# PaceShelf privacy

PaceShelf runs on your own device. The project does not operate an account system,
hosted library, synchronization backend or analytics service for the player.

## Data stored by the app

Your library metadata can contain collection/lesson labels, relative file locators,
YouTube references, watched positions, completion, bookmarks and preferences.
Anonymous writer identifiers distinguish changes made by different installations.
These identifiers are for local/portable reconciliation, not an analytics identity.

**On this device** keeps metadata in app-managed storage. **Portable library** also
writes metadata in `.paceshelf` beside the selected video folder. Exports are
plaintext metadata backups and may reveal viewing interests or private titles.
They do not contain the videos or transfer Android filesystem permission grants.
Do not publish metadata, unreviewed logs or identifying screenshots in GitHub issues.

## When YouTube is contacted

Browsing local videos or adding individual video references does not load YouTube.
Loading a YouTube playlist preview/player is an explicit action and makes network
requests to YouTube/Google. Opening an original link, terms or privacy policy also
contacts its destination through your browser or the YouTube app.

YouTube may receive your IP address, requested video/playlist IDs, player identity,
playback interactions and normal browser/provider data. Cookie/account behavior is
controlled by YouTube, the browser/WebView and your settings. PaceShelf does not
collect YouTube passwords, OAuth tokens or API keys, and does not sign into your
YouTube account. Its player configuration contains stable source IDs and resume
timing, not your local paths or collection labels. Related provider functionality
and advertising remain part of the official player.

Read [YouTube's terms](https://www.youtube.com/t/terms),
[YouTube's API terms](https://developers.google.com/youtube/terms/api-services-terms-of-service)
and [Google's privacy policy](https://policies.google.com/privacy).
If you prefer no provider requests, use local videos and do not load YouTube.

## Export and removal

Export a library backup before uninstalling or clearing app data if you want to
keep history. Uninstalling/clearing app data can remove device-only records.
Portable records on a drive remain there until you remove them separately.
To erase portable metadata, close the player and delete only that library's hidden
`.paceshelf` folder; doing so removes its history and collection edits. It is not a
video backup and does not delete original video files elsewhere in the folder.

Your operating system, browser, YouTube and software download hosts have their own
privacy practices. This document describes PaceShelf's behavior, not a guarantee
about those services. To raise an issue, use the repository's issue templates with
fictional examples and exclude private data.
