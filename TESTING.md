# Synthetic test workflow

Use disposable data only. Fixtures, logs, screenshots and binaries are excluded
from source publication. No personal media or playback records are needed.

## Protocol and desktop durability

```sh
node --test tools/library-protocol.test.cjs tools/youtube.test.cjs
cd desktop
go test -race ./...
go vet ./...
```

The protocol tests cover causal handoff, skewed clocks, rewinds, concurrent edits,
deletions, independent completion, stable IDs, changed file size, migration and
untrusted imports. Go tests cover durable generations, checksums, interruption,
future versions, exclusive writers, unavailable drives and device-only restore.
If your temporary filesystem disallows execution, set TMPDIR to a disposable
executable folder outside the source publication candidates.

## Android provider and UI tests

1. Build/install the debug APK and test APK on a disposable emulator.
2. Run `bash tools/create-test-fixtures.sh` with ffmpeg installed.
3. Create Documents/PaceShelfFixtures on the emulator and copy the generated
   Courses folder into it.
4. Open PaceShelf and choose **Documents/PaceShelfFixtures** with the system picker.
   The player resolves its Courses child. The test rejects other grants.
5. Stop the activity, then run provider instrumentation:

```sh
adb shell am force-stop org.paceshelf.player
adb shell am instrument -w org.paceshelf.player.test/org.paceshelf.player.SelfTestRunner
```

The runner creates its own synthetic provider directories and local checkpoints.
It cleans them up before finishing. Native tests cover local/portable persistence,
stale writers, checksums/versions, interrupted writes, device mode and playback
range/natural-order regressions. They do not prove hardware USB durability.

For UI checks, start the app on its synthetic library, put adb on PATH and run:

```sh
PACESHELF_TEST_PLATFORM=android node tools/paceshelf-smoke.mjs
```

PACESHELF_TEST_DEVICE selects a disposable emulator, default emulator-5554.

## Desktop UI

Start a compiled player on the generated synthetic Courses folder. Open it in a
disposable Chromium profile with its development interface on port 9224. The UI
script checks the course IDs before modifying metadata:

```sh
node tools/paceshelf-smoke.mjs
```

PACESHELF_TEST_CDP_PORT selects another browser development port. Browser checks
cover actual playback/seek, completion/undo, bookmarks, title/favorite editing,
backup preview, storage modes and responsive widths. Android adds lifecycle
suspension/resume checks. Screenshots and raw diagnostic logs stay outside the
publication manifest. Close test servers, browser profiles and emulators afterward.

## YouTube references and integration

The Node checks also cover strict source URLs, bounded imports, stable identities,
mixed collections, atomic rejected batches, portable rewinds, untrusted clocks and
media-adapter transitions. Go checks verify that the provider origin has no library
or file capabilities and preserves the required referrer. Android instrumentation
checks app-private storage without a document grant and rejects URL-shaped player IDs.

For UI checks on the synthetic Courses folder (or an empty folder named
YouTubeFixtures), use the same browser/emulator setup and run:

```sh
node tools/youtube-smoke.mjs
PACESHELF_TEST_PLATFORM=android node tools/youtube-smoke.mjs
```

Set PACESHELF_TEST_CDP_PORT for another desktop browser port. Native tests require
a disposable emulator. Optional real-provider checks contact YouTube's public
IFrame API example, and are intentionally excluded from deterministic CI:

```sh
PACESHELF_TEST_ONLINE=1 node tools/youtube-smoke.mjs
PACESHELF_TEST_PLATFORM=android PACESHELF_TEST_ONLINE=1 node tools/youtube-smoke.mjs
```

These checks cover preview, explicit loading, labels, completion/undo, append,
backup shape, invalid input, actual content clocks and saved progress. Android adds
the bridge-free identity and background release check. They do not establish
physical battery use or all provider restrictions. Keep generated source IDs,
recordings and raw outputs out of public issues unless reviewed.

## Release limits

Physical phone/tablet battery, screen-off USB power, drive handoff and interrupted
hardware I/O remain release gates. ARM64 desktop binaries can be cross-compiled,
but require execution on that hardware before announcing support.
