#!/usr/bin/env bash
set -euo pipefail
project_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$project_dir"
python3 tools/audit-public-source.py
package_dir="$project_dir/dist/PaceShelf-Ubuntu-0.2.1-preview"
mkdir -p -- "$package_dir"
(cd desktop && CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -trimpath -ldflags='-s -w' -o "$package_dir/paceshelf" .)
(cd desktop && CGO_ENABLED=0 GOOS=linux GOARCH=arm64 go build -trimpath -ldflags='-s -w' -o "$package_dir/paceshelf-arm64" .)
cp -- desktop/start.sh desktop/install.sh desktop/paceshelf.svg "$package_dir/"
cp -- README.md LICENSE THIRD-PARTY-NOTICES.md CONTRIBUTING.md TESTING.md VERIFICATION.md PUBLISHING.md CHANGES.md "$package_dir/"
mkdir -p "$package_dir/docs/assets"
cp -- docs/*.md "$package_dir/docs/"
cp -- docs/assets/*.webp "$package_dir/docs/assets/"
mkdir -p "$package_dir/licenses"
cp licenses/Go-BSD-3-Clause.txt "$package_dir/licenses/"
cp desktop/static/fonts/OFL.txt "$package_dir/licenses/Inter-OFL.txt"
chmod 755 "$package_dir/start.sh" "$package_dir/install.sh" "$package_dir/paceshelf" "$package_dir/paceshelf-arm64"
tar --sort=name --mtime='UTC 2020-01-01' --owner=0 --group=0 --numeric-owner -czf dist/PaceShelf-Ubuntu-0.2.1-preview.tar.gz -C dist PaceShelf-Ubuntu-0.2.1-preview
(cd dist && sha256sum PaceShelf-Ubuntu-0.2.1-preview.tar.gz > PaceShelf-Ubuntu-0.2.1-preview.tar.gz.sha256)

if command -v dpkg-deb >/dev/null;then
 for arch in amd64 arm64;do
  deb_dir="$project_dir/dist/deb-$arch"
  mkdir -p "$deb_dir/DEBIAN" "$deb_dir/usr/lib/paceshelf" "$deb_dir/usr/share/applications" "$deb_dir/usr/share/icons/hicolor/scalable/apps" "$deb_dir/usr/share/doc/paceshelf"
  binary=paceshelf; [[ "$arch" == arm64 ]] && binary=paceshelf-arm64
  cp "$package_dir/$binary" "$package_dir/start.sh" "$deb_dir/usr/lib/paceshelf/"
  cp desktop/paceshelf.svg "$deb_dir/usr/share/icons/hicolor/scalable/apps/paceshelf.svg"
  cp LICENSE "$deb_dir/usr/share/doc/paceshelf/copyright"
  cp THIRD-PARTY-NOTICES.md licenses/Go-BSD-3-Clause.txt "$deb_dir/usr/share/doc/paceshelf/"
  cp README.md "$deb_dir/usr/share/doc/paceshelf/"
  cp -R "$package_dir/docs" "$deb_dir/usr/share/doc/paceshelf/"
  cp desktop/static/fonts/OFL.txt "$deb_dir/usr/share/doc/paceshelf/Inter-OFL.txt"
  cat > "$deb_dir/DEBIAN/control" <<EOF
Package: paceshelf
Version: 0.2.1~preview1
Architecture: $arch
Maintainer: PaceShelf contributors
Section: video
Priority: optional
Depends: bash, curl, python3, zenity, xdg-utils, util-linux
Recommends: ffmpeg
Description: Personal offline video learning library
 Organize personal video collections and keep portable learning progress.
EOF
  cat > "$deb_dir/usr/share/applications/paceshelf.desktop" <<'EOF'
[Desktop Entry]
Type=Application
Name=PaceShelf
Comment=Your learning library. Your pace.
Exec=/usr/lib/paceshelf/start.sh
Icon=paceshelf
Terminal=false
Categories=AudioVideo;Education;
EOF
  chmod 755 "$deb_dir/usr/lib/paceshelf/"*
  dpkg-deb --root-owner-group --build "$deb_dir" "dist/paceshelf_0.2.1-preview1_$arch.deb"
  (cd dist && sha256sum "paceshelf_0.2.1-preview1_$arch.deb" > "paceshelf_0.2.1-preview1_$arch.deb.sha256")
 done
fi
