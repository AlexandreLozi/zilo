using System.Text;
using Zilo.VirtualPages;

// Prototype tool. Commands:
//   samples <dir>   write sample PNGs, their decoded QR JSON and failure-variants.json
//   golden          print the golden-hash table (JSON) to stdout
//   variants        print the failure-variant catalogue (JSON) to stdout
var cmd = args.Length > 0 ? args[0] : "";
var utf8 = new UTF8Encoding(false);
switch (cmd)
{
    case "samples" when args.Length == 2:
    {
        var dir = Directory.CreateDirectory(args[1]).FullName;
        foreach (var c in GoldenMatrix.Samples())
        {
            var png = c.Generate();
            var decoded = QrReader.Decode(png);
            var expected = PageGenerator.QrPayload(c.Settings, c.PageIndex, c.Side, c.Seed);
            if (decoded != expected)
            {
                Console.Error.WriteLine($"{c.Name}: decoded QR '{decoded}' != expected '{expected}'");
                return 1;
            }
            File.WriteAllBytes(Path.Combine(dir, c.Name + ".png"), png);
            File.WriteAllText(Path.Combine(dir, c.Name + ".qr.json"), decoded + "\n", utf8);
            Console.WriteLine($"{c.Name}.png {png.Length} bytes  {decoded}");
        }
        File.WriteAllText(Path.Combine(dir, "failure-variants.json"), VirtualDevices.CatalogueJson(), utf8);
        return 0;
    }
    case "golden":
    {
        var sb = new StringBuilder("{\n");
        var cases = GoldenMatrix.Cases().ToList();
        for (var i = 0; i < cases.Count; i++)
            sb.Append($"  \"{cases[i].Name}\": \"{cases[i].Sha256()}\"{(i + 1 < cases.Count ? "," : "")}\n");
        sb.Append("}\n");
        Console.Out.Write(sb.ToString());
        return 0;
    }
    case "variants":
        Console.Out.Write(VirtualDevices.CatalogueJson());
        return 0;
    default:
        Console.Error.WriteLine("usage: Zilo.VirtualPages samples <dir> | golden | variants");
        return 2;
}
