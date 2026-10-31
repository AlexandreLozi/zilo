# Backend scaffold (T04b)

`backend/Zilo.slnx` contains the .NET 10 console agent, four empty libraries,
and two focused test projects. Framework/build policy and package versions live
in the repository-root `Directory.*.props`; the SDK is pinned by `global.json`.

The agent prints a scaffold notice and exits successfully. **Scanning is not
implemented. There are no HTTP listeners or endpoints.** The libraries contain
no contracts or implementation. NAPS2 integration is pending T06, contracts T10,
and the HTTP/security agent skeleton T11. Virtual-driver behavior comes later.

From the repository root, with the pinned .NET SDK installed:

```sh
dotnet restore backend/Zilo.slnx --locked-mode
dotnet build backend/Zilo.slnx --configuration Release --no-restore
dotnet test backend/Zilo.slnx --configuration Release --no-build --no-restore -p:RestoreLockedMode=true
dotnet backend/src/Zilo.Agent/bin/Release/net10.0/Zilo.Agent.dll
```

When deliberately updating dependencies, run `dotnet restore backend/Zilo.slnx`
without locked mode and review the generated `packages.lock.json` changes.
Never hand-edit lock files. CI uses locked restore on native Windows, Linux,
and macOS runners and uploads logs/TRX results even on failure.

Startup tests launch the real built agent twice with a ten-second limit per
invocation; no global console state is replaced. Scaffold tests temporarily
guard empty libraries and the absence of actual NAPS2 packages until the tasks
above introduce reviewed contracts and dependencies.
