# Metadata and commit protocol

PaceShelf separates the metadata model from its disk representation. A JSON
export is a complete `paceshelf.library` model, version 1. Disk snapshots use
`paceshelf.snapshot` envelope version 2. All metadata is plaintext; checksums detect
accidental damage and do not encrypt or authenticate an untrusted drive.

## Identities and edits

Library, media and collection-entry IDs are independent. Resume attaches to media;
completion attaches to an entry; bookmarks reference media and a timestamp.
Relative path plus file size currently locates media. Content fingerprinting and
rename/relink matching are separate, unfinished capabilities.

Each record is a multi-value register with a device counter and observed revision
vector. Causally later changes replace earlier variants. Independent changes remain
visible as conflicts until a person chooses a revision. Causal activity also selects the latest lesson and its collection entry. Device
time breaks ties only between independent activities; it does not select a merge
winner. Intentional rewinds
remain valid. A removed bookmark retains a deletion record. Collection deletion
also retains its folder origins so discovery cannot silently recreate it.

Supported app operations preserve counters through the durable state. Clearing
app data or adopting a different library establishes a new anonymous writer identity. Do not replace internal
checkpoint files manually: use the validated export/import flow. Duplicate revision
IDs with inconsistent values stop merging instead of guessing which one to retain.

## Efficient generations

Media identities, collection structure and migration markers are stored in an
immutable `catalog-<SHA-256>.json`. Checkpoints hold resume positions, completion,
bookmarks, playback preferences, the full observed revision vector, and a digest
reference to that catalog. Untouched lessons need no placeholder progress records.
Watching one video does not rewrite every media/collection record.

A changed catalog is written, synchronized and checked before committing a new
checkpoint that references it. If that checkpoint fails, the active in-memory
catalog and checkpoint remain the prior committed pair. An orphan catalog is safe
and is retained for now. Retention/compaction of old catalogs needs a release policy.

Device checkpoints use atomic replacement, explicit sync and read-back checking;
the previous generation and catalogs remain available. Android performs explicit
sync/read-back because platform commit helpers can log underlying failures without
throwing them. See the [Android implementation](https://android.googlesource.com/platform/frameworks/base/+/HEAD/core/java/android/util/AtomicFile.java).

Portable writes alternate between `library-a.json` and `library-b.json`. A fresh
portable commit creates and verifies both copies. Each checkpoint has its own
payload checksum. A reader activates it only after its referenced catalog passes
checksum, format and library-identity checks. A missing/truncated catalog therefore
cannot activate a partially updated library. The last complete generation and local
copy remain recovery sources. This does not guarantee the health of the drive.

Normal playback checkpoints locally at about five seconds and batches portable
saves at about fifteen seconds after an initial short save. Pause/removal flushes
immediately. Clean flushes do not rewrite snapshots. Errors preserve the local
copy and do not claim a verified portable save. Removing a drive after a failed
local save is stopped by the UI; the OS still performs the final unmount.

## Compatibility, access and limits

Legacy `.course-player` files are read for initial migration and remain untouched.
The early development envelope version 1 is readable and upgraded to version 2.
Unknown snapshot/catalog versions stop editing; they are never initialized as
empty. Use compatible PaceShelf builds on all devices. Older course players do not
synchronize new completion/bookmark/collection metadata.

Desktop kernel locks and compare-and-swap protect supported local writers. Each
save returns its own committed revision while holding the writer lock, so a reply
cannot accidentally acknowledge another concurrent writer’s checkpoint. Browser
Web Locks make a second editor window read-only when available; the backend still
rejects stale revisions. Android uses one activity and serialized saves. A portable
drive is attached to one physical device at a time; shared network mounts are not
supported. Provider calls still need physical slow/failing-device latency tests.

Models are limited to 16 MiB, 30,000 records, 256 writer identities and bounded
conflict variants. Imports reject unknown schemas, unsafe relative paths and
unrecognized metadata fields. Metadata exports exclude media and device permission
grants. Device-mode restoration can explicitly replace a library after preview,
retaining a recovery copy; portable mode rejects unrelated library identities.

The current loopback/bridge transport still serializes the full model for saves;
a record-delta transport and large-library CPU/memory profiling remain useful
optimizations. Disk checkpoints exclude the static catalog. No physical battery
improvement or universal filesystem crash guarantee follows from this protocol.
