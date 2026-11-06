#!/usr/bin/env bash
set -euo pipefail

project_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
: "${ANDROID_HOME:?Set ANDROID_HOME to your Android SDK directory.}"
: "${PACESHELF_RELEASE_KEYSTORE:?Select an external public-release keystore.}"
: "${PACESHELF_RELEASE_PASSWORD_FILE:?Select an external password file.}"
: "${PACESHELF_RELEASE_CERT_SHA256:?Set the expected public release certificate SHA-256.}"
key_alias="${PACESHELF_RELEASE_KEY_ALIAS:-paceshelf}"
build_tools="$ANDROID_HOME/build-tools/35.0.0"
for file in "$PACESHELF_RELEASE_KEYSTORE" "$PACESHELF_RELEASE_PASSWORD_FILE"; do
    [[ -f "$file" ]] || { echo 'Required external signing file is unavailable.' >&2; exit 1; }
    case "$(realpath "$file")" in
        "$project_dir"/*) echo 'Keep signing files outside the source checkout.' >&2; exit 1 ;;
    esac
done
cd "$project_dir"
python3 tools/audit-public-source.py
./gradlew --no-daemon :app:assembleRelease :app:lintRelease
mkdir -p dist
version_name="$(python3 -c 'import json; print(json.load(open("app/build/outputs/apk/release/output-metadata.json"))["elements"][0]["versionName"])')"
release_apk="dist/PaceShelf-$version_name.apk"
"$build_tools/zipalign" -f -P 16 4 app/build/outputs/apk/release/app-release-unsigned.apk dist/aligned.apk
"$build_tools/apksigner" sign --ks "$PACESHELF_RELEASE_KEYSTORE" --ks-key-alias "$key_alias" \
    --ks-pass "file:$PACESHELF_RELEASE_PASSWORD_FILE" --v4-signing-enabled false \
    --out dist/release-candidate.apk dist/aligned.apk
rm dist/aligned.apk
certificate_digest="$("$build_tools/apksigner" verify --print-certs dist/release-candidate.apk | sed -n 's/^Signer #1 certificate SHA-256 digest: //p')"
expected_digest="$(printf '%s' "$PACESHELF_RELEASE_CERT_SHA256" | tr -d ':' | tr '[:upper:]' '[:lower:]')"
if [[ ! "$expected_digest" =~ ^[0-9a-f]{64}$ || "$certificate_digest" != "$expected_digest" ]]; then
 rm -f dist/release-candidate.apk
 echo 'Release rejected: signing certificate differs from the pinned publisher identity.' >&2
 exit 1
fi
mv dist/release-candidate.apk "$release_apk"
"$build_tools/apksigner" verify --verbose "$release_apk"
sha256sum "$release_apk" > dist/SHA256SUMS
echo "Release built. Audit the generated APK separately before publication: $release_apk"

