# YouTube collections

PaceShelf supports **references** to public/unlisted YouTube videos and playlists.
The videos stream from YouTube through its official embedded player. PaceShelf
does not download videos, modify playlists in your YouTube account or operate a
hosted proxy. No API key or PaceShelf account is needed.

Use 0.2.1 or newer for corrected paused-seek checkpoints, restored controls after
returning from a related video, and stable bookmark controls during clock updates.

## Add a video list

1. Open a library and select **Add YouTube**.
2. Choose an existing collection, or give a new collection a title.
3. Paste one complete HTTPS video link per line and select **Preview import**.
4. Review the IDs and count of new references, then select **Add to collection**.

Watch links, `youtu.be`, Shorts and embed links are recognized. Extra URL tracking
parameters are discarded. Duplicates are ignored while preserving the entered
order. A video link with a `list` parameter is treated as a playlist when submitted
alone; a multi-link video list imports its individual video IDs.

Adding individual references does not contact YouTube. Open a lesson and select
**Load YouTube player** when you want to connect. Press play in YouTube's player.
Its controls, captions, settings, branding and links remain available. On Android
the player opens in a separate view; use **Back to PaceShelf** for collection tools.

## Import or update a playlist

Paste a public/unlisted playlist link and select **Preview import**. This explicit
action loads a YouTube player to discover the list. Review the results before
adding them. Loading the preview or player contacts YouTube and requires internet.

The official IFrame API supplies the IDs it makes available; this is not an
authenticated export of your YouTube library. Up to 500 videos can be added per
import. Private, deleted, restricted or omitted items may be missing, and provider
limits can make a list incomplete. Compare the preview count with the original
playlist. Watch Later, account-only library pages and private playlists are not
supported. Paste individual public/unlisted links as a fallback.

Imported labels initially read **YouTube video VIDEO_ID**. You can change your own
lesson labels and section/order in **Edit collection**. The original YouTube title
and other provider metadata remain visible in the embedded player. PaceShelf does
not scrape titles, cache provider thumbnails or require Data API credentials.

A linked collection exposes **Open source playlist** and **Review playlist updates**.
Reviewing updates reopens the import flow with that source and collection selected.
Confirming appends newly discovered videos while retaining existing identities,
labels, ordering, completion, bookmarks and resume positions. Removed source items
remain in your collection so their history is not erased. There is no automatic
background playlist synchronization.

## Progress and playback

Online and local lessons can share one collection. Resume belongs to each media
identity; completion remains independent for each collection entry. Bookmarks
retain timestamps. Available YouTube playback speeds depend on the provider; the
app remembers its supported speed choices. Use YouTube's own controls for its
additional settings. Livestream/DVR resume is outside this preview's supported scope.

Automatic next uses the existing preference and runs only while the online player
is visible. Browser/WebView autoplay restrictions can require another tap. Selecting
a related video outside the current lesson pauses PaceShelf's progress tracking
for that lesson. It must not overwrite the selected lesson with another video's clock.

Android backgrounding checkpoints the latest sampled position and destroys the
provider view. It does not offer background YouTube audio or offline playback.
Network/decoder delays and provider seek granularity can affect the exact resume
point; always confirm a portable save before moving a drive.

Choose **On this device** for device-local metadata, or **Portable library** to
take it with the same writable library folder and its `.paceshelf` directory.
Separate installations exchange metadata only through shared storage or manual
export/restore. YouTube watch history is not PaceShelf's synchronization mechanism.

On Android, **Start a device-only YouTube library** works without a drive/folder
grant. To move that library elsewhere, export a metadata backup and restore it on
the receiving device in device mode. Selecting a filesystem folder opens that
folder's own library; it does not silently combine it with the app-private library.
On Ubuntu, choose an existing video folder or an empty folder with the launcher.

**Use 0.2.1 on all devices for the current playback fixes.** YouTube records require
0.2.0 or newer; earlier frontends reject the new typed fields and stop editing
rather than silently discarding them. Version 0.2.1 keeps the 0.2.0 storage format.
Keep a metadata backup. See [upgrade instructions](INSTALL.md#updating-an-existing-preview).

## If a video will not play

- Check your internet connection and the installed browser/Android System WebView.
- Some owners disable embeds; videos can also be private, removed or restricted.
  Use **Open original video**, which hands off to YouTube or your normal browser.
  Playback outside the embedded player is not tracked by PaceShelf.
- Error 153 indicates an embedded-player identification problem. Restart/update
  PaceShelf; do not disable security protections or add credentials to library files.
- If playlist discovery fails, try individual video links. No folder permission
  can grant access to a private YouTube playlist.

## Privacy and implementation

YouTube is contacted only after loading a preview/player or opening an external
link. YouTube/Google may receive your IP address, requested video/playlist IDs,
player identity and normal provider/browser data, including cookies where allowed.
See [PaceShelf privacy](PRIVACY.md), [YouTube terms](https://www.youtube.com/t/terms)
and [Google's privacy policy](https://policies.google.com/privacy).

The desktop wrapper has a separate loopback origin with no media/metadata routes.
The Android view has no JavaScript interface and no file/content access. Only
bounded player messages for an active session reach the trusted interface; source
IDs, timing and message origins are checked. Local-player network restrictions
remain in place. The provider receives its required referrer identity, without
sending local library paths or titles in player configuration.

This uses the official [IFrame API](https://developers.google.com/youtube/iframe_api_reference),
[player parameters](https://developers.google.com/youtube/player_parameters) and
[embedded-player requirements](https://developers.google.com/youtube/terms/required-minimum-functionality).
No general-purpose streaming or arbitrary web-page embedding is enabled.

[Back to PaceShelf](../README.md)
