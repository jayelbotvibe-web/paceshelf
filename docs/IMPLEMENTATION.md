# PaceShelf implementation status

Version 0.2.0 is a development preview with local and YouTube references. The full product plan remains the
roadmap; features listed there are not implied to exist in this build.

## YouTube preview in 0.2.0

- Strict video/playlist URL parsing, import review and additions to new/existing
  collections, including mixed local/online lessons. User labels and ordering stay local.
- Key-free playlist discovery through the official IFrame player; up to 500 IDs per
  import. Only the provider's available list is imported; no claim of a complete
  authenticated/account library export. Missing/private/restricted items may be omitted.
- Stable provider IDs, shared resume, independent entry completion, bookmarks and
  explicit linked-playlist updates that append without resetting existing records.
- An isolated, fixed-assets desktop origin and a separate bridge-free Android
  WebView, with bounded/session-scoped player state. Local privileged network
  restrictions remain intact. Provider identity/referrer is supplied separately.
- Explicit loading before contacting YouTube, original controls/attribution,
  supported speed persistence, visible-player consecutive playback, external-link
  fallback and complete Android provider release on background.
- Android can create a persistent app-private device-only library without a drive
  or folder grant. Portable transfer remains an explicit mode or backup operation.
- Existing local schemas are unchanged; new optional typed fields are rejected by
  earlier clients. Update every device before using online records.

See [YouTube instructions and limits](YOUTUBE.md) and [privacy](PRIVACY.md).

## Implemented in the first milestone

- New PaceShelf identity and MIT license; separate Android package from the baseline.
- A shared JavaScript metadata protocol used by Android and Ubuntu: versioned library,
  persistent media/entry IDs, causal revisions, retained deletions, explicit conflicts.
- Independent completion and timestamp bookmarks, full metadata export and restore preview.
  Causal activity selects the latest lesson and its active collection, preserving
  legacy viewing order during initial migration and avoiding device-clock winners.
- Collection/lesson/section naming, ordering and favorites without changing original files.
- Device-only mode and portable library mode; explicit adoption of an exported library
  in device mode retains a local recovery copy. Other library identities cannot be
  overwritten silently or merged into unrelated portable metadata.
- Committed generations with SHA-256 checksums, read-back verification, alternating
  portable copies, atomic local checkpoints and the previous local generation. Immutable
  catalogs keep playback checkpoints small; both parts validate before activation. See
  the [storage protocol](STORAGE.md).
- Compare-and-swap and per-save receipts prevent stale browser writes and false
  acknowledgments of another writer’s checkpoint. Ubuntu process locks protect local
  data and writable portable metadata. Android uses one activity; portable drives are
  used by one physical device at a time. Concurrent network mounts are unsupported.
- Ubuntu durable data moved out of cache; an existing legacy cache is read without deletion.
- New metadata lives in `.paceshelf`; legacy `.course-player` snapshots stay untouched.
- Five-second foreground checkpoints, batched portable saves, forced pause/removal flush,
  no repeating idle status polling, and no full Android folder scan on every resume.
- Root-level videos, light gray study controls, backup/conflict dialogs and an Ubuntu
  launcher with a system folder picker. External web requests remain blocked in
  Android's privileged local view; the separate provider view handles YouTube.
- Source allowlist, privacy audit, source archive packaging and explicit release signing.

## Required before a stable local public release

- Actual phone/tablet/Ubuntu handoff, screen-off battery and USB power measurements.
- Hardware/filesystem interruption, full/read-only device, lost-grant and slow-provider tests.
- Broader Android OS/WebView and Ubuntu browser/codec compatibility evidence.
- A multiple-library manager, explicit first-import preview and manual missing-file relink.
  This build selects one root per Android installation or Ubuntu launch; separate Ubuntu
  roots can run separately. Disconnected metadata remains in local storage, but the
  complete offline library manager/Connect drive experience is not implemented yet.
- Incremental fingerprints and relocation matching. Current path/size locators cannot
  identify same-size replacements or automatically follow arbitrary video renames.
- A recovery UI for damaged device-local generations, with restore selection and validation.
  A damaged or newer local file currently stops editing; valid portable copies can be
  displayed for review. Do not manually overwrite app-private files to restore history.
- Bound large-library indexing, full-model transport CPU/memory, retained old catalogs
  and provider I/O latency. Generations are
  capped at 16 MiB; imports validate version/schema/paths and preserve conflicts.
- Release-key ownership/backup, final APK signer pin, update/distribution channel and
  physical package-install tests. Preview APKs are debug-signed for development only.

## Later milestones

The initial isolated YouTube preview implements part of Stage 1B. Wider physical
WebView/provider and source-error testing remains required. No provider pages are
enabled in the privileged Android local player. Notes, attachments,
subtitles/search, advanced playback, other desktop platforms and optional remote
connections remain subsequent milestones described in the product plan.
