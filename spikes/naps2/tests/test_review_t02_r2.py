"""T02 review r2 regressions (Claude reviewer). Run from spikes/naps2.

F4 fix: `.gitattributes` adds `LICENSE text eol=lf` for the first-party hashed
LICENSE. An unanchored pattern matches every file named LICENSE below this
directory, so the later rule overrides `evidence/licenses/** -text` for the
ten upstream nupkg LICENSE evidence files. Git then treats their committed
CRLF bytes as text to normalize: the worktree shows them modified, and any
`git add`/renormalize rewrites them to LF so they stop matching the recorded
`licenseFileSha256` in the inventories.
"""
import hashlib
import json
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest


def tracked(*prefixes):
    out = subprocess.run(["git", "ls-files", "-z", "--", *prefixes], check=True,
        capture_output=True).stdout
    return [name for name in out.decode().split("\0") if name]


class ReviewT02R2Tests(unittest.TestCase):
    def test_f4_upstream_evidence_is_never_text_normalized(self):
        files = tracked("evidence/licenses", "evidence/source")
        self.assertTrue(files)
        out = subprocess.run(["git", "check-attr", "-z", "text", "--", *files], check=True,
            capture_output=True).stdout.decode().split("\0")
        normalized = sorted(path for path, _, value in zip(out[0::3], out[1::3], out[2::3])
            if value != "unset")
        self.assertEqual([], normalized, "upstream evidence bytes must stay -text")

    def test_f4_staging_license_evidence_preserves_recorded_hash(self):
        inventory = json.loads(Path("evidence/inventory/win-x64.json").read_text())
        package = next(p for p in inventory["packages"] if p["id"] == "NAPS2.Sdk")
        relative = Path("evidence") / package["licenseEvidence"]
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            subprocess.run(["git", "init", "-q", str(root)], check=True)
            shutil.copyfile(".gitattributes", root / ".gitattributes")
            (root / relative).parent.mkdir(parents=True)
            shutil.copyfile(relative, root / relative)
            subprocess.run(["git", "-C", str(root), "add", "."], check=True, capture_output=True)
            staged = subprocess.run(["git", "-C", str(root), "show", f":{relative.as_posix()}"],
                check=True, capture_output=True).stdout
        self.assertEqual(package["licenseFileSha256"], hashlib.sha256(staged).hexdigest())


if __name__ == "__main__":
    unittest.main()
