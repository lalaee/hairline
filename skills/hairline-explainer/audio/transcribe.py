"""Word-timed transcript of a narration, for timing scenes and subtitles to the voice.

    python3 -I transcribe.py voice.mp3 voice.json

Needs faster-whisper (pip install faster-whisper, in a venv) and ffmpeg. The model (small.en) downloads
on first use. Prints one line per segment and writes [{start, end, text, words: [[start, end, word]]}].

Whisper's word ends run early on soft endings ("less" loses its "ss"), so judge real gaps with
inspect.py, which reads the audio itself.
"""
import json
import subprocess
import sys

import numpy as np
from faster_whisper import WhisperModel

src, dst = sys.argv[1], sys.argv[2]
# decode with ffmpeg ourselves: faster-whisper's own decoder breaks on some PyAV versions
pcm = subprocess.run(["ffmpeg", "-loglevel", "error", "-i", src, "-ac", "1", "-ar", "16000", "-f", "f32le", "-"],
                     check=True, capture_output=True).stdout
audio = np.frombuffer(pcm, np.float32)
model = WhisperModel("small.en", device="cpu", compute_type="int8")
segments, _ = model.transcribe(audio, word_timestamps=True, vad_filter=False)
out = []
for s in segments:
    print(f"[{s.start:6.2f} – {s.end:6.2f}] {s.text.strip()}")
    out.append({"start": s.start, "end": s.end, "text": s.text.strip(), "words": [[w.start, w.end, w.word] for w in s.words]})
json.dump(out, open(dst, "w"), indent=1)
