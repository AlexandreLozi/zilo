"""Maintainer-only technical interpretation draft; NEVER run to approve dependencies in CI.

This pins observed versions and evidence, not legal/independent approvals.
Review policy.json and SP-2a before changing or accepting its output.
"""
import json
from pathlib import Path

FILE_INTERPRETATIONS = {
    ("GrpcDotNetNamedPipes", "3.1.0"): "Apache-2.0",
    ("Makaretu.Dns", "2.0.1"): "MIT",
    ("SimpleBase", "1.3.1"): "Apache-2.0",
    ("NAPS2.PdfSharp", "1.0.2"): "MIT",
    ("Eto.Forms", "2.11.0"): "BSD-3-Clause",
    ("Eto.Platform.Mac64", "2.11.0"): "BSD-3-Clause",
    **{(name, "1.6.0"): "LGPL-2.1-or-later" for name in (
        "NAPS2.Sdk", "NAPS2.Escl", "NAPS2.Images", "NAPS2.Internals",
        "NAPS2.Images.Gdi", "NAPS2.Images.Gtk", "NAPS2.Images.Mac")},
}
ALLOWED = ["MIT", "Apache-2.0", "BSD-2-Clause", "BSD-3-Clause", "ISC", "0BSD", "Zlib", "LGPL-2.1-or-later"]


def main():
    root = Path(__file__).resolve().parent
    observed = {}
    for path in sorted((root / "evidence/inventory").glob("*.json")):
        if path.name.endswith(".gate.json"):
            continue
        for package in json.loads(path.read_text())["packages"]:
            identity = package["id"], package["version"]
            if identity in observed and observed[identity] != package:
                raise ValueError(f"Conflicting RID package evidence: {identity}")
            observed[identity] = package
    packages = []
    for identity, package in sorted(observed.items()):
        if identity[0].casefold() == "naps2.sdk.worker.win32":
            # D-010b: never emit an approval pin, even if upstream adds SPDX metadata.
            continue
        expression = package["licenseExpression"] or FILE_INTERPRETATIONS.get(identity)
        if expression not in ALLOWED:
            # GtkSharp family deliberately remains unknown/unapproved, never guess LGPL2.1.
            continue
        pin = {key: package[key] for key in ("id", "version", "sha512")}
        pin["licenseExpression"] = expression
        pin.update({"review": {"reviewer": "GPT T02 author technical interpretation; independent Claude/legal review pending",
            "date": "2026-10-31", "reference": "docs/spikes/SP-2a.md#license-evidence"},
            "obligations": ["license-text", "notice"],
            "provenance": [package["source"], f"NuGet lock contentHash: {package['sha512']}"]})
        if expression.startswith("LGPL-"):
            pin["obligations"] += ["source-offer", "replaceable-dll"]
        if package["licenseExpression"] is None:
            pin.update({key: package[key] for key in ("licenseFile", "licenseFileSha256", "source")})
            pin["provenance"].append(f"Actual license bytes SHA256: {package['licenseFileSha256']}")
            pin["provenance"].append(package.get("licenseEvidenceSource", package.get("licenseEvidence", "")))
            if package.get("sourceAssociation"):
                pin["provenance"].append(package["sourceAssociation"])
        if identity == ("Eto.Platform.Mac64", "2.11.0"):
            pin["obligations"].append("Include MonoMac-LICENSE.txt; exercise its MIT option for MonoMac.dll in addition to Eto BSD3 notices")
            pin["provenance"].append("Exact nupkg includes MonoMac-LICENSE.txt: MIT OR Apache2; primary package license file applies to Eto, not a claim that MonoMac is BSD3")
        packages.append(pin)
    policy = {"schemaVersion": 1, "allowedExpressions": ALLOWED, "packages": packages,
        "exceptions": [], "reviewedPayloads": []}
    (root / "policy.json").write_text(json.dumps(policy, indent=2) + "\n")
    print(f"Wrote {len(packages)} exact technical pins; no restricted exceptions/native approvals; independent review pending")


if __name__ == "__main__":
    main()
