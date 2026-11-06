# PaceShelf for Ubuntu

The app uses a loopback server and your browser. It requires no hosted service.
Use the packaged launcher to select a folder. Device data belongs to the normal
user; do not run the player with sudo.

Build from this folder with Go 1.22 or newer:

```sh
go build -trimpath -o paceshelf .
./paceshelf -root /path/to/your/video-folder -addr 127.0.0.1:8378
```

Flags: `-root` selects videos; `-addr` selects a loopback listener; `-data` overrides
the persistent device data folder; `-device-only` disables portable writes; `-legacy`
selects an old progress file to import without modifying it.

Default durable data is under `$XDG_DATA_HOME/paceshelf` or the standard local-share
fallback. The folder key derives from the selected root. Portable identity comes
from complete `.paceshelf/library-a.json` and `library-b.json` generations and their referenced catalog files; moving
the whole folder preserves it. Keep the hidden folder when moving libraries.

An existing Course Player cache is read as a migration source and retained.
Legacy `.course-player` files are never overwritten by new progress. Migration
uses the legacy timestamp convention once; new revisions and conflicts do not
choose a winner by device time.

Normal playback checkpoints locally and batches portable writes. Pause/removal
forces a flush. Failed shared saves keep the local generation; the UI must confirm
a verified portable save before switching devices. Two browser windows cannot
silently overwrite a stale generation; refresh after a stale-window warning.

Optional `ffmpeg` supplies thumbnails. Browser/container support depends on codecs.
Physical removable-drive and multi-device validation remain preview requirements.
See [implementation status](../docs/IMPLEMENTATION.md).
