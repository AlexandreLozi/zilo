"""Real CLI assertions: without rendering/probing implementation these fail."""
import json
import os
from pathlib import Path
import subprocess
import unittest


class RuntimeTests(unittest.TestCase):
    def test_fonts_render_and_export(self):
        rid = os.environ.get("SPIKE_RID", "linux-x64")
        result = subprocess.run(
            [os.environ.get("DOTNET", "dotnet"), f"bin/Release/net10.0/{rid}/Naps2Spike.dll", "render", "artifacts/render-test"],
            capture_output=True, text=True,
        )
        self.assertEqual(0, result.returncode, result.stderr)
        data = json.loads(result.stdout)
        self.assertEqual("1.0.1", data["fontsPackage"])
        self.assertGreater(data["textWidth"], 0)
        self.assertGreater(data["glyphPaths"], 0)
        self.assertGreater(data["pngBytes"], 100)
        self.assertGreater(data["pdfBytes"], 100)
        self.assertTrue(Path("artifacts/render-test/page.png").read_bytes().startswith(b"\x89PNG"))
        self.assertTrue(Path("artifacts/render-test/page.pdf").read_bytes().startswith(b"%PDF"))
        self.assertIn("<path", Path("artifacts/render-test/fonts.svg").read_text())


if __name__ == "__main__":
    unittest.main()
