import hashlib
import importlib.util
from pathlib import Path
import struct
import unittest

SIGNATURE = bytes.fromhex("8b1202b96a612038727b930214d7a03213f5b9e6efae3318ee3b2dce24b36aae")


class BundleTests(unittest.TestCase):
    def load(self):
        path = Path("bundle_inventory.py")
        self.assertTrue(path.is_file(), "Bundle evidence reader is required")
        spec = importlib.util.spec_from_file_location("bundle_inventory", path)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        return module

    def test_records_bundled_assemblies_without_extracting_them(self):
        module = self.load()
        payload = b"managed-content"
        prefix = struct.pack("<Q", 64 + len(payload)) + SIGNATURE
        prefix += bytes(64 - len(prefix))
        name = b"NAPS2.Sdk.dll"
        manifest = struct.pack("<III", 6, 0, 1) + b"\x02ID" + struct.pack("<QQQQQ", 0, 0, 0, 0, 0)
        manifest += struct.pack("<QQQB", 64, len(payload), 0, 1) + bytes([len(name)]) + name
        result = module.inspect_bundle(prefix + payload + manifest)
        self.assertEqual("NAPS2.Sdk.dll", result["entries"][0]["path"])
        self.assertEqual(hashlib.sha256(payload).hexdigest(), result["entries"][0]["sha256"])

    def test_missing_or_truncated_bundle_fails(self):
        module = self.load()
        for content in (b"plain bytes", struct.pack("<Q", 999999) + SIGNATURE):
            with self.assertRaises(ValueError):
                module.inspect_bundle(content)


if __name__ == "__main__":
    unittest.main()
