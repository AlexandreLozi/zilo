using System.Globalization;
using System.Text.Json;
using ZXing.QrCode.Internal;

namespace Zilo.Drivers.Virtual;

/// <summary>Deterministic virtual page generator using integer layout, managed deflate and a private PRNG.</summary>
internal static class PageGenerator
{
    /// <summary>Generates one page as PNG bytes.</summary>
    /// <param name="settings">Scan settings, including the job ID written into the QR payload.</param>
    /// <param name="pageIndex">Zero-based index of the image in the job's order.</param>
    /// <param name="side">Front or back; back is only valid for a duplex source.</param>
    /// <param name="seed">Seed for the page pattern.</param>
    public static byte[] Generate(PageSettings settings, int pageIndex, Side side, uint seed,
        CancellationToken cancellationToken = default)
    {
        var raster = Render(settings, pageIndex, side, seed, out _, cancellationToken);
        return PngEncoder.Encode(raster, settings.Mode, settings.Dpi, cancellationToken);
    }

    /// <summary>The exact QR payload a page carries (fixed key order, no whitespace).</summary>
    /// <remarks>
    /// Validates <paramref name="s"/> first. The job ID charset needs no JSON escaping, so the
    /// payload is valid JSON for every accepted input.
    /// </remarks>
    public static string QrPayload(PageSettings s, int pageIndex, Side side, uint seed)
    {
        ArgumentNullException.ThrowIfNull(s);
        s.Validate();
        return JsonSerializer.Serialize(new
        {
            job = s.Job,
            page = pageIndex,
            side = side.Name(),
            dpi = s.Dpi,
            mode = s.Mode.Name(),
            paper = s.Paper.Name(),
            seed,
        });
    }

    /// <summary>Layout for the given page (the QR size depends on the payload length).</summary>
    public static PageLayout Layout(PageSettings s, int pageIndex, Side side, uint seed) =>
        new(s, EncodeQr(QrPayload(s, pageIndex, side, seed)).Width);

    internal static Raster Render(PageSettings s, int pageIndex, Side side, uint seed,
        out PageLayout layout, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(s);
        s.Validate();
        ArgumentOutOfRangeException.ThrowIfNegative(pageIndex);
        if (!Enum.IsDefined(side)) throw new ArgumentOutOfRangeException(nameof(side));
        if (side == Side.Back && s.Source != ScanSource.Duplex)
            throw new ArgumentException("A back side requires the duplex source.", nameof(side));

        var qr = EncodeQr(QrPayload(s, pageIndex, side, seed));
        var l = layout = new PageLayout(s, qr.Width);
        cancellationToken.ThrowIfCancellationRequested();
        var r = new Raster(l.WidthPx, l.HeightPx);

        cancellationToken.ThrowIfCancellationRequested();
        DrawBanner(r, l, s, pageIndex + 1, side, seed, cancellationToken);
        DrawPageNumber(r, l, pageIndex + 1, side);
        DrawQr(r, l, qr);
        DrawTargets(r, l);
        DrawPattern(r, l, pageIndex, side, seed, cancellationToken);
        DrawRulers(r, l);
        return r;
    }

    private static ByteMatrix EncodeQr(string payload)
    {
        var hints = new Dictionary<ZXing.EncodeHintType, object>
        {
            [ZXing.EncodeHintType.CHARACTER_SET] = "ISO-8859-1",
            [ZXing.EncodeHintType.DISABLE_ECI] = true,
        };
        return Encoder.encode(payload, ErrorCorrectionLevel.M, hints).Matrix;
    }

    private static void DrawBanner(Raster r, PageLayout l, PageSettings s, int pageIndex, Side side, uint seed,
        CancellationToken cancellationToken)
    {
        var b = l.Banner;
        r.FillRect(b.X, b.Y, b.W, b.H, Rgb.Black);
        var pad = l.Px(15);
        var lineH = (b.H - 3 * pad) / 2;
        var line1 = $"ZILO VIRTUAL SCANNER  JOB {s.Job}";
        var line2 = string.Create(CultureInfo.InvariantCulture,
            $"{s.Dpi} DPI  {s.Mode.Name()}  {s.Paper.Name()}  {s.Source.Name()}  P{pageIndex} {side.Name()}  SEED {seed}");
        var avail = b.W - 2 * pad;
        var s1 = BitmapFont.FitScale(line1, avail, lineH);
        var s2 = BitmapFont.FitScale(line2, avail, lineH);
        cancellationToken.ThrowIfCancellationRequested();
        BitmapFont.Draw(r, line1, b.X + pad, b.Y + pad, s1, Rgb.White);
        BitmapFont.Draw(r, line2, b.X + pad, b.Y + 2 * pad + lineH, s2, Rgb.White);
    }

    private static void DrawPageNumber(Raster r, PageLayout l, int pageIndex, Side side)
    {
        var n = pageIndex.ToString(CultureInfo.InvariantCulture);
        var a = l.PageNumber;
        var sc = BitmapFont.FitScale(n, a.W, a.H);
        BitmapFont.Draw(r, n, a.X, a.Y, sc, Rgb.Black);

        var label = side == Side.Front ? "FRONT" : "BACK";
        var sl = l.SideLabel;
        var sc2 = BitmapFont.FitScale(label, sl.W, sl.H);
        if (side == Side.Back)
        {
            // Back pages are visually distinct: white text on a black bar.
            r.FillRect(sl.X, sl.Y, BitmapFont.MeasureWidth(label, sc2) + 2 * sc2, sl.H, Rgb.Black);
            BitmapFont.Draw(r, label, sl.X + sc2, sl.Y + (sl.H - 7 * sc2) / 2, sc2, Rgb.White);
        }
        else
        {
            BitmapFont.Draw(r, label, sl.X, sl.Y + (sl.H - 7 * sc2) / 2, sc2, Rgb.Black);
        }
    }

    private static void DrawQr(Raster r, PageLayout l, ByteMatrix m)
    {
        var q = l.Qr;
        var mod = l.QrModulePx;
        r.FillRect(q.X, q.Y, q.W, q.H, Rgb.White);
        var ox = q.X + 4 * mod;
        var oy = q.Y + 4 * mod;
        for (var y = 0; y < m.Height; y++)
        for (var x = 0; x < m.Width; x++)
            if (m[x, y] == 1)
                r.FillRect(ox + x * mod, oy + y * mod, mod, mod, Rgb.Black);
    }

    /// <summary>11 grey steps (white to black) and 8 colour patches.</summary>
    internal static readonly Rgb[] ColorPatches =
    [
        new(255, 0, 0), new(0, 255, 0), new(0, 0, 255), new(0, 255, 255),
        new(255, 0, 255), new(255, 255, 0), new(0, 0, 0), new(255, 255, 255),
    ];

    internal static byte GrayStep(int i) => (byte)((255 * (10 - i) + 5) / 10);

    private static void DrawTargets(Raster r, PageLayout l)
    {
        var t = l.TickThicknessPx;
        var g = l.GrayTarget;
        for (var i = 0; i < 11; i++)
        {
            var x0 = g.X + l.Px(i * 100);
            var x1 = g.X + l.Px((i + 1) * 100);
            r.FillRect(x0, g.Y, x1 - x0, g.H, Rgb.Gray(GrayStep(i)));
        }
        r.StrokeRect(g.X - t, g.Y - t, g.W + 2 * t, g.H + 2 * t, t, Rgb.Black);

        var c = l.ColorTarget;
        for (var i = 0; i < ColorPatches.Length; i++)
        {
            var x0 = c.X + l.Px(i * 100);
            var x1 = c.X + l.Px((i + 1) * 100);
            r.FillRect(x0, c.Y, x1 - x0, c.H, ColorPatches[i]);
        }
        r.StrokeRect(c.X - t, c.Y - t, c.W + 2 * t, c.H + 2 * t, t, Rgb.Black);
    }

    private static void DrawPattern(Raster r, PageLayout l, int pageIndex, Side side, uint seed,
        CancellationToken cancellationToken)
    {
        var p = l.Pattern;
        var rng = new SplitMix64(((ulong)seed << 32) ^ ((ulong)pageIndex << 1) ^ (ulong)side);
        const int Cell = 50; // 5 mm
        var cols = (int)((p.W * 508L / (2L * l.Dpi)) / Cell);
        var rows = (int)((p.H * 508L / (2L * l.Dpi)) / Cell);
        for (var row = 0; row < rows; row++)
        for (var col = 0; col < cols; col++)
        {
            if ((col & 31) == 0) cancellationToken.ThrowIfCancellationRequested();
            var v = rng.Next();
            var x0 = p.X + l.Px(col * Cell);
            var x1 = p.X + l.Px((col + 1) * Cell);
            var y0 = p.Y + l.Px(row * Cell);
            var y1 = p.Y + l.Px((row + 1) * Cell);
            var c = new Rgb((byte)v, (byte)(v >> 8), (byte)(v >> 16));
            r.FillRect(x0, y0, x1 - x0, y1 - y0, c);
            // A seeded inner mark (one of four quadrants) so the pattern has fine structure too.
            var q = (int)(v >> 24) & 3;
            var hw = (x1 - x0) / 2;
            var hh = (y1 - y0) / 2;
            var inner = c.Luma < 128 ? Rgb.White : Rgb.Black;
            r.FillRect(x0 + (q & 1) * hw + hw / 4, y0 + (q >> 1) * hh + hh / 4, hw / 2, hh / 2, inner);
        }
        var t = l.TickThicknessPx;
        r.StrokeRect(p.X - t, p.Y - t, l.Px(cols * Cell) + 2 * t, l.Px(rows * Cell) + 2 * t, t, Rgb.Black);
    }

    private static void DrawRulers(Raster r, PageLayout l)
    {
        var t = l.TickThicknessPx;
        var labelScale = Math.Max(1, l.Px(25) / 7);

        // Horizontal mm ruler: baseline on top, ticks pointing down.
        var y = l.MmRulerBaselineY;
        var x0 = l.MmRulerOriginX;
        r.FillRect(x0, y, l.MmToPx(l.MmRulerLengthMm) + t, t, Rgb.Black);
        for (var k = 0; k <= l.MmRulerLengthMm; k++)
        {
            var len = l.Px(k % 10 == 0 ? 50 : k % 5 == 0 ? 35 : 20);
            var x = x0 + l.MmToPx(k);
            r.FillRect(x, y, t, len, Rgb.Black);
            if (k % 10 == 0 && k > 0)
            {
                var txt = k.ToString(CultureInfo.InvariantCulture);
                var w = BitmapFont.MeasureWidth(txt, labelScale);
                BitmapFont.Draw(r, txt, x - w / 2, y + l.Px(60), labelScale, Rgb.Black);
            }
        }
        BitmapFont.Draw(r, "MM", x0 + l.Px(15), y + l.Px(60), labelScale, Rgb.Black);

        // Horizontal inch ruler: baseline at the bottom, ticks every 1/8 inch pointing up.
        var yb = l.InchRulerBaselineY;
        r.FillRect(x0, yb, l.EighthsToPx(l.InchRulerLengthEighths) + t, t, Rgb.Black);
        for (var k = 0; k <= l.InchRulerLengthEighths; k++)
        {
            var len = l.Px(k % 8 == 0 ? 50 : k % 4 == 0 ? 35 : k % 2 == 0 ? 25 : 15);
            var x = l.InchRulerOriginX + l.EighthsToPx(k);
            r.FillRect(x, yb + t - len, t, len, Rgb.Black);
            if (k % 8 == 0 && k > 0)
            {
                var txt = (k / 8).ToString(CultureInfo.InvariantCulture);
                var w = BitmapFont.MeasureWidth(txt, labelScale);
                BitmapFont.Draw(r, txt, x - w / 2, yb - l.Px(85), labelScale, Rgb.Black);
            }
        }
        BitmapFont.Draw(r, "IN", x0 + l.Px(15), yb - l.Px(85), labelScale, Rgb.Black);

        // Vertical mm ruler in the left margin: baseline on the right, ticks pointing left.
        var bx = l.VRulerBaselineX;
        var y0 = l.VRulerOriginY;
        r.FillRect(bx, y0, t, l.MmToPx(l.VRulerLengthMm) + t, Rgb.Black);
        for (var k = 0; k <= l.VRulerLengthMm; k++)
        {
            var len = l.Px(k % 10 == 0 ? 50 : k % 5 == 0 ? 35 : 20);
            r.FillRect(bx + t - len, y0 + l.MmToPx(k), len, t, Rgb.Black);
        }
    }
}

/// <summary>SplitMix64 (public-domain algorithm), implemented here so the sequence never depends on the runtime.</summary>
internal struct SplitMix64(ulong state)
{
    private ulong _state = state;

    public ulong Next()
    {
        var z = _state += 0x9E3779B97F4A7C15UL;
        z = (z ^ (z >> 30)) * 0xBF58476D1CE4E5B9UL;
        z = (z ^ (z >> 27)) * 0x94D049BB133111EBUL;
        return z ^ (z >> 31);
    }
}
