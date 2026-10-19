"""A quiet music bed under the narration, and the final mix.

Usage: python3 -I music.py voice.wav out.wav end_chord_at_seconds

Pad + plucked arpeggio + sub bass in D major, 84 BPM, two bars per chord,
through a synthetic room reverb. The bed ducks under the voice (an envelope
follower on the narration) and resolves to D on the last word.
"""
import sys, wave
import numpy as np

SR = 44100
rng = np.random.default_rng(3)


def read(path):
    with wave.open(path) as w:
        x = np.frombuffer(w.readframes(w.getnframes()), np.int16).astype(float) / 32768
        return x.reshape(-1, w.getnchannels()).mean(axis=1)


voice = read(sys.argv[1])
END_CHORD = float(sys.argv[3])
N = len(voice) + int(0.6 * SR)
T = np.arange(N) / SR

midi = lambda m: 440 * 2 ** ((m - 69) / 12)
BEAT = 60 / 84
BAR = 4 * BEAT
# Dmaj9, Bm9, Gmaj7, A(sus4→3): voicings as MIDI notes, root first
PROG = [[50, 57, 61, 64, 66], [47, 54, 57, 61, 62], [43, 55, 59, 62, 66], [45, 52, 57, 61, 64]]
D_FINAL = [50, 57, 62, 66, 69]


def onepole(x, fc):
    a = np.exp(-2 * np.pi * fc / SR)
    y = np.empty_like(x)
    acc = 0.0
    # vectorised enough for a minute of audio: process in blocks with lfilter-like recursion
    for i in range(len(x)):
        acc = (1 - a) * x[i] + a * acc
        y[i] = acc
    return y


def env(n, att, rel):
    e = np.ones(n)
    a, r = int(att * SR), int(rel * SR)
    e[:a] = np.linspace(0, 1, a) ** 2
    e[-r:] *= np.linspace(1, 0, r) ** 2
    return e


L = np.zeros(N)
R = np.zeros(N)

# chord timeline: two bars each until the final chord, which lands on the last word
chords = []
t = 0.0
i = 0
while t + 2 * BAR <= END_CHORD + 0.01:
    chords.append((t, t + 2 * BAR, PROG[i % 4]))
    t += 2 * BAR
    i += 1
if chords:
    s, _, c = chords[-1]
    chords[-1] = (s, END_CHORD, c)
chords.append((END_CHORD, N / SR, D_FINAL))

for k, (t0, t1, notes) in enumerate(chords):
    final = k == len(chords) - 1
    i0 = int(t0 * SR)
    n = int((t1 - t0 + 1.6) * SR)  # each chord rings 1.6 s into the next
    n = min(n, N - i0)
    tt = np.arange(n) / SR
    e = env(n, 1.4 if not final else 0.4, 1.8 if not final else (N / SR - t0) * 0.9)
    # pad: two slightly detuned partial stacks per note, panned apart
    for j, m in enumerate(notes[1:]):
        f = midi(m + 12 if m < 55 else m)
        for det, side in ((-3.5, L), (3.5, R)):
            ff = f * 2 ** (det / 1200)
            ph = rng.uniform(0, 2 * np.pi)
            tone = np.sin(2 * np.pi * ff * tt + ph) + 0.18 * np.sin(4 * np.pi * ff * tt + ph) + 0.06 * np.sin(6 * np.pi * ff * tt + ph)
            side[i0:i0 + n] += 0.045 * tone * e
    # sub bass on the root
    fb = midi(notes[0] - 12)
    sub = np.sin(2 * np.pi * fb * tt) * e * 0.10
    L[i0:i0 + n] += sub
    R[i0:i0 + n] += sub
    # plucked arpeggio in eighths, after the opening question and before the final chord
    if not final:
        steps = int((t1 - t0) / (BEAT / 2))
        pattern = [notes[1], notes[2], notes[3], notes[4], notes[3], notes[2], notes[4], notes[3]]
        for s in range(steps):
            ts = t0 + s * BEAT / 2
            if ts < 6.4:
                continue
            m = pattern[s % len(pattern)] + 12
            f = midi(m)
            ln = int(0.9 * SR)
            j0 = int(ts * SR)
            if j0 + ln > N:
                continue
            u = np.arange(ln) / SR
            pl = (np.sin(2 * np.pi * f * u) + 0.3 * np.sin(4 * np.pi * f * u) * np.exp(-u * 9)) * np.exp(-u * 5.5)
            pl[: int(0.004 * SR)] *= np.linspace(0, 1, int(0.004 * SR))
            pan = 0.5 + 0.3 * np.sin(s * 0.9)
            vel = 0.020 * (1.0 if s % 2 == 0 else 0.75)
            L[j0:j0 + ln] += pl * vel * (1 - pan) * 2
            R[j0:j0 + ln] += pl * vel * pan * 2

# soften the top end, then a synthetic room: exponentially decaying noise, 2.4 s
L, R = onepole(L, 3200), onepole(R, 3200)
ir_n = int(2.4 * SR)
decay = np.exp(-np.arange(ir_n) / SR * 3.2)
irL = rng.standard_normal(ir_n) * decay
irR = rng.standard_normal(ir_n) * decay
irL /= np.sqrt((irL ** 2).sum())
irR /= np.sqrt((irR ** 2).sum())
fft_n = 1 << int(np.ceil(np.log2(N + ir_n)))
wetL = np.fft.irfft(np.fft.rfft(L, fft_n) * np.fft.rfft(irL, fft_n), fft_n)[:N]
wetR = np.fft.irfft(np.fft.rfft(R, fft_n) * np.fft.rfft(irR, fft_n), fft_n)[:N]
L, R = 0.7 * L + 0.45 * wetL, 0.7 * R + 0.45 * wetR

# level: the bed sits about 22 dB under the voice while she speaks, 16 dB under in the pauses
rms = lambda x: np.sqrt((x ** 2).mean())
v = np.zeros(N)
v[: len(voice)] = voice
speech_rms = rms(voice[np.abs(voice) > 0.02]) if np.any(np.abs(voice) > 0.02) else rms(voice)
music_rms = rms(np.concatenate([L, R]))
base = speech_rms * 10 ** (-16 / 20) / music_rms
# envelope follower on the voice: 20 ms windows, 60 ms attack, 450 ms release
w = int(0.02 * SR)
lev = np.array([rms(v[i:i + w]) for i in range(0, N, w)])
active = np.clip((lev - 0.004) / 0.02, 0, 1)
sm = np.zeros_like(active)
acc = 0.0
for i, a in enumerate(active):
    k = 0.02 / 0.06 if a > acc else 0.02 / 0.45
    acc += (a - acc) * min(1, k)
    sm[i] = acc
duck = np.repeat(1 - sm * (1 - 10 ** (-6 / 20)), w)[:N]
# fade in over the first 1.5 s, fade out over the last 2.2 s
fade = np.ones(N)
fi, fo = int(1.5 * SR), int(2.2 * SR)
fade[:fi] = np.linspace(0, 1, fi) ** 2
fade[-fo:] = np.linspace(1, 0, fo) ** 1.5
g = base * duck * fade
outL, outR = v + L * g, v + R * g
peak = max(np.abs(outL).max(), np.abs(outR).max())
if peak > 0.97:
    outL, outR = outL * 0.97 / peak, outR * 0.97 / peak
on = sm.repeat(w)[:N] > 0.5
print(f"bed vs voice: {20*np.log10(rms((L*g)[on])/speech_rms):.1f} dB while speaking, {20*np.log10(rms((L*g)[~on & (fade > 0.99)])/speech_rms):.1f} dB in pauses; peak {peak:.2f}")
with wave.open(sys.argv[2], "wb") as o:
    o.setnchannels(2)
    o.setsampwidth(2)
    o.setframerate(SR)
    o.writeframes((np.stack([outL, outR], 1) * 32767).astype(np.int16).tobytes())
