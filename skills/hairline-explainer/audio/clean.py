"""Repair a narration take: fill dead-silent gaps with room tone, and cut pauses that are too long.

    python3 -I clean.py voice.mp3 voice-clean.wav [--cut START:END ...]

1. Room tone. Every stretch of 0.1 s or more under RMS 6 (see inspect.py) gets room tone mixed in, faded over
   30 ms at each end. The tone is re-synthesised from the take's own quiet-but-live pauses (RMS 12–60): their
   averaged spectrum with random phase, at their level. So every pause sounds like the same room.
2. Cuts. Each --cut removes START–END seconds (times in the INPUT file), joined with a 15 ms crossfade. Keep
   ~0.1 s of the pause: a cut to zero sounds clipped. Cut only inside a pause; check it with inspect.py first.
   Everything after a cut moves earlier by its length, so re-time the video against the cleaned file.

It cannot fix intonation: a voice that drops in pitch mid-sentence still sounds like a full stop. That needs a
regenerated line (reword it so the tool cannot mis-phrase it).
"""
import argparse
import subprocess
import wave

import numpy as np

SR = 44100
ap = argparse.ArgumentParser()
ap.add_argument("src")
ap.add_argument("dst")
ap.add_argument("--cut", action="append", default=[], help="START:END in seconds of the input")
args = ap.parse_args()

pcm = subprocess.run(["ffmpeg", "-loglevel", "error", "-i", args.src, "-ac", "1", "-ar", str(SR), "-f", "s16le", "-"],
                     check=True, capture_output=True).stdout
a = np.frombuffer(pcm, np.int16).astype(float).copy()
rms = lambda x: np.sqrt((x ** 2).mean())
w = int(0.02 * SR)
r = np.array([rms(a[i:i + w]) for i in range(0, len(a) - w, w)])

N = 4096
quiet = [a[i * w:(i + 1) * w] for i in range(len(r)) if 12 < r[i] < 60]
buf = np.concatenate(quiet)
mags = np.mean([np.abs(np.fft.rfft(buf[k:k + N] * np.hanning(N))) for k in range(0, len(buf) - N, N // 2)], axis=0)
level = rms(buf)
rng = np.random.default_rng(7)


def tone(n):
    out = np.zeros(n + N)
    for k in range(0, n, N // 2):
        out[k:k + N] += np.fft.irfft(mags * np.exp(1j * rng.uniform(0, 2 * np.pi, len(mags))), N) * np.hanning(N)
    out = out[:n]
    return out / rms(out) * level


fills, i = [], 0
while i < len(r):
    if r[i] < 6:
        j = i
        while j < len(r) and r[j] < 6:
            j += 1
        if (j - i) * 0.02 >= 0.1:
            fills.append((i * w, j * w))
        i = j
    else:
        i += 1
f = int(0.03 * SR)
for s0, s1 in fills:
    s0, s1 = max(0, s0 - f), min(len(a), s1 + f)
    env = np.ones(s1 - s0)
    env[:f] = np.linspace(0, 1, f)
    env[-f:] = np.linspace(1, 0, f)
    a[s0:s1] += tone(s1 - s0) * env
print(f"filled {len(fills)} dead stretches with room tone (level {level:.1f})")

# cut from the end backwards, so every START:END stays in the input's own times
for c0, c1 in sorted((tuple(map(float, c.split(":"))) for c in args.cut), reverse=True):
    i0, i1, x = int(c0 * SR), int(c1 * SR), int(0.015 * SR)
    ramp = np.linspace(0, 1, x)
    a = np.concatenate([a[:i0 - x], a[i0 - x:i0] * (1 - ramp) + a[i1:i1 + x] * ramp, a[i1 + x:]])
    print(f"cut {c0:.2f}–{c1:.2f} s ({c1 - c0:.2f} s)")
with wave.open(args.dst, "wb") as o:
    o.setnchannels(1)
    o.setsampwidth(2)
    o.setframerate(SR)
    o.writeframes(np.clip(a, -32768, 32767).astype(np.int16).tobytes())
print(f"wrote {args.dst}: {len(a) / SR:.2f} s")
