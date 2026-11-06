#!/usr/bin/env bash
set -euo pipefail
package_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
app_dir="${XDG_DATA_HOME:-$HOME/.local/share}/paceshelf/app"
launcher_dir="${XDG_DATA_HOME:-$HOME/.local/share}/applications"
mkdir -p -- "$app_dir" "$launcher_dir"
for name in paceshelf paceshelf-arm64 start.sh paceshelf.svg; do
 if [[ -f "$package_dir/$name" && "$package_dir/$name" != "$app_dir/$name" ]];then cp -- "$package_dir/$name" "$app_dir/$name";fi
done
chmod 700 -- "$app_dir/start.sh" "$app_dir/paceshelf" "$app_dir/paceshelf-arm64"
python3 - "$app_dir" "$launcher_dir/paceshelf.desktop" <<'PY'
from pathlib import Path
import sys
app=Path(sys.argv[1]);dest=Path(sys.argv[2])
def quote(v):
 if '\n' in v or '\r' in v: raise SystemExit('Unsupported installation path')
 return '"'+v.replace('\\','\\\\').replace('"','\\"').replace('`','\\`').replace('$','\\$').replace('%','%%')+'"'
dest.write_text('[Desktop Entry]\nType=Application\nName=PaceShelf\nComment=Your learning library. Your pace.\nExec='+quote(str(app/'start.sh'))+'\nIcon='+str(app/'paceshelf.svg')+'\nTerminal=false\nCategories=AudioVideo;Education;\n')
PY
if command -v zenity >/dev/null;then zenity --info --title=PaceShelf --text='PaceShelf is installed. Open PaceShelf from your applications menu, then choose a video folder.';else echo 'PaceShelf installed. Open it from your applications menu.';fi
