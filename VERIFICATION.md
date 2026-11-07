# PaceShelf 0.1.0 preview verification

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
includes three separately reviewed synthetic documentation images. It excludes
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
