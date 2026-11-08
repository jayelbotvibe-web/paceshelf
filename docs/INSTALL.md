# Install PaceShelf

This is the **0.2.0 development preview**. Use backed-up videos and keep a separate
metadata backup. You do not need Android build tools or Go to use the downloads.

## Android phones and tablets

Requires **Android 9 or newer** and an up-to-date Android System WebView. External
drives must be recognized by Android before PaceShelf can access their folders.

1. Download [PaceShelf-0.2.0-preview-debug.apk](https://github.com/jayelbotvibe-web/paceshelf/releases/download/v0.2.0-preview/PaceShelf-0.2.0-preview-debug.apk)
   from this project's release page.
2. Open the downloaded APK. If prompted, allow the browser or file manager you
   used to install this app. You can turn that permission off after installation.
   Android's wording varies; keep its other security protections enabled.
3. Open **PaceShelf**, choose your video folder and confirm the system's folder-access grant.
4. Open **Library settings → Save library metadata**. Choose **On this device** for
   local history or **Portable library** to write progress beside videos on a writable drive.
5. Open a collection and select a lesson.

For YouTube without a video folder, select **Start a device-only YouTube library**
on the opening screen instead. Use **Add YouTube**, preview a playlist or paste
video links, then confirm. Online playback needs internet. See [YouTube instructions](YOUTUBE.md).

For an upgrade, install this APK over the matching preview without clearing data.
Update every device to 0.2.0 before sharing metadata containing YouTube references.

This APK is **debug-signed**, not a stable release. A future release with a different
signer may require uninstalling this preview first. Export a library backup before
uninstalling or clearing app data; backups exclude the videos themselves.

If the drive is missing from Android's file manager, check the cable, power and
filesystem first. An app cannot grant access to storage the operating system has
not recognized. Folder-picker restrictions also vary by Android version/provider.

## Ubuntu: recommended AMD64 package

For ordinary **x86_64 / AMD64** Ubuntu PCs. Check `uname -m` if unsure: this package
matches `x86_64`, not `aarch64` or `arm64`.

1. Download [paceshelf_0.2.0-preview1_amd64.deb](https://github.com/jayelbotvibe-web/paceshelf/releases/download/v0.2.0-preview/paceshelf_0.2.0-preview1_amd64.deb).
2. Open a terminal in the folder containing that file and install it:

   ```sh
   sudo apt install ./paceshelf_0.2.0-preview1_amd64.deb
   ```

3. Open **PaceShelf** from your applications menu and choose a video folder.
4. Your browser opens the local player. Choose your storage mode in Library settings.

An empty folder works for a YouTube-only collection. Select **Add YouTube** after
opening it. Before upgrading, exit the old player with its save/removal flow so
the previous local server does not keep the library's writer lock.

Administrator access is for installing the package. **Run the player as your normal
user.** Do not launch PaceShelf or `start.sh` with sudo.

The package installs launcher dependencies. For optional lesson thumbnails:

```sh
sudo apt install ffmpeg
```

Playback uses your browser's codecs. A recognized extension does not guarantee
that its video/audio tracks can decode; try a supported H.264 MP4 or WebM sample.
No minimum Ubuntu/browser version has been established by the current test matrix.

## Ubuntu: portable archive

Use this if you prefer a per-user launcher or need the included ARM64 binary.
**ARM64 is cross-compiled and has not been tested on ARM64 hardware.**

1. Download [PaceShelf-Ubuntu-0.2.0-preview.tar.gz](https://github.com/jayelbotvibe-web/paceshelf/releases/download/v0.2.0-preview/PaceShelf-Ubuntu-0.2.0-preview.tar.gz)
   and extract the entire archive.
2. Install any missing launcher dependencies:

   ```sh
   sudo apt install zenity curl python3 xdg-utils util-linux
   ```

3. Open a terminal inside the extracted **PaceShelf-Ubuntu-0.2.0-preview** folder:

   ```sh
   bash install.sh
   ```

4. Open **PaceShelf** from your applications menu. To run without installing its
   menu entry, use `bash start.sh` in the same extracted folder.

Neither script requires sudo. The player runs locally and opens a loopback URL in
your browser; it does not upload the video library to a website.

## Share progress and back it up

- **Same removable drive:** choose Portable library on each device, verify a save,
  and finish system unmount before unplugging. Preserve the whole hidden `.paceshelf` folder.
- **Separate video copies:** export a library backup, transfer it, and review the
  restore preview on the receiving device. Relative paths and file sizes must match.
- **Before uninstalling:** export a backup somewhere outside the app. A metadata
  backup does not contain videos and is not an encrypted file.

For a different library identity, restore/adoption is available in **On this device**
mode after review. Do not manually replace app-private metadata files. Read
[progress-sharing instructions](../README.md#take-progress-to-another-device) and
[preview limitations](IMPLEMENTATION.md) before relying on cross-device use.

## Download verification

Every packaged download has a companion `.sha256` file on the
[release page](https://github.com/jayelbotvibe-web/paceshelf/releases/tag/v0.2.0-preview).
On Ubuntu, put both files in the same directory and verify, for example:

```sh
sha256sum -c paceshelf_0.2.0-preview1_amd64.deb.sha256
```

The checksum checks the downloaded bytes against the published digest. Preview
checksums do not establish a final Android release-signing identity.

[Back to PaceShelf](../README.md)
