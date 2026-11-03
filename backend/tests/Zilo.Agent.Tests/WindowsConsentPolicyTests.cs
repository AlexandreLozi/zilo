using Xunit;
using Zilo.Security.Persistence;

namespace Zilo.Agent.Tests;

public sealed class WindowsConsentPolicyTests
{
    [Theory]
    [InlineData(-1, 8, false)]
    [InlineData(0, 8, false)]
    [InlineData(7, 8, false)]
    [InlineData(8, 8, false)]
    [InlineData(15, 8, false)]
    [InlineData(16, 9, false)]
    [InlineData(16, -1, false)]
    [InlineData(16, 0, false)]
    [InlineData(16, 7, false)]
    [InlineData(16, 69, false)]
    [InlineData(16, 8, true)]
    [InlineData(24, 16, true)]
    [InlineData(76, 68, true)]
    [InlineData(75, 68, false)]
    public void Ace_sid_bounds_validate_sid_length_against_ace_length(int aceLength, int sidLength, bool valid)
    {
        if (valid)
            WindowsConsentDirectory.RequireAceSidBounds(aceLength, sidLength);
        else
            Assert.Throws<IOException>(() => WindowsConsentDirectory.RequireAceSidBounds(aceLength, sidLength));
    }

    [Fact]
    public void Directory_access_does_not_request_list_or_control_for_unrelated_ancestors()
    {
        Assert.Equal(0x00100080u, WindowsConsentDirectory.DirectoryAccess(false, false));
        Assert.Equal(0x00120080u, WindowsConsentDirectory.DirectoryAccess(true, false));
        Assert.Equal(0xC0020000u, WindowsConsentDirectory.DirectoryAccess(true, true));
    }
}
