# SP-4a — unsigned packaging dry runs (T03)

- **Date:** 2026-10-31. **Branch:** `t03-packaging-dryrun`. **Evidence commit:** `ffa639f` (logs
  captured against it; later commits on the branch add only docs and logs).
- **Author:** Claude (Opus 5.5), BE lane under OD-2. **GPT review is pending** (resume). Nothing
  here merges before that review passes.
- **Subject:** the T04b hello agent (`backend/src/Zilo.Agent`). It prints
  `Zilo.Agent scaffold: scanning is not implemented.` and exits 0. `backend/**` was **not
  modified**.
- **Host:** Ubuntu 24.04.5 LTS on WSL2 (kernel 6.18.54.1, x86_64). No binary ran natively on
  Windows (OD-6). Headless only (OD-4). No push, no merge.
- **Logs (redacted):** [`docs/validation/logs/T03/`](../validation/logs/T03/).

## Verdicts

| Row | Verdict | Evidence |
|---|---|---|
| deb build | **pass** | `linux-build.log`: nfpm 2.48.0 → `zilo-agent_0.0.1-1_amd64.deb`, exit 0. |
| deb inspection | **pass** | `inspect.log`: control fields, exact 11-file list, apphost `0755 root/root`, no network in maintainer scripts, `systemd-analyze verify` (host, systemd 255) exit 0. |
| deb smoke, local (rootless chroot) | **pass, with the deviations below** | `deb-smoke-rootless.log`: official Ubuntu 24.04.5 base image (SHA-256 and Ubuntu signing key verified). apt resolves `dotnet-runtime-10.0` 10.0.14, `libsane1`, and `sane-airscan` (recommend). Files land, user unit globally enabled, agent runs, `systemd-analyze verify` and `desktop-file-validate` exit 0, `x-scheme-handler/zilo` lands in `mimeinfo.cache`. After purge nothing is left, and the rootfs snapshot diff is empty (8819 entries). Ends `DEB SMOKE PASS`. |
| deb smoke, container | **pending (no container runtime)** | No headless OCI runtime on this host (see below). CI job `deb-smoke` (`ubuntu:24.04` container) runs the same script as real root, with recommends on. |
| rpm build | **pass** | `linux-build.log`: `zilo-agent-0.0.1-1.x86_64.rpm`, exit 0. |
| rpm inspection | **pass** | `inspect.log`: Requires `dotnet-runtime-10.0` and `sane-backends`, Recommends `sane-airscan`, exact file list, scriptlets present. |
| rpm smoke, local (rootless chroot) | **pass, with the deviations below** | `rpm-smoke-rootless.log`: official Fedora 43 Container Base image (SHA-256 and Fedora 43 key verified). dnf resolves `dotnet-runtime-10.0` 10.0.13, `sane-backends` 1.4.0 and `sane-airscan`. `rpm -V` is clean, the agent runs, systemd 258 `verify` exits 0, desktop entry valid, mime cache entry present (desktop-file-utils file trigger). After erase nothing is left, and the snapshot diff is empty (12348 entries). Ends `RPM SMOKE PASS`. |
| rpm smoke, container | **pending (no container runtime)** | CI job `rpm-smoke` (`fedora:43` container). |
| test-sign verify (Linux) | **pass** | `test-sign.log`: throwaway root and code-signing leaf. osslsigncode 2.8 signs and verifies `Zilo.Agent.exe` and all 5 DLLs, plus a wixl-built MSI (`Signature verification: ok`). Three negative controls fail as expected: unsigned file, tampered file, unrelated root. GPG: `rpmsign` + `rpmkeys -K` OK (and not OK without the key). apt `InRelease` → `Packages` → `.deb` hash chain verifies with `gpgv`, and a tampered `InRelease` is a BAD signature. |
| MSI build | **pending (WiX is Windows-only; host may run only Microsoft-signed tools)** | `msi-build-linux.log`: WiX 5.0.2 on Linux prints `WIX0000 … only supports Windows … behavior … undefined` and fails with WIX0389/WIX0027 path errors (exit 27). WiX is signed by the .NET Foundation, not Microsoft, so OD-6 forbids running it on the host. `Zilo.Agent.wxs` is authored and XML-well-formed only; **it has not been compiled anywhere.** CI job `windows-msi` builds it. |
| MSI install smoke | **pending (blocked-by-host-SAC)** | Not attempted on the host (OD-6). CI job `windows-msi` runs `install-smoke.ps1` on the hosted runner. |
| pkg build | **pending (no macOS host)** | Scripts, plists and the distribution file are authored. The plists parse (`plistlib`), XML is well-formed, `sh -n` passes, and the `osx-arm64` apphost publishes on Linux (`publish-osx.log`). CI job `macos-pkg` builds the universal pkg. |
| notarization | **pending (M6 / SP-4b)** | Needs owner Apple credentials. |
| workflow lint | **pass** | `actionlint.log`: actionlint 1.7.12, 0 errors. The shellcheck/pyflakes rules were disabled (tools not installed). |
| hosted CI | **pending** | No git remote (D-010). |

**Deviations of the local rootless-chroot smokes** (all confined to
`packaging/linux/smoke/rootless-chroot.sh`; the CI container jobs have none):
1. It is an unprivileged user+mount+pid namespace with a chroot, not an OCI container. Host
   network, host `/dev` bind.
2. Only uid/gid 0 is mapped (no `newuidmap` on the host). `chown`/`chgrp` to other ids fails with
   EINVAL. A shim in `/usr/local/sbin` ignores exactly that error, and APT's `DPkg::Path` puts the
   shim first. Ownership is therefore emulated, for example fontconfig-config's
   `chown root:staff`. Our package installs only `root:root` files.
3. Transitive recommends are not installed, because dbus's `dpkg-statoverride` cannot be shimmed.
   Recommends resolution is shown with `apt-get --simulate`/`dnf --assumeno` (recommends on), then
   `sane-airscan` is installed explicitly.

## What was built

| Artifact | Tool | Layout |
|---|---|---|
| `zilo-agent_0.0.1-1_amd64.deb`, `zilo-agent-0.0.1-1.x86_64.rpm` | nfpm 2.48.0 (`packaging/linux/nfpm.yaml`) | `/usr/lib/zilo/` payload, `/usr/bin/zilo-agent` symlink, `/usr/lib/systemd/user/zilo-agent.service`, `/usr/share/applications/zilo-agent.desktop` (`MimeType=x-scheme-handler/zilo;`, `NoDisplay=true`). |
| MSI (CI only) | WiX 5.0.2 (`packaging/windows/Zilo.Agent.wxs`) | `Scope="perUser"`, `%LOCALAPPDATA%\Programs\Zilo`, HKCU `…\CurrentVersion\Run\ZiloAgent`, HKCU `Software\Classes\zilo` (`URL Protocol`, `shell\open\command`). Every resource is in components, so uninstall removes it. `MajorUpgrade`. |
| Signing-smoke MSI | wixl 0.103 (`packaging/signing/smoke-msi.wxs`) | One file. It exists only so that osslsigncode signs a real MSI on Linux. It is **not** the product MSI. |
| pkg (CI only) | `pkgbuild` + `productbuild` (`packaging/macos/build-pkg.sh`) | `/Applications/Zilo Agent.app` (universal apphost via `lipo`, `LSUIElement`, `CFBundleURLTypes` → `zilo`), `/Library/LaunchAgents/dev.zilo.agent.plist` (`RunAtLoad`, Aqua sessions), `postinstall` (lsregister, `launchctl bootstrap` for the console user), `uninstall.sh`. |

**Maintainer scripts** (`packaging/linux/scripts/`): `postinstall` runs
`systemctl --global enable zilo-agent.service`, which writes a symlink and works without a running
systemd. `preremove` disables the unit only on real removal (deb `remove`/`deconfigure`, rpm `0`)
and never on upgrade. No network access. The desktop-file-utils triggers (dpkg and rpm) refresh
the mime cache, so the scripts don't call `update-desktop-database`.

### Publish choice: framework-dependent, multi-file, untrimmed

- **D-002:** every assembly stays a separate, replaceable file: no `PublishSingleFile`, no
  trimming. The scaffold carries no NAPS2 yet. The layout already keeps
  `Zilo.Drivers.Naps2.dll` separate, which is where NAPS2's LGPL DLLs will sit.
- **Why not self-contained:** `dotnet publish -r <rid> --self-contained` fails locked restore with
  `NU1004: The project's runtime identifiers have changed`. The committed lock files have no RIDs.
  The fix (adding `RuntimeIdentifiers` and regenerating the lock files) changes `backend/**`,
  which T03 may not do without approval. So the dry run publishes portable framework-dependent
  output and sets only `DefaultAppHostRuntimeIdentifier`, which yields the `linux-x64`,
  `win-x64` (PE32+) and `osx-arm64`/`osx-x64` apphosts. Locked restore stays enforced.
- **Linux: framework-dependent is a viable production option.** Ubuntu 24.04 ships
  `dotnet-runtime-10.0` 10.0.14 (noble-updates/security) and Fedora 43 ships 10.0.13. Both
  resolved in the smokes, and the distro patches the runtime. Caveat: older LTS releases
  (Ubuntu 22.04, Debian 12) may not carry .NET 10. That is a T42 decision.
- **Windows and macOS need self-contained for production.** A customer PC has no .NET 10 runtime,
  and the dry-run MSI and pkg don't install one. **Open item for the masters:** approve adding
  `RuntimeIdentifiers` (`win-x64;win-arm64;osx-arm64;osx-x64;linux-x64`) to the backend and
  regenerating the lock files (T40/T41 or a small backend task).

## No headless container runtime on this host

From `toolchain.log`: `podman`, `nerdctl`, `buildah` and `newuidmap` are absent. The `docker` on
PATH is Docker Desktop's WSL shim script (`/mnt/c/Program Files/Docker/Docker/resources/bin/docker`).
It was **not run**, because the spec forbids launching Docker Desktop. Unprivileged user namespaces
work, which enabled the rootless-chroot fallback.

## Commands

The SDK and tools were installed task-private into the session scratch dir (`<scratch>`). Nothing
was installed globally and no sudo was used.

```sh
# toolchain (hashes in toolchain.log)
curl -fsSLO https://builds.dotnet.microsoft.com/dotnet/Sdk/10.0.403/dotnet-sdk-10.0.403-linux-x64.tar.gz
sha512sum -c   # vs release-metadata hash b7b3d846…3dc7b9c5
curl -fsSLO https://github.com/goreleaser/nfpm/releases/download/v2.48.0/{checksums.txt,nfpm_2.48.0_Linux_x86_64.tar.gz}
sha256sum -c   # 6d7f9a28…97341750
apt-get download osslsigncode wixl msitools rpm rpm-common librpm*9t64 … && dpkg-deb -x … <scratch>/tools/root
(cd packaging/windows && dotnet tool restore)          # WiX 5.0.2; dotnet nuget verify --all: author + repository signed

packaging/linux/build.sh <out>                                         # deb + rpm
RPM=rpm packaging/linux/inspect.sh <out>/*.deb <out>/*.rpm <scratch>/inspect
packaging/linux/smoke/rootless-chroot.sh deb ubuntu-base-24.04.5-base-amd64.tar.gz <out>/*.deb <scratch>/chroot
packaging/linux/smoke/rootless-chroot.sh rpm Fedora-Container-Base-Generic-43-1.6.x86_64.oci.tar.xz <out>/*.rpm <scratch>/chroot
packaging/publish.sh win <out>/publish-win
packaging/signing/test-sign-smoke.sh <out>/publish-win <out>/*.deb <out>/*.rpm <scratch>/sign
packaging/publish.sh osx <out>/publish-osx
(cd packaging/windows && dotnet wix build -arch x64 -d ProductVersion=0.0.1 -d PublishDir=<out>/publish-win Zilo.Agent.wxs -o <out>/x.msi)   # exit 27, expected
actionlint -verbose .github/workflows/packaging-dryrun.yml
```

Environment: `DOTNET_ROOT`, `NUGET_PACKAGES`, `DOTNET_CLI_HOME` under `<scratch>`,
`DOTNET_CLI_TELEMETRY_OPTOUT=1`, `DOTNET_NOLOGO=1`, and `RPM_CONFIGDIR` pointing at the
extracted rpm-common.

## Tool versions and licences

None of these tools is shipped in a Zilo artifact.

| Tool | Version | Licence | Source / pin |
|---|---|---|---|
| .NET SDK | 10.0.403 (runtime 10.0.14) | MIT | official archive, SHA-512 vs release metadata |
| nfpm | 2.48.0 | MIT | GitHub release, SHA-256 from `checksums.txt` |
| WiX Toolset (`wix` dotnet tool) | **5.0.2** | **MS-RL** | `packaging/windows/.config/dotnet-tools.json`; NuGet author + repository signatures verified |
| osslsigncode | 2.8 (Ubuntu 2.8-2) | GPL-3.0+ with OpenSSL exception | Ubuntu noble archive |
| msitools / wixl | 0.103 | LGPL-2.1+ (libmsi), GPL-2+/GPL-3+ (tools) | Ubuntu noble archive |
| rpm / rpmsign / rpmkeys | 4.18.2 | GPL-2+ / LGPL-2+ | Ubuntu noble archive |
| GnuPG | 2.4.4 | GPL-3+ | host |
| OpenSSL | 3.0.13 | Apache-2.0 | host |
| dpkg-deb / apt-ftparchive | 1.22.6 / apt 2.7 | GPL-2+ | host |
| systemd-analyze | 255 (host), 255 / 258 (images) | LGPL-2.1+ | host / images |
| actionlint | 1.7.12 | MIT | GitHub release, SHA-256 `8aca8db9…` |
| Ubuntu base | 24.04.5 | — | cdimage SHA256SUMS + Ubuntu CD signing key |
| Fedora Container Base | 43-1.6 | — | CHECKSUM + Fedora 43 primary key |

**WiX licence finding:** WiX **6.x and 7.x** NuGet packages carry `OSMFEULA.txt` with
`requireLicenseAcceptance=true` (the Open Source Maintenance Fee EULA). WiX **5.0.2** is plain
MS-RL. The dry run pins 5.0.2 to avoid accepting a commercial EULA on the owner's behalf.
**Owner/legal question:** accept OSMF and move to 7.x, or stay on 5.x (check its support status).

## D-011 production signing: what it will need

**Test keys cannot satisfy SAC.** The throwaway root isn't in the Windows trust store and has no
reputation, so a test-signed build is blocked exactly like an unsigned one. The `test-sign` row
proves the tooling and the signing points, nothing more.

- **Windows certificate:** Authenticode from a CA in the Microsoft Trusted Root Program. Options:
  Azure Trusted Signing (Microsoft-managed keys; eligibility and identity validation apply), or an
  OV/EV code-signing certificate whose key sits in a FIPS 140-2 L2+ HSM or token (CA/B Forum
  baseline). SHA-256 digests. Owner-operated credentials (SP-4b).
- **Windows signing points, in order:**
  1. Every PE we ship, **before** packaging:
     - `Zilo.Agent.exe` (apphost);
     - every `Zilo.*.dll`;
     - the bundled NAPS2 assemblies and `NAPS2.Sdk.Worker.Win32` (x86 TWAIN worker) once T06 adds
       them;
     - any helper (tray UI, updater).
  2. Microsoft-signed .NET runtime files in a self-contained publish are already signed: verify
     them, don't re-sign.
  3. Build the MSI, then sign the **MSI** (the embedded cab is covered by the MSI signature).
  4. Self-update artifacts (D-008) must also carry the Authenticode signature plus the manifest
     signature.
- **Windows verification:** `signtool verify /pa /all /tw` on Windows CI, or `osslsigncode verify`
  on Linux. The CI step should fail on any unsigned PE in the payload.
- **Timestamp:** RFC 3161, SHA-256 (`signtool sign /fd sha256 /tr <url> /td sha256`):
  - Azure Trusted Signing: `http://timestamp.acs.microsoft.com`;
  - for a CA certificate, use that CA's TSA, for example DigiCert `http://timestamp.digicert.com`
    or Sectigo `http://timestamp.sectigo.com`.

  The dry run used no TSA (offline). Without a timestamp, signatures stop validating when the
  certificate expires.
- **LGPL interplay to settle with legal (D-002):** re-signing third-party LGPL DLLs is allowed.
  However, a user who exercises the LGPL right to replace a DLL will produce an unsigned file that
  SAC blocks. Document this in the source offer.
- **macOS (SP-4b, T41):**
  - signing:
    - "Developer ID Application" certificate: `codesign --options runtime --timestamp` on every
      Mach-O and on the app;
    - "Developer ID Installer" certificate: `productsign` for the pkg;
  - notarization: `notarytool submit --wait`, then `stapler staple`;
  - .NET under the hardened runtime needs JIT entitlements (for example
    `com.apple.security.cs.allow-jit`), to be validated in SP-4b;
  - Apple's timestamp service is implicit with `--timestamp`.
- **Linux:** an owner-held OpenPGP repository key signs `InRelease` (apt) and `repomd.xml` plus
  per-package rpm signatures (`rpmsign`). The public key ships via the repo setup instructions.
  The key must never live in CI except through a protected signing step.

## Open items

1. Approve the backend `RuntimeIdentifiers` and lock-file regeneration for self-contained
   Windows/macOS builds (above).
2. WiX 5.0.2 (MS-RL) vs 6+/7 (OSMF EULA): owner/legal.
3. Placeholders to replace before external release: maintainer, vendor and homepage
   (`zilo.invalid`), and the macOS bundle id / LaunchAgent label `dev.zilo.agent`.
4. Container smokes, the MSI build and install smoke, and the pkg build run only once a hosted
   remote exists (D-010). The workflow is ready (`.github/workflows/packaging-dryrun.yml`).
5. T40 should decide between the Run key (used here) and a scheduled task. T41 replaces the
   LaunchAgent with `SMAppService`.
