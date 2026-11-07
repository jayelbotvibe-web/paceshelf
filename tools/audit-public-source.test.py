#!/usr/bin/env python3
"""Exercise the documentation media boundary using disposable publication trees."""
import hashlib
import json
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]


class PublicationBoundary(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary.name)
        (self.root / "tools").mkdir()
        (self.root / "docs/assets").mkdir(parents=True)
        shutil.copyfile(ROOT / "tools/audit-public-source.py", self.root / "tools/audit-public-source.py")
        self.image = (ROOT / "docs/assets/walkthrough-poster.webp").read_bytes()
        (self.root / "docs/assets/example.webp").write_bytes(self.image)
        self.manifest = {
            "android_package": "org.paceshelf.player",
            "files": ["tools/audit-public-source.py", "docs/assets/example.webp"],
            "binary_sha256": {},
            "documentation_sha256": {"docs/assets/example.webp": hashlib.sha256(self.image).hexdigest()},
        }

    def tearDown(self):
        self.temporary.cleanup()

    def audit(self):
        (self.root / "PUBLIC-SOURCE-MANIFEST.json").write_text(json.dumps(self.manifest))
        return subprocess.run([sys.executable, str(self.root / "tools/audit-public-source.py")], capture_output=True).returncode

    def test_reviewed_static_image_passes(self):
        self.assertEqual(self.audit(), 0)

    def test_changed_image_fails(self):
        (self.root / "docs/assets/example.webp").write_bytes(self.image + b"changed")
        self.assertNotEqual(self.audit(), 0)

    def test_general_allowlist_does_not_allow_images(self):
        self.manifest["documentation_sha256"] = {}
        self.assertNotEqual(self.audit(), 0)

    def test_metadata_is_blocked_even_with_matching_hash(self):
        payload = b"private metadata"
        chunk = b"EXIF" + len(payload).to_bytes(4, "little") + payload
        if len(payload) % 2:
            chunk += b"\0"
        image = self.image + chunk
        image = image[:4] + (len(image) - 8).to_bytes(4, "little") + image[8:]
        (self.root / "docs/assets/example.webp").write_bytes(image)
        self.manifest["documentation_sha256"]["docs/assets/example.webp"] = hashlib.sha256(image).hexdigest()
        self.assertNotEqual(self.audit(), 0)

    def test_unlisted_media_fails(self):
        (self.root / "docs/assets/unreviewed.webp").write_bytes(self.image)
        self.assertNotEqual(self.audit(), 0)


if __name__ == "__main__":
    unittest.main()
