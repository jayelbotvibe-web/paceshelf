#!/usr/bin/env python3
"""Audit publication candidates without printing matched secrets or file contents."""
import argparse
import hashlib
import json
from pathlib import Path
import re
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]
MANIFEST = "PUBLIC-SOURCE-MANIFEST.json"
BUILD_ROOTS = {".git", ".gradle", "build", "dist", "out", "test-fixtures", "__pycache__"}
BLOCKED_PARTS = {"recovery", "integrity", ".course-player", ".paceshelf", "screenshots", "data"}
BLOCKED_SUFFIXES = {
    ".mp4", ".webm", ".mkv", ".mov", ".m4v", ".avi", ".mp3", ".wav", ".flac",
    ".png", ".jpg", ".jpeg", ".gif", ".webp", ".pdf", ".zip", ".tar", ".gz", ".7z",
    ".apk", ".aab", ".dex", ".class", ".idsig", ".jks", ".keystore", ".p12", ".pfx",
    ".pem", ".key", ".db", ".sqlite", ".sqlite3", ".log",
}
BLOCKED_NAMES = {"local.properties", ".env", "settings.json", "course-aliases.json",
                 "library.json", "collections.json", "notes.json"}
PATTERNS = {
    "machine-specific home path": re.compile(r"/(?:home|Users)/[A-Za-z0-9_.-]+/"),
    "machine-specific media mount": re.compile(r"/run/(?:media)/[^\s`<>]+"),
    "Windows user path": re.compile(r"[A-Z]:\\Users\\[^\\\s]+", re.I),
    "email address": re.compile(r"\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b", re.I),
    "private key": re.compile(r"-----BEGIN (?:[A-Z ]+ )?PRIVATE KEY-----"),
    "access credential": re.compile(r"\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|AKIA[A-Z0-9]{16}|AIza[0-9A-Za-z_-]{30,})\b"),
    "literal volume identity": re.compile(r"\b(?:[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}|[0-9A-F]{16})\b", re.I),
}


def git(*args):
    return subprocess.check_output(["git", "-C", str(ROOT), *args], stderr=subprocess.DEVNULL)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--staged", action="store_true", help="audit the entire Git index using staged bytes")
    args = parser.parse_args()
    try:
        in_git = Path(git("rev-parse", "--show-toplevel").decode().strip()).resolve() == ROOT
    except (OSError, subprocess.CalledProcessError):
        in_git = False
    if args.staged and not in_git:
        print("FAIL: --staged requires a Git repository rooted at this source tree.")
        return 1

    modes = {}
    if args.staged:
        candidates = []
        for entry in git("ls-files", "--stage", "-z").split(b"\0"):
            if not entry:
                continue
            header, name = entry.split(b"\t", 1)
            mode, _, stage = header.decode().split()
            if stage != "0":
                print("FAIL: unresolved Git index entries must be resolved before publication.")
                return 1
            rel = name.decode()
            candidates.append(rel)
            modes[rel] = mode
        read = lambda rel: git("show", ":" + rel)
    elif in_git:
        candidates = sorted(set(n.decode() for n in git("ls-files", "--cached", "--others", "--exclude-standard", "-z").split(b"\0") if n))
        read = lambda rel: (ROOT / rel).read_bytes()
    else:
        candidates = []
        for p in ROOT.rglob("*"):
            parts = p.relative_to(ROOT).parts
            if any(x in BUILD_ROOTS or x == ".buildtmp" or x.startswith((".browser-", ".interop-", ".real-resume-")) for x in parts):
                continue
            if p.is_file() or p.is_symlink():
                candidates.append(p.relative_to(ROOT).as_posix())
        read = lambda rel: (ROOT / rel).read_bytes()

    try:
        manifest = json.loads(read(MANIFEST))
        allowed = set(manifest["files"]) | {MANIFEST}
        binary_hashes = manifest["binary_sha256"]
        expected_package = manifest["android_package"]
    except (OSError, ValueError, KeyError, subprocess.CalledProcessError):
        print("FAIL: publication allowlist is missing or invalid.")
        return 1
    failures = []
    for number, rel in enumerate(sorted(candidates), 1):
        label = f"candidate #{number}"
        path = Path(rel)
        if path.is_absolute() or ".." in path.parts or rel not in allowed:
            failures.append(f"{label}: file is outside the reviewed allowlist")
            continue
        if modes.get(rel, "100644") not in {"100644", "100755"} or (not args.staged and (ROOT / rel).is_symlink()):
            failures.append(f"{label}: symlink/submodule publication is blocked")
            continue
        if any(x in BLOCKED_PARTS or x.startswith((".browser-", ".interop-", ".real-resume-", "design-backup-")) for x in path.parts) or path.suffix.lower() in BLOCKED_SUFFIXES or path.name in BLOCKED_NAMES or path.name.startswith("progress") and path.suffix == ".json":
            failures.append(f"{label}: generated, private or media file type is blocked")
            continue
        try:
            data = read(rel)
        except (OSError, subprocess.CalledProcessError):
            failures.append(f"{label}: candidate cannot be read")
            continue
        if rel in binary_hashes:
            if hashlib.sha256(data).hexdigest() != binary_hashes[rel]:
                failures.append(f"{label}: approved binary hash changed; review its origin")
            continue
        if len(data) > 2 * 1024 * 1024:
            failures.append(f"{label}: unexpectedly large source file")
            continue
        try:
            content = data.decode("utf-8")
        except UnicodeDecodeError:
            failures.append(f"{label}: undeclared binary content")
            continue
        for description, pattern in PATTERNS.items():
            if pattern.search(content):
                failures.append(f"{label}: blocked {description}")
        if path.suffix == ".java":
            match = re.search(r"^package\s+([^;]+);", content, re.M)
            if not match or match.group(1) != expected_package:
                failures.append(f"{label}: Android package differs from the generic reviewed identity")
        if rel == "app/build.gradle":
            for field in ("namespace", "applicationId"):
                match = re.search(r"\b" + field + r"\s+['\"]([^'\"]+)['\"]", content)
                if not match or match.group(1) != expected_package:
                    failures.append(f"{label}: Android identity differs from the reviewed manifest")
    missing = allowed - set(candidates)
    if missing:
        failures.append(f"{len(missing)} reviewed source files are missing from the publication candidates")
    if failures:
        print("FAIL: source publication audit rejected these candidates:")
        for failure in failures:
            print("- " + failure)
        print("Matched content and candidate paths are suppressed to keep diagnostics private.")
        return 1
    print(f"PASS: {len(candidates)} reviewed source files; no blocked content or unexpected binaries.")
    print("This automated check supplements manual review and does not inspect account/commit identity.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
