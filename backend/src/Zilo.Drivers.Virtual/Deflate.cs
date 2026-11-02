namespace Zilo.Drivers.Virtual;

/// <summary>
/// A small, fully managed zlib (RFC 1950) / deflate (RFC 1951) encoder: one fixed-Huffman block,
/// greedy LZ77 with bounded hash chains. It exists so that PNG bytes do not depend on the
/// runtime's native zlib build (which can differ by OS, CPU and .NET version). Any standard
/// inflater, including <see cref="System.IO.Compression.ZLibStream"/>, decodes the output.
/// </summary>
internal static class Deflate
{
    private const int WindowSize = 32768;
    private const int MinMatch = 3;
    private const int MaxMatch = 258;
    private const int HashBits = 15;
    private const int HashSize = 1 << HashBits;
    private const int MaxChain = 16;

    private static readonly int[] LengthBase =
        [3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115, 131, 163, 195, 227, 258];
    private static readonly int[] LengthExtra =
        [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0];
    private static readonly int[] DistBase =
        [1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769, 1025, 1537, 2049, 3073, 4097, 6145, 8193, 12289, 16385, 24577];
    private static readonly int[] DistExtra =
        [0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13];

    private static readonly byte[] LengthCode = BuildLengthCodeTable();

    private static byte[] BuildLengthCodeTable()
    {
        var t = new byte[MaxMatch + 1];
        for (var code = 0; code < LengthBase.Length; code++)
        {
            var hi = code == LengthBase.Length - 1 ? 258 : LengthBase[code] + (1 << LengthExtra[code]) - 1;
            for (var len = LengthBase[code]; len <= Math.Min(hi, MaxMatch); len++) t[len] = (byte)code;
        }
        t[258] = 28;
        return t;
    }

    public static byte[] ZlibCompress(ReadOnlySpan<byte> data, CancellationToken cancellationToken = default)
    {
        var w = new BitWriter(Math.Max(1024, data.Length / 8));
        w.WriteByte(0x78); // CMF: deflate, 32K window
        w.WriteByte(0x01); // FLG: fastest, check bits ok (0x7801 % 31 == 0)
        w.WriteBits(1, 1); // BFINAL
        w.WriteBits(1, 2); // BTYPE = 01 fixed Huffman

        var head = new int[HashSize];
        Array.Fill(head, -1);
        var prev = new int[WindowSize];

        var n = data.Length;
        var i = 0;
        var iterations = 0;
        while (i < n)
        {
            if ((++iterations & 0xff) == 0) cancellationToken.ThrowIfCancellationRequested();
            var bestLen = 0;
            var bestDist = 0;
            if (i + MinMatch <= n)
            {
                var h = Hash(data, i);
                var cand = head[h];
                var chain = MaxChain;
                var maxLen = Math.Min(MaxMatch, n - i);
                while (cand >= 0 && i - cand <= WindowSize && chain-- > 0)
                {
                    if (data[cand + bestLen] == data[i + bestLen])
                    {
                        var len = 0;
                        while (len < maxLen && data[cand + len] == data[i + len]) len++;
                        if (len > bestLen)
                        {
                            bestLen = len;
                            bestDist = i - cand;
                            if (len == maxLen) break;
                        }
                    }
                    var p = prev[cand & (WindowSize - 1)];
                    if (p >= cand) break; // stale slot
                    cand = p;
                }
            }

            if (bestLen >= MinMatch)
            {
                WriteLength(w, bestLen);
                WriteDistance(w, bestDist);
                var end = i + bestLen;
                for (; i < end; i++) Insert(data, i, head, prev);
            }
            else
            {
                WriteLiteral(w, data[i]);
                Insert(data, i, head, prev);
                i++;
            }
        }

        WriteSymbol(w, 256); // end of block
        w.AlignToByte();
        var adler = Adler32(data, cancellationToken);
        w.WriteByte((byte)(adler >> 24));
        w.WriteByte((byte)(adler >> 16));
        w.WriteByte((byte)(adler >> 8));
        w.WriteByte((byte)adler);
        return w.ToArray();
    }

    private static int Hash(ReadOnlySpan<byte> d, int i) =>
        (int)(((uint)(d[i] << 16 | d[i + 1] << 8 | d[i + 2]) * 2654435761u) >> (32 - HashBits));

    private static void Insert(ReadOnlySpan<byte> d, int i, int[] head, int[] prev)
    {
        if (i + MinMatch > d.Length) return;
        var h = Hash(d, i);
        prev[i & (WindowSize - 1)] = head[h];
        head[h] = i;
    }

    private static void WriteLiteral(BitWriter w, byte b) => WriteSymbol(w, b);

    private static void WriteSymbol(BitWriter w, int sym)
    {
        // RFC 1951 3.2.6 fixed literal/length code.
        if (sym <= 143) w.WriteHuffman(0x30 + sym, 8);
        else if (sym <= 255) w.WriteHuffman(0x190 + sym - 144, 9);
        else if (sym <= 279) w.WriteHuffman(sym - 256, 7);
        else w.WriteHuffman(0xC0 + sym - 280, 8);
    }

    private static void WriteLength(BitWriter w, int len)
    {
        var code = LengthCode[len];
        WriteSymbol(w, 257 + code);
        if (LengthExtra[code] > 0) w.WriteBits((uint)(len - LengthBase[code]), LengthExtra[code]);
    }

    private static void WriteDistance(BitWriter w, int dist)
    {
        var code = 0;
        while (code + 1 < DistBase.Length && DistBase[code + 1] <= dist) code++;
        w.WriteHuffman(code, 5);
        if (DistExtra[code] > 0) w.WriteBits((uint)(dist - DistBase[code]), DistExtra[code]);
    }

    public static uint Adler32(ReadOnlySpan<byte> data, CancellationToken cancellationToken = default)
    {
        const uint Mod = 65521;
        uint a = 1, b = 0;
        var i = 0;
        while (i < data.Length)
        {
            cancellationToken.ThrowIfCancellationRequested();
            var chunk = Math.Min(5552, data.Length - i);
            for (var k = 0; k < chunk; k++)
            {
                a += data[i + k];
                b += a;
            }
            a %= Mod;
            b %= Mod;
            i += chunk;
        }
        return b << 16 | a;
    }

    private sealed class BitWriter(int capacity)
    {
        private byte[] _buf = new byte[capacity];
        private int _len;
        private ulong _acc;
        private int _bits;

        public void WriteBits(uint value, int count)
        {
            _acc |= (ulong)value << _bits;
            _bits += count;
            while (_bits >= 8)
            {
                Push((byte)_acc);
                _acc >>= 8;
                _bits -= 8;
            }
        }

        /// <summary>Huffman codes are packed most-significant bit first.</summary>
        public void WriteHuffman(int code, int length)
        {
            uint rev = 0;
            for (var k = 0; k < length; k++) rev |= (uint)((code >> k) & 1) << (length - 1 - k);
            WriteBits(rev, length);
        }

        public void AlignToByte()
        {
            if (_bits > 0) WriteBits(0, 8 - _bits);
        }

        public void WriteByte(byte b)
        {
            AlignToByte();
            Push(b);
        }

        private void Push(byte b)
        {
            if (_len == _buf.Length) Array.Resize(ref _buf, _buf.Length * 2);
            _buf[_len++] = b;
        }

        public byte[] ToArray() => _buf.AsSpan(0, _len).ToArray();
    }
}
