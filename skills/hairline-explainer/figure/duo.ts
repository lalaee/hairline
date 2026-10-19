import { Cam, clamp, fit, lerp, poly, proj, seg, type Vec2, type Vec3 } from "../../../packages/hairline/src/core/iso";
import { spring, stepS } from "../../../packages/hairline/src/core/motion";
import { mk, pointer, register } from "../../../packages/hairline/src/core/stage";
import { inject } from "../../../packages/hairline/src/core/styles";

/**
 * Duo: a book-style foldable in two halves on a hinge along its long edge.
 * The pointer's x sets the fold, from shut (0°) to flat (180°), on a spring;
 * past flat, further right takes it apart: the outer display drops below,
 * a battery rises out of each half, the hinge lifts off the spine and the
 * folding inner display floats on top. The pointer's y then picks the layer
 * nearest it, which takes the bright edge. At rest it stands half open.
 *
 * Halves are slabs, transformed in 3D and painted per face: back faces are
 * culled, and the two halves are ordered by which side of the moving half's
 * plane the viewer is on, which is exact for two slabs that share an edge.
 */

/** Half width and length (world units ≈ mm), slab thickness, outer corner radius. */
const W = 82, L = 118, T = 5.6, R = 11;
const REST = 112, LAYERS = ["outer display", "chassis", "batteries", "hinge", "inner display"];

type V3 = [number, number, number];
type Xf = { p(u: number, y: number, w: number): V3; d(u: number, y: number, w: number): V3 };

/** A half's outline in (u, y): square on the hinge side (u = 0), rounded on the outer side. */
function outline(u0: number, y0: number, u1: number, y1: number, r: number, rHinge = 0.6, n = 5): Vec2[] {
  const out: Vec2[] = [];
  const corner = (cu: number, cv: number, rr: number, a0: number) => {
    for (let k = 0; k <= n; k++) { const a = ((a0 + (90 * k) / n) * Math.PI) / 180; out.push([cu + rr * Math.cos(a), cv + rr * Math.sin(a)]); }
  };
  corner(u1 - r, y1 - r, r, 0); corner(u0 + rHinge, y1 - rHinge, rHinge, 90); corner(u0 + rHinge, y0 + rHinge, rHinge, 180); corner(u1 - r, y0 + r, r, 270);
  return out;
}
function rr(u0: number, y0: number, u1: number, y1: number, r: number, n = 5): Vec2[] { return outline(u0, y0, u1, y1, r, r, n); }
function circle(cu: number, cv: number, r: number, n = 20): Vec2[] {
  return Array.from({ length: n }, (_, k) => [cu + r * Math.cos((k / n) * 2 * Math.PI), cv + r * Math.sin((k / n) * 2 * Math.PI)] as Vec2);
}

export type DuoState = { angle: number; explode: number; layer: string };
/** `glare`: where a band of light crosses the open display, -1 (left edge) … 1 (right edge); null for none. */
export type DuoOptions = { intensity?: number; glare?: number | null; onState?: (s: DuoState) => void };

export function duo(el: HTMLElement, opts: DuoOptions = {}) {
  inject(document);
  el.setAttribute("data-hairline", "");
  el.setAttribute("data-hairline-theme", "light");
  const svg = mk("svg", { viewBox: "0 0 400 320" }, el) as SVGSVGElement;
  let GMAX = lerp(14, 30, clamp(opts.intensity ?? 0.5, 0, 1));

  const C = Cam(-28, 0.5, 1.42);
  fit(C, [[-W, 0, -22], [W, 0, -22], [-W, L, -22], [W, L, -22], [0, 0, T + W], [0, L, T + W], [-W, L, T + 72], [W, 0, T + 72]] as Vec3[], 200, 162);
  const P = proj(C);
  const s = Math.sin(C.az), c = Math.cos(C.az), zf = Math.sqrt(1 - C.k * C.k);
  const VIEW: V3 = [zf * s, zf * c, C.k];
  const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const S = (q: V3) => P(q[0], q[1], q[2]);

  const g = mk("g", {}, svg);
  /** Paths are rebuilt each frame into a pool, so the DOM never churns. */
  const pool: SVGPathElement[] = [];
  let used = 0;
  const path = (d: string, cls: string, parent: Element = g) => {
    let p = pool[used];
    if (!p) { p = mk("path", {}, g); pool.push(p); }
    if (p.parentNode !== parent) parent.appendChild(p);
    p.setAttribute("d", d); p.setAttribute("class", cls); p.style.opacity = "";
    used++;
    return p;
  };

  /** Draws a slab: outline `o` in (u, y), from w = -t to w = 0, front faces only. Returns whether each cap faces the viewer. */
  function slab(xf: Xf, o: Vec2[], t: number, cls: string) {
    const top = o.map(([u, y]) => xf.p(u, y, 0)), bot = o.map(([u, y]) => xf.p(u, y, -t));
    const upF = dot(xf.d(0, 0, 1), VIEW) > 0;
    const n = o.length;
    // sides: each segment's outward normal in (u, y) is its edge turned clockwise (the outline runs counter-clockwise)
    const sides: string[] = [];
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n, du = o[j][0] - o[i][0], dy = o[j][1] - o[i][1];
      if (dot(xf.d(dy, -du, 0), VIEW) > 0) sides.push(poly([S(top[i]), S(top[j]), S(bot[j]), S(bot[i])]));
    }
    const cap = upF ? top : bot;
    // the silhouette first, filled, then the cap's own outline over it
    path(sides.join("") + poly(cap.map(S)), "fo", g);
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n, du = o[j][0] - o[i][0], dy = o[j][1] - o[i][1];
      const a = dot(xf.d(dy, -du, 0), VIEW) > 0, h = (i + n - 1) % n;
      const b = dot(xf.d(o[i][1] - o[h][1], -(o[i][0] - o[h][0]), 0), VIEW) > 0;
      if (a !== b) path(seg(S(top[i]), S(bot[i])), cls);
    }
    path(poly(cap.map(S)), cls);
    const far = upF ? bot : top;
    // the far cap's outline, only where its edge is on the silhouette
    const rim: string[] = [];
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n, du = o[j][0] - o[i][0], dy = o[j][1] - o[i][1];
      if (dot(xf.d(dy, -du, 0), VIEW) > 0) rim.push(seg(S(far[i]), S(far[j])));
    }
    path(rim.join(""), cls + " nf");
    return upF;
  }
  /** A flat outline drawn on a face at height w. */
  const flat = (xf: Xf, o: Vec2[], w: number, cls: string) => path(poly(o.map(([u, y]) => S(xf.p(u, y, w)))), cls);
  const line = (xf: Xf, a: Vec2, b: Vec2, w: number, cls: string) => path(seg(S(xf.p(a[0], a[1], w)), S(xf.p(b[0], b[1], w))), cls);

  // the two halves: the left lies on the ground mirrored; the right turns about the hinge line (x = 0, z = T) by α = π − θ
  const fixed = (dz = 0): Xf => ({ p: (u, y, w) => [-u, y, T + w + dz], d: (u, y, w) => [-u, y, w] });
  const moving = (alpha: number, dz = 0): Xf => {
    const ca = Math.cos(alpha), sa = Math.sin(alpha);
    return { p: (u, y, w) => [u * ca - w * sa, y, T + u * sa + w * ca + dz], d: (u, y, w) => [u * ca - w * sa, y, u * sa + w * ca] };
  };
  const HALF = outline(0, 0, W, L, R);
  const DISP = outline(0.9, 2.6, W - 2.6, L - 2.6, R - 2.4);
  const OUTER = rr(3, 3, W - 3, L - 3, R - 2.6);
  const BUMP = rr(W - 34, L - 34, W - 7, L - 7, 7), BUMP_TOP = rr(W - 33, L - 33, W - 8, L - 8, 6);

  function half(xf: Xf, which: "fixed" | "moving", lit: boolean, inner: boolean) {
    const cls = lit ? "hi" : "sil";
    const up = slab(xf, HALF, T, cls);
    if (up && inner) {
      // the inner face: half of the folding display, meeting its twin at the crease
      flat(xf, DISP, 0, "nf");
      line(xf, [0.9, 4], [0.9, L - 4], 0, "nf dash");
      if (which === "moving") flat(xf, circle(W / 2, L - 9, 1.6), 0, "nf dash");
    }
    if (!up && which === "moving") {
      // the outside of the moving half is the back: a camera plateau with two lenses and a flash
      const b = (u: number, y: number, h: number): V3 => xf.p(u, y, -T - h);
      path(poly(BUMP.map(([u, y]) => S(b(u, y, 0)))), "nf sil");
      path(poly(BUMP_TOP.map(([u, y]) => S(b(u, y, 1.6)))), cls);
      for (const [u, y] of [[W - 26, L - 26], [W - 15, L - 15]]) {
        path(poly(circle(u, y, 4.4).map(([a, bb]) => S(b(a, bb, 1.6)))), cls);
        path(poly(circle(u, y, 1.8).map(([a, bb]) => S(b(a, bb, 2.2)))), "nf lo");
      }
      path(poly(circle(W - 15, L - 26, 1.5).map(([a, bb]) => S(b(a, bb, 1.6)))), "nf lo");
    }
    if (!up && which === "fixed") {
      // the outside of the fixed half is the outer display, with its camera in the corner
      flat(xf, OUTER.map(([u, y]) => [u, y]), -T, "nf lo");
      flat(xf, circle(W - 9, L - 9, 1.4), -T, "nf lo");
    }
    if (which === "moving") {
      // the side button with Touch ID, and Camera Control below it, on the outer long edge
      for (const [y0, y1] of [[L - 46, L - 30], [L - 70, L - 60]]) {
        const q = (y: number, w: number): Vec2 => S(xf.p(W + 0.7, y, w));
        if (dot(xf.d(1, 0, 0), VIEW) > 0) path(poly([q(y0, -1.6), q(y1, -1.6), q(y1, -4), q(y0, -4)]), "nf " + (lit ? "hi" : "sil"));
      }
    }
  }

  /** A flat plate (exploded view): outline in world x/y, from z to z + t. */
  const plate = (o: Vec2[], z: number, t: number, cls: string) => slab({ p: (u, y, w) => [u, y, z + t + w], d: (u, y, w) => [u, y, w] }, o, t, cls);
  const shift = (o: Vec2[], dx: number, mirror = false): Vec2[] => (mirror ? o.map(([u, y]) => [-u + dx, y] as Vec2).reverse() : o.map(([u, y]) => [u + dx, y] as Vec2));

  const ang = spring(REST, { k: 70, c: 15, eps: 0.05 }), ex = spring(0, { k: 90, c: 17, eps: 0.002 });
  let pick = -1, lastLayer = "", glare: number | null = opts.glare ?? null;

  function draw() {
    used = 0;
    const theta = clamp(ang.x, 0, 180), alpha = Math.PI - (theta * Math.PI) / 180;
    const e = clamp(ex.x, 0, 1) * clamp((theta - 160) / 20, 0, 1), G = GMAX * e;
    const lit = (i: number) => pick === i;
    if (e < 0.01) {
      // folded or folding: paint the half the viewer is behind first
      const nIn: V3 = [-Math.sin(alpha), 0, Math.cos(alpha)];
      const movingFirst = dot(nIn, VIEW) > 0 && theta > 0.5;
      const F = () => half(fixed(), "fixed", lit(1), true), M = () => half(moving(alpha), "moving", lit(1), true);
      if (movingFirst) { M(); F(); } else { F(); M(); }
      if (theta < 1) path(seg(S([0, 0, T]), S([0, L, T])), "nf sil");
      if (glare !== null && theta > 175) {
        // a band of light across the open display; where it crosses the fold, the crease shows
        const gx = glare * W, x0 = clamp(gx - 9, -W + 2.6, W - 2.6), x1 = clamp(gx + 9, -W + 2.6, W - 2.6);
        if (x1 > x0) path(poly([S([x0, 2.6, T]), S([x1, 2.6, T]), S([x1, L - 2.6, T]), S([x0, L - 2.6, T])]), "glare");
        const near = clamp(1 - Math.abs(gx) / 14, 0, 1);
        if (near > 0) path(seg(S([0, 3, T]), S([0, L - 3, T])), "nf hi").style.opacity = String(near);
      }
    } else {
      const fade = (from: number) => { for (let i = from; i < used; i++) pool[i].style.opacity = String(clamp(e * 4, 0, 1)); };
      // 0 outer display, below the left half
      let k = used;
      plate(shift(rr(3, 3, W - 3, L - 3, R - 2.6), 0, true), -G * 1.0 - 0.8, 0.8, lit(0) ? "hi" : "sil");
      flat({ p: (u, y) => [-u, y, -G * 1.0], d: (u, y, w) => [u, y, w] }, circle(W - 9, L - 9, 1.4), 0, "nf lo");
      fade(k);
      // 1 the chassis, flat
      half(fixed(), "fixed", lit(1), false); half(moving(alpha), "moving", lit(1), false);
      flat(fixed(), rr(6, 6, W - 6, L - 6, R - 5), 0, "nf lo"); flat(moving(alpha), rr(6, 6, W - 6, L - 6, R - 5), 0, "nf lo");
      // 2 a battery in each half, and the board beside the left one
      k = used;
      const zb = T - 4 + G * 1.0, bc = lit(2) ? "hi" : "sil";
      plate(shift(rr(12, 12, W - 10, L - 46, 5), 0, true), zb, 3.6, bc);
      plate(rr(12, 36, W - 10, L - 12, 5), zb, 3.6, bc);
      plate(shift(rr(14, L - 40, W - 30, L - 10, 3), 0, true), zb + 0.4, 1.2, bc);
      plate(shift(rr(36, L - 33, 50, L - 19, 1.5), 0, true), zb + 1.6, 1.4, bc);
      fade(k);
      // 3 the hinge, lifted off the spine: a long barrel of many links
      k = used;
      const zh = T - 3 + G * 2.1, hc = lit(3) ? "hi" : "sil";
      plate(rr(-4.5, 6, 4.5, L - 6, 4.5, 6), zh, 3, hc);
      for (let i = 1; i < 14; i++) { const y = 6 + ((L - 12) * i) / 14; path(seg(P(-4.5, y, zh + 3), P(4.5, y, zh + 3)), "nf lo"); }
      fade(k);
      // 4 the folding inner display, one sheet across both halves
      k = used;
      const zd = T + G * 3.2, dc = lit(4) ? "hi" : "sil";
      plate(rr(-W + 1, 1, W - 1, L - 1, R - 1), zd, 0.8, dc);
      path(seg(P(0, 3, zd + 0.8), P(0, L - 3, zd + 0.8)), "nf dash");
      path(poly(circle(W / 2, L - 9, 1.6).map(([u, y]) => P(u, y, zd + 0.8))), "nf dash");
      fade(k);
    }
    for (let i = used; i < pool.length; i++) pool[i].setAttribute("d", "");
    const layer = e > 0.25 && pick >= 0 ? LAYERS[pick] : theta < 2 ? "closed" : theta > 178 ? "flat" : "open";
    if (opts.onState) opts.onState({ angle: theta, explode: e, layer });
    lastLayer = layer;
  }

  /** The layer whose middle sits nearest the pointer's height on screen, in the exploded stack's target pose. */
  function nearest(p: Vec2, e: number) {
    const G = GMAX * e, zs = [-G * 1.0, T / 2, T - 2 + G * 1.0, T + G * 2.1, T + G * 3.2];
    let best = 1, bd = Infinity;
    zs.forEach((z, i) => { const d = Math.abs(P(i === 0 ? -W / 2 : W / 2, L / 2, z)[1] - p[1]); if (d < bd) { bd = d; best = i; } });
    return best;
  }

  const B = register(el, (dt) => {
    const m1 = stepS(ang, dt), m2 = stepS(ex, dt);
    draw();
    return m1 || m2;
  });
  pointer(el, {
    move: (p) => {
      // one gesture across: the first stretch unfolds it, the last takes it apart
      ang.t = 180 * clamp((p[0] - 40) / 220, 0, 1);
      ex.t = clamp((p[0] - 275) / 95, 0, 1);
      const flatEnough = ang.t > 165;
      pick = flatEnough && ex.t > 0.25 ? nearest(p, ex.t) : -1;
      B.wake();
    },
    leave: () => { ang.t = REST; ex.t = 0; pick = -1; B.wake(); },
  });
  return {
    update(o: DuoOptions) { if (o.intensity != null) GMAX = lerp(14, 30, clamp(o.intensity, 0, 1)); if (o.glare !== undefined) glare = o.glare; draw(); B.wake(); },
    get layer() { return lastLayer; },
  };
}
