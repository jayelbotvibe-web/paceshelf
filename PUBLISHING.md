# Publishing this source safely

Publish this sanitized source tree or an archive generated from
PUBLIC-SOURCE-MANIFEST.json. Use a fresh Git history for the first publication.
Do not combine it with another workspace, previous source archive or generated
build directory. Git ignore rules do not remove files from existing commits.

## Source checks

PUBLIC-SOURCE-MANIFEST.json is an explicit allowlist. New files require review
before they are added to that list. The checker rejects unexpected files, media,
runtime records, symlinks, secrets and machine-specific home/media paths. The only
permitted binaries are the declared Gradle wrapper, font files and separately
reviewed documentation images with verified hashes. Documentation images must be
static WebP files directly in `docs/assets`, below 2 MiB, with no EXIF/XMP or other
metadata chunks. Their exact hashes live in `documentation_sha256`; adding a file
to the general allowlist alone does not permit an image. Synthetic fixtures and
raw recordings must be generated locally and stay ignored.

```sh
python3 tools/audit-public-source.py
git config core.hooksPath .githooks
python3 tools/package-public-source.py --output ../PaceShelf-Public-Source.zip
```

The pre-commit hook checks the full staged index, including staged file contents.
The included GitHub Actions workflow repeats the check for pushes and pull requests.
A server-side check happens after upload, so run the local check before pushing.

For browser-based upload, extract and upload only the contents of the source
archive. Do not drag a development checkout containing generated build outputs.

Use generic demonstration titles for examples. Product screenshots must be made
from synthetic demonstration data and separately reviewed before adding them to
the allowlist. An ignore file and pattern scanner cannot prove that an arbitrary
image or recording contains no private information.

Check the Git author name/email before creating a commit. Commit identity, the
repository owner's account name, profile and public activity are controlled by
the publisher and remain visible independently of the files in this project.

## Release identity

The source uses the PaceShelf application identifier, org.paceshelf.player.
Keep the signing key
outside the checkout, protect a separate backup and pin its expected certificate.
Different signing identities cannot be treated as interchangeable updates.

The release helper requires:

- PACESHELF_RELEASE_KEYSTORE: external keystore filename.
- PACESHELF_RELEASE_PASSWORD_FILE: external password-file filename.
- PACESHELF_RELEASE_KEY_ALIAS: key alias, defaulting to paceshelf.
- PACESHELF_RELEASE_CERT_SHA256: expected publisher certificate digest.
- ANDROID_HOME: the local Android SDK directory.

It writes signed artifacts under ignored dist/. Source approval does not approve
generated APKs, logs or other binaries for publication. Audit each release artifact
separately; generated diagnostics can include machine paths even when source is
generic. Never publish keystores, passwords, local.properties or diagnostic bundles.

The project uses the MIT license. Verify dependency notices before publishing,
and retain the bundled font license.


## PaceShelf preview release identity

The Android package is `org.paceshelf.player`. Public releases require explicit
external signing files and `PACESHELF_RELEASE_CERT_SHA256`, the expected certificate
digest. A mismatched signer fails before the APK is promoted to a release filename.
Use a generic certificate subject such as `CN=PaceShelf`; a certificate subject can
be inspected in a distributed APK. Keep private personal identity out of it.
Debug APKs are development previews and do not establish the final publisher key.

The project is licensed under MIT. Keep the bundled Inter OFL notice. Public
examples and screenshots must use a synthetic fixture generator only. The public
walkthrough uses `tools/create-demo.py`; see [demo production](docs/DEMO.md).
