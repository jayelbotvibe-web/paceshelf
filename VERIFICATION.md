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

The source archive contains only reviewed source/documentation, upstream notices,
the Gradle wrapper and Inter fonts. It excludes generated media, private libraries,
playback records, screenshots, raw logs, signing material, local configuration,
Git history and build outputs. Runtime tests and raw diagnostics are not publication
candidates. GitHub account and commit identity are outside the file audit.

Remaining release gates include physical phone/tablet USB handoff, screen-off
battery and USB power measurement, filesystem failure/latency checks, wider codec
and OS coverage, large-library CPU/memory profiling, final signing ownership and
completion of the local library-manager/relink/recovery experience. ARM64 desktop
packages are cross-compiled and have not been executed on that hardware. Online
sources are not implemented. See [implementation status](docs/IMPLEMENTATION.md).
