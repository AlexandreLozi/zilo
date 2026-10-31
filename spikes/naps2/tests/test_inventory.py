import hashlib
import importlib.util
from pathlib import Path
import struct
import tempfile
import unittest


class InventoryTests(unittest.TestCase):
    def load(self):
        path = Path("inventory.py")
        self.assertTrue(path.is_file(), "Inventory producer is required")
        spec = importlib.util.spec_from_file_location("inventory", path)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        return module

    def test_native_binaries_are_not_trusted_by_extension(self):
        module = self.load()
        for content in [b"\x7fELFxxx", b"\xcf\xfa\xed\xfexxx", b"MZ" + bytes(100)]:
            self.assertEqual("native", module.binary_kind(content))
        self.assertEqual("data", module.binary_kind(b"hello"))

    def test_managed_pe_requires_clr_directory(self):
        module = self.load()
        data = bytearray(512)
        data[:2] = b"MZ"
        struct.pack_into("<I", data, 0x3c, 0x80)
        data[0x80:0x84] = b"PE\0\0"
        struct.pack_into("<H", data, 0x98, 0x10b)
        struct.pack_into("<II", data, 0x98 + 96 + 14 * 8, 0x2000, 72)
        self.assertEqual("managed", module.binary_kind(bytes(data)))

    def test_content_hash_is_checked_against_lock(self):
        module = self.load()
        with self.assertRaisesRegex(ValueError, "hash"):
            module.verify_hash(b"changed package", "not-the-locked-hash")

    def test_gate_projection_preserves_every_package_and_payload(self):
        module = self.load()
        self.assertTrue(hasattr(module, "gate_inventory"), "Strict gate projection is required")
        source = {"rid": "linux-x64", "packages": [{"id": "A", "version": "1.0", "sha512": "h", "licenseExpression": "MIT", "licenseFile": None, "licenseFileSha256": None, "source": "url", "repository": "extra"}],
                  "payloads": [{"path": "A.dll", "sha256": "h", "kind": "managed", "packageId": "A", "packageVersion": "1.0", "size": 1}]}
        output = module.gate_inventory(source)
        self.assertEqual(1, len(output["packages"]))
        self.assertEqual(1, len(output["payloads"]))
        self.assertNotIn("repository", output["packages"][0])
        self.assertNotIn("size", output["payloads"][0])

    def test_worker_bundle_never_claims_separate_replaceable_dlls(self):
        module = self.load()
        self.assertTrue(hasattr(module, "gate_inventory"), "Strict gate projection is required")
        source = {"rid": "win-x64", "packages": [{"id": "NAPS2.Sdk.Worker.Win32", "version": "1.6.0", "sha512": "h", "licenseExpression": None, "licenseFile": "LICENSE", "source": "url"}], "payloads": []}
        deployment = module.gate_inventory(source)["packages"][0]["deployment"]
        self.assertTrue(deployment["singleFile"])
        self.assertFalse(deployment["separateDll"])


if __name__ == "__main__":
    unittest.main()
