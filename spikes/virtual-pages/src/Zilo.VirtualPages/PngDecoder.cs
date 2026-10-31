using System.Buffers.Binary;
using System.IO.Compression;
using System.Text;

namespace Zilo.VirtualPages;

/// <summary>A decoded PNG as an RGB raster plus its header fields.</summary>
public sealed record DecodedPng(int Width, int Height, int BitDepth, int ColorType, int? PixelsPerMetre, Raster Raster)
{
    /// <summary>8-bit luminance, row-major, for barcode decoders.</summary>
    public byte[] Luminance()
    {
        var px = Raster.Pixels;
        var l = new byte[Width * Height];
        for (var i = 0; i < l.Length; i++) l[i] = new Rgb(px[i * 3], px[i * 3 + 1], px[i * 3 + 2]).Luma;
        return l;
    }
}

/// <summary>
/// Minimal PNG reader for verification (tests and the sample tool): non-interlaced grayscale
/// (1/8-bit) and 8-bit RGB, all five filter types, CRC-checked, with IHDR first, IDAT present and
/// IEND required as the final chunk. Not hardened for untrusted input. Inflate uses the runtime, which is
/// fine because decoding is not part of the byte-identity guarantee.
/// </summary>
public static class PngDecoder
{
    public static DecodedPng Decode(ReadOnlySpan<byte> png)
    {
        ReadOnlySpan<byte> sig = [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A];
        if (!png.StartsWith(sig)) throw new InvalidDataException("Not a PNG.");
        var pos = 8;
        int w = 0, h = 0, depth = 0, type = 0;
        int? ppm = null;
        bool ihdr = false, sawIdat = false, iend = false;
        using var idat = new MemoryStream();
        while (pos < png.Length)
        {
            // Structural checks only (review r1 L3): this is a verifier for trusted generator output,
            // not a general-purpose or hardened PNG parser.
            if (png.Length - pos < 12) throw new InvalidDataException("Truncated chunk header.");
            var len = BinaryPrimitives.ReadInt32BigEndian(png[pos..]);
            if (len < 0 || len > png.Length - pos - 12) throw new InvalidDataException("Chunk length out of range.");
            var ctype = Encoding.ASCII.GetString(png.Slice(pos + 4, 4));
            var data = png.Slice(pos + 8, len);
            var crc = BinaryPrimitives.ReadUInt32BigEndian(png[(pos + 8 + len)..]);
            var calc = Crc32.Update(0xFFFFFFFFu, png.Slice(pos + 4, 4 + len)) ^ 0xFFFFFFFFu;
            if (crc != calc) throw new InvalidDataException($"Bad CRC in {ctype}.");
            if (!ihdr && ctype != "IHDR") throw new InvalidDataException("First chunk must be IHDR.");
            switch (ctype)
            {
                case "IHDR":
                    if (ihdr || len != 13) throw new InvalidDataException("Bad IHDR.");
                    ihdr = true;
                    w = BinaryPrimitives.ReadInt32BigEndian(data);
                    h = BinaryPrimitives.ReadInt32BigEndian(data[4..]);
                    depth = data[8];
                    type = data[9];
                    if (w <= 0 || h <= 0) throw new InvalidDataException("Bad dimensions.");
                    if (data[12] != 0) throw new NotSupportedException("Interlaced PNG.");
                    break;
                case "pHYs" when len == 9 && data[8] == 1:
                    ppm = BinaryPrimitives.ReadInt32BigEndian(data);
                    break;
                case "IDAT":
                    sawIdat = true;
                    idat.Write(data);
                    break;
            }
            pos += 12 + len;
            if (ctype == "IEND")
            {
                iend = true;
                break;
            }
        }
        if (!iend) throw new InvalidDataException("Missing IEND.");
        if (pos != png.Length) throw new InvalidDataException("Data after IEND.");
        if (!sawIdat) throw new InvalidDataException("Missing IDAT.");

        var channels = type switch { 0 => 1, 2 => 3, _ => throw new NotSupportedException($"Colour type {type}.") };
        if (depth != 8 && !(depth == 1 && type == 0)) throw new NotSupportedException($"Bit depth {depth}.");
        var bitsPerPixel = channels * depth;
        var rowBytes = checked((int)(((long)w * bitsPerPixel + 7) / 8));
        var bpp = Math.Max(1, bitsPerPixel / 8);

        idat.Position = 0;
        using var z = new ZLibStream(idat, CompressionMode.Decompress);
        var raw = new byte[checked((rowBytes + 1) * h)];
        try
        {
            z.ReadExactly(raw);
        }
        catch (EndOfStreamException e)
        {
            throw new InvalidDataException("Image data shorter than the header requires.", e);
        }

        var r = new Raster(w, h);
        var prev = new byte[rowBytes];
        var cur = new byte[rowBytes];
        for (var y = 0; y < h; y++)
        {
            var o = y * (rowBytes + 1);
            var f = raw[o];
            for (var i = 0; i < rowBytes; i++)
            {
                int a = i >= bpp ? cur[i - bpp] : 0, b = prev[i], c = i >= bpp ? prev[i - bpp] : 0;
                var x = raw[o + 1 + i];
                cur[i] = f switch
                {
                    0 => x,
                    1 => (byte)(x + a),
                    2 => (byte)(x + b),
                    3 => (byte)(x + (a + b) / 2),
                    4 => (byte)(x + Paeth(a, b, c)),
                    _ => throw new InvalidDataException($"Filter {f}."),
                };
            }
            for (var x = 0; x < w; x++)
            {
                Rgb px = (type, depth) switch
                {
                    (0, 1) => (cur[x >> 3] & (0x80 >> (x & 7))) != 0 ? Rgb.White : Rgb.Black,
                    (0, 8) => Rgb.Gray(cur[x]),
                    _ => new Rgb(cur[x * 3], cur[x * 3 + 1], cur[x * 3 + 2]),
                };
                var di = (y * w + x) * 3;
                r.Pixels[di] = px.R;
                r.Pixels[di + 1] = px.G;
                r.Pixels[di + 2] = px.B;
            }
            (prev, cur) = (cur, prev);
        }
        return new DecodedPng(w, h, depth, type, ppm, r);
    }

    private static int Paeth(int a, int b, int c)
    {
        var p = a + b - c;
        int pa = Math.Abs(p - a), pb = Math.Abs(p - b), pc = Math.Abs(p - c);
        return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
    }
}
