# PaceShelf

**Your learning library. Your pace.**

PaceShelf is a free personal video learning library for Android and Ubuntu. It runs
on your devices, with no account, hosted video service or synchronization backend.
Supply your own videos in any folder or on a removable drive.

## Development preview — 0.1.0

Get the Android APK and Ubuntu packages from this repository’s
[preview download page](../../releases/tag/v0.1.0-preview). Android previews are
debug-signed; keep a metadata backup before switching to a future release signer.

This is the first implementation milestone, based on an existing offline player.
It is not the completed roadmap or a stable public release. Online playback is not
implemented. Physical Android battery, USB handoff and broad codec validation are
still required. See [implementation status](docs/IMPLEMENTATION.md).

- Browse folders as collections; play MP4/WebM and other browser-supported media.
- Resume playback, change speed, seek, skip and advance to the next lesson.
- Customize collection titles, lesson titles, sections and ordering; save favorites.
- Mark lessons complete independently of playback position, with undo.
- Create timestamp bookmarks, jump back to them and delete them.
- Choose device-only or portable metadata storage in Library settings.
- Export all metadata and preview a backup before restoring it; videos are excluded.
- Review conflicting changes instead of choosing a position by device clock.
- Use a light gray interface, bundled Inter font and responsive phone/tablet layouts.

Metadata uses persistent library/media/entry IDs. Media locators currently match
relative path and size. Automatic content-based relocation and detection of edits
that preserve file size are not implemented; do not treat this as content hashing.

## Android

The preview uses `org.paceshelf.player`, separate from the earlier application.
Installing it does not replace an app with a different identifier. Select your
video folder using Android's folder picker. A folder containing videos directly
also works; no particular folder name is required.

Build with JDK 17 and Android SDK 35:

```sh
./gradlew :app:assembleDebug :app:assembleAndroidTest :app:lintDebug
```

The development APK is under `app/build/outputs/apk/debug/`. Debug builds are for
testing. Public release signing requires external key material and a pinned
certificate; it is never generated silently. See [publishing](PUBLISHING.md).

## Ubuntu

The Ubuntu `.deb` package installs an applications-menu launcher. The portable
archive contains a graphical folder picker and an installer for an
applications-menu launcher. Install `zenity`, `curl`, `python3` and `xdg-utils` if
needed; `ffmpeg` enables thumbnails. Extract the Ubuntu package and run `install.sh`
once, then open PaceShelf from your applications menu. Run the player as your normal
user. There is no need to run `start.sh` with sudo.

Build the portable Ubuntu package with Go 1.22 or newer:

```sh
bash tools/package-desktop.sh
```

For development, run from the `desktop` folder:

```sh
go build -trimpath -o paceshelf .
./paceshelf -root /path/to/your/video-folder -addr 127.0.0.1:8378
```

Open the printed loopback URL. `-device-only` avoids writing new metadata beside
videos. Persistent history lives in the operating system's application-data area;
cache cleanup must not remove it. See [desktop details](desktop/README.md).

## Taking progress to another device

In **Portable library** mode, use the same video folder and its hidden `.paceshelf`
metadata folder on the other device. Pause, wait for a verified portable save, and
finish safe removal through the operating system before unplugging. Android's
button prepares the app for removal; system unmount remains a separate action.
Only one device should use a portable drive at a time. Network filesystems and
simultaneously mounted storage are not supported.

In **On this device** mode, export a library backup and transfer it yourself. On
the other device, choose the matching video folder, choose On this device, and
restore the backup after reviewing the replacement preview. Relative paths and
sizes must match for videos to be available. Regrant folder access on each device.
There is no automatic exchange between independent installations.

Legacy progress snapshots are imported once and kept untouched. Earlier players
cannot synchronize new PaceShelf completion, bookmarks or collection edits; use
PaceShelf on each device after migration. Keep an independent metadata backup.

## Privacy, source and license

The source contains synthetic examples only. It excludes personal identities,
private libraries, videos, playback records, credentials, signing keys and recovery
material. Your own app-generated metadata is plaintext and can contain your video
titles and history; do not upload it to the source repository.

```sh
node --test tools/library-protocol.test.cjs
python3 tools/audit-public-source.py
```

See [testing](TESTING.md), [verification](VERIFICATION.md), the [product plan](docs/PRODUCT-PLAN.md)
and [risk review](docs/PLAN-REVIEW.md). Source is available under the [MIT license](LICENSE).
Inter retains its [SIL Open Font License](app/src/main/assets/fonts/OFL.txt).
Other bundled/build components retain their [upstream notices](THIRD-PARTY-NOTICES.md).
