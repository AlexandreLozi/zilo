namespace Zilo.Agent;

public static class Program
{
    public static Task<int> Main(string[] args)
    {
        if (args.Contains("--self-test", StringComparer.Ordinal))
        {
            var result = AgentSelfTest.Run();
            if (result == 0) Console.WriteLine("Zilo.Agent self-test: PASS");
            return Task.FromResult(result);
        }
        return AgentHost.RunAsync(AgentOptions.FromEnvironment(), args);
    }
}
