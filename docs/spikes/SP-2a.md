# SP-2a — published NAPS2.Sdk 1.6.0 on net10.0

**2026-10-31 · GPT author · independent Claude review and GPT-master validation pending.**

## Outcome: evidence/tooling implemented; feasibility partial / blocked

The isolated repro, five locked RID restores/publishes, exhaustive published-file
inventories, license-gate tool/tests, independent eSCL acquisition and Linux
render/export probes are implemented and locally exercised. **The complete
five-platform license/runtime acceptance is not met.** Windows worker policy,
unknown Gtk binding licenses and the absent published ICA backend remain gates;
T06 must not copy this graph into production as an all-platform cleared graph.
Under D-010b, the workflow now asserts these **exact negative findings** rather
than treating a known denial as an incidental CI failure. A green tooling check
never changes the denied shipping graph or unblocks T06.

No changes were made to production projects, root SDK/package/lock configuration,
planning files or other workflows. No GPL NAPS2 application source, Dynamsoft
material, ImageSharp package, hardware fixture pretending to be real hardware,
or T12 dependency was used. The approved GPT license-tool helper's commit
`9018fd0e5452d476d24c8ef40ccd898d0b7c50b9` was integrated as `55c96ee`;
its lifecycle was settled/released by the master before this handoff.

## Exact selection and reproduction

- SDK **10.0.403**, exact `spikes/naps2/global.json`, roll-forward disabled.
- `net10.0`; `NAPS2.Sdk [1.6.0]`; `SixLabors.Fonts [1.0.1]` resolved and locked.
- Exactly one imaging backend per RID: `NAPS2.Images.Gdi/Gtk/Mac [1.6.0]`.
- Windows also investigates `NAPS2.Sdk.Worker.Win32 [1.6.0]` as published.
- Five independent `locks/RID.packages.lock.json`; NuGet.org-only source config.
- Local props/targets/package files stop production configuration inheritance.
- Framework-dependent, `UseAppHost=false`, `SelfContained=false`,
  `PublishSingleFile=false`, `PublishTrimmed=false`, `PublishReadyToRun=false`.
  **Those project settings do not change the upstream EXE bundle.**

No .NET executable was initially on PATH. Official `https://dot.net/v1/dotnet-install.sh`
was downloaded to `/tmp/opencode/zilo-t02-dotnet/install.sh` and actually run with
`--channel 10.0 --install-dir /tmp/opencode/zilo-t02-dotnet/sdk --no-path`;
it selected 10.0.403 from `https://builds.dotnet.microsoft.com/dotnet/Sdk/10.0.403/dotnet-sdk-10.0.403-linux-x64.tar.gz`.
No sudo, system install or trust-store edit occurred. To reproduce exactly,
use the same official script with **`--version 10.0.403`**, not a floating channel.

Actual validation commands, from `spikes/naps2` unless noted:

```sh
export DOTNET=/tmp/opencode/zilo-t02-dotnet/sdk/dotnet  # or installed dotnet 10.0.403
python3 run.py
DOTNET="$DOTNET" python3 -B -m unittest discover -s tests -v
python3 -B -m unittest discover -s ../../tools/license-gate -p 'test_*.py' -v
"$DOTNET" bin/Release/net10.0/linux-x64/Naps2Spike.dll inspect
"$DOTNET" bin/Release/net10.0/linux-x64/Naps2Spike.dll list Escl
"$DOTNET" bin/Release/net10.0/linux-x64/Naps2Spike.dll list Default
"$DOTNET" bin/Release/net10.0/linux-x64/Naps2Spike.dll render artifacts/render-observed
python3 bundle_inventory.py ~/.nuget/packages/naps2.sdk.worker.win32/1.6.0/contentFiles/NAPS2.Worker.exe --output evidence/worker-bundle.json
python3 ../../tools/license-gate/gate.py check evidence/inventory/osx-arm64.gate.json --policy policy.json
python3 ../../tools/license-gate/gate.py check evidence/inventory/linux-x64.gate.json --policy policy.json
for rid in win-x64 win-arm64 osx-arm64 osx-x64 linux-x64; do
  python3 expected_gate.py --rid "$rid" || exit
done
# From repository root:
/tmp/opencode/zilo-t02-dotnet/actionlint/actionlint .github/workflows/spike-naps2.yml
```

`run.py` executes `dotnet restore Naps2Spike.csproj -p:RuntimeIdentifier=RID
--configfile NuGet.Config --locked-mode`, then `dotnet publish ... -c Release
--no-restore -o artifacts/publish/RID`, then `inventory.py`. **Use the property,
not restore `-r` alone:** restore's `-r` sets RuntimeIdentifiers without reliably
selecting RuntimeIdentifier-conditioned references/lock paths. The project fails
closed when RuntimeIdentifier is missing or outside the five investigated RIDs.
Never run multiple RIDs concurrently in the same checkout's shared `obj` directory.

## Observed results and evidence

All results below are **local Linux x86_64**, not GitHub CI or native Windows/macOS.
Raw commands, stdout/stderr, host, exact lock SHA256s and expected failures are in
[`runtime-local.json`](../../spikes/naps2/evidence/logs/runtime-local.json).
Per-RID full publish logs: [`evidence/logs/`](../../spikes/naps2/evidence/logs/).

| Check | Actual local result |
|---|---|
| Locked restore + cross-publish all 5 RIDs | Exit 0 each, no warnings/errors in captured publish logs |
| Repeated locked restores | Exit 0; original lock files unchanged |
| Copied-project Fonts 1.0.1→2.0.0 with original lock | Exit 1, **NU1004** before accepting dependency drift; original files unchanged |
| License tool suite | **65 tests passed**, rerun after recovery; [`gate-tests-recovery.log`](../../spikes/naps2/evidence/logs/gate-tests-recovery.log) |
| Spike/integration suite | **18 tests passed**, including five new expected-outcome tests; [`spike-tests-recovery.log`](../../spikes/naps2/evidence/logs/spike-tests-recovery.log) |
| D-010b exact gate outcomes | All five matched; actual gate exits **1/1/0/0/1**, not cleared; [`expected-outcomes.log`](../../spikes/naps2/evidence/logs/expected-outcomes.log) |
| eSCL list | Exit 0, count 0; explicitly `acquisitionProven:false` |
| Default Linux/SANE list | **Exit 1**, missing `libsane.so.1`; not an empty-list pass |
| Independent Python eSCL fixture | Real NAPS2 caps + POST job + PNG NextDocument + end-of-job; one 32×24 page acquired; no physical scanner |
| Fonts 1.0.1 vector rendering | Actual assembly informational version `1.0.1+be8883caf13f364292508274d68c39c2455ec3e2`; 14 glyph paths, width 219, system IPAGothic font |
| GTK raster import/PNG/PDF export | PNG 136 bytes, PDF 2690 bytes; format signatures asserted |
| Workflow static validation | actionlint **1.7.12**, exit 0 after expected-denial amendment; workflow itself **not run** |

Recovery validation reinstalled the same exact official SDK because the old
temporary SDK had disappeared. `DOTNET=... python3 run.py` repeated all five locked
restores/publishes, followed by `git diff --exit-code -- locks` (exit 0); see
[`locked-publish-recovery.log`](../../spikes/naps2/evidence/logs/locked-publish-recovery.log).
The original `runtime-local.json` remains historical evidence, not rewritten as a
fresh observation. The eighteen-test rerun reacquired the independent eSCL page
and repeated actual Fonts/PNG/PDF rendering on Linux only.

Fonts render through the pinned library's `IGlyphRenderer` to SVG. The separate
original gradient image exercises NAPS2 GTK raster import/PNG/PDF export; the
test does **not** claim that text was rasterized into that PDF, or that OCR/PDF
import/complex-script/font embedding compatibility has been proven. No system
font is redistributed. Tests were added/red-run before implementing the probe,
bundle reader, inventory classifier/projection and real-graph policy path; the
ImageSharp extension-package ban was also observed red before its correction.

### RID inventory

Full source/version/license/hash/provenance and every actual published path:
[`evidence/inventory/`](../../spikes/naps2/evidence/inventory/).
The `*.gate.json` projection retains **all** packages/payloads for strict schema
validation. Package counts below exclude one separately labeled original
`Zilo.Naps2Spike@0.0.0` source identity; gate counts include that identity.
Managed counts include satellite resources and the first-party DLL.

| RID | NuGet packages | Managed / native / data files | Total files | Real metadata gate exit | Native execution |
|---|---:|---|---:|---|---|
| win-x64 |27|75 /1 /3|79|**exit 1**, 3 errors: worker missing exact policy pin + 2 dependent payloads|blocked-by-host-SAC; hosted CI pending|
| win-arm64 |27|75 /0 /3|78|**exit 1**, 2 errors: worker missing exact policy pin + marker DLL; EXE omitted|blocked-by-host-SAC; hosted CI pending|
| osx-arm64 |26|74 /0 /3|77|**0**, supplied permissive/conditional-LGPL technical policy|Pending|
| osx-x64 |26|74 /0 /3|77|**0**, same scope|Pending|
| linux-x64 |31|78 /0 /3|81|**exit 1**, 14 errors: 7 unapproved Gtk packages + 7 DLLs|GTK + eSCL fixture only|

Data files are the first-party PDB/deps/runtimeconfig, not hidden native assets.
Only one published native binary was found: win-x64 `NAPS2.Worker.exe`.
`restoreNativeCandidates` also inventories native binaries inside restored
archives, including the worker archive on win-arm64 even though its EXE is not
copied. Final assets have **no download-only runtime-pack dependencies**;
initial exploratory restores using all RuntimeIdentifiers downloaded build-only
packs, but the final single-RID commands do not. The host .NET runtime and OS
libraries are not bundled or cleared by this framework-dependent inventory.

NuGet `contentHash` is checked against assets and `.nupkg.metadata`; signed ZIP
`archiveSha512` is computed independently and checked against its sidecar. They
are not interchangeable. Example NAPS2.Sdk 1.6.0 lock contentHash:
`I1u+uTL8avIe3faCrTPWkWj8KEK9qnZI8E/9Bm7k0emCeFMsIVsQUn0d85aQJXmjtnpMh5b711v3u9863hCbTQ==`.
Its signed ZIP SHA512 is:
`Ay7Vjl/+/KBls8Vvfg/NXd/bkdt/88SLmkQCuX1Wk/9IzjOdf2g47JreLPdYtAoAX3JG0orln8z1ot7d+HbdDg==`.
The inventory matches published third-party bytes to original ZIP-entry hashes;
unattributed bytes stay unowned and require separate review. This is not an
independent cryptographic attestation of upstream source/license truth.

## License evidence

**Self-authored technical interpretations below are pending independent Claude
review and final legal review. No restricted-license exception was granted.**
The actual policy has `exceptions:[]` and `reviewedPayloads:[]`. Dynamic LGPL
metadata pins require license text, NOTICE, exact-version source offer and
replaceable-DLL obligations; a matching metadata declaration is not proof those
redistribution obligations are fulfilled. Final installer NOTICE/source delivery
and legal sign-off remain outside this spike's acceptance.

Raw nuspec/license/notice bytes are committed under
[`evidence/licenses/`](../../spikes/naps2/evidence/licenses/); immutable source
URLs and SHA256s are in [`source/index.json`](../../spikes/naps2/evidence/source/index.json).
`policy.json` pins exact identity/version/NuGet hash and, for file-mapped
licenses, exact filename/file hash/source plus evidence/obligations. Missing,
restricted, disallowed or changed metadata fails closed. All seven Gtk binding
packages and the Windows worker are intentionally absent from approved pins.
The wrapper independently rejects any pin for these eight denied identities,
and requires empty exceptions and reviewed payloads even if raw outcomes stay unchanged.

| Package(s), exact version | Evidence / technical interpretation |
|---|---|
| NAPS2.Sdk, Escl, Images, Internals, Images.Gdi/Gtk/Mac, Sdk.Worker.Win32 **1.6.0** | Each nupkg LICENSE expressly grants LGPL2.1-or-later; repository commit `f914a4ec2af090aca4fa55eb3242ec91641482c3`. Worker has no approval pin; non-replaceable single-file deployment remains an independent blocker. |
| NAPS2.PdfSharp **1.0.2** | Nupkg LICENCE.md, MIT. |
| NAPS2.Mdns **1.0.1**, NTwain **1.0.1**, Wia **2.0.3** | Nuspec MIT expressions; Wia also carries MIT text. |
| GrpcDotNetNamedPipes **3.1.0** | Nupkg Apache2 LICENSE; declared repository commit captured in inventory. |
| Makaretu.Dns **2.0.1** | No declared license; exact nuspec repository commit `701463d2091e6d98d4cc4490abb0e0ead8ae2985` LICENSE is MIT; source bytes/hash captured. |
| SimpleBase **1.3.1** | Nuspec generic Apache URL corroborated by source commit `72ecb1de90918faade31351ece771e67f52d4d4a` Apache2 LICENSE and AssemblyInfo 1.3.1 at publication era. Not a reproducibly rebuilt source-to-package attestation. |
| Eto.Forms, Eto.Platform.Mac64 **2.11.0** | Exact nupkg Eto-LICENSE is BSD3. Mac64 additionally includes MonoMac-LICENSE (MIT OR Apache2); record MIT option and preserve both component notices. Primary package label is not a claim that MonoMac itself is BSD3. |
| SixLabors.Fonts **1.0.1**, ZXing.Net **0.16.11**, Grpc.Core.Api **2.67.0** | Nuspec Apache2 expressions; Fonts exact version/hash locked and exercised, no Split-version upgrade. |
| Google.Protobuf **3.29.3** | Nuspec BSD3 expression. |
| Microsoft.Bcl.AsyncInterfaces, Extensions.DependencyInjection.Abstractions, Extensions.Logging.Abstractions, System.Formats.Nrbf, System.Resources.Extensions **10.0.10** | Nuspec MIT expressions; bundled third-party notice files retained where supplied. |
| System.Drawing.Common, Microsoft.Win32.SystemEvents **9.0.3** | Nuspec MIT plus supplied license/third-party notices. Native Windows API/runtime behavior untested here. |
| SharpZipLib **1.4.2**, StandardSocketsHttpHandler **2.2.0.10**, System.ValueTuple **4.6.2** | Nuspec MIT expressions. |
| AtkSharp, CairoSharp, GLibSharp, GdkSharp, GioSharp, GtkSharp, PangoSharp **3.24.24.95** | **UNRESOLVED**: all seven nuspecs omit license metadata and immutable source commit. Publication-era GtkSharp root LICENSE is Library GPL2.0; this is candidate evidence, not permission to invent LGPL2.1 or map each binary. No approval; Linux gate denies. |

The original gate's 65 tests cover default deny, seeded GPL/AGPL/Split/unknown packages,
exact-version/hash matching, file-evidence drift, native review/hash/path
binding, malformed input, compound-expression restrictions, conditional LGPL,
NAPS2 application/Dynamsoft/ImageSharp unconditional bans and synthetic reviewed
SANE-linking exceptions. **Those SANE fixtures are deliberately fabricated test
data, not approvals.** Three additional integration tests use the actually
restored osx-arm64 graph and seed bad packages/native payload into it; the real
permissive/conditional-LGPL metadata graph passes while seeded variants fail.
The producer/policy are trusted review inputs; the gate cannot detect a lying
producer, missing files or false licensing evidence by itself.
Five additional expected-outcome tests prove that the evidence wrapper rejects
an unexpected pass, additional seeded denial, invalid metadata and mislabeled
RID, while accepting only the five exact recorded outcomes. The raw gate retains
its own nonzero return codes; no policy exception, payload review or waiver was
added for this wrapper.

## Native/platform findings and unsupported routes

### Published Windows worker

The exact nupkg worker SHA/version are in both Windows inventories and locks.
Whole EXE SHA256:
`9282bc3787eb3080a91008907d94394d0e19337377861372c357017942c046be`.
[`worker-bundle.json`](../../spikes/naps2/evidence/worker-bundle.json) records
**v6.0, 147 entries**, their byte hashes, embedded `.deps.json` and runtimeconfig.
It includes NAPS2 LGPL DLLs, Fonts 1.0.1 and self-contained **.NET 10.0.9**.
No ImageSharp dependency/file is listed; an `NAPS2.Images.ImageSharp` string
alone is not evidence of shipping that package.

Exact source `NAPS2.Sdk.Worker.Build.csproj` sets `SelfContained=true`,
`PublishSingleFile=true`, `PublishTrimmed=true`, `TrimMode=partial`, `win-x86`.
That is source evidence of publish settings, **not evidence that the LGPL DLLs
were trimmed**. The reviewer compared embedded SHA-256 hashes against matching
1.6.0 `lib/net10.0` nupkg entries: NAPS2.Sdk, Escl, Images, Images.Gdi and
Internals are byte-identical and untrimmed (the SDK DLL is 630,272 bytes).
Google.Protobuf 3.29.3 and SharpZipLib 1.4.2 differ, consistent with partial
trimming of those non-LGPL dependencies. The deployment projection therefore
does not claim LGPL trimming. The bundled/non-replaceable layout still conflicts
with D-002; this is not a definitive legal judgment or a new license exception.

Static PE inspection found the worker EXE unsigned: PE32 i386 (`0x14c`), with
Authenticode security directory `0/0`. D-011 forbids shipping it as-is; signing
changes its bytes and invalidates an unmodified upstream EXE hash comparison.
`NAPS2.Worker.dll` assembly version 8.6.0 matches no captured nupkg entry; its
SDK-side LGPL provenance is inferred from Worker.Build.csproj, not established
by captured worker source or a reproducible build. This provenance remains unresolved.

The published `.targets` copy EXE only for `win-x86`, `win-x64`, .NET Framework,
or a RID-less non-macOS target. **win-arm64 is omitted**: its marker DLL is
published, but its EXE is absent. Neither x86-on-arm64 execution nor TWAIN
acquisition was tested. Do not advertise Win32 TWAIN support from cross-publish.
The restored worker package conservatively remains blocked on both Windows RIDs.
Do not implement a worker rebuild or change policy without joint follow-up.

### Published macOS SDK / ICA

The SDK 1.6.0 nupkg ships generic net10.0/net8.0/net462, **not net10.0-macos**.
The metadata probe finds eSCL/SANE/TWAIN/WIA types but **no AppleScanDriver** and
no Microsoft.macOS/ImageCaptureCore reference. At the exact declared source
commit, AppleScanDriver and its factory branch are `#if MAC`; MAC is defined
only for the macOS TFM. The factory's unsupported-driver message itself says
to use net10.0-macos for Apple. Consequently the generic published asset is
**not an ICA implementation**, even when paired with Images.Mac/Eto imaging.
Actual macOS build/runtime remains untested; a usable ICA package/build strategy
requires a follow-up decision, not an unsupported success claim.

### Platform imaging/system dependencies

- Windows Gdi references System.Drawing.Common 9.0.3 and Windows system APIs;
  WIA/TWAIN and worker launch remain pending native hosts/hardware.
- macOS generic Images.Mac references Eto.Platform.Mac64/MonoMac; AppKit and
  OS framework/runtime compatibility, including arm64, remain untested. Managed
  wrapper DLLs are not proof of functional ICA/native support.
- Linux Gtk references seven GtkSharp wrappers and system GTK3/GdkPixbuf/GLib/
  Cairo/Pango/ATK/GIO; libtiff is used for TIFF paths. System GTK/GdkPixbuf were
  sufficient for actual PNG/PDF tests; TIFF was not exercised. System libraries
  are **not redistributed or license-cleared** by this inventory.
- System `libsane.so.1` is missing here, so SANE enumeration/acquisition and a
  SANE test-backend fixture are **pending**, not passed. No SANE binaries package
  was included; eSCL fixture acquisition was the available independent route.
- No Pdfium/Tesseract/Sane.Binaries/ImageSharp packages were added. OCR/PDF
  import, WSD/sane-airscan and manufacturer scanner drivers are out of this probe.

## CI and remaining gates

[`spike-naps2.yml`](../../.github/workflows/spike-naps2.yml) runs gate unit tests
and all-five locked cross-publish/inventories on path-matched PRs, main pushes
and manual dispatches. Docs-only edits do not trigger it. Pushes are main-only;
the expensive native runtime matrix (Linux x64, Windows x64/arm64, macOS arm64/x64)
is manual/main-push only, never duplicated on a PR. Concurrency cancels superseded
runs on the same ref. Runner labels were checked
against the official GitHub-hosted-runner documentation; OS/architecture are
asserted before runtime evidence is labeled native. Artifacts are uploaded even
when the actual license graph is denied. `expected_gate.py` runs the real gate,
asserts its exact exit/status/error multiset and package/payload counts, and fails
on any drift, including an unexpected pass. **D-010b permits green evidence/tooling
checks for these exact denials only; Windows/Linux shipping graphs remain
blocked.** The macOS metadata passes are not ICA/runtime or release clearance.
Static lint is not execution; hosted execution of this revision remains pending.
actionlint 1.7.12 was downloaded from its official release and its archive SHA256
verified against release checksums:
`8aca8db96f1b94770f1b0d72b6dddcb1ebb8123cb3712530b08cc387b349a3d8`.

### Comparison contract and action pins (r1 fix)

The three Claude r1 regressions were reproduced red immediately after the review
fast-forward, before fixes. Final local validation passed **66 gate tests and 23
spike tests**, including all three regressions, 16 denied-pin/exception mutation
subcases, the hidden worker-payload waiver, LF checkout and unsupported
application-code regressions. See [`r1-fix-summary.md`](../../spikes/naps2/evidence/logs/r1-fix-summary.md)
and its adjacent test/outcome logs. The Linux locked restore/Release build used
SDK 10.0.403 and had zero warnings/errors. No cross-publish was repeated: project,
source, locks and package inventory inputs were unchanged; only the two Windows
gate projections were regenerated from existing full inventories to correct the
LGPL trimming claim. Hosted/native Windows/macOS and independent re-review remain pending.

CI compares **exact gate outcomes**, not byte-identical regenerated evidence:
exit code, status, package/payload counts and the full error multiset must match.
Windows now reports `missing exact package policy pin (id/version/hash/expression)`
for `NAPS2.Sdk.Worker.Win32@1.6.0`; dependent marker/EXE payload denials remain
`exact approved inventory owner required` (3 errors on x64, 2 on arm64).
Linux retains the seven missing-pin errors and seven dependent DLL denials.
The macOS metadata outcomes remain passes; raw exits stay **1/1/0/0/1**.
The wrapper additionally rejects denied-identity pins and any exception or payload
review even if the raw gate still produces exactly the expected outcome.

Only lock files are byte-compared in CI. Inventories remain uploaded evidence,
not a byte-drift assertion: first-party DLL/PDB output hashes are path-dependent,
and changes preserving gate counts/errors can pass. Deterministic/path-mapped
builds and evidence byte comparison are deferred, not silently claimed here.
The three source inputs to the first-party package pin are forced to LF by local
`.gitattributes`; a `core.autocrlf=true` checkout regression checks the exact pin.

On 2026-11-01, `git ls-remote https://github.com/actions/<name>.git refs/tags/<tag>`
verified these official upstream refs before pinning every workflow action use:

| Action | Verified tag | Commit SHA |
|---|---|---|
| checkout | v4 | `11d5960a326750d5838078e36cf38b85af677262` |
| setup-python | v5 | `a26af69be951a213d495a4c3e4e4022e16d87065` |
| setup-dotnet | v4 | `67a3573c9a986a3f9c594539f4ab511d57bb3ce9` |
| upload-artifact | v4 | `ea165f8d65b6e75b540449e92b4886f43607fa02` |

OD-6/D-011 explicitly prohibit executing **any unsigned Windows binaries** on
the owner's SAC-enforcing Windows host. No native Windows execution was attempted
in this recovery; those rows are **blocked-by-host-SAC (pending)**, not code
failures or passes. The authored Windows runtime jobs target hosted CI only;
actual hosted CI/disposable-VM runtime evidence remains pending. Never bypass
SAC, retry an application-control block, or treat test-key signatures as clearance.

Remaining before claiming full T02/platform acceptance or unblocking T06:

1. Independent Claude review of this combined diff, tool/policy/evidence and tests;
   GPT-master validation; no current self-review is an independent approval.
2. Jointly decide worker packaging and absent published ICA route; retain current
   default-deny behavior, do not fork/rebuild silently in this task.
3. Resolve exact Gtk binding source/license evidence and any required reviewed,
   version-specific legal exceptions; never infer LGPL2.1 from a family name.
4. Run the native CI matrix; supply/fix system imaging prerequisites explicitly.
   Run device-list and actual WIA/TWAIN/ICA/SANE/hardware tests on the target OS.
5. Final installer/runtime/native inventory, license texts, NOTICE/source-offer
   fulfillment and legal release sign-off. This spike is not a releasable installer.

**Disposition: D-010b evidence/tooling implemented, feasibility acceptance partial/blocked;
author-branch push is not merge approval, all-platform runtime proof or legal clearance.**
