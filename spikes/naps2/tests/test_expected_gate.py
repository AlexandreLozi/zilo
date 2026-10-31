"""Negative-feasibility evidence must reject any unexpected outcome, not waive it."""
import copy
import json
from pathlib import Path
import subprocess
import sys
import tempfile
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


if __name__ == "__main__":
    unittest.main()
