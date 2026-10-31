using System.Globalization;
using System.Numerics;
using System.Reflection;
using System.Reflection.Metadata;
using System.Reflection.PortableExecutable;
using System.Text;
using System.Text.Json;
using NAPS2.Images;
using NAPS2.ImportExport;
using NAPS2.Pdf;
using NAPS2.Scan;
using SixLabors.Fonts;

// Independent feasibility probe, not a service, hardware emulator, or production driver.
CultureInfo.CurrentCulture = CultureInfo.InvariantCulture;
try
{
    if (args.FirstOrDefault() == "inspect")
    {
        using var stream = File.OpenRead(typeof(ScanController).Assembly.Location);
        using var pe = new PEReader(stream);
        var metadata = pe.GetMetadataReader();
        var types = metadata.TypeDefinitions.Select(handle => metadata.GetTypeDefinition(handle))
            .Select(type => metadata.GetString(type.Namespace) + "." + metadata.GetString(type.Name)).ToArray();
        var references = metadata.AssemblyReferences.Select(handle => metadata.GetString(metadata.GetAssemblyReference(handle).Name)).ToArray();
        Write(new { hasAppleDriver = types.Any(name => name.EndsWith(".AppleScanDriver")),
            hasImageCaptureCoreReference = references.Any(name => name.Contains("ImageCaptureCore") || name.Contains("Microsoft.macOS")),
            driverTypes = types.Where(name => name.EndsWith("ScanDriver")).Order().ToArray(), references });
        return 0;
    }
    string platform = OperatingSystem.IsWindows() ? "Gdi" : OperatingSystem.IsMacOS() ? "Mac" : "Gtk";
    var type = Assembly.Load($"NAPS2.Images.{platform}").GetType($"NAPS2.Images.{platform}.{platform}ImageContext", true)!;
    var images = (ImageContext)Activator.CreateInstance(type)!;
    using var context = new ScanningContext(images);
    var controller = new ScanController(context);
    switch (args.FirstOrDefault())
    {
        case "list":
            var driver = args.Length > 1 ? Enum.Parse<Driver>(args[1], true) : Driver.Default;
            var devices = await controller.GetDeviceList(new ScanOptions { Driver = driver });
            Write(new { driver = driver.ToString(), count = devices.Count, devices, acquisitionProven = false });
            break;
        case "fixture":
            var device = new ScanDevice(Driver.Escl, args[1], "Independent Python eSCL fixture");
            var caps = await controller.GetCaps(device);
            Directory.CreateDirectory(args[2]);
            int count = 0;
            await foreach (var page in controller.Scan(new ScanOptions
            {
                Device = device, Dpi = 75, PageSize = PageSize.Letter,
                PaperSource = PaperSource.Flatbed, MaxQuality = true
            }))
            {
                using (page)
                using (var rendered = images.Render(page))
                {
                    rendered.Save(Path.Combine(args[2], $"fixture-{count++}.png"));
                    if (rendered.Width != 32 || rendered.Height != 24) throw new Exception("Unexpected fixture dimensions");
                }
            }
            if (count != 1 || caps.MetadataCaps?.Model != "Zilo independent SP-2a fixture")
                throw new Exception("Fixture page count or model mismatch");
            Write(new { fixture = "independent-python-escl", pages = count, model = caps.MetadataCaps.Model, hardware = false });
            break;
        case "render":
            Directory.CreateDirectory(args[1]);
            var family = SystemFonts.Families.First();
            var options = new TextOptions(family.CreateFont(28)) { Origin = new Vector2(5, 5) };
            var renderer = new SvgGlyphRenderer();
            TextRenderer.RenderTextTo(renderer, "Zilo Fonts 1.0.1", options);
            File.WriteAllText(Path.Combine(args[1], "fonts.svg"), renderer.Svg);
            using (var image = images.Load(TestBitmap()))
            {
                image.SetResolution(75, 75);
                image.Save(Path.Combine(args[1], "page.png"));
            }
            var pages = new List<ProcessedImage>();
            try
            {
                await foreach (var page in new ImageImporter(context).Import(Path.Combine(args[1], "page.png"))) pages.Add(page);
                if (!await new PdfExporter(context).Export(Path.Combine(args[1], "page.pdf"), pages)) throw new Exception("PDF export cancelled");
            }
            finally { foreach (var page in pages) page.Dispose(); }
            Write(new
            {
                platform, fontsPackage = "1.0.1", fontFamily = family.Name,
                fontsAssembly = typeof(Font).Assembly.GetCustomAttribute<AssemblyInformationalVersionAttribute>()?.InformationalVersion,
                textWidth = TextMeasurer.MeasureSize("Zilo Fonts 1.0.1", options).Width,
                glyphPaths = renderer.Paths,
                pngBytes = new FileInfo(Path.Combine(args[1], "page.png")).Length,
                pdfBytes = new FileInfo(Path.Combine(args[1], "page.pdf")).Length,
                scope = "Fonts glyph outlines to SVG; independent raster image to PNG/PDF; no OCR or PDF import"
            });
            break;
        default:
            throw new ArgumentException("Usage: list [Default|Escl|Sane|Wia|Twain|Apple] | render OUTDIR | fixture URL OUTDIR");
    }
    return 0;
}
catch (Exception ex)
{
    Console.Error.WriteLine(JsonSerializer.Serialize(new { error = ex.GetType().FullName, message = ex.Message, detail = ex.InnerException?.Message }));
    return 1;
}

static void Write(object result) => Console.WriteLine(JsonSerializer.Serialize(result));

static byte[] TestBitmap()
{
    const int width = 32, height = 24, stride = width * 3;
    using var stream = new MemoryStream();
    using var writer = new BinaryWriter(stream);
    writer.Write((ushort)0x4d42); writer.Write(54 + stride * height); writer.Write(0); writer.Write(54);
    writer.Write(40); writer.Write(width); writer.Write(height); writer.Write((ushort)1); writer.Write((ushort)24);
    writer.Write(0); writer.Write(stride * height); writer.Write(2953); writer.Write(2953); writer.Write(0); writer.Write(0);
    for (int y = 0; y < height; y++)
        for (int x = 0; x < width; x++) { writer.Write((byte)(x * 7)); writer.Write((byte)(y * 9)); writer.Write((byte)200); }
    return stream.ToArray();
}

// Original, deliberately small vector sink exercises the pinned Fonts glyph renderer without ImageSharp.
sealed class SvgGlyphRenderer : IGlyphRenderer
{
    private readonly StringBuilder paths = new();
    private readonly StringBuilder current = new();
    public int Paths { get; private set; }
    public string Svg => $"<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"800\" height=\"100\" viewBox=\"0 0 800 100\">{paths}</svg>";
    public TextDecorations EnabledDecorations() => TextDecorations.None;
    public void SetDecoration(TextDecorations decoration, Vector2 start, Vector2 end, float thickness) { }
    public void BeginText(in FontRectangle bounds) { }
    public void EndText() { }
    public bool BeginGlyph(in FontRectangle bounds, in GlyphRendererParameters parameters) { current.Clear(); return true; }
    public void EndGlyph() { if (current.Length > 0) { paths.Append($"<path d=\"{current}\"/>"); Paths++; } }
    public void BeginFigure() { }
    public void EndFigure() => current.Append("Z ");
    public void MoveTo(Vector2 point) => current.Append($"M{point.X},{point.Y} ");
    public void LineTo(Vector2 point) => current.Append($"L{point.X},{point.Y} ");
    public void QuadraticBezierTo(Vector2 control, Vector2 point) => current.Append($"Q{control.X},{control.Y} {point.X},{point.Y} ");
    public void CubicBezierTo(Vector2 first, Vector2 second, Vector2 point) => current.Append($"C{first.X},{first.Y} {second.X},{second.Y} {point.X},{point.Y} ");
}
