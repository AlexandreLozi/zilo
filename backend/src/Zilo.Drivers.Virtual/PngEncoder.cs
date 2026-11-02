using System.Buffers.Binary;
using System.Text;

namespace Zilo.Drivers.Virtual;

/// <summary>
/// Hand-written PNG encoder: 1-bit grayscale (bw, ordered dither), 8-bit grayscale (gray) or
/// 8-bit RGB (color). Filter type 0 on every row, our own deflate, and a pHYs chunk with the DPI.
/// No time or text chunks, so output depends only on the pixels and DPI.
/// </summary>
internal static class PngEncoder
{
    private static readonly byte[] Signature = [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A];

    // 4x4 Bayer matrix, values 0..15.
    private static readonly int[] Bayer = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];

    public static byte[] Encode(Raster r, ColorMode mode, int dpi, CancellationToken cancellationToken = default)
    {
        var (bitDepth, colorType, rowBytes) = mode switch
        {
            ColorMode.Bw => (1, 0, (r.Width + 7) / 8),
            ColorMode.Gray => (8, 0, r.Width),
            ColorMode.Color => (8, 2, r.Width * 3),
            _ => throw new ArgumentOutOfRangeException(nameof(mode)),
        };

        cancellationToken.ThrowIfCancellationRequested();
        var raw = new byte[checked((rowBytes + 1) * r.Height)];
        var px = r.Pixels;
        for (var y = 0; y < r.Height; y++)
        {
            if ((y & 31) == 0) cancellationToken.ThrowIfCancellationRequested();
            var o = y * (rowBytes + 1);
            raw[o++] = 0; // filter: None
            var s = y * r.Width * 3;
            switch (mode)
            {
                case ColorMode.Color:
                    Buffer.BlockCopy(px, s, raw, o, rowBytes);
                    break;
                case ColorMode.Gray:
                    for (var x = 0; x < r.Width; x++, s += 3)
                        raw[o + x] = new Rgb(px[s], px[s + 1], px[s + 2]).Luma;
                    break;
                case ColorMode.Bw:
                    for (var x = 0; x < r.Width; x++, s += 3)
                    {
                        var l = new Rgb(px[s], px[s + 1], px[s + 2]).Luma;
                        var white = 2 * l > 32 * Bayer[(y & 3) * 4 + (x & 3)] + 16;
                        if (white) raw[o + (x >> 3)] |= (byte)(0x80 >> (x & 7));
                    }
                    break;
            }
        }

        cancellationToken.ThrowIfCancellationRequested();
        using var ms = new MemoryStream();
        ms.Write(Signature);

        Span<byte> ihdr = stackalloc byte[13];
        BinaryPrimitives.WriteInt32BigEndian(ihdr, r.Width);
        BinaryPrimitives.WriteInt32BigEndian(ihdr[4..], r.Height);
        ihdr[8] = (byte)bitDepth;
        ihdr[9] = (byte)colorType;
        ihdr[10] = 0; // deflate
        ihdr[11] = 0; // adaptive filtering method
        ihdr[12] = 0; // no interlace
        WriteChunk(ms, "IHDR", ihdr);

        Span<byte> phys = stackalloc byte[9];
        var ppm = (int)((dpi * 10000L * 2 + 254) / 508); // round(dpi / 0.0254)
        BinaryPrimitives.WriteInt32BigEndian(phys, ppm);
        BinaryPrimitives.WriteInt32BigEndian(phys[4..], ppm);
        phys[8] = 1; // metre
        WriteChunk(ms, "pHYs", phys);

        WriteChunk(ms, "IDAT", Deflate.ZlibCompress(raw, cancellationToken));
        WriteChunk(ms, "IEND", []);
        return ms.ToArray();
    }

    private static void WriteChunk(Stream s, string type, ReadOnlySpan<byte> data)
    {
        Span<byte> len = stackalloc byte[4];
        BinaryPrimitives.WriteInt32BigEndian(len, data.Length);
        s.Write(len);
        var t = Encoding.ASCII.GetBytes(type);
        s.Write(t);
        s.Write(data);
        var crc = Crc32.Update(Crc32.Update(0xFFFFFFFFu, t), data) ^ 0xFFFFFFFFu;
        Span<byte> c = stackalloc byte[4];
        BinaryPrimitives.WriteUInt32BigEndian(c, crc);
        s.Write(c);
    }
}

internal static class Crc32
{
    private static readonly uint[] Table = Build();

    private static uint[] Build()
    {
        var t = new uint[256];
        for (uint n = 0; n < 256; n++)
        {
            var c = n;
            for (var k = 0; k < 8; k++) c = (c & 1) != 0 ? 0xEDB88320u ^ (c >> 1) : c >> 1;
            t[n] = c;
        }
        return t;
    }

    public static uint Update(uint crc, ReadOnlySpan<byte> data)
    {
        foreach (var b in data) crc = Table[(crc ^ b) & 0xFF] ^ (crc >> 8);
        return crc;
    }
}
