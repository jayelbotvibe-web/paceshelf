#!/usr/bin/env python3
"""Create a source-only archive from the reviewed publication manifest."""
import argparse
import hashlib
import json
from pathlib import Path
import subprocess
import sys
import zipfile

root = Path(__file__).resolve().parents[1]
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--output", type=Path, default=root.parent / "PaceShelf-Public-Source.zip")
args = parser.parse_args()
destination = args.output.resolve()
if destination == root or root in destination.parents:
    raise SystemExit("Write the source archive outside the source tree.")
subprocess.run([sys.executable, str(root / "tools/audit-public-source.py")], check=True)
manifest = json.loads((root / "PUBLIC-SOURCE-MANIFEST.json").read_text())
files = sorted(set(manifest["files"]) | {"PUBLIC-SOURCE-MANIFEST.json"})
destination.parent.mkdir(parents=True, exist_ok=True)
temporary = destination.with_name(destination.name + ".tmp")
try:
    with zipfile.ZipFile(temporary, "w", zipfile.ZIP_DEFLATED) as archive:
        for rel in files:
            source = root / rel
            if source.is_symlink() or root not in source.resolve().parents:
                raise ValueError("Publication source escaped its reviewed tree.")
            # Fixed generic timestamps and no extra/comment fields avoid exporting
            # workstation timestamps, ownership metadata or local filesystem paths.
            entry = zipfile.ZipInfo("paceshelf/" + rel, date_time=(2020, 1, 1, 0, 0, 0))
            entry.create_system = 3
            entry.external_attr = (0o100755 if source.stat().st_mode & 0o111 else 0o100644) << 16
            entry.compress_type = zipfile.ZIP_DEFLATED
            entry.extra = b""
            entry.comment = b""
            archive.writestr(entry, source.read_bytes())
    with zipfile.ZipFile(temporary) as archive:
        assert set(archive.namelist()) == {"paceshelf/" + rel for rel in files}
        for rel in files:
            assert archive.read("paceshelf/" + rel) == (root / rel).read_bytes()
    temporary.replace(destination)
finally:
    if temporary.exists():
        temporary.unlink()
checksum = hashlib.sha256(destination.read_bytes()).hexdigest()
destination.with_suffix(destination.suffix + ".sha256").write_text(checksum + "  " + destination.name + "\n")
print(f"Ready: {destination.name} ({len(files)} reviewed source files)")
print("SHA-256: " + checksum)

