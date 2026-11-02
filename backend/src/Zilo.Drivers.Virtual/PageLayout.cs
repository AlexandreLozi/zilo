namespace Zilo.Drivers.Virtual;

/// <summary>Axis-aligned rectangle in pixels.</summary>
internal readonly record struct PxRect(int X, int Y, int W, int H);

/// <summary>
/// Physical page layout. All positions are defined in tenths of a millimetre and converted to
/// pixels with exact integer rounding, so element positions are tied to the true DPI.
/// </summary>
internal sealed class PageLayout
{
    public const int MarginTenthMm = 100;
    public const int TickThicknessTenthMm = 2;

    public int Dpi { get; }
    public int WidthPx { get; }
    public int HeightPx { get; }
    public int TickThicknessPx { get; }

    public PxRect Banner { get; }
    public PxRect PageNumber { get; }
    public PxRect SideLabel { get; }
    /// <summary>QR area including the 4-module quiet zone.</summary>
    public PxRect Qr { get; }
    public int QrModulePx { get; }
    public PxRect GrayTarget { get; }
    public PxRect ColorTarget { get; }
    public PxRect Pattern { get; }

    /// <summary>Horizontal mm ruler: baseline at <see cref="MmRulerBaselineY"/>, tick k's left edge at <see cref="MmRulerOriginX"/> + MmToPx(k).</summary>
    public int MmRulerOriginX { get; }
    public int MmRulerBaselineY { get; }
    public int MmRulerLengthMm { get; }

    /// <summary>Horizontal inch ruler (ticks every 1/8 inch, pointing up from a bottom baseline).</summary>
    public int InchRulerOriginX { get; }
    public int InchRulerBaselineY { get; }
    public int InchRulerLengthEighths { get; }

    /// <summary>Vertical mm ruler in the left margin: tick k's top edge at <see cref="VRulerOriginY"/> + MmToPx(k).</summary>
    public int VRulerBaselineX { get; }
    public int VRulerOriginY { get; }
    public int VRulerLengthMm { get; }

    public PageLayout(PageSettings s, int qrModules)
    {
        Dpi = s.Dpi;
        var (wT, hT) = s.Paper.Dimensions();
        WidthPx = Px(wT);
        HeightPx = Px(hT);
        TickThicknessPx = Math.Max(1, Px(TickThicknessTenthMm));
        var m = MarginTenthMm;
        var contentW = wT - 2 * m;

        Banner = R(m, m, contentW, 120);

        QrModulePx = Math.Max(2, Px(6));
        var qrPx = (qrModules + 8) * QrModulePx;
        Qr = new PxRect(Px(wT - m) - qrPx, Px(260), qrPx, qrPx);

        var numberRight = Qr.X - Px(50);
        PageNumber = new PxRect(Px(m), Px(260), Math.Max(1, numberRight - Px(m)), Px(400));
        SideLabel = new PxRect(Px(m), Px(690), Math.Max(1, numberRight - Px(m)), Px(100));

        var targetsTop = Math.Max(820, (int)((Qr.Y + Qr.H) * 508L / (2L * Dpi)) + 40);
        GrayTarget = R(m, targetsTop, 1100, 100);
        ColorTarget = R(m, targetsTop + 120, 800, 100);

        var rulersTop = hT - m - 200;
        var patternTop = targetsTop + 260;
        Pattern = R(m, patternTop, contentW, Math.Max(100, rulersTop - 60 - patternTop));

        MmRulerOriginX = Px(m);
        MmRulerBaselineY = Px(rulersTop);
        MmRulerLengthMm = contentW / 10;

        InchRulerOriginX = Px(m);
        InchRulerBaselineY = Px(hT - m) - TickThicknessPx;
        InchRulerLengthEighths = (int)(contentW * 8L / 254);

        VRulerBaselineX = Px(90);
        VRulerOriginY = Px(m);
        VRulerLengthMm = (hT - 2 * m) / 10;
    }

    /// <summary>round(tenths * dpi / 254), half up.</summary>
    public int Px(int tenthMm) => (int)((tenthMm * (long)Dpi * 2 + 254) / 508);

    /// <summary>Pixel offset of k millimetres: round(k * dpi / 25.4).</summary>
    public int MmToPx(int mm) => Px(mm * 10);

    /// <summary>Pixel offset of k eighths of an inch: round(k * dpi / 8).</summary>
    public int EighthsToPx(int k) => (int)((k * (long)Dpi * 2 + 8) / 16);

    private PxRect R(int x, int y, int w, int h)
    {
        var x0 = Px(x);
        var y0 = Px(y);
        return new PxRect(x0, y0, Px(x + w) - x0, Px(y + h) - y0);
    }
}
