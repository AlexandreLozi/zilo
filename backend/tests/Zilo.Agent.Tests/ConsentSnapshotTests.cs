using System.Text;
using Xunit;
using Zilo.Security.Persistence;

namespace Zilo.Agent.Tests;

public sealed class ConsentSnapshotTests
{
    private const string Valid = "{\"version\":1,\"generation\":7,\"records\":[{\"origin\":\"https://clinic.example\",\"state\":\"blocked\",\"baked\":false,\"updatedAt\":\"2026-11-02T12:00:00.0000000+00:00\",\"cooldownUntil\":null,\"lastDenied\":null}]}";

    [Fact]
    public void Private_snapshot_reconstructs_exact_block_state_without_extra_authority_fields()
    {
        var snapshot = ConsentSnapshotCodec.Decode(Encoding.UTF8.GetBytes(Valid));
        Assert.Equal(7, snapshot.Generation);
        var record = Assert.Single(snapshot.Records);
        Assert.Equal("https://clinic.example", record.Origin);
        Assert.Equal("blocked", record.State);
        Assert.False(record.Baked);
        var encoded = Encoding.UTF8.GetString(ConsentSnapshotCodec.Encode(snapshot));
        Assert.DoesNotContain("DenialStreak", encoded, StringComparison.OrdinalIgnoreCase);
        Assert.Equal(snapshot.Generation, ConsentSnapshotCodec.Decode(Encoding.UTF8.GetBytes(encoded)).Generation);
    }

    [Theory]
    [InlineData("\"version\":1", "\"version\":2")]
    [InlineData("\"generation\":7", "\"generation\":0")]
    [InlineData("\"generation\":7", "\"generation\":-1")]
    [InlineData("\"state\":\"blocked\"", "\"state\":\"pending\"")]
    [InlineData("\"state\":\"blocked\"", "\"state\":\"none\"")]
    [InlineData("https://clinic.example", "HTTPS://CLINIC.EXAMPLE")]
    [InlineData("https://clinic.example", "https://localhost")]
    [InlineData("https://clinic.example", "http://clinic.example")]
    [InlineData("\"baked\":false", "\"baked\":false,\"denialStreak\":3")]
    [InlineData("\"baked\":false", "\"baked\":false,\"baked\":true")]
    [InlineData("\"version\":1", "\"Version\":1")]
    [InlineData("+00:00", "+01:00")]
    public void Invalid_or_unapproved_metadata_is_not_a_snapshot(string oldText, string newText)
    {
        Assert.Throws<InvalidDataException>(() => ConsentSnapshotCodec.Decode(Encoding.UTF8.GetBytes(Valid.Replace(oldText, newText, StringComparison.Ordinal))));
    }

    [Fact]
    public void Trailing_material_and_invalid_utf8_are_rejected()
    {
        Assert.Throws<InvalidDataException>(() => ConsentSnapshotCodec.Decode(Encoding.UTF8.GetBytes(Valid + "{}")));
        Assert.Throws<InvalidDataException>(() => ConsentSnapshotCodec.Decode(new byte[] { 0xff }));
    }

    [Fact]
    public void Duplicate_origins_cannot_hide_a_block_behind_a_grant()
    {
        var record = Valid[(Valid.IndexOf('[') + 1)..Valid.LastIndexOf(']')];
        var duplicate = Valid.Replace(record, record + "," + record.Replace("blocked", "granted"), StringComparison.Ordinal);
        Assert.Throws<InvalidDataException>(() => ConsentSnapshotCodec.Decode(Encoding.UTF8.GetBytes(duplicate)));
    }

    [Fact]
    public void Oversized_file_is_rejected_before_deserialization()
    {
        Assert.Throws<InvalidDataException>(() => ConsentSnapshotCodec.Decode(new byte[4_194_305]));
    }
}
