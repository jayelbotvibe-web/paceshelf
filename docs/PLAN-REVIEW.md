# Product plan review

Reviewed against PRODUCT-PLAN.md, the 1.2.2 source, and the
official platform/provider documentation linked below.

Verdict: the local personal-player concept is feasible. The original Stage 1
bundled too many independent changes, and the data/online-player contracts were
not specific enough to begin implementing the entire feature list safely.
Split the local release from the online integration and settle storage semantics
before building the new collection interface.

This is a design/code review, not a penetration test, physical-device battery
measurement or implementation of the proposed mitigations. Severity describes
what must be resolved before the affected feature is released. A risk in a new
feature does not mean it is already exploitable in the current local-only app.

## Findings requiring a decision before implementation

### R01 — Critical: older apps can discard new metadata

Evidence: Android `CourseLibrary.merge`  reconstructs each record
using only position, duration and updatedAt. The Go `Progress` type in
`desktop/main.go`  has the same three fields. Both write snapshots
again after loading them.

What could happen: add completion or notes to these records, then use an older
phone installation; its next save can remove those fields. Replacing the root
mapping with a new envelope can cause old readers to reject the entire snapshot.

Required change: choose a versioned format, preserve immutable pre-migration
copies, and keep new metadata out of files old clients can silently overwrite.
Define the minimum writer version and mixed-version behavior. An incompatible
client must not initialize an existing newer library as empty. Migration must
be idempotent and interruption-safe; restoring the old app needs its matching
old-format data, not just a downgraded APK.

Release proof: migrate a populated 1.2.2 library, interrupt migration, reopen it,
and exercise an older writer. Preserve both history and newer study data or
refuse the incompatible write without changing either.

### R02 — High: timestamps alone do not define synchronization

Evidence: Android `merge` and Go `ProgressStore.mergeFile` select the record with
the newest wall-clock timestamp. Per-video monotonic timestamp guards on save
help with local rollback but do not resolve independent, unseen edits.

What could happen: a stale private cache with an ahead-of-time clock replaces a
newer SSD position. Future deletion of a collection or note can be undone when
an old cache merges it back. Two desktop processes can overwrite each other's
in-memory snapshots. Moving an SSD sequentially is not the same as supporting
simultaneous writers or cloud synchronization.

Required change: define revisions, conflict handling and deletion records before
collection editing. Retain intentional rewinds. Detect/prevent concurrent writers
on supported local configurations; do not treat a process mutex as an inter-app
lock. Filesystem/provider lock support needs testing. If independent edits cannot
be ordered, offer a recovery choice instead of silently using the furthest time.

Release proof: clock skew plus divergent cache, delete/reconnect, repeated import,
and concurrent launch scenarios converge without resurrecting removed objects.

### R03 — Critical for online support: the Android bridge is not isolated from remote frames

Evidence: `MainActivity`  injects the Android bridge and currently
blocks external requests. `LocalServer`  also restricts content through
its Content Security Policy. Those restrictions are appropriate for local use.

What could happen: simply allowing YouTube/other frames to load can expose the
same native bridge to those frames. Bridge methods can save history, change
settings, invoke file pickers and prepare drive removal. Android documents that
`addJavascriptInterface` is exposed to every frame and cannot identify the
origin of the caller. [Android native-bridge security guidance](https://developer.android.com/privacy-and-security/risks/insecure-webview-native-bridges).

Required change: isolate provider content from privileged local controls, or use
a carefully scoped messaging design with verified origins and a minimal command
surface. Keep the loopback server private and retain its host/origin checks.
Do not globally relax the existing request restrictions or allow arbitrary sites.

Release proof: a deliberately untrusted embedded page cannot call native save,
export, folder-selection or eject actions, even though permitted online playback
works. Check navigation, redirects and child frames as well as the main URL.

### R04 — High: YouTube is a provider-specific integration, not ordinary HTML video

Evidence: desktop middleware currently sends `Referrer-Policy: no-referrer`
(`desktop/main.go`). Google's embedded-player requirements call for
client identification and explain WebView/app identity handling. Its player
reference identifies missing identification as error 153 and also documents
embedding-disabled, private/deleted videos and blocked autoplay.
[Client identity requirements](https://developers.google.com/youtube/terms/required-minimum-functionality?hl=en),
[player API and errors](https://developers.google.com/youtube/iframe_api_reference).

What could happen: the local player works but an embedded video is blank or fails
with 153; automatic-next needs another tap; a creator disables embedding; or the
requested playback speed is not available. Our current 1.7× option cannot be
assumed available for every YouTube video. Existing HTMLVideoElement event/seek
code will not control a cross-origin YouTube frame directly.

Required change: define a player-adapter capability contract and validate client
identity in Android and the Ubuntu browser launcher. Preserve only the necessary
origin context, without leaking local filesystem paths or privileged tokens.
Use the provider's player and events; report unsupported operations honestly.
Public playlist discovery/refresh needs an explicit credential, quota, pagination
and caching design if the Data API is chosen; embedded playback alone does not
establish that those features need no setup. [Data API overview](https://developers.google.com/youtube/data/getting-started).

Release proof: public video, multi-page playlist, restart/resume, supported speeds,
blocked autoplay, embedding disabled, expired/unavailable source and quota failure
on desktop and both physical Android devices. No backend/proxy is assumed.

### R05 — High: some planned player and search features cannot be uniform across sources

Google's API guidance restricts interference with player UI/ads, background
YouTube playback and offline downloads. Do not copy a feature from an unofficial
client and assume the same integration is allowed. Its official captions download
API requires permission to edit the video; the presence of captions in a player
does not grant general access to a searchable transcript.
[Provider policy guidance](https://developers.google.com/youtube/terms/developer-policies-guide),
[caption-download permissions](https://developers.google.com/youtube/v3/docs/captions/download).

What could happen: a promised universal mini-player, audio-only mode, custom
overlay, speed list or subtitle search is unavailable or incompatible with the
chosen provider. Live streams can have no finite duration, while current progress
validation requires a positive finite duration.

Required change: maintain a source capability matrix. First online release targets
supported prerecorded videos; live/DRM/private-source support requires separate
design. Local subtitle search starts with user-provided subtitle files. PiP and
background policy are source/platform-specific; hidden playback stays off by
default. Show a manual completion/external-open fallback without claiming exact
position tracking there. Keep creator titles/attribution distinct from personal
collection labels; user renaming must not silently alter required provider metadata.

### R06 — High: media identity and learning state are underspecified

Evidence: current IDs derive from course/folder paths with explicit aliases.
`recoverPreviousDeviceCaches`  imports matching path-like IDs from
other device caches; the match is not a content or persistent-library proof.

What could happen: unrelated files named alike inherit each other's history;
moving a file loses its position; an edited/re-encoded video receives old bookmark
timestamps; or completing a video in one collection unexpectedly completes a
different learning path. Copying a library can accidentally retain the original's
identity and merge two intentionally separate libraries.

Required change: specify libraryId, mediaId and collection-entry/lessonId as
different concepts. Recommended default: shared resume position per media;
completion per collection entry; notes/bookmarks attached to media/time. Moving
a library preserves its ID; deliberately forking it assigns a new one. Matching
by filename or a short fingerprint is a candidate match requiring confirmation
when ambiguous, not permission to silently transfer history. Define changed-media
and duplicate-playlist-item behavior.

### R07 — High: portable saves need transaction and failure rules

Evidence: current Android writes truncate the chosen snapshot before writing it
(`writeShared`), then read it back. A second snapshot and a local copy
provide recovery. This is not an atomic commit of future collections, notes,
positions and preferences spread across several files.

What could happen: a disconnect leaves a new collection pointing at missing note
data; disk-full truncates a candidate snapshot; a damaged/stale but valid-looking
file wins a merge; or provider file-descriptor/fsync behavior differs from local
storage. Readback is not proof against future cable/controller/media failure.

Required change: define a versioned committed generation with integrity checks
and keep the last complete valid generation until replacement succeeds. Test the
chosen write scheme against real SAF/exFAT capabilities rather than assuming
POSIX atomic rename/locking everywhere. Always keep a device-local copy and never
write to original videos. Distinguish pending, device-saved, shared-verified and
system-unmounted states. A timeout is not a successful save or completed unmount.

Release proof: interruption during every commit step, full/read-only storage,
malformed/partial files and missing drive. Restore a complete generation without
creating a phantom mount directory. Shared snapshots are recovery copies, not an
independent backup of the SSD or its videos.

### R08 — High: device-only storage can disappear

Evidence: Ubuntu's default progress copy is under `os.UserCacheDir()`
(`desktop/main.go`). Android uses private files and currently sets
`allowBackup=false`; uninstalling/clearing app data removes private history.
[Android app-specific storage lifecycle](https://developer.android.com/training/data-storage/app-specific).

What could happen: a cache cleanup removes the only laptop copy when SSD saving
has failed; reinstalling the APK as a fresh app loses a person's device-only notes.
An exported metadata archive cannot restore videos that were never included.

Required change: move durable desktop records to persistent app-data storage,
migrating the cache copy without deleting its recovery source. Keep only
regenerable thumbnails/index caches in cache storage. Make backup coverage and
export age visible. Explain uninstall/clear-data consequences; provide export to
a user-chosen location outside app-private storage. Metadata archives explicitly
state that media and device permission grants are excluded.

### R09 — High: battery work and USB power need separate evidence

Evidence: 1.2.2 emulator checks prove fewer checkpoint cycles and suspended
background timers, not physical battery savings. Android still rebuilds the library
on resume (`MainActivity`); Ubuntu still repeats clean shared writes.

What could happen: idle drain persists because the phone powers the connected
SSD; thousands of thumbnail/fingerprint reads make startup hot; full rescans after
every brief app switch waste time; or a stalled provider save delays suspension.
Five-/15-second checkpoint intervals also permit recent progress to be absent
after an abrupt disconnect or forced termination. They are scheduling targets,
not hard maximum delays under failing I/O.

Required change: profile foreground, paused, hidden and screen-off states with
SSD connected/disconnected, controlling other device activity and temperature.
Keep durable local checkpoints, bounded UI waiting and no repeated background
polling. Stop/reset background work correctly around dialogs, fast resume and
explicit visible PiP. Index/fingerprint incrementally; do not read all media merely
to restore a collection. A failed background flush must not suspend saving forever
or claim that a pending write reached the SSD.

### R10 — Medium: access and playback vary by device and browser

Android grants are per installation, and persisted access can be lost after moving
or deleting a document. A portable archive cannot reproduce grants. USB power,
bridges, filesystem support, free space and cable quality are independent factors.
Container extensions are not codec guarantees; hardware decoding differs by
device. Browser directory APIs also have a compatibility/permission boundary.
[Android document access](https://developer.android.com/training/data-storage/shared/documents-files),
[media format support](https://developer.android.com/media/platform/supported-formats),
[browser filesystem capabilities](https://developer.chrome.com/docs/capabilities/web-apis/file-system-access).

Required change: publish a tested compatibility matrix. First browser edition is
the Ubuntu local-launcher/server UI, not an arbitrary HTML file guaranteed to work
in every browser. Keep filesystem access in its local backend; a browser-only
edition would need separate capability detection. Provide relink, read-only/device
mode and unsupported-media states. Opening in an external player must not falsely
claim that precise progress is still being tracked.

### R11 — High: public distribution needs release ownership

Evidence: `tools/package-release.sh` creates a new signing key if it is missing.
That is useful for a first private build but a released app needs a stable publisher
identity and a deliberate key-recovery/rotation process.

What could happen: a rebuild on another machine uses a different signer and cannot
upgrade existing installations normally. Users uninstall to resolve it and lose
device-only data. A broad APK audience also encounters device/store installation
rules that differ from a limited test device set. Google's current verification
timeline includes regional participating-store protections beginning 30 September
2026 in selected regions; this is not evidence that every direct APK install is
blocked. [Current Android distribution/verification documentation](https://developer.android.com/developer-verification).

Required change: protect and back up the signing material, pin the expected
certificate, and make release builds fail rather than silently establish a new
identity. Choose a download/distribution channel, version scheme, update integrity
checks and a support/security-contact route. Verify the exact channel's current
registration/install requirements. A free app and no hosted backend do not remove
release maintenance, distribution or potential publisher costs. Review dependency
licenses/notices before reusing code and choose the project's distribution license.

### R12 — Medium: imported metadata and resources are untrusted input

What could happen: a malicious archive writes outside its destination, a note/title
executes script in the privileged UI, a resource path escapes the granted folder,
or a crafted file/very large import exhausts memory. Imported source URLs could
also target local endpoints if blindly fetched as online video links.

Required change: validate archive paths, sizes, versions and checksums; reject
traversal/symlink escapes and unsafe schemes. Render notes/titles as text by default.
Ask before overwriting a library and validate imports before applying any edits.
Never execute an imported code attachment. PDF/HTML rendering and network
connectors need isolation and updates. Keep metadata, thumbnails and index limits
separate; current 16 MiB JSON and 64 KiB request limits need deliberate evolution.

### R13 — Medium: local storage is not the same as confidentiality

What could happen: someone with the SSD can read course names, notes and history;
a shared export leaks absolute paths, identity details or future connection
credentials. YouTube playback still exchanges data with the provider even when
our metadata remains local. A packaged account token could be copied to another
person's installation unintentionally.

Required change: no credentials/tokens in portable exports; keep future connector
credentials device-local. Describe plaintext portable metadata honestly and offer
a redacted export/optional protected backup if needed. Do not claim the online
edition is anonymous or has no third-party communication. Provide local delete
controls and source-specific disclosures.

### R14 — High for online release: provider caching and retention need their own rules

The plan promises an offline-readable collection and full export but does not
separate user-authored records from provider API data. YouTube's policies include
refresh/deletion rules for stored API data, including 30-day limits for specified
categories, and privacy-policy requirements. They must be mapped to the actual
integration rather than assumed irrelevant because storage is local.
[YouTube data-storage and privacy requirements](https://developers.google.com/youtube/terms/developer-policies).

What could happen: an offline archive indefinitely retains stale API titles,
thumbnails or other metadata, while deleting that cache accidentally deletes a
person's independently written notes. Playlist deletions/reordering or repeated
videos can also reset completion if identity is tied to list position.

Required change: separate provider cache records and expiry from user-owned
collection references, labels, notes and completion. Apply the applicable refresh,
display, deletion and export rules. Use stable media/entry identities, preserve
unavailable-item records, and ask whether playlist refresh should append new lessons
or mirror removals. No scraping workaround is assumed to resolve these obligations.

### R15 — High delivery risk: Stage 1 is too broad to validate as one change

Original Stage 1 simultaneously changes identity, storage modes, collection
editing, migration, completion semantics, notes, online playback, UI and packaging.
Failure in any area can obscure a regression in another. There are no effort
estimates yet, so a completion date for the combined list would be speculative.

Required change: keep the roadmap, but split implementation into independently
reviewable milestones: foundations, a focused local release, online feasibility
and integration, then richer study tools. Each milestone has a working artifact
and explicit acceptance evidence. Future remote media sources do not automatically
include remote metadata sync; cloud-file syncing a live database is not an assumed
replacement for a synchronization protocol.

## Recommended decisions

1. Keep Android plus Ubuntu as the tested initial platforms. The Ubuntu edition
   uses its installed local launcher/browser UI; a separate native desktop window
   is a later presentation option rather than a second required UI implementation.
2. Make durability, migration, stable identities and the media/collection-entry
   distinction prerequisites for editable collections.
3. Target a local first public release with device/portable modes, simple collection
   editing, explicit completion, timestamp bookmarks, relink and metadata recovery.
   Add full note editing with the later study milestone.
4. Develop the YouTube proof in isolation with no privileged bridge available to
   provider frames. Release online sources only when the identity, source policies,
   quota/cache design and physical-device playback checks pass.
5. Keep unsupported streaming links as external-open/manual-completion entries,
   clearly distinguished from in-app resume-capable media.
6. Keep all accepted advanced features on the roadmap, while gating PiP, captions,
   remote sources and browser-only capabilities by source/platform support.

## Tests that must be added to the release evidence

| Failure scenario | Required outcome |
| --- | --- |
| New library opened by an old app | No silent loss of new fields; reject unsafe writes |
| Power loss/kill during migration or metadata commit | At least one complete prior generation remains recoverable |
| Clock-skewed stale cache, intentional rewind, deletion and reconnect | Deterministic recovery or an explicit conflict choice; no resurrection |
| Same filename in two libraries, duplicate media in two collections, edited video | Correct media match and independent collection completion |
| Two instances writing one library | Prevent concurrent writers or prove safe reconciliation |
| Full/read-only SSD, removed USB, lost SAF grant, slow provider | Local save remains usable; no false success or indefinite UI wait |
| Cleanup of regenerable caches | Durable library and history survive |
| Backgrounding, folder dialog, quick resume and visible PiP | Correct save/suspend/resume behavior with source-specific restrictions |
| Imported script, oversized archive, traversal path and local-endpoint URL | Reject/isolate without executing, escaping the destination or touching original media |
| YouTube client identity, blocked embedding/autoplay, unavailable speed/quota | Clear capability/error state; local collection remains usable |
| Caption display without transcript-download authorization | No promise or attempt to index an unavailable transcript |
| Export/import on a different device | Regrant access; retain metadata; exclude secrets and disclose media exclusion |
| Release built with the wrong signing identity | Build fails before distribution |

No new claim about drive health, universal codec support or physical battery life
is established by this review. Mitigations above are requirements to implement and
test, not completed fixes.
