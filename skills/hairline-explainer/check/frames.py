"""Checks on rendered frames and finished videos. Look at what these produce; do not just run them.

    python3 -I frames.py jumps FRAMES_DIR
        Mean change between consecutive frames, largest first. A hard cut shows as one frame far above its
        neighbours (it was 1.96 where the fades peak under 0.9). Look at the frames around every outlier.

    python3 -I frames.py sheet VIDEO OUT.png T[=label] ...
        One frame per time, labelled, in a grid: grab each frame at the moment a keyword is spoken and
        confirm its scene, headline and subtitle are up.

    python3 -I frames.py safe VIDEO OUT.png T ...
        For the 9:16 cut: shades the parts Reels / TikTok / Shorts cover with their own interface (top bar,
        the button column on the right, the caption at the bottom). Nothing that matters may sit in red.
"""
import glob
import os
import subprocess
import sys
import tempfile

import numpy as np
from PIL import Image, ImageDraw


def grab(video, t):
    path = os.path.join(tempfile.mkdtemp(), "f.png")
    subprocess.run(["ffmpeg", "-loglevel", "error", "-y", "-ss", str(t), "-i", video, "-frames:v", "1", path], check=True)
    return Image.open(path).convert("RGB")


def grid(images, cols, out):
    w, h = images[0].size
    rows = (len(images) + cols - 1) // cols
    o = Image.new("RGB", (cols * w + (cols - 1) * 10, rows * h + (rows - 1) * 10), (40, 40, 40))
    for k, im in enumerate(images):
        o.paste(im, ((k % cols) * (w + 10), (k // cols) * (h + 10)))
    o.save(out)
    print("wrote", out)


cmd = sys.argv[1]
if cmd == "jumps":
    prev, jumps = None, []
    for i, f in enumerate(sorted(glob.glob(os.path.join(sys.argv[2], "*.png")))):
        a = np.asarray(Image.open(f).convert("L").resize((320, 180)), dtype=float)
        if prev is not None:
            jumps.append((np.abs(a - prev).mean(), i / 30))
        prev = a
    for d, t in sorted(jumps, reverse=True)[:10]:
        print(f"{d:5.2f} at {t:6.2f} s (frame {round(t * 30)})")
elif cmd == "sheet":
    video, out, ims = sys.argv[2], sys.argv[3], []
    for spec in sys.argv[4:]:
        t, _, label = spec.partition("=")
        im = grab(video, float(t))
        im = im.resize((640, round(640 * im.height / im.width)))
        d = ImageDraw.Draw(im)
        d.rectangle([0, 0, 640, 18], fill=(255, 255, 255))
        d.text((6, 3), f"{t} s  {label}", fill=(220, 0, 0))
        ims.append(im)
    grid(ims, 3 if ims[0].width > ims[0].height else 4, out)
elif cmd == "safe":
    video, out, ims = sys.argv[2], sys.argv[3], []
    for t in sys.argv[4:]:
        im = grab(video, float(t)).convert("RGBA")
        W, H = im.size
        ov = Image.new("RGBA", im.size, (0, 0, 0, 0))
        d = ImageDraw.Draw(ov)
        # at 1080 x 1920: top ~200 px, bottom ~440 px, and a ~130 px button column on the right above the caption
        d.rectangle([0, 0, W, H * 200 // 1920], fill=(255, 0, 0, 50))
        d.rectangle([0, H - H * 440 // 1920, W, H], fill=(255, 0, 0, 50))
        d.rectangle([W - W * 130 // 1080, H * 1000 // 1920, W, H - H * 440 // 1920], fill=(255, 0, 0, 50))
        ims.append(Image.alpha_composite(im, ov).convert("RGB").resize((360, 640)))
    grid(ims, 4, out)
else:
    sys.exit(__doc__)
