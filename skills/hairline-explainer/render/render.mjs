/**
 * Renders the narrated explainer frame by frame and, given audio, muxes the MP4.
 *
 *   node render.mjs [--vert] [--only=3,9.5] [--audio=mix.wav --out=video.mp4] [--work=dir]
 *
 * --vert   the 9:16 cut: page.html's vertical layout at 540 × 960, captured at 2× for 1080 × 1920
 * --only   render just these seconds (previews); no mux
 * --audio  the final mix (voice + music) to put under the frames; with --out, ffmpeg writes the MP4
 * --work   where the bundle and frames go (default: a folder in the OS temp dir, never the repo)
 *
 * How it works: page.html draws one frame from a state object (window.render); this script owns time.
 * The repo's virtual clock (packages/hairline/test/parity/clock.js) freezes the page, so every frame is
 * exactly 1/30 s after the last however slow the screenshot is, and the Duo's springs run in that time.
 * The Duo is driven by real pointer moves, so what it does on screen is the figure's own behaviour.
 *
 * Everything between the two "SCENE SCRIPT" rules is this video's script. For a new video, rewrite
 * that part (see SKILL.md, step 5); the rest is machinery.
 */
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "../../..");
const arg = (k) => process.argv.find((a) => a === `--${k}` || a.startsWith(`--${k}=`))?.split("=").slice(1).join("=") ?? null;
const VERT = process.argv.includes("--vert");
const ONLY = arg("only") ? arg("only").split(",").map(Number) : null;
const AUDIO = arg("audio"), OUT = arg("out");
const WORK = path.resolve(arg("work") || path.join(os.tmpdir(), `hairline-explainer-${VERT ? "vert" : "wide"}`));
const FRAMES = path.join(WORK, "frames");

// the bundle: the figure, compiled against the repo's own core, next to the page
const { build } = createRequire(path.join(ROOT, "package.json"))("esbuild");
fs.rmSync(FRAMES, { recursive: true, force: true });
fs.mkdirSync(FRAMES, { recursive: true });
await build({ entryPoints: [path.join(HERE, "../figure/duo.ts")], bundle: true, format: "esm", outfile: path.join(WORK, "duo.js"), logLevel: "warning" });
fs.copyFileSync(path.join(HERE, "page.html"), path.join(WORK, "page.html"));

const srv = http.createServer((q, r) => {
  const u = q.url.split("?")[0], f = path.join(WORK, u === "/" ? "page.html" : u);
  if (!f.startsWith(WORK) || !fs.existsSync(f)) { r.statusCode = 404; return r.end(); }
  r.setHeader("content-type", f.endsWith(".js") ? "text/javascript" : "text/html");
  r.end(fs.readFileSync(f));
});
await new Promise((ok) => srv.listen(0, "127.0.0.1", ok));
const PORT = srv.address().port;

const { chromium } = createRequire(path.join(ROOT, "packages/hairline/package.json"))("@playwright/test");
const exe = process.env.CHROMIUM || (fs.existsSync("/opt/pw-browsers/chromium") ? "/opt/pw-browsers/chromium" : undefined);
const b = await chromium.launch(exe ? { executablePath: exe } : {});
const p = await b.newPage(VERT ? { viewport: { width: 540, height: 960 }, deviceScaleFactor: 2 } : { viewport: { width: 1280, height: 720 } });
const AWAY = VERT ? [530, 955] : [1270, 715];
p.on("pageerror", (e) => console.log("page error:", e.message));
await p.addInitScript({ path: path.join(ROOT, "packages/hairline/test/parity/clock.js") });
await p.goto(`http://127.0.0.1:${PORT}/${VERT ? "?v" : ""}`);
await p.waitForFunction(() => window.ready);
await p.evaluate(() => document.fonts.ready);
const box = await p.locator("#f").boundingBox();
const at = ([x, y]) => [box.x + box.width * x, box.y + box.height * y];

// the exploded hinge's height, found live before the clock freezes (it depends on the figure's geometry)
await p.mouse.move(...at([0.95, 0.5])); await p.waitForTimeout(1500);
let hingeY = 0.38;
for (let y = 0.25; y <= 0.5; y += 0.01) { await p.mouse.move(...at([0.95, y])); await p.waitForTimeout(40); if (await p.evaluate(() => window.st.layer) === "hinge") { hingeY = y + 0.02; break; } }
await p.mouse.move(...AWAY); await p.waitForTimeout(1500);
await p.evaluate(() => window.__freeze(1000));

const E = (t) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2);
const cl = (v) => Math.max(0, Math.min(1, v));
/** Piecewise ease through [time, value] keys. */
const keys = (ks) => (t) => {
  if (t <= ks[0][0]) return ks[0][1];
  for (let i = 1; i < ks.length; i++) if (t <= ks[i][0]) { const [t0, v0] = ks[i - 1], [t1, v1] = ks[i]; return v0 + (v1 - v0) * E(cl((t - t0) / (t1 - t0))); }
  return ks[ks.length - 1][1];
};
const ramp = (t, a, b) => cl((t - a) / (b - a));

/* ═══════════════════════════════ SCENE SCRIPT ═══════════════════════════════ */

const FPS = 30, DUR = 56.26;
/**
 * The scenes below are timed in the FIRST narration take's seconds; the final voice (example/narration-paced.mp3
 * cleaned with `clean.py --cut 11.60:11.90 --cut 16.05:16.69`) says the same words at other times. Each pair is
 * [final-voice time, first-take time] of the same word (from audio/anchors.py), and a frame's time is mapped
 * piecewise-linearly through them, so every cue moves with its word. For a new video timed directly against its
 * own voice, use WARP = [[0, 0], [DUR, DUR]].
 */
const WARP = [[0, 0], [5.58, 5.1], [6.52, 6.6], [7.8, 7.0], [11.18, 10.7], [11.68, 11.5], [13.98, 12.9], [15.92, 15.3], [16.96, 16.5], [17.52, 16.9], [18.6, 18.0], [19.98, 19.5], [20.66, 20.8], [21.34, 21.3], [22.7, 22.7], [24.16, 24.4], [25.02, 25.25], [25.74, 25.9], [27.84, 28.1], [27.98, 28.3], [29.64, 30.1], [31.18, 32.2], [32.14, 33.1], [32.86, 33.6], [34.32, 34.8], [35.56, 36.4], [36.0, 36.7], [36.82, 37.5], [39.24, 40.2], [40.3, 41.1], [42.38, 42.7], [44.32, 44.2], [45.92, 45.8], [46.54, 46.4], [48.48, 48.5], [49.58, 49.5], [50.56, 50.5], [51.84, 51.5], [52.76, 52.8], [55.36, 54.1], [56.26, 55.3]];
const warp = (t) => { for (let i = 1; i < WARP.length; i++) if (t <= WARP[i][0]) { const [n0, o0] = WARP[i - 1], [n1, o1] = WARP[i]; return o0 + ((t - n0) / (n1 - n0)) * (o1 - o0); } return WARP[WARP.length - 1][1]; };

/** Subtitles, word for word with the voice: [start, end, text]. Back-to-back lines need a gap (the old one fades out first). */
const SUBS = [
  [0.0, 6.6, "Glass doesn't bend. So how does a $1,999 iPhone fold in half?"],
  [7.0, 10.7, "Apple says the inner screen is more than 10 ultra-thin layers."],
  [11.5, 16.5, "First, thickness. The thinner the glass, the less a bend stresses it."],
  [16.9, 20.8, "Apple puts high-strength glass above and below the folding panel."],
  [21.3, 24.95, "Custom adhesives let the layers glide past each other, like pages in a book."],
  [25.3, 32.2, "A titanium plate sits underneath, and a hinge of more than a hundred parts holds the centre flat when open."],
  [33.1, 36.4, "It's why a paperback bends, but a glued stack of paper won't."],
  [36.7, 40.2, "That's also why glass fiber-optic cable can curve around corners."],
  [41.1, 45.8, "So if you try one in store, tilt it under the lights. The crease is reduced, not gone."],
  [46.4, 48.5, "The matte finish just hides it better."],
  [49.4, 55.1, "Thin glass, sliding layers, a flat hinge. Not magic — engineered."],
];
/** 9:16 shows bigger subtitles in a narrower column, so the two longest lines are split at their pause into chunks of their own. */
if (VERT) SUBS.splice(SUBS.findIndex(([a]) => a === 25.3), 1,
  [25.3, 27.6, "A titanium plate sits underneath,"], [28.0, 32.2, "and a hinge of more than a hundred parts holds the centre flat when open."]);
if (VERT) SUBS.splice(SUBS.findIndex(([a]) => a === 41.1), 1,
  [41.1, 43.7, "So if you try one in store, tilt it under the lights."], [44.05, 45.8, "The crease is reduced, not gone."]);
const RECAP = `<span class=it>Thin glass</span><span class=it>Sliding layers</span><span class=it>A flat hinge</span><span class=it style="margin-top:18px;font-weight:600;color:#16181d">Not magic. Engineered.</span>`;
/** Kicker and headline from each time on. No middle dots and no numbering in kickers. */
const HEADS = [
  [0.2, ["iPhone Duo", "How does glass fold?"]],
  [6.8, ["The inner screen", "10+ ultra-thin layers"]],
  [11.2, ["Thickness", "Thinner glass, less stress"]],
  [16.7, ["The sandwich", "Glass above and below"]],
  [21.0, ["The adhesives", "Layers that slide"]],
  [25.6, ["The support", "A titanium plate"]],
  [27.9, ["The support", "A 100-part hinge"]],
  [32.9, ["Why it works", "Paperback vs. glued stack"]],
  [36.5, ["The same idea", "Thin glass curves"]],
  [40.9, ["In the store", "Reduced, not gone"]],
  [46.2, ["In the store", "Matte hides it better"]],
  [48.9, ["In short", "How it folds", RECAP]],
];
/** When the Duo is up (otherwise the diagrams are), cross-faded over 0.6 s. */
const DUO_SPANS = [[-1, 7.0], [28.0, 33.0], [40.9, 99]];
const duoO = (t) => Math.max(...DUO_SPANS.map(([a, z]) => Math.min(ramp(t, a - 0.3, a + 0.3), 1 - ramp(t, z - 0.3, z + 0.3))));
/** Which diagram from each time on. The paperback is set at 32.4, before the Duo hands over at 33.0, so its fade-in never shows the previous diagram. */
const MODES = [[7.0, "stack"], [11.2, "thick"], [16.7, "stack"], [32.4, "paper"], [36.5, "fiber"]];
const HIDDEN_CHANGES = new Set([32.4]); // changes made while the Duo covers the diagrams: no hand-over needed
const modeAt = (t) => MODES.filter(([a]) => t >= a).pop()?.[1] ?? "stack";
/** Between two diagrams, a 0.7 s hand-over centred on the change, inside the narrator's pause: the old one out (drifting up), then the new one in. Never an overlap: two line drawings crossed look tangled. */
const XF = 0.35;
function diagrams(t) {
  const kOf = (m) => (m === "thick" ? thickK(t) : m === "paper" ? paperK(t) : stackK(t));
  for (let i = 1; i < MODES.length; i++) {
    const [a, next] = MODES[i];
    if (HIDDEN_CHANGES.has(a) || t < a - XF || t > a + XF) continue;
    const prev = MODES[i - 1][1], x = E((t - (a - XF)) / (2 * XF));
    return [{ mode: prev, k: kOf(prev), o: 1 - cl(2 * x), dy: -14 * x }, { mode: next, k: kOf(next), o: cl(2 * x - 1), dy: 14 * (1 - x) }];
  }
  const m = modeAt(t);
  return [{ mode: m, k: kOf(m), o: 1, dy: 0 }];
}

// the diagrams' motion: bend (k), how far the stack fans out (spread)
const stackK = keys([[16.7, 0], [22.4, 0], [23.5, 1], [24.2, 0.45], [25.1, 1], [25.5, 1], [26.1, 0]]);
const stackSpread = (t) => (t < 16.7 ? keys([[7.3, 0], [9.4, 1]])(t) : keys([[16.9, 1], [17.6, 0.55], [21.0, 0.55], [21.8, 0.12]])(t));
const thickK = keys([[11.6, 0], [12.9, 1], [13.6, 1], [14.3, 0.15], [15.1, 1]]);
const paperK = keys([[33.4, 0], [34.3, 1], [35.0, 1], [35.6, 0.2], [36.2, 1]]);

/** The pointer over the Duo: [time, [x, y] | null], as fractions of the figure. x under 0.1 shuts it, 0.67 lays it flat, past 0.93 takes it apart; y then picks a layer. */
const PTR = [[0, null], [1.1, null], [2.5, [0.67, 0.45]], [4.4, [0.67, 0.45]], [5.8, [0.05, 0.45]], [7.2, [0.05, 0.45]],
  [26.0, [0.95, 0.6]], [27.2, [0.95, hingeY]], [32.6, [0.95, hingeY]], [34.5, [0.67, 0.45]], [48.6, [0.67, 0.45]], [49.0, null]];
/** The band of light over the open display ("tilt it under the lights"), crossing the crease on "crease". */
const glareAt = (t) => (t < 42.6 || t > 48.6 ? null : keys([[42.6, -1.35], [44.2, 0], [45.6, 0], [48.2, 1.35]])(t));

function stateAt(t) {
  const head = HEADS.filter(([a]) => t >= a).pop();
  const next = HEADS.find(([a]) => a > t);
  let capO = head ? ramp(t, head[0], head[0] + 0.4) : 0;
  if (next) capO = Math.min(capO, 1 - ramp(t, next[0] - 0.3, next[0]));
  const sub = SUBS.find(([a, z]) => t >= a - 0.05 && t <= z + 0.3);
  const subO = sub ? Math.min(ramp(t, sub[0] - 0.05, sub[0] + 0.15), 1 - ramp(t, sub[1] + 0.1, sub[1] + 0.3)) : 0;
  const dO = duoO(t);
  const items = [ramp(t, 49.5, 49.8), ramp(t, 50.5, 50.8), ramp(t, 51.5, 51.8), ramp(t, 52.8, 53.2)];
  const fade = 1 - ramp(t, 54.8, 55.3);
  return {
    layers: diagrams(t), labO: 1 - dO, duoO: dO * fade, curO: 0,
    spread: stackSpread(t), count: t < 16.7 ? ramp(t, 8.8, 9.3) : 0,
    hiGlass: t >= 18.0 && t < 21.4, labels: t < 21.0 ? ramp(t, 18.0, 18.5) : 1 - ramp(t, 21.0, 21.4),
    slideTag: ramp(t, 23.0, 23.4) * (1 - ramp(t, 25.5, 25.8)), plate: ramp(t, 25.9, 26.5),
    draw: ramp(t, 36.8, 38.6), time: t,
    glare: glareAt(t), head: head?.[1], capO: capO * fade, items, sub: sub?.[2], subO: subO * fade,
  };
}

/* ═════════════════════════════ end SCENE SCRIPT ═════════════════════════════ */

function pointerAt(t) {
  const i = PTR.findIndex(([tt]) => tt > t);
  if (i === -1) return PTR[PTR.length - 1][1];
  if (i === 0) return PTR[0][1];
  const [t0, a] = PTR[i - 1], [t1, z] = PTR[i];
  if (!a || !z) return a && t < t1 ? a : (t >= t1 ? z : a);
  const e = E(cl((t - t0) / (t1 - t0)));
  return [a[0] + (z[0] - a[0]) * e, a[1] + (z[1] - a[1]) * e];
}

const total = Math.round(DUR * FPS);
const want = ONLY ? new Set(ONLY.map((s) => Math.round(s * FPS))) : null;
let lastP, curO = 0;
for (let n = 0; n < total; n++) {
  const t = warp(n / FPS), s = stateAt(t), q = pointerAt(t);
  if (q) await p.mouse.move(...at(q)); else if (lastP !== null) await p.mouse.move(...AWAY);
  lastP = q;
  // the cursor shows only while the Duo is up and the pointer is over it
  curO = cl(curO + (q && s.duoO > 0.5 ? 1 : -1) / 8); s.curO = curO * s.duoO;
  await p.evaluate((s) => window.render(s), s);
  await p.evaluate((ms) => window.__advance(ms), 1000 / FPS);
  if (!want || want.has(n)) await p.screenshot({ path: path.join(FRAMES, `${String(n).padStart(5, "0")}.png`) });
}
await b.close();
srv.close();
console.log(`${want ? want.size : total} frames in ${FRAMES} (hinge pick at y ${hingeY.toFixed(2)})`);

if (AUDIO && OUT && !ONLY) {
  const r = spawnSync("ffmpeg", ["-loglevel", "error", "-y", "-framerate", String(FPS), "-i", path.join(FRAMES, "%05d.png"), "-i", AUDIO,
    "-map", "0:v", "-map", "1:a", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "20", "-preset", "slow",
    "-c:a", "aac", "-b:a", "192k", "-shortest", "-movflags", "+faststart", OUT], { stdio: "inherit" });
  if (r.status !== 0) process.exit(r.status ?? 1);
  console.log("wrote", OUT);
}
