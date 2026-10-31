"""Maintainer-only evidence capture from immutable upstream commits; not run by CI.

Output is committed for offline review. Publication-era evidence is marked as
such; it is NOT a cryptographic source-to-binary attestation.
"""
import hashlib
import json
from pathlib import Path
import urllib.request

NAPS2 = "https://raw.githubusercontent.com/cyanfish/naps2/f914a4ec2af090aca4fa55eb3242ec91641482c3/"
SOURCES = {
    "makaretu-LICENSE": "https://raw.githubusercontent.com/richardschneider/net-dns/701463d2091e6d98d4cc4490abb0e0ead8ae2985/LICENSE",
    "simplebase-LICENSE.txt": "https://raw.githubusercontent.com/ssg/SimpleBase/72ecb1de90918faade31351ece771e67f52d4d4a/LICENSE.txt",
    "simplebase-AssemblyInfo.cs": "https://raw.githubusercontent.com/ssg/SimpleBase/72ecb1de90918faade31351ece771e67f52d4d4a/src/Properties/AssemblyInfo.cs",
    "gtksharp-LICENSE-candidate": "https://raw.githubusercontent.com/GtkSharp/GtkSharp/82dc24c1d5c288311ca9078244c4000cef6c211f/LICENSE",
    "sdk-worker-build.csproj": NAPS2 + "NAPS2.Sdk.Worker.Build/NAPS2.Sdk.Worker.Build.csproj",
    "sdk-worker-package.csproj": NAPS2 + "NAPS2.Sdk.Worker.Win32/NAPS2.Sdk.Worker.Win32.csproj",
    "sdk-worker-copy.targets": NAPS2 + "NAPS2.Sdk.Worker.Win32/NAPS2.Sdk.Worker.Win32.targets",
    "sdk-project.csproj": NAPS2 + "NAPS2.Sdk/NAPS2.Sdk.csproj",
    "sdk-driver-factory.cs": NAPS2 + "NAPS2.Sdk/Scan/Internal/ScanDriverFactory.cs",
    "sdk-apple-driver.cs": NAPS2 + "NAPS2.Sdk/Scan/Internal/Apple/AppleScanDriver.cs",
}


def main():
    root = Path(__file__).resolve().parent
    captured = {}
    for name, url in SOURCES.items():
        data = urllib.request.urlopen(url, timeout=30).read()
        relative = f"evidence/source/{name}"
        path = root / relative
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(data)
        captured[name] = {"url": url, "path": relative, "sha256": hashlib.sha256(data).hexdigest()}
    (root / "evidence/source/index.json").write_text(json.dumps(captured, indent=2) + "\n")
    licenses = {
        "Makaretu.Dns/2.0.1": {**captured["makaretu-LICENSE"], "association": "Repository commit declared by exact nupkg nuspec; MIT text at that commit."},
        "SimpleBase/1.3.1": {**captured["simplebase-LICENSE.txt"], "association": "Exact nupkg licenseUrl points to Apache; publication-era source LICENSE is Apache2 and AssemblyInfo.cs declares1.3.1. Source-to-package association corroborated, not reproducibly rebuilt."},
    }
    for package in ("AtkSharp", "CairoSharp", "GdkSharp", "GioSharp", "GLibSharp", "GtkSharp", "PangoSharp"):
        licenses[f"{package}/3.24.24.95"] = {**captured["gtksharp-LICENSE-candidate"], "association": "UNRESOLVED: no license/commit metadata in nupkg; publication-era GtkSharp root LICENSE is LGPL2.0, not enough to map exact binary. Gate approval intentionally absent."}
    (root / "source-licenses.json").write_text(json.dumps(licenses, indent=2) + "\n")


if __name__ == "__main__":
    main()
