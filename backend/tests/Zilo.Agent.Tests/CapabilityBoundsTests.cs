using Xunit;
using Zilo.Agent;
using Zilo.Core;

namespace Zilo.Agent.Tests;

public sealed class CapabilityBoundsTests
{
    [Theory]
    [InlineData(double.NaN)]
    [InlineData(double.PositiveInfinity)]
    [InlineData(-1)]
    public void Nonfinite_or_nonpositive_dimensions_are_not_emitted(double width)
    {
        var caps = MakeCaps(new SizeMm(width, 297), new SourceDefaults(300, "gray", "a4"));
        Assert.Throws<InvalidDataException>(() => CapabilityValidator.Validate(caps));
    }

    [Theory]
    [InlineData(301, "gray", "a4")]
    [InlineData(300, "color", "a4")]
    [InlineData(300, "gray", "absent")]
    public void Unsupported_defaults_are_not_emitted(int dpi, string color, string size)
        => Assert.Throws<InvalidDataException>(() => CapabilityValidator.Validate(MakeCaps(new SizeMm(210, 297), new SourceDefaults(dpi, color, size))));

    private static DeviceCaps MakeCaps(SizeMm area, SourceDefaults defaults)
        => new("device", [new SourceCaps("flatbed", ResolutionCaps.List([300]), ["gray"], [new PageSize("a4", 210, 297)], area, false, null, defaults)]);
}
