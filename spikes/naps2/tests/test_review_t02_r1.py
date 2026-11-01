"""T02 review r1 (Claude): failing tests that prove D-010b defects. See docs/reviews/T02-r1.md.

D-010b: a negative spike merges only if "no suppression, waiver or allowlist entry is added".
These tests fail on 7e09b60 and must pass after the fix. Run from spikes/naps2.
"""
import json
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest

DENIED = {"naps2.sdk.worker.win32", "atksharp", "cairosharp", "glibsharp", "gdksharp", "giosharp",
          "gtksharp", "pangosharp"}
COMPLIANT = {"linkage": "dynamic", "separateDll": True, "replaceable": True,
             "trimmed": False, "merged": False, "singleFile": False}


def gate(graph):
    with tempfile.TemporaryDirectory() as temporary:
        path = Path(temporary) / "graph.json"
        path.write_text(json.dumps(graph))
        return subprocess.run([sys.executable, "../../tools/license-gate/gate.py", "check", str(path),
                               "--policy", "policy.json"], capture_output=True, text=True)


class ReviewT02R1Tests(unittest.TestCase):
    def test_f1_denied_items_have_no_policy_allowlist_pin(self):
        policy = json.loads(Path("policy.json").read_text())
        pinned = sorted(p["id"] for p in policy["packages"] if p["id"].casefold() in DENIED)
        self.assertEqual([], pinned, "policy.json approves a D-010b denied item")

    def test_f1_worker_denial_does_not_rest_on_a_producer_flag_alone(self):
        # Only the producer's hardcoded deployment projection changes; policy is untouched.
        graph = json.loads(Path("evidence/inventory/win-arm64.gate.json").read_text())
        for package in graph["packages"]:
            if package["id"] == "NAPS2.Sdk.Worker.Win32":
                package["deployment"] = dict(COMPLIANT)
        result = gate(graph)
        self.assertEqual(1, result.returncode, "worker cleared by policy pin once the flag flips: "
                         + result.stdout)

    def test_f2_wrapper_rejects_a_waiver_masked_by_an_existing_denial(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            spike = root / "spikes/naps2"
            shutil.copytree(".", spike, ignore=shutil.ignore_patterns("bin", "obj", "artifacts"))
            shutil.copytree("../../tools/license-gate", root / "tools/license-gate")
            graph = json.loads((spike / "evidence/inventory/win-x64.gate.json").read_text())
            exe = next(p for p in graph["payloads"] if p["path"] == "NAPS2.Worker.exe")
            policy = json.loads((spike / "policy.json").read_text())
            policy["reviewedPayloads"].append(dict(
                {key: exe[key] for key in ("path", "sha256", "kind", "packageId", "packageVersion")},
                rid="win-x64", licenseExpression="LGPL-2.1-or-later",
                review={"reviewer": "seeded", "date": "2026-11-01",
                        "reference": "docs/legal/exceptions.md#seeded-worker-waiver"},
                obligations=["seeded"], provenance=["seeded"]))
            (spike / "policy.json").write_text(json.dumps(policy))
            result = subprocess.run([sys.executable, "expected_gate.py", "--rid", "win-x64"],
                                    cwd=spike, capture_output=True, text=True)
            self.assertNotEqual(0, result.returncode, "waiver accepted silently: " + result.stdout)


if __name__ == "__main__":
    unittest.main()
