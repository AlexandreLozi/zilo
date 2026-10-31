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


WORKER = [
    "package NAPS2.Sdk.Worker.Win32@1.6.0: LGPL requires dynamic, separate, replaceable, untrimmed/unmerged DLL deployment",
    "payload NAPS2.Sdk.Worker.Win32.dll: exact approved inventory owner required",
]
GTK = ("AtkSharp", "CairoSharp", "GLibSharp", "GdkSharp", "GioSharp", "GtkSharp", "PangoSharp")
EXPECTED = {
    "win-x64": (1, "denied", 28, 79, WORKER + ["payload NAPS2.Worker.exe: exact approved inventory owner required"]),
    "win-arm64": (1, "denied", 28, 78, WORKER),
    "linux-x64": (1, "denied", 32, 81,
        [f"package {name}@3.24.24.95: missing exact package policy pin (id/version/hash/expression)" for name in GTK]
        + [f"payload {name}.dll: exact approved inventory owner required" for name in GTK]),
    "osx-arm64": (0, "passed", 27, 77, []),
    "osx-x64": (0, "passed", 27, 77, []),
}


def main():
    root = Path(__file__).resolve().parent
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--rid", choices=EXPECTED, required=True)
    parser.add_argument("--inventory", type=Path)
    args = parser.parse_args()
    inventory = args.inventory or root / f"evidence/inventory/{args.rid}.gate.json"
    try:
        if json.loads(inventory.read_text())["rid"] != args.rid:
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
