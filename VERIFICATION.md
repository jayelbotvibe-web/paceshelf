# PaceShelf preview verification

## 0.2.1 review and playback fixes

Verified on 2026-11-09 using disposable libraries and an Android emulator.

| Check | Result |
| --- | --- |
| Android app/test build and lint | Pass; version 0.2.1, code 3 |
| Native persistence and isolated-player configuration | 24 emulator checks pass |
| Local playback regression | 20 desktop and 19 Android UI checks pass |
| Metadata, parsing, adapter and provider timing | 34 Node tests pass |
| Desktop durability/isolation | 22 Go tests pass with race detection; vet passes |
| YouTube integration | 18 desktop and 17 Android UI checks pass, including real-provider paused seeking and saved clocks |
| Progress handoff | Desktop position around 32 seconds resumes on Android; a rewind to 9 seconds returns to Ubuntu through export/restore |
| Consecutive playback | A real video end completes its lesson and starts the next video |
| Packaging | Nine shared frontend files match the APK assets; preview signing certificate matches 0.2.0 |
| Publication boundary | Source allowlist and five media-boundary checks pass |

The review reproduced and fixed stale paused-seek checkpoints, disabled seek
controls after returning from a related video, repeated bookmark DOM replacement,
and overlapping retry timers when a provider clock is temporarily unavailable.
New unit regressions cover each behavior. Integration checks use a real paused
seek and controlled related-video/unchanged-clock snapshots for the UI transitions.
The local smoke test now selects its long MP4 fixture by source identity rather
than assuming UUID-based collection order; the short WebM cannot satisfy its
19-second checkpoint assertion.

Physical phone/tablet USB handoff, screen-off battery consumption, all codecs,
all YouTube restrictions and hardware filesystem durability remain unverified.
The export/restore check does not establish physical SSD handoff reliability.

## 0.2.0 YouTube preview

Verified on 2026-11-08 using disposable data. This is preview evidence, not a
claim of physical phone/tablet, USB durability or battery validation.

| Check | Result |
| --- | --- |
| Android debug app/test build and lint | Pass; version 0.2.0, code 2 |
| Native persistence, provider codec and isolated-player configuration | 24 emulator checks pass |
| Existing local playback regression | 20 desktop and 19 Android UI checks pass |
| Metadata and YouTube parsing/adapter regression | 30 Node tests pass |
| Desktop durability and provider-origin isolation | 22 Go tests pass with race detection; vet passes |
| YouTube imports, labels, completion, append and invalid-input UI | 15 desktop and 14 Android checks pass, including opt-in real-provider playback |
| Provider playlist discovery | A public nine-video playlist returns nine references through the official IFrame API |
| Desktop → Android → Ubuntu YouTube handoff | Actual player clocks preserve a roughly 32-second position, then a deliberate rewind to 9 seconds, through metadata export/restore |
| Consecutive YouTube playback | A real video end completes the correct lesson and starts the next without another tap |
| Android provider isolation/lifecycle | No Android JavaScript interface; registered app origin; saved progress and provider view destroyed on background |
| Preview upgrade identity | Debug signing certificate matches 0.1.0; private-path scan passes |
| Public source and image boundary | Allowlist audit and 5 media-boundary tests pass |

The handoff test found and fixed an unacknowledged-seek timing issue: a quick
provider rewind immediately before leaving could otherwise retain the earlier
app-requested position. A targeted regression test and the real round trip pass.
No cloud sync, private-playlist authorization, video download or arbitrary web
embedding is enabled. Provider availability and autoplay can vary. ARM64 binaries
are cross-compiled; physical devices and their USB/battery behavior remain release gates.

## 0.1.0 baseline

Verified on 2026-11-06 using synthetic fixtures and disposable application data.
This is development-preview evidence, not approval of a stable public release.

| Check | Result |
| --- | --- |
| Android debug app, instrumentation build and lint | Pass |
| Android provider/codec instrumentation | 18 checks pass on an emulator |
| Android playback, editing, backup/mode and lifecycle UI | 19 checks pass |
| Ubuntu browser UI at phone, tablet and desktop widths | 20 checks pass |
| Metadata protocol, recency, conflicts, deletion and ordering | 18 Node tests pass |
| Desktop persistence, interruption, migration and concurrent receipts | 21 Go tests pass with race detection; go vet passes |
| Android/Ubuntu handoff by copying portable metadata | Pass in both directions; intentional rewind and older clock label retained |
| Continue learning and actual resumed Android playback | Pass after the copied desktop handoff |
| Android safe-removal preparation | Metadata saved, stream released, library paused; system unmount remains separate |
| Ubuntu installer, graphical selection, repeat launch and package extraction | Pass in disposable directories, including a path with spaces |
| Shared frontend assets and script syntax | Pass |
| Source allowlist and privacy audit | Pass |

The large-library fixture contains 10,000 synthetic media records and one saved
position. Its static catalog is 1,217,873 bytes; playback checkpoints remain below
2 KiB and the catalog is not rewritten during those updates. This measures metadata
write behavior, not real-device battery life or large-library decoding performance.

Failure checks include stale writers, unknown formats with a cached editor,
retained deletions, deliberate rewinds, changed file size, missing/truncated catalogs,
interrupted catalog upgrades, unavailable portable storage and verification of the
local checkpoint before removal assurances. Backup adoption establishes a fresh
anonymous writer identity and retains the previous library locally.

The original preview source archive contains reviewed source/documentation,
upstream notices, the Gradle wrapper and Inter fonts. The current repository also
includes separately reviewed synthetic documentation images. It excludes
sample course clips, private libraries, playback records, unreviewed screenshots,
raw logs, signing material, local configuration, Git history and build outputs.
Runtime tests and raw diagnostics are not publication candidates. GitHub account
and commit identity are outside the file audit.

Remaining release gates include physical phone/tablet USB handoff, screen-off
battery and USB power measurement, filesystem failure/latency checks, wider codec
and OS coverage, large-library CPU/memory profiling, final signing ownership and
completion of the local library-manager/relink/recovery experience. ARM64 desktop
packages are cross-compiled and have not been executed on that hardware. Online
sources are not implemented. See [implementation status](docs/IMPLEMENTATION.md).

## Public presentation and walkthrough

The updated README separates installation from development, explains storage
modes and links to a 46.65-second, intentionally silent recording of the actual
Ubuntu browser interface. Sample lesson media is original, programmatically
generated material in an isolated library. Phone/tablet stills are responsive
browser captures, not physical-device validation. See [demo details](docs/DEMO.md).

The H.264 export was fully decoded without errors; dimensions, frame rate, runtime
and absence of audio were checked. Representative encoded frames and a sequence
contact sheet were visually reviewed. This is frame/technical review, not a claim
of a full real-time audiovisual viewing or new Android/hardware testing.

Five publication-boundary tests verify acceptance of a pinned static WebP and
rejection of changed bytes, a general-allowlist-only image, embedded metadata and
unlisted media. Documentation links and issue-template YAML were checked. These
documentation changes do not change the application downloads or preview signer.
