"""Re-time a video to a new take of the same script: match words between two transcripts and print WARP.

    python3 -I anchors.py timeline.json new-take.json

timeline.json is the transcript of the take the scene script is timed in (the video's own clock); new-take.json
is the transcript of the voice the video will now play (transcribe the CLEANED file, after clean.py's cuts).
Prints a WARP table for render.mjs: pairs [new-take time, timeline time] at the first word of every sentence
and at every sentence end, plus the start and the end. render.mjs maps each frame's time through it, so every
cue (headline, subtitle, pointer move, diagram motion) lands on the same word in the new take.

Words are matched in order on their letters, so small transcription differences ("100" against "a hundred")
just drop that anchor. Check the result: times must rise on both sides, and a frame grabbed at a spoken
keyword should show its scene (check/frames.py sheet).
"""
import difflib
import json
import re
import sys

norm = lambda w: re.sub(r"[^a-z0-9]", "", w.lower())
old = [x for s in json.load(open(sys.argv[1])) for x in s["words"]]
new = [x for s in json.load(open(sys.argv[2])) for x in s["words"]]
sm = difflib.SequenceMatcher(a=[norm(w[2]) for w in old], b=[norm(w[2]) for w in new], autojunk=False)
pairs = [[0.0, 0.0]]
for blk in sm.get_matching_blocks():
    for k in range(blk.size):
        i, j = blk.a + k, blk.b + k
        o, n = old[i], new[j]
        starts = i == 0 or old[i - 1][2].strip()[-1:] in ".?!"
        ends = o[2].strip()[-1:] in ".?!"
        if starts:
            pairs.append([round(n[0], 2), round(o[0], 2)])
        if ends:
            pairs.append([round(n[1], 2), round(o[1], 2)])
pairs.append([round(new[-1][1], 2), round(old[-1][1], 2)])
# keep it strictly rising on both sides
clean = []
for p in pairs:
    if not clean or (p[0] > clean[-1][0] + 0.05 and p[1] > clean[-1][1] + 0.05):
        clean.append(p)
print(f"// {len(clean)} anchors; matched {sum(b.size for b in sm.get_matching_blocks())} of {len(old)} words")
print("const WARP = [" + ", ".join(f"[{n}, {o}]" for n, o in clean) + "];")
print("// then add the video's tail: [new DUR, timeline DUR], and set DUR to the new voice's length plus ~0.5 s")
