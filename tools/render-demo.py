#!/usr/bin/env python3
"""Render the real-time screencast, explanatory text and reviewed documentation images."""
import argparse
import bisect
import hashlib
import json
from pathlib import Path
import subprocess

from PIL import Image, ImageDraw, ImageFont


def font(size):
    path = subprocess.check_output(
        ["fc-match", "-f", "%{file}", "DejaVu Sans"], text=True
    ).strip()
    return ImageFont.truetype(path, size)


def stamp(seconds):
    ms = round(seconds * 1000)
    return f"{ms//3600000:02}:{ms//60000%60:02}:{ms//1000%60:02}.{ms%1000:03}"


def strip(image, title, detail, label_font, detail_font):
    draw = ImageDraw.Draw(image)
    draw.rectangle((0, 800, 1280, 900), fill="#29333f")
    if draw.textlength(title, font=label_font) > 1180 or draw.textlength(detail, font=detail_font) > 1180:
        raise ValueError("Explanatory text is too wide; shorten the copy instead of clipping.")
    draw.text((40, 818), title, font=label_font, fill="#ffffff")
    draw.text((40, 858), detail, font=detail_font, fill="#dce3eb")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--work", type=Path, default=Path("dist/demo-work"))
    parser.add_argument("--assets", type=Path, default=Path("docs/assets"))
    args = parser.parse_args()
    timeline = json.loads((args.work / "timeline.json").read_text())
    assert (timeline["width"], timeline["height"]) == (1280, 800)
    frames, cues = timeline["frames"], timeline["cues"]
    times = [item["time"] for item in frames]
    duration = cues[-1]["end"]
    fps = 20
    label_font, detail_font = font(25), font(17)
    output = args.work / "PaceShelf-Walkthrough.mp4"
    process = subprocess.Popen([
        "ffmpeg", "-y", "-hide_banner", "-loglevel", "error", "-f", "rawvideo",
        "-pixel_format", "rgb24", "-video_size", "1280x900", "-framerate", str(fps),
        "-i", "pipe:0", "-an", "-c:v", "libx264", "-preset", "medium", "-crf", "21",
        "-pix_fmt", "yuv420p", "-color_primaries", "bt709", "-color_trc", "bt709",
        "-colorspace", "bt709", "-movflags", "+faststart", "-map_metadata", "-1", str(output)
    ], stdin=subprocess.PIPE)
    last = None
    source = None
    for n in range(round(duration * fps)):
        t = n / fps
        i = max(0, bisect.bisect_right(times, t) - 1)
        if i != last:
            with Image.open(args.work / "frames" / frames[i]["file"]) as opened:
                source = opened.convert("RGB")
            assert source.size == (1280, 800)
            last = i
        image = Image.new("RGB", (1280, 900), "#f6f7f9")
        image.paste(source, (0, 0))
        cue = next((cue for cue in cues if cue["start"] <= t < cue["end"]), cues[0])
        strip(image, cue["title"], cue["detail"], label_font, detail_font)
        process.stdin.write(image.tobytes())
    process.stdin.close()
    if process.wait() != 0:
        raise SystemExit("Walkthrough encoding failed.")
    # This is a descriptive text track for a silent demonstration, not invented speech.
    vtt = "WEBVTT\n\n" + "\n\n".join(
        stamp(cue["start"]) + " --> " + stamp(cue["end"]) + "\n" + cue["title"] + "\n" + cue["detail"]
        for cue in cues
    ) + "\n"
    (args.work / "PaceShelf-Walkthrough.vtt").write_text(vtt)
    args.assets.mkdir(parents=True, exist_ok=True)
    with Image.open(args.work / "library-desktop.png") as image:
        image.convert("RGB").save(args.assets / "library-desktop.webp", quality=88, method=6)
    poster = Image.new("RGB", (1280, 900), "#f6f7f9")
    with Image.open(args.work / "player-desktop.png") as image:
        poster.paste(image.convert("RGB"), (0, 0))
    strip(poster, "See PaceShelf in action", "A short walkthrough · Real app recording · Fictional sample library", label_font, detail_font)
    poster.save(args.assets / "walkthrough-poster.webp", quality=88, method=6)
    responsive = Image.new("RGB", (1280, 1000), "#eef0f3")
    draw = ImageDraw.Draw(responsive)
    draw.text((50, 34), "A familiar library, on a smaller screen.", font=font(32), fill="#29333f")
    for filename, xy, factor, label in [
        ("player-phone.png", (76, 154), .85, "Phone layout"),
        ("player-tablet.png", (520, 154), .68, "Tablet layout"),
    ]:
        with Image.open(args.work / filename) as image:
            image = image.convert("RGB")
            size = tuple(round(d * factor) for d in image.size)
            image = image.resize(size, Image.Resampling.LANCZOS)
            draw.rounded_rectangle((xy[0]-7, xy[1]-7, xy[0]+size[0]+7, xy[1]+size[1]+7), radius=17, fill="#ffffff", outline="#cdd4dd", width=2)
            responsive.paste(image, xy)
        draw.text((xy[0], 112), label, font=font(21), fill="#46525e")
    draw.text((50, 950), "Responsive browser previews · Fictional sample library · Not physical-device validation", font=font(18), fill="#5c6877")
    responsive.save(args.assets / "responsive-layouts.webp", quality=90, method=6)
    for file in [output, args.work / "PaceShelf-Walkthrough.vtt"]:
        digest = hashlib.sha256(file.read_bytes()).hexdigest()
        file.with_suffix(file.suffix + ".sha256").write_text(digest + "  " + file.name + "\n")
    report = {
        "duration_seconds": round(duration * fps) / fps,
        "video": {"dimensions": [1280, 900], "fps": fps, "codec": "H.264", "audio": "intentionally silent"},
        "source": "Actual PaceShelf 0.1.0 Ubuntu browser interface; capture timing preserved",
        "rights": "Original programmatic sample lessons and UI captures; MIT project, DejaVu font used for rendering",
        "privacy": "Isolated fictional library; no personal videos, paths, history or desktop chrome recorded",
        "images": {file.name: hashlib.sha256(file.read_bytes()).hexdigest() for file in sorted(args.assets.glob("*.webp"))},
    }
    (args.work / "render-report.json").write_text(json.dumps(report, indent=2) + "\n")
    print(f"Rendered {report['duration_seconds']:.2f} seconds, three documentation images and a descriptive text track.")


if __name__ == "__main__":
    main()
