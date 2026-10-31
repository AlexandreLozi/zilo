"""Integration tests use the actually restored/published osx-arm64 metadata graph.

The seeded variants are adversarial metadata, never hardware/runtime evidence.
"""
import copy
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

GATE = Path("../../tools/license-gate/gate.py")


class RealGraphGateTests(unittest.TestCase):
    def check(self, data):
        self.assertTrue(Path("policy.json").is_file(), "Actual version-specific metadata policy is required")
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary) / "inventory.json"
            path.write_text(json.dumps(data))
            return subprocess.run([sys.executable, str(GATE), "check", str(path), "--policy", "policy.json"], capture_output=True, text=True)

    def graph(self):
        return json.loads(Path("evidence/inventory/osx-arm64.gate.json").read_text())

    def test_actual_permissive_and_dynamic_lgpl_graph(self):
        result = self.check(self.graph())
        self.assertEqual(0, result.returncode, result.stdout + result.stderr)

    def test_seeded_disallowed_or_unknown_package_is_denied(self):
        for expression in ("GPL-3.0-only", "AGPL-3.0-only", "LicenseRef-Six-Labors-Split-License", "LicenseRef-Unknown"):
            with self.subTest(expression=expression):
                graph = self.graph()
                package = copy.deepcopy(graph["packages"][0])
                package.update(id="Seeded.Bad.Package", licenseExpression=expression, licenseFile=None)
                graph["packages"].append(package)
                result = self.check(graph)
                self.assertEqual(1, result.returncode, result.stdout + result.stderr)

    def test_native_payload_cannot_piggyback_on_permissive_package(self):
        graph = self.graph()
        graph["payloads"].append({"path": "seeded-native.so", "sha256": "0" * 64, "kind": "native",
            "packageId": graph["packages"][0]["id"], "packageVersion": graph["packages"][0]["version"]})
        result = self.check(graph)
        self.assertEqual(1, result.returncode, result.stdout + result.stderr)


if __name__ == "__main__":
    unittest.main()
