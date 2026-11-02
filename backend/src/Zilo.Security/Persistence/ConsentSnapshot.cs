using System.Globalization;
using System.Text;
using System.Text.Json;

namespace Zilo.Security.Persistence;

public sealed record StoredConsent(string Origin, string State, bool Baked,
    DateTimeOffset UpdatedAt, DateTimeOffset? CooldownUntil, DateTimeOffset? LastDenied);

public sealed record ConsentSnapshot(long Generation, IReadOnlyList<StoredConsent> Records);

internal static class ConsentSnapshotCodec
{
    internal const int MaxBytes = 4_194_304;
    internal const int MaxRecords = 4096;
    internal const int MaxOriginBytes = 2048;
    private static readonly UTF8Encoding StrictUtf8 = new(false, true);
    private static readonly OriginPolicy Eligibility = new(false, Array.Empty<string>());

    internal static ConsentSnapshot Decode(ReadOnlyMemory<byte> bytes)
    {
        if (bytes.Length is 0 or > MaxBytes) throw Invalid();
        try
        {
            _ = StrictUtf8.GetCharCount(bytes.Span);
            using var document = JsonDocument.Parse(bytes, new JsonDocumentOptions { MaxDepth = 8 });
            var root = document.RootElement;
            RequireFields(root, "version", "generation", "records");
            if (root.GetProperty("version").GetInt32() != 1) throw Invalid();
            var generation = root.GetProperty("generation").GetInt64();
            if (generation <= 0) throw Invalid();
            var array = root.GetProperty("records");
            if (array.ValueKind != JsonValueKind.Array || array.GetArrayLength() > MaxRecords) throw Invalid();
            var records = new List<StoredConsent>(array.GetArrayLength());
            var origins = new HashSet<string>(StringComparer.Ordinal);
            foreach (var item in array.EnumerateArray())
            {
                RequireFields(item, "origin", "state", "baked", "updatedAt", "cooldownUntil", "lastDenied");
                var record = new StoredConsent(item.GetProperty("origin").GetString()!,
                    item.GetProperty("state").GetString()!, item.GetProperty("baked").GetBoolean(),
                    Timestamp(item.GetProperty("updatedAt")) ?? throw Invalid(),
                    Timestamp(item.GetProperty("cooldownUntil")), Timestamp(item.GetProperty("lastDenied")));
                Validate(record);
                if (!origins.Add(record.Origin)) throw Invalid();
                records.Add(record);
            }
            return new(generation, records.AsReadOnly());
        }
        catch (Exception ex) when (ex is JsonException or DecoderFallbackException or InvalidOperationException or FormatException or OverflowException or ArgumentException)
        {
            // Never include persisted strings, paths or origin names in diagnostics.
            throw Invalid();
        }
    }

    internal static byte[] Encode(ConsentSnapshot snapshot)
    {
        if (snapshot.Generation <= 0 || snapshot.Records.Count > MaxRecords) throw Invalid();
        using var stream = new MemoryStream();
        using (var writer = new Utf8JsonWriter(stream))
        {
            writer.WriteStartObject();
            writer.WriteNumber("version", 1);
            writer.WriteNumber("generation", snapshot.Generation);
            writer.WriteStartArray("records");
            var origins = new HashSet<string>(StringComparer.Ordinal);
            foreach (var record in snapshot.Records)
            {
                Validate(record);
                if (!origins.Add(record.Origin)) throw Invalid();
                writer.WriteStartObject();
                writer.WriteString("origin", record.Origin);
                writer.WriteString("state", record.State);
                writer.WriteBoolean("baked", record.Baked);
                WriteTimestamp(writer, "updatedAt", record.UpdatedAt);
                WriteTimestamp(writer, "cooldownUntil", record.CooldownUntil);
                WriteTimestamp(writer, "lastDenied", record.LastDenied);
                writer.WriteEndObject();
                writer.Flush();
                if (stream.Length > MaxBytes) throw Invalid();
            }
            writer.WriteEndArray();
            writer.WriteEndObject();
        }
        if (stream.Length > MaxBytes) throw Invalid();
        return stream.ToArray();
    }

    private static void RequireFields(JsonElement element, params string[] fields)
    {
        if (element.ValueKind != JsonValueKind.Object) throw Invalid();
        var seen = new HashSet<string>(StringComparer.Ordinal);
        foreach (var property in element.EnumerateObject())
            if (!fields.Contains(property.Name, StringComparer.Ordinal) || !seen.Add(property.Name)) throw Invalid();
        if (seen.Count != fields.Length) throw Invalid();
    }

    private static DateTimeOffset? Timestamp(JsonElement value)
    {
        if (value.ValueKind == JsonValueKind.Null) return null;
        if (value.ValueKind != JsonValueKind.String || !DateTimeOffset.TryParseExact(value.GetString(), "O",
                CultureInfo.InvariantCulture, DateTimeStyles.None, out var timestamp) || timestamp.Offset != TimeSpan.Zero)
            throw Invalid();
        return timestamp;
    }

    private static void Validate(StoredConsent record)
    {
        if (record.Origin is null || record.Origin.Contains('\0') || StrictUtf8.GetByteCount(record.Origin) > MaxOriginBytes)
            throw Invalid();
        var origin = Eligibility.Evaluate(record.Origin);
        if (origin.Class != OriginClass.Eligible || origin.Origin != record.Origin || record.UpdatedAt.Offset != TimeSpan.Zero)
            throw Invalid();
        if (record.State == "denied")
        {
            if (record.CooldownUntil is not { } cooldown || record.LastDenied is not { } denied ||
                cooldown.Offset != TimeSpan.Zero || denied.Offset != TimeSpan.Zero || cooldown < denied ||
                cooldown - denied > TimeSpan.FromHours(24)) throw Invalid();
        }
        else if (record.State is not ("granted" or "blocked") || record.CooldownUntil is not null || record.LastDenied is not null)
            throw Invalid();
    }

    private static void WriteTimestamp(Utf8JsonWriter writer, string name, DateTimeOffset? timestamp)
    {
        if (timestamp is null) writer.WriteNull(name);
        else writer.WriteString(name, timestamp.Value.ToString("O", CultureInfo.InvariantCulture));
    }

    private static InvalidDataException Invalid() => new("consent-metadata-invalid");
}
