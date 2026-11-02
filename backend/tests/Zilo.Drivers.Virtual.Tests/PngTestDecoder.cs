using System.Buffers.Binary;
using System.IO.Compression;
using System.Text;
using Xunit;

namespace Zilo.Drivers.Virtual.Tests;

// This is intentionally a pixel decoder, not a byte-level PNG assertion. The production encoder
// is verified through the pixels that a normal PNG reader and QR reader observe.
internal static class PngTestDecoder
{
    public static (int Width, int Height, int Depth, int Type, byte[] Luma, byte[] Rgb) Decode(ReadOnlySpan<byte> png)
    {
        ReadOnlySpan<byte> signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
        Assert.True(png.StartsWith(signature));
        var pos = 8; var width = 0; var height = 0; var depth = 0; var type = 0;
        using var compressed = new MemoryStream();
        while (pos < png.Length)
        {
            var length = BinaryPrimitives.ReadInt32BigEndian(png[pos..]);
            var name = Encoding.ASCII.GetString(png.Slice(pos + 4, 4));
            var data = png.Slice(pos + 8, length);
            if (name == "IHDR")
            {
                width = BinaryPrimitives.ReadInt32BigEndian(data);
                height = BinaryPrimitives.ReadInt32BigEndian(data[4..]);
                depth = data[8]; type = data[9];
            }
            else if (name == "IDAT") compressed.Write(data);
            pos += length + 12;
            if (name == "IEND") break;
        }
        var channels = type == 2 ? 3 : 1;
        var rowBytes = checked((width * channels * depth + 7) / 8);
        compressed.Position = 0;
        using var inflater = new ZLibStream(compressed, CompressionMode.Decompress);
        var raw = new byte[checked((rowBytes + 1) * height)];
        inflater.ReadExactly(raw);
        var luma = new byte[checked(width * height)];
        var rgb = new byte[checked(width * height * 3)];
        for (var y = 0; y < height; y++)
        {
            var row = y * (rowBytes + 1);
            Assert.Equal(0, raw[row]);
            for (var x = 0; x < width; x++)
            {
                var r = type switch
                {
                    0 when depth == 1 => (raw[row + 1 + (x >> 3)] & (0x80 >> (x & 7))) != 0 ? 255 : 0,
                    0 => raw[row + 1 + x],
                    2 => raw[row + 1 + x * 3],
                    _ => throw new InvalidDataException("Unsupported test image."),
                };
                var g = type == 2 ? raw[row + 2 + x * 3] : r;
                var b = type == 2 ? raw[row + 3 + x * 3] : r;
                var value = type switch
                {
                    0 => r,
                    2 => (299 * r + 587 * g + 114 * b + 500) / 1000,
                    _ => throw new InvalidDataException("Unsupported test image."),
                };
                luma[y * width + x] = (byte)value;
                rgb[(y * width + x) * 3] = (byte)r;
                rgb[(y * width + x) * 3 + 1] = (byte)g;
                rgb[(y * width + x) * 3 + 2] = (byte)b;
            }
        }
        return (width, height, depth, type, luma, rgb);
    }
}
