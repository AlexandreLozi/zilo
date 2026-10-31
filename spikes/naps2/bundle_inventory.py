"""Read .NET v6 single-file bundle metadata without running/extracting the executable.

This is evidence, NOT a license scanner or a complete native/runtime inventory.
Bundle format: https://github.com/dotnet/runtime/blob/main/src/installer/managed/Microsoft.NET.HostModel/Bundle/Manifest.cs
"""
import argparse
import hashlib
import json
from pathlib import Path
import struct
import zlib

SIGNATURE = bytes.fromhex("8b1202b96a612038727b930214d7a03213f5b9e6efae3318ee3b2dce24b36aae")


def inspect_bundle(data):
    marker = data.find(SIGNATURE)
    if marker < 8:
        raise ValueError("No .NET bundle signature")
    position = struct.unpack_from("<Q", data, marker - 8)[0]

    def take(fmt):
        nonlocal position
        size = struct.calcsize(fmt)
        if position + size > len(data):
            raise ValueError("Truncated bundle manifest")
        result = struct.unpack_from(fmt, data, position)
        position += size
        return result[0] if len(result) == 1 else result

    def string():
        nonlocal position
        size = 0
        for shift in range(0, 35, 7):
            part = take("<B")
            size |= (part & 127) << shift
            if not part & 128:
                break
        else:
            raise ValueError("Invalid bundle string length")
        if size > 65536 or position + size > len(data):
            raise ValueError("Truncated/oversized bundle string")
        value = data[position:position + size].decode("utf-8")
        position += size
        return value

    major, minor, count = take("<III")
    if (major, minor) != (6, 0) or not 0 < count < 10000:
        raise ValueError("Unsupported bundle version/count")
    bundle_id = string()
    deps_offset, deps_size, config_offset, config_size, flags = take("<QQQQQ")
    entries, embedded_json = [], {}
    for _ in range(count):
        offset, size, compressed = take("<QQQ")
        kind = take("<B")
        name = string()
        stored = compressed or size
        if offset + stored > len(data) or size > 128 * 1024 * 1024:
            raise ValueError("Bundle entry outside executable/bounds")
        content = data[offset:offset + stored]
        if compressed:
            content = zlib.decompress(content, -15)
        if len(content) != size:
            raise ValueError("Bundle entry size mismatch")
        entries.append({"path": name, "offset": offset, "size": size, "compressedSize": compressed,
            "bundleFileType": kind, "sha256": hashlib.sha256(content).hexdigest()})
        if name.endswith((".deps.json", ".runtimeconfig.json")):
            embedded_json[name] = json.loads(content)
    return {"sha256": hashlib.sha256(data).hexdigest(), "size": len(data), "format": f"{major}.{minor}",
        "bundleId": bundle_id, "flags": flags, "entries": entries, "embeddedJson": embedded_json,
        "scope": "Bundle entries plus whole EXE hash; native host/runtime internals and per-assembly trimming not cleared."}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("executable", type=Path)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    result = inspect_bundle(args.executable.read_bytes())
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(result, indent=2) + "\n")
    print(json.dumps({"format": result["format"], "entries": len(result["entries"]), "sha256": result["sha256"]}))


if __name__ == "__main__":
    main()
