using System.Runtime.CompilerServices;
using System.Runtime.Loader;
using System.Security.Cryptography;
using Zilo.Core;
using Zilo.Drivers.Virtual;

var installed = Path.GetFullPath(args[0]);
AssemblyLoadContext.Default.Resolving += (_, name) =>
    AssemblyLoadContext.Default.LoadFromAssemblyPath(Path.Combine(installed, name.Name + ".dll"));
await Prove();

[MethodImpl(MethodImplOptions.NoInlining)]
async Task Prove()
{
    await using var backend = VirtualBackendFactory.Create();
    var devices = await backend.ListDevicesAsync(CancellationToken.None);
    if (!devices.Devices.Any(d => d.Id == "virtual")) throw new Exception("Virtual factory route missing");
    var request = new ScanRequest(JobId.Parse("job-msi-proof-0001"), "virtual",
        new EffectiveSettings("flatbed", 75, "gray", "A5", new SizeMm(148, 210), 1),
        new AcquisitionLimits(1, 10_000_000, 20_000_000));
    var count = 0;
    await foreach (var page in backend.AcquireAsync(request, CancellationToken.None))
    {
        if (page.Index != 0 || page.ContentType != "image/png" ||
            !page.Bytes.AsSpan(0, 8).SequenceEqual(new byte[] { 137, 80, 78, 71, 13, 10, 26, 10 }))
            throw new Exception("Installed Virtual did not generate a PNG/QR page");
        count++;
    }
    if (count != 1) throw new Exception("Expected one installed Virtual page");
    foreach (var name in new[] { "Zilo.Drivers.Virtual", "zxing" })
    {
        var assembly = AppDomain.CurrentDomain.GetAssemblies().Single(a => a.GetName().Name == name);
        var expected = Path.Combine(installed, name + ".dll");
        if (!string.Equals(assembly.Location, expected, StringComparison.OrdinalIgnoreCase))
            throw new Exception("Dependency loaded outside installed payload: " + assembly.Location);
        if (name == "zxing" && assembly.GetName().Version != new Version(0, 16, 11, 0))
            throw new Exception("Installed ZXing version is not exactly 0.16.11.0");
        Console.WriteLine($"installed dependency: {assembly.FullName}; path={assembly.Location}; sha256={Convert.ToHexString(SHA256.HashData(File.ReadAllBytes(expected)))}");
    }
    Console.WriteLine("INSTALLED VIRTUAL + ZXING LOAD PASS: factory + one PNG/QR page");
}
