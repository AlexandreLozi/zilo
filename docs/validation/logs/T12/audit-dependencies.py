"""Read-only exact dependency closure check. Run from repository root."""
import base64
import hashlib
import json
from pathlib import Path
import subprocess
import xml.etree.ElementTree as ET

base = "add1d73"
old = set()
for name in subprocess.check_output(["git", "ls-tree", "-r", "--name-only", base, "backend"], text=True).splitlines():
    if name.endswith("packages.lock.json"):
        data = json.loads(subprocess.check_output(["git", "show", f"{base}:{name}"], text=True))
        for packages in data["dependencies"].values():
            old.update((key.lower(), val["resolved"]) for key, val in packages.items() if "resolved" in val)

current = set()
for path in sorted(Path("backend").rglob("packages.lock.json")):
    data = json.loads(path.read_text())
    for packages in data["dependencies"].values():
        current.update((key.lower(), val["resolved"]) for key, val in packages.items() if "resolved" in val)
added = current - old
assert added == {("zxing.net", "0.16.11")}, f"Unexpected package closure: {added}"
print("New union package closure:", sorted(added))

cache = Path("/tmp/opencode/t12-proto-r2/nuget/zxing.net/0.16.11")
root = ET.parse(cache / "zxing.net.nuspec").getroot()
ns = {"n": "http://schemas.microsoft.com/packaging/2013/05/nuspec.xsd"}
metadata = root.find("n:metadata", ns)
for key in ("id", "version", "authors", "license", "projectUrl"):
    print(f"Nuspec {key}:", metadata.find(f"n:{key}", ns).text)
assert metadata.find("n:license", ns).text == "Apache-2.0"
digest = base64.b64encode(hashlib.sha512((cache / "zxing.net.0.16.11.nupkg").read_bytes()).digest()).decode()
print("Package SHA512 base64:", digest)
assert digest == (cache / "zxing.net.0.16.11.nupkg.sha512").read_text().strip()
content_hash = json.loads((cache / ".nupkg.metadata").read_text())["contentHash"]
lock = json.loads(Path("backend/src/Zilo.Drivers.Virtual/packages.lock.json").read_text())
assert lock["dependencies"]["net10.0"]["ZXing.Net"]["contentHash"] == content_hash
print("NuGet metadata/lock contentHash:", content_hash)

assets = json.loads(Path("backend/src/Zilo.Drivers.Virtual/obj/project.assets.json").read_text())
for framework, packages in assets["targets"].items():
    qr = packages["ZXing.Net/0.16.11"]
    assert not qr.get("dependencies"), qr
    for kind in ("compile", "runtime"):
        selected = list(qr[kind])
        assert selected == ["lib/net9.0/zxing.dll"], selected
        print(framework, kind, selected)
    assert not qr.get("native") and not qr.get("runtimeTargets"), qr
print("PASS: exact approved managed QR only; no new transitive/native/image stack.")
