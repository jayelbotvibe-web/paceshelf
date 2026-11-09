# Changes

## 0.2.1 — YouTube playback fixes

Paused seeks now wait for the provider's actual clock and briefly continue sampling
until it settles, so a stale paused snapshot cannot restore the old position.
Returning from a related YouTube video re-enables the selected lesson's seek
controls without replaying its initial resume. Unchanged clock updates preserve
bookmark controls and keyboard focus instead of rebuilding them every second.
Temporary missing provider clocks retain only one retry timer.

## 0.2.0 — YouTube reference preview

Add public/unlisted YouTube playlists or pasted video links to new or existing
collections. Preview imports, reuse stable video identities and append playlist
updates without resetting progress, completion, labels or ordering. Online and
local videos can share a collection.

Official embedded playback lives in an isolated desktop origin or a separate
bridge-free Android WebView. It supports tracked resume, bookmarks, completion and
consecutive lessons, while retaining YouTube controls and requiring internet.
Loading a provider is explicit. Android can start an app-private device-only library
without storage access. No video downloading, account credentials or maintainer
backend is introduced. Existing clients must be updated to read YouTube records.

## 0.1.0 — development preview

PaceShelf starts from the offline Android/Ubuntu player with a separate public
identity. This milestone adds versioned portable metadata, causal conflict handling,
independent completion, bookmarks, collection editing, favorites, storage modes and
metadata backup previews. Ubuntu durable data moves out of cache; local and portable
save generations are verified independently. The UI retains light gray surfaces
and Inter with additional study controls.

The project uses MIT licensing and privacy-reviewed source packaging. No online
sources are implemented yet. See implementation status for release gates and
remaining roadmap work.
