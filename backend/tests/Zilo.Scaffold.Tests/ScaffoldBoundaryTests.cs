using System.Reflection;
using System.Text.Json;
using Xunit;

namespace Zilo.Scaffold.Tests;

public sealed class ScaffoldBoundaryTests
{
    [Fact]
    public void Core_contains_the_neutral_contract()
    {
        var assembly = Assembly.Load(new AssemblyName("Zilo.Core"));

        Assert.Contains(assembly.DefinedTypes, type => type.Name == "IScanBackend");
        Assert.Contains(assembly.DefinedTypes, type => type.Name == "Page");
    }

    [Theory]
    [InlineData("Zilo.Core")]
    [InlineData("Zilo.Security")]
    [InlineData("Zilo.Drivers.Naps2")]
    [InlineData("Zilo.Drivers.Virtual")]
    public void Libraries_do_not_reference_outer_layers_or_other_drivers(string assemblyName)
    {
        var references = Assembly.Load(new AssemblyName(assemblyName))
            .GetReferencedAssemblies()
            .Select(name => name.Name)
            .ToHashSet(StringComparer.Ordinal);

        Assert.DoesNotContain("Zilo.Agent", references);
        if (assemblyName != "Zilo.Security")
            Assert.DoesNotContain("Zilo.Security", references);
        Assert.DoesNotContain("Zilo.Drivers.Naps2", references);
        Assert.DoesNotContain("Zilo.Drivers.Virtual", references);
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
