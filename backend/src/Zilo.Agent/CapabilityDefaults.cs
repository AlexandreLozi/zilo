using Zilo.Core;

namespace Zilo.Agent;

internal static class CapabilityDefaults
{
    // R-D4/R-J7: driver defaults are hints; the published defaults must be
    // complete, supported, and inside the agent's configured limits.
    public static DeviceCaps Complete(DeviceCaps caps, AgentLimits policy)
    {
        var dpiLimit = Math.Min(policy.MaxResolutionDpi, caps.Limits?.MaxResolutionDpi ?? policy.MaxResolutionDpi);
        var sources = caps.Sources.Select(source =>
        {
            var sizes = source.PageSizes.IsDefaultOrEmpty
                ? [new PageSize("max", source.MaxAreaMm.WidthMm, source.MaxAreaMm.HeightMm)] : source.PageSizes.ToArray();
            var dpi = Resolution(source.Resolutions, source.Defaults.Resolution, dpiLimit);
            var color = source.ColorModes.Contains(source.Defaults.ColorMode) ? source.Defaults.ColorMode
                : new[] { "color", "gray", "bw" }.FirstOrDefault(source.ColorModes.Contains)
                    ?? throw new InvalidDataException("no supported color default");
            var size = sizes.Any(size => size.Id == source.Defaults.PageSize) ? source.Defaults.PageSize
                : sizes.Any(size => size.Id == "a4") ? "a4" : sizes.Any(size => size.Id == "letter") ? "letter" : sizes[0].Id;
            return new SourceCaps(source.Source, source.Resolutions, source.ColorModes, sizes, source.MaxAreaMm,
                source.CustomPageSize, source.MaxPages, new SourceDefaults(dpi, color, size));
        }).ToArray();
        var result = new DeviceCaps(caps.DeviceId, sources, new DeviceLimits(
            Math.Min(policy.MaxPagesPerJob, caps.Limits?.MaxPagesPerJob ?? policy.MaxPagesPerJob),
            Math.Min(policy.MaxPixelsPerPage, caps.Limits?.MaxPixelsPerPage ?? policy.MaxPixelsPerPage), dpiLimit));
        CapabilityValidator.Validate(result);
        return result;
    }

    private static int Resolution(ResolutionCaps caps, int preferred, int limit)
    {
        if (caps.Kind == "list")
        {
            var offered = caps.Values.Where(value => value > 0 && value <= limit).ToArray();
            if (offered.Length == 0) throw new InvalidDataException("no bounded resolution default");
            return offered.Contains(preferred) ? preferred
                : offered.OrderBy(value => Math.Abs((long)value - 300)).ThenByDescending(value => value).First();
        }
        if (caps.Kind == "range")
        {
            if (caps.Min is not { } min || caps.Max is not { } max || caps.Step is not { } step || min <= 0 || max < min || step <= 0 || min > limit)
                throw new InvalidDataException("invalid resolution range");
            var lastIndex = ((long)Math.Min(max, limit) - min) / step;
            if (preferred >= min && preferred <= Math.Min(max, limit) && ((long)preferred - min) % step == 0) return preferred;
            var index = Math.Clamp((300L - min) / step, 0, lastIndex);
            var lower = min + index * step;
            var upper = min + Math.Min(index + 1, lastIndex) * step;
            return (int)(Math.Abs(upper - 300) <= Math.Abs(lower - 300) ? upper : lower);
        }
        // An open discriminator must survive; do not interpret an unknown payload.
        if (preferred <= 0 || preferred > limit) throw new InvalidDataException("invalid opaque resolution default");
        return preferred;
    }
}
