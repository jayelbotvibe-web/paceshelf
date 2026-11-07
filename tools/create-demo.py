#!/usr/bin/env python3
"""Create original, silent sample videos for the public product walkthrough."""
import argparse
import math
from pathlib import Path
import shutil
import subprocess

from PIL import Image, ImageDraw, ImageFont


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=Path("dist/demo-work"))
    args = parser.parse_args()
    work = args.output.resolve()
    library = work / "Demo Library"
    if library.exists():
        raise SystemExit("Use a fresh output directory; existing demo data is preserved.")
    work.mkdir(parents=True, exist_ok=True)
    font_path = subprocess.check_output(
        ["fc-match", "-f", "%{file}", "DejaVu Sans"], text=True
    ).strip()
    regular = ImageFont.truetype(font_path, 22)
    heading = ImageFont.truetype(font_path, 38)
    small = ImageFont.truetype(font_path, 15)
    examples = [
        ("Photography Foundations", "01 - Getting started", [
            "01 - Understanding exposure", "02 - Finding the light",
            "03 - Composing your frame", "04 - Practice and review"],
         "Understanding exposure", ["APERTURE", "SHUTTER", "ISO"], "#6b8290"),
        ("Sketching Essentials", "01 - Your first sketches", [
            "01 - Lines and shapes", "02 - Light and shadow", "03 - Daily practice"],
         "Lines and shapes", ["OBSERVE", "SIMPLIFY", "REFINE"], "#9a8574"),
        ("Everyday Astronomy", "01 - Exploring the night sky", [
            "01 - Finding your bearings", "02 - Mapping the stars", "03 - The moon"],
         "Mapping the stars", ["LOOK", "LOCATE", "EXPLORE"], "#788391"),
    ]
    for number, (collection, section, lessons, title, labels, accent) in enumerate(examples):
        source = work / ("sample-" + str(number) + ".mp4")
        process = subprocess.Popen([
            "ffmpeg", "-y", "-hide_banner", "-loglevel", "error", "-f", "rawvideo",
            "-pixel_format", "rgb24", "-video_size", "960x540", "-framerate", "12",
            "-i", "pipe:0", "-an", "-c:v", "libx264", "-preset", "fast", "-crf", "24",
            "-pix_fmt", "yuv420p", "-movflags", "+faststart", "-map_metadata", "-1", str(source)
        ], stdin=subprocess.PIPE)
        for frame in range(60 * 12):
            image = Image.new("RGB", (960, 540), "#f2f3f5")
            draw = ImageDraw.Draw(image)
            draw.text((54, 34), "PACESHELF / FICTIONAL SAMPLE LESSON", font=small, fill="#65717c")
            draw.text((54, 80), collection, font=heading, fill="#27323c")
            draw.line((54, 145, 906, 145), fill="#dce1e6", width=2)
            points = [(480, 224), (305, 408), (655, 408)]
            draw.polygon(points, fill="#e5e9ed", outline="#cbd3da", width=3)
            phase = frame / 12 * .7
            for index, ((x, y), label) in enumerate(zip(points, labels)):
                radius = 43 + round(3 * math.sin(phase + index * 2))
                draw.ellipse((x-radius, y-radius, x+radius, y+radius), fill=accent)
                draw.ellipse((x-11, y-11, x+11, y+11), fill="#f5f7f8")
                label_y = y - 76 if index == 0 else y + 58
                draw.text((x, label_y), label, font=small, fill="#46525e", anchor="mm")
            draw.text((480, 346), "A little every day.", font=regular, fill="#46525e", anchor="mm")
            draw.line((54, 510, 906, 510), fill="#dce1e6", width=3)
            draw.line((54, 510, 54 + round(852 * frame / 719), 510), fill=accent, width=3)
            process.stdin.write(image.tobytes())
        process.stdin.close()
        if process.wait() != 0:
            raise SystemExit("Sample video encoding failed.")
        folder = library / collection / section
        folder.mkdir(parents=True)
        for lesson in lessons:
            shutil.copyfile(source, folder / (lesson + ".mp4"))
    print("Created 10 original sample lessons in Demo Library; no personal media was read.")


if __name__ == "__main__":
    main()
