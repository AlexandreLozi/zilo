"""From this directory: python3 run.py [--rid RID] [--update-locks].

Default is locked restore + framework-dependent publish + exhaustive inventory.
--update-locks is an explicit maintainer operation, never used by CI.
"""
import argparse
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys

RIDS = ("win-x64", "win-arm64", "osx-arm64", "osx-x64", "linux-x64")


def main():
    os.chdir(Path(__file__).resolve().parent)
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--rid", choices=RIDS, action="append")
    parser.add_argument("--update-locks", action="store_true")
    args = parser.parse_args()
    dotnet = os.environ.get("DOTNET", "dotnet")
    logs = Path("artifacts/logs")
    logs.mkdir(parents=True, exist_ok=True)
    for rid in args.rid or RIDS:
        properties = [f"-p:RuntimeIdentifier={rid}"]
        publish = Path("artifacts/publish") / rid
        if publish.exists():
            shutil.rmtree(publish)
        commands = [
            [dotnet, "restore", "Naps2Spike.csproj", *properties, "--configfile", "NuGet.Config",
                *(["--force-evaluate"] if args.update_locks else ["--locked-mode"])],
            [dotnet, "publish", "Naps2Spike.csproj", *properties, "-c", "Release", "--no-restore", "-o", str(publish)],
            [sys.executable, "inventory.py", "--rid", rid, "--assets", "obj/project.assets.json",
                "--lock", f"locks/{rid}.packages.lock.json", "--publish", str(publish),
                "--output", f"evidence/inventory/{rid}.json"],
        ]
        with (logs / f"{rid}.log").open("w") as log:
            for command in commands:
                line = "+ " + " ".join(command)
                print(line, flush=True)
                log.write(line + "\n")
                result = subprocess.run(command, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
                print(result.stdout, end="", flush=True)
                log.write(result.stdout)
                log.flush()
                if result.returncode:
                    return result.returncode
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
