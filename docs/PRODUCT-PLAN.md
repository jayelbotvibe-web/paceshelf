# PaceShelf product plan

Planning baseline: PaceShelf 1.2.2. Proposed capabilities require separate validation.

This document records the proposed product scope and implementation order. Features
listed as additions are planned, not implemented. The existing Android and Ubuntu
player remains the starting point.

The detailed [risk review](PLAN-REVIEW.md) identifies migration, synchronization,
online-content isolation, durability and distribution issues. The delivery order
below incorporates its recommendations. Proposed mitigations are not completed
software fixes.

Public source and release examples must exclude personal identities, machine
paths, private media/catalog titles, playback records and recovery material.
Use synthetic demonstration content. Review documentation, source identifiers,
test artifacts, binaries and commit metadata before publication. See
[publishing guidance](../PUBLISHING.md) for the source allowlist and privacy checks.

## Product definition

A free personal learning player that organizes a person's videos and supported
online playlists into collections and remembers where they stopped. It runs on
their devices and stores their library on their device or portable storage.

The maintainer distributes software without operating an account service, video
hosting service or synchronization backend. Download distribution is still needed.
Local playback works offline. Online playback depends on the source and requires
internet access. Online providers receive requests needed to play their videos.

Primary users are individual learners. Initial target devices are Android phones,
Android tablets and Ubuntu laptops. Windows follows when installation, playback
and storage behavior can be tested there; macOS is a later platform target.

The initial Ubuntu installation uses a normal launcher for the existing local
server/browser interface. This requires no external hosting. A separate native
desktop window and a browser-only edition are later options, not additional
required UI implementations in the first release.

## Baseline verified in the current code

| Capability | Current behavior | Planned treatment |
| --- | --- | --- |
| Local video library | One selected folder tree; courses and sections derive from folders | Keep automatic discovery; add multiple libraries and editable collections |
| Playback | Speed, seek, skip, previous/next, automatic advance, fullscreen and desktop shortcuts | Preserve; add preferences and study controls progressively |
| Continue learning | Most recently played course, lesson and saved position | Preserve; add recent collections and pinned/favorite collections |
| Progress and completion | Position/duration per video; completion inferred from proximity to the end | Separate saved position, completion state and watch history |
| Search | Course-title search and lesson-title/section filtering | Extend to all lessons, bookmarks, notes and available subtitle text |
| Device portability | Android and Ubuntu exchange two SSD snapshots; device-local copies also exist | Generalize into explicit device and portable library modes |
| Identity and recovery | Course aliases, cache migration, older history import and progress export | Add persistent identities, relocation and full-library metadata backup |
| Save feedback | Pending, verified SSD save, device-only save and detailed errors | Retain accuracy; make portable-folder availability and recovery clearer |
| Safe removal | App saves and releases reads; Ubuntu attempts system unmount; Android hands off to Files | Preserve the platform distinction and test with actual devices |
| Background behavior | 1.2.2 saves, releases the Android video stream and suspends timers | Preserve; validate real-device idle battery behavior |
| Appearance | Near-white/light gray, bundled Inter, touch controls, phone and wide-screen layouts | Refine this design instead of replacing the product's visual identity |

Android 1.2.2 checkpoints normal playback locally about every five seconds and
batches verified shared saves about every 15 seconds after an initial short save.
Pausing, leaving the app and preparing removal flush immediately. Ubuntu currently
saves shared progress with each submitted update and can still repeat clean writes.
Its persistence work should be brought into the same efficient policy.

Current checks cover Android emulation, document-provider access and Ubuntu.
Physical-device battery improvement and universal USB compatibility are not yet
established. Playback controls alone do not prove that every codec is supported.

## Useful ideas from the comparison projects

The following are documented strengths to adapt. They are not claims that those
projects lack our proposed extensions or have been tested here end to end.

| Reference | Documented strength | Addition or improvement for our product |
| --- | --- | --- |
| [Locademy](https://github.com/swimshahriar/locademy) | Simple folder import, modules, completion and automatic advance | A short Add collection flow and clean, readable course/lesson screens |
| [Deskemy](https://github.com/NFRohan/Deskemy) | Import preview, content-based relocation, continue watching, bookmarks, resources and subtitle search | Persistent media identities, Locate missing library, review tools and global search |
| [Ckourse](https://github.com/redaantar/ckourse) | Review/edit imported structure, categories, timestamped notes, PDFs and optional remote sources | Metadata-only editing, notes alongside lessons, resources and optional user-owned storage connections |
| [LearnTube](https://github.com/akshvaishnav21/LearnTube) | YouTube playlists as learning paths, manual completion and timestamped notes | Supported online collections, independent completion and the same study workflow across sources |
| [FreeTube](https://freetubeapp.io/) and its [data documentation](https://docs.freetubeapp.io/usage/data-location/) | Locally stored playlists, preferences and history | A user-controlled library with export/import, portable storage and understandable recovery |

## Planned user experience

### Add a collection

1. Choose personal videos or a supported online source.
2. Select a folder or supply a video/playlist link.
3. Preview detected sections and lessons, with source availability shown.
4. Adjust the collection title, section names and lesson order, then save.

Titles and ordering belong to the library metadata. Editing them must not rename,
move, delete or re-encode the original media. Removing a collection removes its
library entry; deletion of original files is outside this collection action.

A video can belong to several collections while retaining one underlying identity.
Collections may combine personal videos and supported online videos. A collection
must remain readable when some sources are unavailable.

Use separate library, media and collection-entry identities. The planned default
is a shared resume position per media item and independent completion per collection
entry. Bookmarks/notes attach to media and timestamps. Moving a library preserves
its identity; deliberately making an independent copy creates a new identity.
Duplicate/changed media and ambiguous relocation need explicit handling rather
than automatic filename-only matches.

### Library and navigation

- Continue learning is the primary return action, showing the precise lesson.
- Favorites, categories/tags, recently used collections and useful sorting help
  larger libraries. Collection cards show lesson counts and completion clearly.
- Generic course names and arbitrary folders work without provider-specific naming
  assumptions or a required directory named Courses.
- A disconnected SSD leaves its collection metadata visible with a Connect drive
  action. An unavailable online video offers a clear source message and skip action.
- Desktop launch uses an app icon and folder selection; routine use needs no
  terminal command. The local browser edition starts through a launcher.

### Playback and study

- Keep the current resume, speed, seeking and next-lesson behavior.
- Separate resume position from completion. Offer Mark complete, Mark incomplete
  and undo. Rewatching an earlier point does not silently erase completion.
- Add one-tap timestamp bookmarks, optional titles and notes. Selecting a bookmark
  or note returns to its lesson and timestamp.
- Add local subtitle selection, remembered per-course speed, configurable skip
  intervals and an automatic-next preference/countdown.
- Show associated PDFs, exercises, code and other attachments with their lesson.
  Provide an Open externally fallback when an attachment cannot be displayed.
- Search available subtitle files; automatic speech transcription is a separate
  optional capability with additional device and resource requirements.
- Add chapter navigation, audio-track selection, picture-in-picture/mini-player
  and a sleep timer where the platform and media support them.

### Phone, tablet and desktop design

Use Deskemy's clear organization and Locademy's straightforward presentation as
references, retaining our light gray surfaces, graphite text and bundled Inter.

- Phone: video first; easy-to-reach main controls; labeled Lessons, Notes and
  Resources panels. Secondary actions belong in menus or sheets.
- Tablet/desktop: video and a collapsible lesson/study panel side by side, with
  enough video width for reading instructional material.
- Library navigation expands on wider screens and stays compact on phones.
- Maintain readable text, accessible labels, visible focus, sufficient contrast
  and usable touch targets. Avoid putting every player option on the main bar.

## Data ownership, portability and recovery

Two explicit modes are required:

| Mode | Metadata storage | Moving to another device |
| --- | --- | --- |
| On this device | App-managed local storage | Export/import the library metadata |
| Portable library | A chosen writable folder, usually the SSD, plus a local recovery copy | Save, system-unmount, move the drive, then reconnect in the next app |

The full metadata export should include collections, media identities/locators,
positions, completion, bookmarks, notes and portable preferences. It does not
include the media by default. Device-specific permissions must be granted again
on another device; an exported file cannot grant filesystem access.

Required behavior:

- Use persistent library/media identities. Paths locate media but must not be the
  only identity. Relink moved files and confirm uncertain matches with the user.
- Store durable device-only history in persistent app-data storage, not the
  regenerable cache directory. Migrate Ubuntu's existing cache copy safely.
- Export backup data to a user-chosen location outside app-private storage.
  Explain that uninstall/clear-data can remove device-only records and that a
  metadata export excludes media. Keep credentials out of portable metadata.
- Avoid hashing every video or rescanning the whole collection on every launch.
  Cache indexing results and fingerprint only when identity needs establishing.
- Preserve intentional rewinds. The furthest playback position is not necessarily
  the newest intended resume point.
- Track independent edits and detect conflicting histories. Device clock errors
  must not silently overwrite good progress; ambiguous conflicts need a choice.
- Specify per-object revisions and deletion records so an old cache cannot
  resurrect removed collections/notes. Prevent concurrent writers on supported
  local configurations or prove reconciliation; a process-local lock is insufficient.
- Version the metadata format and migrations. Preserve original 1.2.x snapshots
  before upgrading. Mixed-version use must not silently discard completion,
  notes or collections; newer metadata may need separate versioned files and a
  compatibility check.
- Validate a complete committed metadata generation before activating it. A write
  interrupted between collection/note/progress files must not create a partially
  usable library. Preserve the last complete valid generation and test the chosen
  protocol against real document-provider/filesystem capabilities.
- Keep independent valid snapshots and a local recovery copy; verify shared saves
  and provide restore preview. A read-only library remains usable in device mode.
- Distinguish recovery copies on the same SSD from a backup on another device.
  App safeguards reduce interrupted-save risk; they cannot guarantee drive health.
- Provide manual export/import for disconnected installations. Automatic exchange
  requires shared storage or an explicit connection and is not implied by having
  the app installed on several devices.

Imports are untrusted: validate paths, schemas, sizes and versions before applying
changes; reject directory traversal and unsafe URL schemes; render titles/notes as
text by default. Do not execute resource attachments or permit provider pages to
call privileged local save, file-selection or removal operations.

## Online source support

YouTube videos/playlists are part of the intended first online release, following
a feasibility check on the actual desktop and Android environments. A local public
release can ship independently; an online integration failure must not block it.

Before committing the implementation, verify supported playback integration,
playlist enumeration, saved-position seeking, speed, event reporting, captions,
key/quota requirements if applicable, and behavior when a video cannot play.
This check must also establish whether the integration can be distributed without
a maintainer-operated proxy or backend. A blocker should be made explicit before
promising the feature as complete.

The current Android request filter and Content Security Policy intentionally block
external content, and the current Ubuntu response suppresses Referer. Prototype
provider playback in an isolated context without the privileged Android bridge;
verify the provider's required client identity rather than globally weakening
local safeguards. See R03–R05 in the risk review and the
[official embedded-player requirements](https://developers.google.com/youtube/terms/required-minimum-functionality?hl=en).

Define capabilities per source: available speeds, seek/resume, automatic advance,
captions/transcript access, picture-in-picture, audio tracks and background behavior.
The first online scope is supported prerecorded videos. Local subtitle search uses
user-supplied files; displaying a provider's captions does not imply permission to
download/index their transcript. Keep the required provider player UI/attribution
distinct from personal collection labels. Do not assume background playback or
offline downloading is allowed for online sources.

Use provider-supported methods and preserve required player behavior. Store the
provider's stable video identity in the library. Handle unavailable/private videos,
reordered playlists and new lessons without resetting existing progress. Internet
access is required for streaming.

Keep provider API caches/expiry separate from independently authored notes,
completion and collection references. Specify playlist append/mirror behavior,
duplicate entries and retention rules for the chosen API. Source credentials and
tokens remain device-local and are excluded from exports. Online use needs accurate
third-party data/privacy disclosures, even when our own metadata stays local.

Other providers are added individually after checking their capabilities. An
external link with manual completion can be supported as a clearly labeled
fallback, without claiming exact in-app playback-position tracking.

## Delivery order

### Stage 0: preserve and validate the foundation

- Snapshot the 1.2.2 source/release and representative history before implementation.
- Check idle behavior on supported Android phones and tablets with the SSD connected and disconnected;
  distinguish app work, decoding, screen use and USB power consumption.
- Reduce repeated clean writes and unnecessary rescans on both platforms.
- Verify actual three-device handoff, interrupted-save recovery and safe removal.
- Define versioned metadata and prove migration without losing current history.
- Settle identity, completion, revisions, deletion and committed-generation rules.
- Put durable desktop history outside cache, with safe migration of the old copy.
- Define trust boundaries and run an isolated YouTube feasibility proof.
- Establish release signing/backup ownership, distribution channel, minimum app/OS
  versions and current channel-specific installation/verification requirements.
- Pin the expected release certificate; a missing release key must not silently
  generate a different publisher identity. Review licenses and bundled notices.

### Stage 1A: focused local public product

- Generic local folder libraries and explicit device/portable modes.
- Editable collections with import preview, sections, ordering and favorites.
- Independent completion and timestamp bookmarks.
- Missing-drive display, relink flow, full metadata export/import and recovery.
- Clear phone/tablet/desktop navigation and simplified playback controls.
- Android APK and Ubuntu installation/launch flows with no routine terminal use.
- Full note editing, resources and advanced study tools follow in Stage 2.

### Stage 1B: first online release

- Supported YouTube videos/playlists only after the isolated feasibility proof passes.
- Shared collection organization with provider-specific playback and capability UI.
- Validate required client identification, source attribution, privacy/cache rules,
  credential/quota handling if applicable, unavailable videos and blocked autoplay.
- Physical-device resume/playback checks on an Android phone, Android tablet and Ubuntu browser.
- External-open/manual-completion fallback clearly identifies tracking limitations.

### Stage 2: study and review

- Timestamped note editing and searchable review of bookmarks/notes.
- Resource attachments and PDF viewing, with external-open fallback.
- Local subtitles, subtitle search, global lesson/note/bookmark search.
- Per-course preferences, sleep timer, chapters, supported audio-track selection,
  picture-in-picture/mini-player and configurable automatic advance.
- Tags/categories, learning paths spanning collections, and optional private
  study-time/history summaries. Statistics should not obstruct Continue learning.

### Stage 3: broader distribution and optional sources

- Windows packaging and physical validation; macOS when build/sign/test resources
  are available. Platform support is announced after it is tested.
- Additional streaming providers and optional user-owned WebDAV/SFTP/S3 or cloud
  storage connections, each with explicit setup and capability limits.
- Remote media access does not imply automatic metadata sync. A cloud-synchronized
  live database is not an assumed substitute for a synchronization protocol.
- Optional direct device-to-device metadata transfer on the local network.
- Release update checks/downloads through the distribution channel, with user
  control and no permanent background polling.

## Release acceptance criteria

1. Existing history imports without replacing newer valid positions or modifying
   the original media. Migration can be recovered from its retained backup.
2. Phone → Ubuntu → tablet resumes the same lesson from verified shared metadata;
   deliberate rewind and manual completion survive the round trip.
3. A collection edited in one supported app remains understandable in the others.
4. Disconnects, read-only access and damaged metadata produce clear states with
   local recovery; app startup never creates a phantom missing-drive directory.
5. Backgrounding saves the latest position and stops playback/read activity and
   unnecessary timers; physical idle measurements accompany battery claims.
6. A large library stays responsive without repeated full media reads.
7. Online-source tests cover playlist changes, failed playback and restoration;
   unsupported behavior is identified clearly in the interface.
8. Phone/tablet portrait and landscape layouts, keyboard navigation and touch
   controls are checked with representative long lesson names and large courses.
9. Installation and normal use require no maintainer-hosted account or backend.
10. Cache cleanup preserves durable records; wrong-signer releases fail before
    distribution; exports exclude credentials and identify their backup coverage.
11. Clock-skewed caches, deletion/reconnect and concurrent instances cannot silently
    overwrite or resurrect collection state. Mixed-version writers cannot strip
    newer fields or reset a newer library as empty.
12. Interrupted commit/migration, full storage and unsafe imports leave a complete
    prior library recoverable without executing imported content or modifying media.
13. Online provider frames cannot invoke privileged local/native operations. Source
    capability and error tests pass without weakening loopback host/origin isolation.

The expanded fault scenarios and evidence requirements are in
[PLAN-REVIEW.md](PLAN-REVIEW.md). Schedule estimates follow the foundation and online
feasibility work; the complete roadmap is not one release-sized implementation.

Implementation choices such as playback engines, indexing strategy and archive
format should follow targeted measurements and compatibility checks. The present
plan does not claim that changing frameworks automatically improves battery life
or media support.
