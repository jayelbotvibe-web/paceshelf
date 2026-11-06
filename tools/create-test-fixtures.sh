#!/usr/bin/env bash
set -euo pipefail
project_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
fixtures="$project_dir/test-fixtures/Courses"
mp4="$fixtures/TEST101 - Offline Playback/Day 1"
webm="$fixtures/TEST202 - WebM Playback"
mkdir -p "$mp4" "$webm"
ffmpeg -y -hide_banner -loglevel error \
    -f lavfi -i 'testsrc2=size=640x360:rate=24:duration=60' \
    -f lavfi -i 'sine=frequency=440:sample_rate=48000:duration=60' \
    -c:v libx264 -preset ultrafast -pix_fmt yuv420p -c:a aac -movflags +faststart \
    -shortest "$mp4/Video 2.mp4"
cp "$mp4/Video 2.mp4" "$mp4/Video 10.mp4"
ffmpeg -y -hide_banner -loglevel error \
    -f lavfi -i 'testsrc2=size=320x180:rate=15:duration=12' \
    -f lavfi -i 'sine=frequency=550:sample_rate=48000:duration=12' \
    -c:v libvpx -deadline realtime -cpu-used 8 -b:v 150k -c:a libvorbis \
    -shortest "$webm/Video 1.webm"
echo "Test fixtures created in $fixtures"
