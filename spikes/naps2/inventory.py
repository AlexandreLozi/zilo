"""Inventory locked NuGet ZIPs and every published file; never infer a license from a name.

NuGet's lock contentHash is NOT necessarily the SHA512 of a signed nupkg.
Both are recorded: NuGet metadata/contentHash is checked against the lock;
archiveSha512 is independently checked against the archive sidecar.
"""
import argparse
import base64
import hashlib
import json
from pathlib import Path
import struct
import xml.etree.ElementTree as ET
import zipfile


def digest(data, algorithm="sha256"):
    return hashlib.new(algorithm, data).hexdigest()


def verify_hash(data, expected):
    actual = base64.b64encode(hashlib.sha512(data).digest()).decode()
    if actual != expected:
        raise ValueError("NuGet archive SHA512 hash mismatch")
    return actual


def binary_kind(data):
    if data.startswith(b"MZ"):
        try:
            pe = struct.unpack_from("<I", data, 0x3C)[0]
            if data[pe:pe + 4] != b"PE\0\0":
                return "native"
            optional = pe + 24
            magic = struct.unpack_from("<H", data, optional)[0]
            directory = optional + {0x10B: 96, 0x20B: 112}[magic]
            rva, size = struct.unpack_from("<II", data, directory + 14 * 8)
            return "managed" if rva and size else "native"
        except (struct.error, KeyError):
            return "native"
    if data[:4] in (b"\x7fELF", b"\xcf\xfa\xed\xfe", b"\xce\xfa\xed\xfe", b"\xfe\xed\xfa\xcf", b"\xfe\xed\xfa\xce", b"\xca\xfe\xba\xbe", b"\xbe\xba\xfe\xca"):
        return "native"
    return "data"


def metadata(archive):
    name = next(n for n in archive.namelist() if n.endswith(".nuspec"))
    root = ET.fromstring(archive.read(name))
    md = next(e for e in root if e.tag.split("}")[-1] == "metadata")
    fields = {e.tag.split("}")[-1]: e for e in md}
    lic = fields.get("license")
    text = lambda key: fields[key].text if key in fields else None
    return {
        "id": text("id"), "version": text("version"),
        "licenseExpression": lic.text if lic is not None and lic.get("type") == "expression" else None,
        "licenseFile": lic.text if lic is not None and lic.get("type") == "file" else None,
        "licenseUrl": text("licenseUrl"),
        "repository": fields["repository"].attrib if "repository" in fields else None,
    }, name


def write_evidence(root, relative, data):
    target = root / relative
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_bytes(data)


def first_party_package():
    names = ("Naps2Spike.csproj", "Program.cs")
    project_source = b"".join((Path(__file__).parent / p).read_bytes() for p in names)
    return {"id": "Zilo.Naps2Spike", "version": "0.0.0", "type": "first-party-source",
        "sha512": base64.b64encode(hashlib.sha512(project_source).digest()).decode(),
        "licenseExpression": "UNLICENSED", "licenseFile": None,
        "source": "first-party:Zilo.Naps2Spike/Program.cs,Naps2Spike.csproj",
        "sourceFiles": ["spikes/naps2/Program.cs", "spikes/naps2/Naps2Spike.csproj"],
        "licenseStatus": "Private; owner licence choice deferred to M7; no redistribution approval"}


def produce(rid, assets_path, lock_path, publish, cache, evidence):
    assets = json.loads(assets_path.read_text())
    lock = json.loads(lock_path.read_text())
    locked = {}
    for group in lock["dependencies"].values():
        for name, item in group.items():
            identity = name.lower(), item["resolved"]
            if identity in locked and locked[identity] != item["contentHash"]:
                raise ValueError("Conflicting lock content hashes")
            locked[identity] = item["contentHash"]
    packages, hashes, native_candidates = [], {}, []
    sources_path = Path(__file__).parent / "source-licenses.json"
    sources = json.loads(sources_path.read_text()) if sources_path.exists() else {}
    for identity, library in sorted(assets["libraries"].items()):
        if library["type"] != "package":
            raise ValueError(f"Unexpected non-package library {identity}")
        package_id, version = identity.rsplit("/", 1)
        roots = [cache] if cache else [Path(folder) for folder in assets["packageFolders"]]
        package_dir = next((folder / library["path"] for folder in roots
            if (folder / library["path"] / f"{package_id.lower()}.{version}.nupkg").is_file()), None)
        if package_dir is None:
            raise ValueError(f"Restored package ZIP missing from assets packageFolders: {identity}")
        nupkg = package_dir / f"{package_id.lower()}.{version}.nupkg"
        raw = nupkg.read_bytes()
        archive_hash = verify_hash(raw, nupkg.with_suffix(".nupkg.sha512").read_text().strip())
        nuget_metadata = json.loads((package_dir / ".nupkg.metadata").read_text())
        locked_hash = locked[(package_id.lower(), version)]
        if locked_hash != library["sha512"] or nuget_metadata["contentHash"] != locked_hash:
            raise ValueError(f"NuGet content hash differs from locked restore: {identity}")
        with zipfile.ZipFile(nupkg) as archive:
            package, nuspec_name = metadata(archive)
            if package["id"].lower() != package_id.lower() or package["version"] != version:
                raise ValueError(f"NuGet identity differs from lock: {identity}")
            package.update({"sha512": locked_hash, "archiveSha512": archive_hash,
                "source": f"https://api.nuget.org/v3-flatcontainer/{package_id.lower()}/{version}/{package_id.lower()}.{version}.nupkg",
                "nuspecSha256": digest(archive.read(nuspec_name)),
                "declaredLicenseFile": package["licenseFile"], "licenseFileSha256": None})
            prefix = Path("licenses") / package_id.lower() / version
            write_evidence(evidence, prefix / "package.nuspec", archive.read(nuspec_name))
            for name in archive.namelist():
                if name.endswith("/"):
                    continue
                content = archive.read(name)
                kind = binary_kind(content)
                # Only actual ZIP bytes can establish third-party ownership.
                hashes.setdefault(digest(content), []).append((package_id, version, name))
                if kind == "native":
                    native_candidates.append({"packageId": package_id, "packageVersion": version,
                        "path": name, "sha256": digest(content), "size": len(content)})
                base = Path(name).name.lower()
                if any(word in base for word in ("license", "licence", "copying", "notice")):
                    write_evidence(evidence, prefix / Path(name).name, content)
            if package["licenseFile"]:
                content = archive.read(package["licenseFile"])
                package["licenseFileSha256"] = digest(content)
                package["licenseEvidence"] = str(prefix / Path(package["licenseFile"]).name)
            elif identity in sources:
                source = sources[identity]
                path = Path(__file__).parent / source["path"]
                content = path.read_bytes()
                if digest(content) != source["sha256"]:
                    raise ValueError("Source license evidence hash mismatch")
                package.update({"licenseFile": source["path"], "licenseFileSha256": source["sha256"],
                    "licenseEvidenceSource": source["url"], "sourceAssociation": source["association"]})
            packages.append(package)
    packages.append(first_party_package())
    payloads = []
    own_names = {"Naps2Spike.dll", "Naps2Spike.pdb", "Naps2Spike.deps.json", "Naps2Spike.runtimeconfig.json"}
    for path in sorted(publish.rglob("*")):
        if not path.is_file():
            continue
        content = path.read_bytes()
        relative = path.relative_to(publish).as_posix()
        candidates = hashes.get(digest(content), [])
        owners = {(c[0], c[1]) for c in candidates}
        if len(owners) == 1:
            package_id, version = next(iter(owners))
            provenance = sorted(c[2] for c in candidates)
        elif relative in own_names:
            package_id, version, provenance = "Zilo.Naps2Spike", "0.0.0", ["first-party build output"]
        else:
            package_id = version = None
            provenance = ["unattributed or ambiguous published bytes"]
        kind = binary_kind(content)
        payloads.append({"path": relative, "sha256": digest(content), "size": len(content),
            "kind": kind if package_id else "unowned", "packageId": package_id,
            "packageVersion": version, "packagePaths": provenance})
    if not payloads:
        raise ValueError("Empty publish directory")
    return {"schemaVersion": 1, "rid": rid, "targetFramework": "net10.0", "sdk": "10.0.403",
        "deployment": {"linkage": "dynamic", "separateDll": True, "replaceable": True,
            "trimmed": False, "merged": False, "singleFile": False},
        "scope": "Framework-dependent publish; system libraries and SDK/download-only runtime packs not redistributed. Upstream Win32 worker bundle is NOT cleared by top-level deployment properties.",
        "packages": packages, "payloads": payloads, "restoreNativeCandidates": native_candidates,
        "toolchainDownloads": assets["project"]["frameworks"]["net10.0"].get("downloadDependencies", [])}


def gate_inventory(inventory):
    """Lossless identity/payload projection to the gate's deliberately strict schema."""
    packages = []
    for package in inventory["packages"]:
        selected = {key: package.get(key) for key in (
            "id", "version", "sha512", "licenseExpression", "licenseFile", "source")}
        if package.get("licenseFileSha256"):
            selected["licenseFileSha256"] = package["licenseFileSha256"]
        selected["deployment"] = {"linkage": "dynamic", "separateDll": True, "replaceable": True,
            "trimmed": False, "merged": False, "singleFile": False}
        if package["id"].lower() == "naps2.sdk.worker.win32":
            # Bundled LGPL DLLs match their untrimmed nupkg bytes. The bundle is still
            # single-file and non-replaceable; keep this independent deployment deny layer.
            selected["deployment"].update(separateDll=False, replaceable=False, singleFile=True)
        packages.append(selected)
    return {"schemaVersion": 1, "rid": inventory["rid"], "packages": packages,
        "payloads": [{key: payload[key] for key in ("path", "sha256", "kind", "packageId", "packageVersion")}
            for payload in inventory["payloads"]]}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--rid", required=True)
    parser.add_argument("--assets", type=Path, required=True)
    parser.add_argument("--lock", type=Path, required=True)
    parser.add_argument("--publish", type=Path, required=True)
    parser.add_argument("--cache", type=Path, help="Override authoritative assets packageFolders")
    parser.add_argument("--evidence", type=Path, default=Path("evidence"))
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    result = produce(args.rid, args.assets, args.lock, args.publish, args.cache, args.evidence)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(result, indent=2) + "\n")
    args.output.with_suffix(".gate.json").write_text(json.dumps(gate_inventory(result), indent=2) + "\n")
    print(json.dumps({"rid": args.rid, "packages": len(result["packages"]), "payloads": len(result["payloads"]),
        "native": sum(p["kind"] == "native" for p in result["payloads"]),
        "unowned": sum(p["kind"] == "unowned" for p in result["payloads"])}))


if __name__ == "__main__":
    main()
