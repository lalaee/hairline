---
name: hairline-explainer
description: Use when someone wants an explainer video (or GIF) made from a Hairline figure, such as a product teardown, "how X works" or a narrated walkthrough, or wants the iPhone Duo explainer in assets/ rebuilt, re-timed to a new voice-over or cut for Reels/TikTok/Shorts. Renders the figure frame by frame on the repo's virtual clock, adds diagrams, subtitles and a music bed, and muxes MP4s in 16:9 and 9:16.
argument-hint: "[subject] [narration.mp3]"
---

# Hairline: explainer videos

This skill turns a Hairline figure into a narrated explainer video. The reference result is `assets/iphone-duo-narrated.mp4` (16:9) and `assets/iphone-duo-reels.mp4` (9:16), each also as `-voice-only.mp4` without the music bed: a 56-second explainer of how the iPhone Duo's glass folds, with a voice-over, timed scenes, subtitles and a music bed. Everything here rebuilds those two files exactly, and is the starting point for the next video.

Every path below is relative to this folder. Frames and bundles go to a temp folder, never the repo. Only finished videos go in `assets/`.

| File | What it is |
| --- | --- |
| `figure/duo.ts` | The iPhone Duo figure: two halves on a hinge that fold 0–180° with the pointer's x, come apart into five layers past flat, and pick a layer with y. Built on `packages/hairline/src/core` (camera, springs, pointer, stylesheet), plus a small per-face painter for the hinged halves. Has a `glare` option: a band of light across the open display. |
| `render/page.html` | The page one frame is drawn on: the figure, the side-on diagrams (layer stack, thick vs thin glass, paperback vs glued stack, glass fiber), headline panel, subtitles and cursor. `?v` switches to the 9:16 layout. |
| `render/render.mjs` | Owns time. Freezes the page on the repo's virtual clock, sets each frame's state, moves the real pointer, screenshots, and muxes. The **scene script** (marked) is this video's timing. |
| `audio/transcribe.py` | Word-timed transcript (faster-whisper). |
| `audio/inspect.py` | Finds what is wrong with a take: dead-silent gaps, pace, pauses inside sentences. |
| `audio/clean.py` | Fills dead gaps with the take's own room tone; cuts over-long pauses. |
| `audio/anchors.py` | Matches two takes' words and prints the `WARP` table that re-times the video to the new take. |
| `audio/music.py` | An original music bed (pad, plucked arpeggio, sub bass), ducked under the voice, and the final mix. |
| `check/frames.py` | Hard-cut detection, keyword sync sheets, and the 9:16 safe-zone overlay. |
| `example/narration-paced.mp3` | The voice-over the final videos use (as supplied, before cleaning). |
| `example/timeline-words.json` | Word timings of the first take, which the scene script is timed in. |

## Setup

```sh
pnpm install                                   # repo deps: esbuild, @playwright/test
python3 -m venv /tmp/stt && /tmp/stt/bin/pip install faster-whisper numpy pillow
```

You also need `ffmpeg` (with libx264) and Chromium. `render.mjs` uses `$CHROMIUM`, else `/opt/pw-browsers/chromium` if present, else Playwright's own. Do not run `playwright install` where browsers are preinstalled. Run the Python scripts with `-I`, from the venv when they need faster-whisper.

## Rebuild the reference videos exactly

```sh
cd skills/hairline-explainer
W=$(mktemp -d)
python3 -I audio/clean.py example/narration-paced.mp3 $W/voice.wav --cut 11.60:11.90 --cut 16.05:16.69
python3 -I audio/music.py $W/voice.wav $W/mix.wav 54.75          # last arg: when the final chord lands ("Engineered")
node render/render.mjs        --audio=$W/mix.wav --out=../../assets/iphone-duo-narrated.mp4
node render/render.mjs --vert --audio=$W/mix.wav --out=../../assets/iphone-duo-reels.mp4
# the same pictures without the music bed: swap the soundtrack, padded to the video's full length
for v in narrated reels; do
  ffmpeg -y -i ../../assets/iphone-duo-$v.mp4 -i $W/voice.wav -map 0:v -map 1:a -c:v copy \
    -af apad -c:a aac -b:a 192k -ac 2 -t 56.266667 -movflags +faststart ../../assets/iphone-duo-$v-voice-only.mp4
done
```

Each render takes a few minutes, one screenshot per frame. `--only=3,9.5,27` renders just those seconds, which is how to preview.

## Making a new one

Work in this order. Show the person something after each of steps 2, 4, 6 and 8, and let them redirect early. Most of what went wrong on the reference video was caught by the person looking, not by a test.

### 1. Facts first

When the subject is a real product, find the primary source (the maker's announcement) and one or two good write-ups before writing a word. Every number and claim on screen must come from them. Say in captions only what the sources say. Your drawing is not a fact: "the board sits beside the left battery" describes your illustration, not the product. Put "Illustration, not to scale" on screen. Cite the sources in your reply.

If the person names a product you don't know, search before saying it doesn't exist. "iPhone Duo" looked made-up, and it was real.

### 2. The figure

Use an existing figure in `packages/hairline/src/figures/` when one fits. Otherwise write one, as `figure/duo.ts` does: import the core, draw in the 400 × 320 viewBox, use the pointer for the gestures and springs for the motion, and report state through a callback. Check the poses before any video: screenshot it at four to eight pointer positions and look at the sheet. On the Duo, the sheet caught a figure drawn too small, display outlines too faint to see, and a pick that always landed on one layer because the pointer's y did two jobs. Split the gestures: x unfolds the phone and, past flat, takes it apart; y picks a layer.

### 3. The voice

The person usually brings the narration from a text-to-speech tool. Inspect every take before cutting anything to it:

```sh
/tmp/stt/bin/python -I audio/transcribe.py take.mp3 take.json
python3 -I audio/inspect.py take.mp3 take.json
```

- **Dead-silent gaps** are the most common fault. The tool stitches sentences, or "paces" a take, with near-digital silence, which sounds like the audio dropping out. Scan for near-zero, not exact zero: these gaps are dithered. Every take on the reference video had them. Fix them with `clean.py`, which fills them with room tone.
- **A pause inside a sentence** ("the thinner the glass, the less | a bend stresses it"). Cut it with `clean.py --cut`, keeping about 0.1 s. A cut cannot fix the falling pitch, though; only a regenerated line can. `inspect.py` flags gaps after words without a full stop, but it misses this one: the voice's pitch falls on "less", so the transcriber hears a full stop too. Read the transcript against the script and listen for such breaks; the person caught this one.
- **Pace:** about 140–160 words per minute reads well. 169 felt rushed.

When the person asks what is wrong with the delivery, measure first, then answer with the measurements. The faults usually trace back to the script, so suggest rewrites the tool cannot mis-phrase:
- Spell out numbers: "a two-thousand-dollar iPhone", not "$1,999", which took 3 s to say.
- Avoid clauses that read as complete sentences ("the less" read as an ending).
- Signpost the structure: first, second, third.
- Keep each explanation next to what it explains.
- Use full stops for a deliberate beat: "Not magic. Engineered."

### 4. Timing

Transcribe the cleaned voice. Its word times are the clock: every headline, subtitle, pointer move and diagram motion is a time in it. When a new take of the same script arrives, don't re-time by hand. Run `anchors.py old.json new.json`, put the printed `WARP` into `render.mjs`, and every cue follows its word. Clean first, then transcribe the cleaned file: cuts move everything after them. Whisper's word starts can drift by about 0.2 s between runs. That's fine for scene cues; where a cut must be exact (a pause boundary for `--cut`), read the loudness envelope of the audio itself, in 30 ms windows.

### 5. The scene script

The marked block in `render.mjs`. For a new video, rewrite it; the machinery around it stays.
- **One picture per spoken idea.** The figure shows the product. A side-on diagram shows the physics the figure can't (`render/page.html`'s `draw*` functions are line drawings in the same palette). Each one changes on the word that introduces it.
- **Headlines:** a short kicker and a headline per idea. **Never use a middle dot or a number in a label**: "Thickness", not "1 · Thickness". The person required this.
- **Subtitles** are word for word with the voice. Two back-to-back lines need a gap, or the text swaps in a single frame.
- **Transitions are never cuts.** Between diagrams, use a 0.7 s hand-over inside the narrator's pause: the old one fades out drifting up, then the new one fades in. Run them in sequence: two crossed line drawings look tangled. Between the figure and a diagram, cross-fade over 0.6 s. Set a diagram before the figure hands over to it, so the fade-in never shows the previous one.
- **Drive the figure with the real pointer** (`PTR`), so what it does is its own behaviour.

### 6. Preview, then look

Render 8–12 seconds at the key words with `--only`, make a contact sheet, and read it before the full render. Then, after it:

```sh
python3 -I check/frames.py jumps $TMPDIR/hairline-explainer-wide/frames       # hard cuts
python3 -I check/frames.py sheet video.mp4 sync.png 9.0="ten layers" 12.4="First, thickness" ...
```

On the reference video, `jumps` found two cuts nobody had spotted yet: subtitles swapping in one frame, and a stale diagram flashing during a figure-to-diagram fade. The largest jump should be ordinary motion, under about 1.0 here; look at the frames around every outlier.

### 7. Music

`music.py voice.wav mix.wav END` writes an original bed and the mix. It sits about 21 dB under the voice while she speaks and about 17 dB under in pauses, fades in over 1.5 s and out over 2.2 s, and resolves on the chord at END (the last word). Don't use music you can't license; the person can supply their own track, and keep the ducking. You can't hear the mix, so check it by measurement: re-transcribe the mix and confirm every word still comes through, and check the bed's level across the whole video. Say plainly that you checked by measurement.

### 8. 16:9 and 9:16

`--vert` renders the same timeline in `page.html`'s vertical layout: laid out at 540 × 960, captured at 2× for 1080 × 1920, so hairlines stay legible on a phone. Reels, TikTok and Shorts cover the top bar, a button column on the right and the caption at the bottom. Check every scene with `frames.py safe`. On the reference video, the glued stack reached into the button column and the "10+ layers" label was clipped; both were fixed by moving the drawing inward when `V` is set. Clear the button column with equal margins on both sides, not by shifting things left: subtitles and diagrams stay on the frame's centre line. An off-centre subtitle was the next thing the person noticed. Subtitles in 9:16 are big (23 px at 540 wide, 46 px in the video) and three lines at most: split a longer line at its pause into chunks of its own, timed to the words (`if (VERT) SUBS.splice(...)` in `render.mjs`), and keep the picture clear of the tallest chunk.

### 9. Deliver

Finished videos go to `assets/`, committed and pushed. Never commit scratch frames, crops or check sheets; write them to the temp folder. Tell the person what changed, what you verified and how, and what you could not verify, such as how the mix sounds.

## Simpler cuts

- **An animated GIF of a figure** (`assets/phone.gif`): the same virtual clock and a scripted pointer path. Render ~290 frames at 30 fps, then encode with a palette: `ffmpeg -framerate 30 -i %04d.png -vf "crop=…,scale=360:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=32:stats_mode=diff[p];[b][p]paletteuse=dither=none" -loop 0 out.gif`. Move the pointer fully off the stage to end on the rest pose, so the loop is seamless.
- **A captions-only explainer** (`assets/phone-explainer.mp4`, `assets/iphone-duo-explainer.mp4`): the same page structure, but with no voice. The scene durations are fixed and the captions carry the explanation.
