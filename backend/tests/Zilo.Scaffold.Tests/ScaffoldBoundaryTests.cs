using System.Reflection;
using System.Text.Json;
using Xunit;

namespace Zilo.Scaffold.Tests;

// Temporary T04b gates: replace with real behavior tests when T06/T10 introduce
// the reviewed dependency graph and contracts. These are not long-term architecture rules.
public sealed class ScaffoldBoundaryTests
{
    [Theory]
    [InlineData("Zilo.Core")]
    [InlineData("Zilo.Drivers.Naps2")]
    [InlineData("Zilo.Drivers.Virtual")]
    [InlineData("Zilo.Security")]
    public void Placeholder_library_has_no_implementation_or_contract_types(string assemblyName)
    {
        var assembly = Assembly.Load(new AssemblyName(assemblyName));

        Assert.Empty(assembly.DefinedTypes);
    }

    [Fact]
    public void Restored_runtime_graph_does_not_include_an_actual_Naps2_package()
    {
        var depsPath = Path.Combine(AppContext.BaseDirectory, "Zilo.Scaffold.Tests.deps.json");
        using var deps = JsonDocument.Parse(File.ReadAllText(depsPath));
        var packages = deps.RootElement.GetProperty("libraries").EnumerateObject()
            .Where(library => library.Value.GetProperty("type").GetString() == "package")
            .Select(library => library.Name);

        Assert.DoesNotContain(packages, package => package.StartsWith("NAPS2", StringComparison.OrdinalIgnoreCase));
    }
}
