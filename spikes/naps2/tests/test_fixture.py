import importlib.util
import json
import os
from pathlib import Path
import subprocess
import unittest


class FixtureTests(unittest.TestCase):
    def test_real_naps2_escl_client_acquires_independent_page(self):
        path = Path("escl_fixture.py")
        self.assertTrue(path.is_file(), "Independent Python fixture is required")
        spec = importlib.util.spec_from_file_location("escl_fixture", path)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        rid = os.environ.get("SPIKE_RID", "linux-x64")
        with module.Fixture() as fixture:
            result = subprocess.run(
                [os.environ.get("DOTNET", "dotnet"), f"bin/Release/net10.0/{rid}/Naps2Spike.dll", "fixture", fixture.url, "artifacts/fixture-test"],
                capture_output=True, text=True, timeout=30,
            )
            self.assertEqual(0, result.returncode, result.stderr)
            self.assertEqual(1, json.loads(result.stdout)["pages"])
            self.assertEqual(["image/png"], fixture.formats)
            self.assertIn("POST /eSCL/ScanJobs", fixture.requests)
            self.assertEqual(2, fixture.requests.count("GET /eSCL/ScanJobs/1/NextDocument"))


if __name__ == "__main__":
    unittest.main()
