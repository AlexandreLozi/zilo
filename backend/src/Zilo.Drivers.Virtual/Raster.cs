namespace Zilo.Drivers.Virtual;

internal readonly record struct Rgb(byte R, byte G, byte B)
{
    public static readonly Rgb White = new(255, 255, 255);
    public static readonly Rgb Black = new(0, 0, 0);

    /// <summary>Integer Rec.601 luma, identical on every platform.</summary>
    public byte Luma => (byte)((299 * R + 587 * G + 114 * B + 500) / 1000);

    public static Rgb Gray(byte v) => new(v, v, v);
}

/// <summary>An RGB canvas. Drawing is clipped to the canvas and uses integer arithmetic only.</summary>
internal sealed class Raster
{
    public int Width { get; }
    public int Height { get; }

    /// <summary>Row-major RGB triplets.</summary>
    public byte[] Pixels { get; }

    public Raster(int width, int height)
    {
        ArgumentOutOfRangeException.ThrowIfLessThan(width, 1);
        ArgumentOutOfRangeException.ThrowIfLessThan(height, 1);
        Width = width;
        Height = height;
        Pixels = new byte[checked(width * height * 3)];
        Array.Fill(Pixels, (byte)255);
    }

    public Rgb this[int x, int y]
    {
        get
        {
            var i = (y * Width + x) * 3;
            return new Rgb(Pixels[i], Pixels[i + 1], Pixels[i + 2]);
        }
    }

    public void FillRect(int x, int y, int w, int h, Rgb c)
    {
        var x0 = Math.Max(0, x);
        var y0 = Math.Max(0, y);
        var x1 = Math.Min(Width, x + w);
        var y1 = Math.Min(Height, y + h);
        if (x0 >= x1 || y0 >= y1) return;
        for (var yy = y0; yy < y1; yy++)
        {
            var i = (yy * Width + x0) * 3;
            for (var xx = x0; xx < x1; xx++, i += 3)
            {
                Pixels[i] = c.R;
                Pixels[i + 1] = c.G;
                Pixels[i + 2] = c.B;
            }
        }
    }

    /// <summary>A rectangle outline with stroke <paramref name="t"/> drawn inside the box.</summary>
    public void StrokeRect(int x, int y, int w, int h, int t, Rgb c)
    {
        FillRect(x, y, w, t, c);
        FillRect(x, y + h - t, w, t, c);
        FillRect(x, y, t, h, c);
        FillRect(x + w - t, y, t, h, c);
    }
}
