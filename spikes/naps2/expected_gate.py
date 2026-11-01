"""D-010b tooling assertion, NOT a release gate or redistribution clearance.

Run the unmodified gate and require the exact observed result, including every
cascading payload denial. A new denial, an unexpected pass, or invalid metadata
fails this evidence check. Never regenerate expectations to make CI green.
"""
import argparse
import json
from pathlib import Path
import subprocess
import sys
from inventory import first_party_package, gate_inventory


WORKER = [
    "package NAPS2.Sdk.Worker.Win32@1.6.0: missing exact package policy pin (id/version/hash/expression)",
    "payload NAPS2.Sdk.Worker.Win32.dll: exact approved inventory owner required",
]
GTK = ("AtkSharp", "CairoSharp", "GLibSharp", "GdkSharp", "GioSharp", "GtkSharp", "PangoSharp")
DENIED_IDENTITIES = {name.casefold() for name in (*GTK, "NAPS2.Sdk.Worker.Win32", "Zilo.Naps2Spike")}
FIRST_PARTY = ["package Zilo.Naps2Spike@0.0.0: missing exact package policy pin (id/version/hash/expression)"] + [
    f"payload {name}: exact approved inventory owner required" for name in (
        "Naps2Spike.deps.json", "Naps2Spike.dll", "Naps2Spike.pdb", "Naps2Spike.runtimeconfig.json")]
EXPECTED = {
    "win-x64": (1, "denied", 28, 79, WORKER + ["payload NAPS2.Worker.exe: exact approved inventory owner required"]),
    "win-arm64": (1, "denied", 28, 78, WORKER),
    "linux-x64": (1, "denied", 32, 81,
        [f"package {name}@3.24.24.95: missing exact package policy pin (id/version/hash/expression)" for name in GTK]
        + [f"payload {name}.dll: exact approved inventory owner required" for name in GTK]),
    "osx-arm64": (1, "denied", 27, 77, []),
    "osx-x64": (1, "denied", 27, 77, []),
}
EXPECTED = {rid: (code, status, packages, payloads, errors + FIRST_PARTY)
    for rid, (code, status, packages, payloads, errors) in EXPECTED.items()}


def main():
    root = Path(__file__).resolve().parent
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--rid", choices=EXPECTED, required=True)
    parser.add_argument("--inventory", type=Path)
    args = parser.parse_args()
    inventory = args.inventory or root / f"evidence/inventory/{args.rid}.gate.json"
    try:
        # Outcome equality alone cannot reveal a waiver masked by another denial.
        policy = json.loads((root / "policy.json").read_text())
        if policy["exceptions"] != [] or policy["reviewedPayloads"] != []:
            raise ValueError("D-010b forbids exceptions and reviewed payload waivers in this spike")
        if any(pin["id"].casefold() in DENIED_IDENTITIES for pin in policy["packages"]):
            raise ValueError("D-010b forbids approval pins for denied identities")
        graph = json.loads(inventory.read_text())
        source = json.loads((root / f"evidence/inventory/{args.rid}.json").read_text())
        own = first_party_package()
        if [p for p in source["packages"] if p["id"].casefold() == "zilo.naps2spike"] != [own]:
            raise ValueError("First-party source inventory differs from actual private UNLICENSED inputs")
        expected_own = gate_inventory({"rid": args.rid, "packages": [own], "payloads": []})["packages"]
        if [p for p in graph["packages"] if p["id"].casefold() == "zilo.naps2spike"] != expected_own:
            raise ValueError("First-party gate metadata differs from private UNLICENSED source")
        if graph["rid"] != args.rid:
            raise ValueError("Inventory RID differs from asserted RID")
        result = subprocess.run([sys.executable, str(root / "../../tools/license-gate/gate.py"),
            "check", str(inventory), "--policy", str(root / "policy.json")], capture_output=True, text=True)
        code, status, packages, payloads, errors = EXPECTED[args.rid]
        observed = json.loads(result.stdout)
        expected = {"status": status, "packages": packages, "payloads": payloads, "errors": errors}
        # Sorting preserves duplicate multiplicity; merely checking subsets could hide new failures.
        observed["errors"] = sorted(observed["errors"])
        expected["errors"] = sorted(expected["errors"])
        matched = result.returncode == code and not result.stderr and observed == expected
        print(json.dumps({"rid": args.rid, "expectedOutcomeMatched": matched,
            "gateExit": result.returncode, "gate": observed,
            "shippingClearance": False, "scope": "negative-feasibility tooling only"}))
        return 0 if matched else 1
    except (OSError, ValueError, KeyError, TypeError) as exc:
        print(json.dumps({"expectedOutcomeMatched": False, "error": str(exc)}))
        return 1


if __name__ == "__main__":
    sys.exit(main())
