"""What is wrong with a narration take, before any video is cut to it.

    python3 -I inspect.py voice.mp3 [voice.json]

Reports, from the audio itself:
  - dead silence: stretches of 0.1 s or more under RMS 6 (of 32768). Real pauses carry room tone (RMS ~20–60);
    a drop to near-zero reads as a dropout. Text-to-speech tools insert these when they stitch sentences or
    "pace" a take. Check near-zero, not exact zero: these are dithered, so an exact-zero scan misses them.
  - the quiet floor between words, against speech level.
And, given the transcript (transcribe.py):
  - pace in words per minute (an explainer reads well at ~140–160);
  - the longest gaps between words, so a pause in the middle of a sentence shows up ("the less | a bend").
"""
import json
import subprocess
import sys

import numpy as np

SR = 44100
pcm = subprocess.run(["ffmpeg", "-loglevel", "error", "-i", sys.argv[1], "-ac", "1", "-ar", str(SR), "-f", "s16le", "-"],
                     check=True, capture_output=True).stdout
a = np.frombuffer(pcm, np.int16).astype(float)
w = int(0.02 * SR)
r = np.array([np.sqrt((a[i:i + w] ** 2).mean()) for i in range(0, len(a) - w, w)])
print(f"duration {len(a) / SR:.2f} s; speech RMS {np.sqrt((a ** 2).mean()):.0f}")

dead, i = [], 0
while i < len(r):
    if r[i] < 6:
        j = i
        while j < len(r) and r[j] < 6:
            j += 1
        if (j - i) * 0.02 >= 0.1:
            dead.append((i * 0.02, j * 0.02))
        i = j
    else:
        i += 1
# leading and trailing silence are fine; only gaps between words matter
dead = [d for d in dead if d[0] > 0.3 and d[1] < len(a) / SR - 0.3]
print(f"dead-silent gaps: {len(dead)}" + ("" if dead else "  (clean)"))
for s, e in dead:
    print(f"  {s:6.2f}–{e:6.2f} s  ({e - s:.2f} s)")
inner = r[int(0.5 / 0.02):int((len(a) / SR - 0.5) / 0.02)]
print(f"quietest 20 ms between words: RMS {inner.min():.1f}")

if len(sys.argv) > 2:
    W = [x for s in json.load(open(sys.argv[2])) for x in s["words"]]
    print(f"{len(W)} words in {W[-1][1]:.1f} s = {len(W) / W[-1][1] * 60:.0f} wpm")
    gaps = sorted(((W[k + 1][0] - W[k][1], W[k][1], W[k][2].strip(), W[k + 1][2].strip()) for k in range(len(W) - 1)), reverse=True)
    print("longest gaps (a gap after a word with no full stop is a pause inside a sentence):")
    for g, t, x, y in gaps[:14]:
        flag = "" if x[-1:] in ".?!" else "   <- mid-sentence"
        print(f"  {g:4.2f} s at {t:6.2f}  \"{x} | {y}\"{flag}")
