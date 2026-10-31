# Published NAPS2 1.6.0 / .NET 10 feasibility probe

**Research only. Not a production backend or redistribution clearance.**
Findings, actual results and blocked acceptance: [SP-2a](../../docs/spikes/SP-2a.md).

## Reproduce

Install the official .NET **10.0.403** SDK and Python 3.12, then:

```sh
cd spikes/naps2
python3 run.py                         # five RIDs; locked restore by default
python3 -B -m unittest discover -s tests -v  # on Linux x64 with system GTK/GdkPixbuf
python3 -B -m unittest discover -s ../../tools/license-gate -p 'test_*.py' -v
python3 ../../tools/license-gate/gate.py check evidence/inventory/osx-arm64.gate.json --policy policy.json
python3 ../../tools/license-gate/gate.py check evidence/inventory/linux-x64.gate.json --policy policy.json
# Last command intentionally returns1: Gtk bindings are not cleared.
python3 expected_gate.py --rid linux-x64
# Returns0 ONLY when the raw gate gives the exact known exit1 denial (D-010b).
# This is tooling evidence, never shipping clearance; T06 remains blocked.
```

`DOTNET=/path/to/dotnet` overrides the executable used by `run.py` and runtime
tests. `SPIKE_RID=win-x64` (etc.) selects native runtime tests on another OS;
never run a foreign RID and call it native validation. `run.py --rid RID`
limits restore/publish/inventory to one RID; runs must not overlap because they
share `obj/project.assets.json`. The workflow isolates matrix jobs.
OD-6 forbids unsigned native Windows execution on the owner's SAC-enforcing
host: use hosted CI/a disposable VM, never run these probes through WSL interop.

`run.py` changes to its own directory before SDK resolution. Local `global.json`,
`Directory.Build.props/targets`, `Directory.Packages.props` and `NuGet.Config`
stop production SDK/build/central-package/config inheritance. No root config is
edited. All publishes are framework-dependent, without apphost, single-file,
trimming or ReadyToRun; upstream worker packaging is a separate blocked issue.

## Evidence and policy maintenance

- `locks/RID.packages.lock.json`: all resolved package versions/content hashes.
- `evidence/inventory/RID.json`: full package/source/license/native-candidate and
  every-published-file inventory, including sizes, hashes and ZIP ownership.
- `RID.gate.json`: exact, complete package/payload projection to the strict gate
  schema; every package/payload is retained, rich provenance is in `RID.json`.
- `evidence/licenses/`: raw nupkg nuspecs/license/notice bytes, not normalized.
- `evidence/source/`: immutable upstream source/license evidence; candidate
  Gtk license is explicitly **not** an approved binary-to-source mapping.
- `policy.json`: self-authored version/hash-specific technical metadata pins,
  **independent Claude and legal review pending**; no restricted exceptions and
  no native approvals. Ordinary LGPL metadata pins do not waive obligations.
- `evidence/worker-bundle.json`: upstream EXE manifest, entry hashes and embedded
  dependency/runtime JSON, not an assertion that the bundle is releasable.
- `evidence/logs/`: recorded local results, not CI output.

The inventory producer checks NuGet lock `contentHash` against the restore's
assets and `.nupkg.metadata`; it independently hashes signed archive bytes
against the archive SHA512 sidecar. These hashes are intentionally distinct.
Published third-party ownership is established from actual ZIP entry bytes,
not a guessed filename/parent license; unknown published bytes stay unowned.
The first-party output identity is separately labeled and hashes its source.
The input producer and policy are trusted review inputs, not attestations.

Maintainer operations (never run automatically to make CI green):

```sh
python3 run.py --update-locks          # intentional dependency change; review diff
python3 capture_sources.py            # recapture immutable source evidence
python3 build_policy.py               # regenerate DRAFT technical pins; review diff
python3 bundle_inventory.py ~/.nuget/packages/naps2.sdk.worker.win32/1.6.0/contentFiles/NAPS2.Worker.exe --output evidence/worker-bundle.json
```

Do not regenerate locks/policy to suppress a license failure. New restricted
exceptions require actual review in `docs/legal/exceptions.md`; this task has
not created or approved any. After changing the first-party project/source,
rerun all inventories before regenerating its source-hash policy pin.

`escl_fixture.py` is an original Python-stdlib, direct-URL, single-page PNG
flatbed fixture, independent of NAPS2.Escl.Server and T12. It tests the real
NAPS2 client path, not mDNS discovery, SANE, a scanner, ADF, duplex or hardware.
