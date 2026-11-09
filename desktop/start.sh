#!/usr/bin/env bash
set -euo pipefail
player_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
fail() { if command -v zenity >/dev/null; then zenity --error --title=PaceShelf --text="$1" || true; else echo "$1" >&2; fi; exit 1; }
# The optional argument selects a library directly, including paths with spaces.
# Otherwise use the system folder dialog. No terminal is needed after installation.
library_root="${1:-}"
if [[ -z "$library_root" ]]; then
 command -v zenity >/dev/null || fail 'Install zenity for the folder picker, or pass a library folder to start.sh.'
 library_root="$(zenity --file-selection --directory --title='PaceShelf — Choose your video library')" || exit 0
fi
[[ -d "$library_root" ]] || fail 'Connect your drive and select an available video folder.'
library_root="$(realpath -- "$library_root")"
case "$(uname -m)" in
 x86_64) player_binary="$player_dir/paceshelf" ;;
 aarch64|arm64) player_binary="$player_dir/paceshelf-arm64" ;;
 *) fail 'This build supports Ubuntu on x86_64 or ARM64.' ;;
esac
[[ -x "$player_binary" ]] || fail 'The PaceShelf executable is missing. Extract the complete Ubuntu package first.'
library_key="$(printf '%s' "$library_root" | sha256sum | cut -c1-16)"
runtime_dir="${XDG_CACHE_HOME:-$HOME/.cache}/paceshelf-runtime/$library_key"
mkdir -p -- "$runtime_dir"; chmod 700 -- "$runtime_dir"
exec 8>"$runtime_dir/launch.lock"
flock -x 8
status_file="$runtime_dir/status.json"
# Reuse only a verified PaceShelf instance for this exact library.
if [[ -f "$runtime_dir/address" ]]; then
 player_addr="$(cat "$runtime_dir/address")"
 if [[ "$player_addr" =~ ^127\.0\.0\.1:[0-9]+$ ]] && curl --fail --silent --max-time 2 "http://$player_addr/api/status" > "$status_file"; then
  if python3 - "$status_file" "$library_root" <<'PY'
import json,sys
try:
 s=json.load(open(sys.argv[1]));ok=s.get('protocol')==3 and s.get('version')=='0.2.1' and s.get('root')==sys.argv[2] and s.get('ready')
except Exception:ok=False
sys.exit(0 if ok else 1)
PY
  then
   xdg-open "http://$player_addr" >/dev/null 2>&1 8>&- || true
   exit 0
  fi
 fi
fi
# Select a free loopback port; the server still validates the actual bind.
player_port="$(python3 - <<'PY'
import socket
with socket.socket() as s:
 s.bind(('127.0.0.1',0));print(s.getsockname()[1])
PY
)"
player_addr="127.0.0.1:$player_port";player_url="http://$player_addr"
printf '%s' "$player_addr" > "$runtime_dir/address"
# Run from local storage so the executable does not hold a removable drive busy.
cp -- "$player_binary" "$runtime_dir/player.new";chmod 700 -- "$runtime_dir/player.new";mv -f -- "$runtime_dir/player.new" "$runtime_dir/player"
player_launcher_pid=$$
(
 for attempt in {1..150};do
  if curl --fail --silent --max-time 1 "$player_url/api/status" > /dev/null;then
   flock -u 8;exec 8>&-
   xdg-open "$player_url" >/dev/null 2>&1 || true;exit 0
  fi
  if ! kill -0 "$player_launcher_pid" 2>/dev/null;then exit 1;fi
  sleep .1
 done
 flock -u 8
) &
cd -- "$runtime_dir"
exec "$runtime_dir/player" -root "$library_root" -addr "$player_addr" >> "$runtime_dir/player.log" 2>&1 8>&-
