"""Negative-feasibility evidence must reject any unexpected outcome, not waive it."""
import copy
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import shutil
import unittest


class ExpectedGateTests(unittest.TestCase):
    def run_probe(self, rid, graph=None):
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary) / "graph.json"
            path.write_text(json.dumps(graph if graph is not None else self.graph(rid)))
            return subprocess.run([sys.executable, "expected_gate.py", "--rid", rid,
                "--inventory", str(path)], capture_output=True, text=True)

    def graph(self, rid):
        return json.loads(Path(f"evidence/inventory/{rid}.gate.json").read_text())

    def test_all_five_actual_outcomes_are_expected(self):
        for rid in ("win-x64", "win-arm64", "linux-x64", "osx-arm64", "osx-x64"):
            with self.subTest(rid=rid):
                result = self.run_probe(rid)
                self.assertEqual(0, result.returncode, result.stdout + result.stderr)

    def test_unexpected_pass_is_not_accepted_as_expected_denial(self):
        graph = self.graph("osx-arm64")
        graph["rid"] = "win-x64"
        self.assertNotEqual(0, self.run_probe("win-x64", graph).returncode)

    def test_additional_seeded_denial_is_not_hidden_by_known_blocker(self):
        graph = self.graph("win-x64")
        package = copy.deepcopy(graph["packages"][0])
        package.update(id="Seeded.Bad.Package", licenseExpression="GPL-3.0-only")
        graph["packages"].append(package)
        self.assertNotEqual(0, self.run_probe("win-x64", graph).returncode)

    def test_malformed_metadata_is_not_a_license_denial(self):
        self.assertNotEqual(0, self.run_probe("linux-x64", {"invalid": True}).returncode)

    def test_rid_cannot_be_mislabeled(self):
        self.assertNotEqual(0, self.run_probe("osx-x64", self.graph("osx-arm64")).returncode)

    def test_first_party_gate_omission_or_licence_mutation_fails_closed(self):
        for mutation in ("omission", "MIT", "LicenseRef-Private"):
            with self.subTest(mutation=mutation):
                graph = self.graph("osx-arm64")
                own = next(p for p in graph["packages"] if p["id"] == "Zilo.Naps2Spike")
                if mutation == "omission":
                    graph["packages"].remove(own)
                else:
                    own["licenseExpression"] = mutation
                self.assertNotEqual(0, self.run_probe("osx-arm64", graph).returncode)

    def test_first_party_source_inventory_and_policy_mutations_fail_closed(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            spike = root / "spikes/naps2"
            shutil.copytree(".", spike, ignore=shutil.ignore_patterns("bin", "obj", "artifacts", "__pycache__"))
            shutil.copytree("../../tools/license-gate", root / "tools/license-gate")
            inventory_path = spike / "evidence/inventory/osx-arm64.json"
            baseline = json.loads(inventory_path.read_text())
            policy_path = spike / "policy.json"
            policy = json.loads(policy_path.read_text())
            program = spike / "Program.cs"
            source = program.read_bytes()
            for mutation in ("source-omission", "inventory-omission", "metadata", "source-hash", "missing-source", "policy"):
                with self.subTest(mutation=mutation):
                    data = copy.deepcopy(baseline)
                    own = next(p for p in data["packages"] if p["id"] == "Zilo.Naps2Spike")
                    if mutation == "source-omission":
                        own["sourceFiles"].pop()
                    elif mutation == "inventory-omission":
                        data["packages"].remove(own)
                    elif mutation == "metadata":
                        own["licenseExpression"] = "MIT"
                    elif mutation == "source-hash":
                        program.write_bytes(source + b"\n// seeded source change\n")
                    elif mutation == "missing-source":
                        program.unlink()
                    else:
                        pin = dict(policy["packages"][0], id="ZILO.NAPS2SPIKE")
                        changed = copy.deepcopy(policy)
                        changed["packages"].append(pin)
                        policy_path.write_text(json.dumps(changed))
                    inventory_path.write_text(json.dumps(data))
                    result = subprocess.run([sys.executable, "expected_gate.py", "--rid", "osx-arm64"],
                        cwd=spike, capture_output=True, text=True)
                    self.assertEqual(1, result.returncode, result.stdout + result.stderr)
                    self.assertFalse(json.loads(result.stdout)["expectedOutcomeMatched"])
                    program.write_bytes(source)
                    policy_path.write_text(json.dumps(policy))


if __name__ == "__main__":
    unittest.main()
