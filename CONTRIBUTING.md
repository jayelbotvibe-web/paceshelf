# Contribute to PaceShelf

PaceShelf is a free, MIT-licensed local video learning player. Current priorities
are reliable progress, accessible playback, straightforward installation and
validation on real Android and Ubuntu hardware. See the
[implementation status](docs/IMPLEMENTATION.md) before starting a larger feature.

## Report a problem or suggest a feature

Use [Issues](https://github.com/jayelbotvibe-web/paceshelf/issues). For bugs, include
the app version, Android or Ubuntu/browser version, storage mode, expected result
and steps to reproduce. Use fictional video titles. Never attach personal libraries,
metadata backups, private paths, videos, credentials or unreviewed diagnostic logs.

For features, describe the user's task and why the existing workflow is insufficient.
Large new integrations should be discussed before implementation. Online providers
must not be loaded into the privileged local-player bridge.

## Build Android

Install JDK 17 and Android SDK 35, then use the checked-in Gradle wrapper:

```sh
./gradlew :app:assembleDebug :app:assembleAndroidTest :app:lintDebug
```

The debug APK is under `app/build/outputs/apk/debug/`. Use a local SDK configuration;
do not commit `local.properties`, keystores or signing credentials. Release builds
require an external key and a pinned certificate; see [publishing](PUBLISHING.md).

## Build Ubuntu

Requires Go 1.22 or newer. Create `dist` in the repository root, then from `desktop`:

```sh
go build -trimpath -o ../dist/paceshelf .
../dist/paceshelf -root /path/to/your/video-folder -addr 127.0.0.1:8378
```

Open the printed loopback URL. Use `-device-only` to avoid writing portable metadata
beside the videos. Run as a normal user. [Desktop details](desktop/README.md)
document flags and storage locations.

Build Ubuntu distribution packages from the repository root:

```sh
bash tools/package-desktop.sh
```

## Checks before a pull request

```sh
node --test tools/library-protocol.test.cjs tools/youtube.test.cjs
python3 tools/audit-public-source.py
python3 tools/audit-public-source.test.py
```

From `desktop`, also run `go test -race ./...` and `go vet ./...`. Use the
[test guide](TESTING.md) for Android and UI checks. Keep shared Android assets and
`desktop/static` synchronized when changing the interface.

The publication manifest is an exact allowlist. Review new files before adding
them; generated fixtures stay outside source publication. Documentation images
must use synthetic data, be reviewed visually and have their exact bytes pinned.
See [demo production](docs/DEMO.md) and [publishing safeguards](PUBLISHING.md).

Enable the local staged-content check:

```sh
git config core.hooksPath .githooks
```

Keep pull requests focused. Explain the user-visible change and relevant validation;
identify untested hardware or platform behavior rather than implying broad support.
