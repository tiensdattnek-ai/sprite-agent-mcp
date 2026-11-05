/**
 * Pixel-perfect drawing primitives. No anti-aliasing, no subpixels, no blur.
 * Every op snaps to integer coordinates and writes palette indices only.
 */

import { LayerView, transformPixels } from "./canvas.js";
import { Palette, resolveColor, shiftRamp } from "./palettes.js";
import { shadeColor, toHex } from "./color.js";

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hashSeed(s: string | number | undefined): number {
  const str = String(s ?? Math.random());
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

export type DrawOp = Record<string, any> & { op: string };

const BAYER: Record<string, number[]> = {
  bayer2: [0, 2, 3, 1],
  bayer4: [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5],
  checker: [0, 1, 1, 0],
};

function idx(pal: Palette, spec: unknown, fallback = "outline"): number {
  return resolveColor(pal, (spec === undefined || spec === null ? fallback : spec) as string | number);
}

function rectBrush(v: LayerView, x: number, y: number, w: number, h: number, c: number): void {
  for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) v.set(xx, yy, c);
}

export function line(v: LayerView, x0: number, y0: number, x1: number, y1: number, c: number, thickness = 1): void {
  x0 = Math.round(x0); y0 = Math.round(y0); x1 = Math.round(x1); y1 = Math.round(y1);
  const dx = Math.abs(x1 - x0), sx = x0 < x1 ? 1 : -1;
  const dy = -Math.abs(y1 - y0), sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;
  const t = Math.max(1, Math.round(thickness)), off = Math.floor((t - 1) / 2);
  for (;;) {
    rectBrush(v, x0 - off, y0 - off, t, t, c);
    if (x0 === x1 && y0 === y1) break;
    const e2 = 2 * err;
    if (e2 >= dy) { err += dy; x0 += sx; }
    if (e2 <= dx) { err += dx; y0 += sy; }
  }
}

export function ellipse(v: LayerView, cx: number, cy: number, rx: number, ry: number, c: number, fill: boolean): void {
  cx = Math.round(cx); cy = Math.round(cy); rx = Math.max(0, Math.round(rx)); ry = Math.max(0, Math.round(ry));
  if (rx === 0 || ry === 0) { line(v, cx - rx, cy - ry, cx + rx, cy + ry, c); return; }
  const put = (x: number, y: number) => {
    if (fill) { line(v, cx - x, cy + y, cx + x, cy + y, c); line(v, cx - x, cy - y, cx + x, cy - y, c); }
    else { v.set(cx + x, cy + y, c); v.set(cx - x, cy + y, c); v.set(cx + x, cy - y, c); v.set(cx - x, cy - y, c); }
  };
  let x = 0, y = ry;
  let d1 = ry * ry - rx * rx * ry + 0.25 * rx * rx;
  let dx = 2 * ry * ry * x, dy = 2 * rx * rx * y;
  while (dx < dy) {
    put(x, y);
    if (d1 < 0) { x++; dx += 2 * ry * ry; d1 += dx + ry * ry; }
    else { x++; y--; dx += 2 * ry * ry; dy -= 2 * rx * rx; d1 += dx - dy + ry * ry; }
  }
  let d2 = ry * ry * (x + 0.5) * (x + 0.5) + rx * rx * (y - 1) * (y - 1) - rx * rx * ry * ry;
  while (y >= 0) {
    put(x, y);
    y--; dy -= 2 * rx * rx;
    if (d2 > 0) { d2 += rx * rx - dy; }
    else { x++; dx += 2 * ry * ry; d2 += dx - dy + rx * rx; }
  }
}

export function floodFill(v: LayerView, x: number, y: number, c: number): number {
  x = Math.round(x); y = Math.round(y);
  const target = v.get(x, y);
  if (target === c) return 0;
  const stack = [[x, y]];
  let n = 0;
  while (stack.length) {
    const [px, py] = stack.pop()!;
    if (!v.inBounds(px, py) || v.get(px, py) !== target) continue;
    v.set(px, py, c); n++;
    stack.push([px + 1, py], [px - 1, py], [px, py + 1], [px, py - 1]);
  }
  return n;
}

export function polygon(v: LayerView, points: number[][], c: number, fill: boolean): void {
  if (points.length < 2) return;
  for (let i = 0; i < points.length; i++) {
    const a = points[i], b = points[(i + 1) % points.length];
    line(v, a[0], a[1], b[0], b[1], c);
  }
  if (fill && points.length >= 3) {
    const ys = points.map(p => p[1]);
    const minY = Math.min(...ys), maxY = Math.max(...ys);
    let cx = 0, cy = 0;
    for (const p of points) { cx += p[0]; cy += p[1]; }
    const inside = Math.round(cx / points.length), insideY = Math.round(cy / points.length);
    // Scanline fill with parity, seeded from centroid flood fill when possible.
    for (let y = minY; y <= maxY; y++) {
      const xs: number[] = [];
      for (let i = 0; i < points.length; i++) {
        const a = points[i], b = points[(i + 1) % points.length];
        const [x1, y1] = a, [x2, y2] = b;
        if ((y1 <= y && y2 > y) || (y2 <= y && y1 > y)) xs.push(x1 + ((y - y1) / (y2 - y1)) * (x2 - x1));
      }
      xs.sort((p, q) => p - q);
      for (let i = 0; i + 1 < xs.length; i += 2) line(v, Math.round(xs[i]), y, Math.round(xs[i + 1]), y, c);
    }
    void inside; void insideY;
  }
}

function gradientIndices(pal: Palette, from: unknown, to: unknown, steps: number): number[] {
  const a = idx(pal, from, "shadow"), b = idx(pal, to, "highlight");
  const posA = pal.ramp.indexOf(a), posB = pal.ramp.indexOf(b);
  const p0 = posA < 0 ? 0 : posA, p1 = posB < 0 ? pal.ramp.length - 1 : posB;
  const out: number[] = [];
  for (let i = 0; i < steps; i++) {
    const t = steps === 1 ? 0 : i / (steps - 1);
    out.push(pal.ramp[Math.round(p0 + (p1 - p0) * t)] ?? a);
  }
  return out;
}

export function applyOps(v: LayerView, ops: DrawOp[]): { applied: number; notes: string[] } {
  const pal = v.palette;
  const notes: string[] = [];
  let applied = 0;
  const box = (o: DrawOp) => ({
    x: Math.round(o.x ?? 0), y: Math.round(o.y ?? 0),
    w: Math.round(o.w ?? v.width), h: Math.round(o.h ?? v.height),
  });
  for (const o of ops) {
    const c = idx(pal, o.color, "base");
    switch (o.op) {
      case "clear":
        v.clear(); break;
      case "pixel":
      case "pixels": {
        const pts = o.points ?? (o.x !== undefined ? [[o.x, o.y, o.color]] : []);
        for (const p of pts) {
          const ci = p.length > 2 && p[2] !== undefined ? idx(pal, p[2], "base") : c;
          rectBrush(v, Math.round(p[0]), Math.round(p[1]), Math.max(1, Math.round(o.size ?? 1)), Math.max(1, Math.round(o.size ?? 1)), ci);
        }
        break;
      }
      case "rect": {
        const b = box(o);
        if (o.fill === false || o.outline) {
          line(v, b.x, b.y, b.x + b.w - 1, b.y, c, o.thickness ?? 1);
          line(v, b.x, b.y + b.h - 1, b.x + b.w - 1, b.y + b.h - 1, c, o.thickness ?? 1);
          line(v, b.x, b.y, b.x, b.y + b.h - 1, c, o.thickness ?? 1);
          line(v, b.x + b.w - 1, b.y, b.x + b.w - 1, b.y + b.h - 1, c, o.thickness ?? 1);
        } else rectBrush(v, b.x, b.y, b.w, b.h, c);
        break;
      }
      case "line":
        line(v, o.x1 ?? o.x ?? 0, o.y1 ?? o.y ?? 0, o.x2 ?? o.x ?? 0, o.y2 ?? o.y ?? 0, c, o.thickness ?? o.width ?? 1);
        break;
      case "circle":
      case "ellipse": {
        const r = Math.round(o.r ?? o.rx ?? 4);
        ellipse(v, o.cx ?? o.x ?? v.width / 2, o.cy ?? o.y ?? v.height / 2, r, Math.round(o.ry ?? r), c, o.fill !== false);
        break;
      }
      case "polygon":
        polygon(v, (o.points ?? []).map((p: any) => Array.isArray(p) ? p : [p.x, p.y]), c, o.fill !== false);
        break;
      case "fill":
        notes.push(`flood fill replaced ${floodFill(v, o.x ?? 0, o.y ?? 0, c)} pixels`);
        break;
      case "dither": {
        const b = box(o);
        const a = idx(pal, o.colorA ?? o.from ?? "transparent", "shadow");
        const z = idx(pal, o.colorB ?? o.to ?? "base", "base");
        const matrix = BAYER[String(o.pattern ?? "bayer4")] ?? BAYER.bayer4;
        const side = Math.round(Math.sqrt(matrix.length));
        const ratio = Math.max(0, Math.min(1, o.ratio ?? 0.5));
        for (let y = b.y; y < b.y + b.h; y++) for (let x = b.x; x < b.x + b.w; x++) {
          const t = (matrix[((y % side) + side) % side * side + ((x % side) + side) % side] + 0.5) / matrix.length;
          v.set(x, y, t < ratio ? a : z);
        }
        break;
      }
      case "gradient": {
        const b = box(o);
        const steps = Math.max(2, Math.min(64, Math.round(o.steps ?? 6)));
        const ramp = gradientIndices(pal, o.from ?? o.colorA, o.to ?? o.colorB, steps);
        const vertical = (o.direction ?? "vertical") !== "horizontal";
        for (let y = b.y; y < b.y + b.h; y++) for (let x = b.x; x < b.x + b.w; x++) {
          const t = vertical ? (y - b.y) / Math.max(1, b.h - 1) : (x - b.x) / Math.max(1, b.w - 1);
          v.set(x, y, ramp[Math.min(steps - 1, Math.floor(t * steps))]);
        }
        break;
      }
      case "noise": {
        const b = box(o);
        const rnd = mulberry32(hashSeed(o.seed ?? 1));
        const colors: number[] = (o.colors ?? ["shadow", "base", "light"]).map((s: any) => idx(pal, s, "base"));
        const density = Math.max(0, Math.min(1, o.density ?? 0.4));
        for (let y = b.y; y < b.y + b.h; y++) for (let x = b.x; x < b.x + b.w; x++) {
          if (rnd() < density) v.set(x, y, colors[Math.floor(rnd() * colors.length)]);
        }
        break;
      }
      case "scatter": {
        const b = box(o);
        const rnd = mulberry32(hashSeed(o.seed ?? 7));
        const count = Math.max(1, Math.min(10000, Math.round(o.count ?? 20)));
        const cc = idx(pal, o.color ?? o.colors?.[0] ?? "highlight", "highlight");
        for (let i = 0; i < count; i++) {
          const x = b.x + Math.floor(rnd() * b.w), y = b.y + Math.floor(rnd() * b.h);
          v.set(x, y, cc);
        }
        break;
      }
      case "replace": {
        const from = idx(pal, o.from, "base");
        for (let i = 0; i < v.pixels.length; i++) if (v.pixels[i] === from) { v.pixels[i] = c; applied++; }
        break;
      }
      case "outline":
        opOutline(v, c, o);
        break;
      case "shade":
        opShade(v, o);
        break;
      case "mirror": {
        const axis = String(o.axis ?? "x");
        const snap = v.snapshot();
        const w = v.width, h = v.height;
        for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
          const mx = axis === "x" || axis === "both" ? w - 1 - x : x;
          const my = axis === "y" || axis === "both" ? h - 1 - y : y;
          const src = snap[y * w + x];
          if (src) v.set(mx, my, src);
        }
        break;
      }
      case "shift": {
        const r = transformPixels(v.snapshot(), v.width, v.height, "shift", { dx: o.dx ?? 0, dy: o.dy ?? 0, wrap: !!o.wrap });
        v.restore(r.pixels);
        break;
      }
      case "text":
        drawText(v, String(o.text ?? ""), Math.round(o.x ?? 0), Math.round(o.y ?? 0), c, Math.max(1, Math.min(8, Math.round(o.scale ?? 1))));
        break;
      case "crop": {
        const r = transformPixels(v.snapshot(), v.width, v.height, "crop", { targetW: v.width, targetH: v.height, box: { x: box(o).x, y: box(o).y, w: box(o).w, h: box(o).h } });
        v.restore(r.pixels);
        break;
      }
      default:
        throw new Error(`Unknown draw op "${o.op}". Supported: clear, pixel(s), rect, line, circle/ellipse, polygon, fill, dither, gradient, noise, scatter, replace, outline, shade, mirror, shift, text, crop.`);
    }
    applied++;
  }
  return { applied, notes };
}

function opOutline(v: LayerView, color: number, o: DrawOp): void {
  const snap = v.snapshot();
  const mode = String(o.mode ?? "outside");
  const thickness = Math.max(1, Math.min(4, Math.round(o.thickness ?? 1)));
  const w = v.width, h = v.height;
  const isSolid = (x: number, y: number) => x >= 0 && y >= 0 && x < w && y < h && snap[y * w + x] !== 0;
  // Flood the EMPTY space connected to the canvas border: only that region is
  // "outside". Interior gaps (eye sockets, belt holes) must NOT be outlined.
  const exterior = new Uint8Array(w * h);
  const queue: number[] = [];
  for (let x = 0; x < w; x++) { queue.push(x, (h - 1) * w + x); }
  for (let y = 0; y < h; y++) { queue.push(y * w, y * w + w - 1); }
  while (queue.length) {
    const i = queue.pop()!;
    if (exterior[i] || snap[i]) continue;
    exterior[i] = 1;
    const x = i % w, y = (i / w) | 0;
    if (x > 0) queue.push(i - 1);
    if (x < w - 1) queue.push(i + 1);
    if (y > 0) queue.push(i - w);
    if (y < h - 1) queue.push(i + w);
  }
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const solid = isSolid(x, y);
    if (mode === "inside") {
      if (solid && (!isSolid(x - 1, y) || !isSolid(x + 1, y) || !isSolid(x, y - 1) || !isSolid(x, y + 1))) v.set(x, y, color);
      continue;
    }
    if (solid || !exterior[y * w + x]) continue;
    const above = isSolid(x, y - 1);   // sprite is above us → we are below it (shadow side)
    const below = isSolid(x, y + 1);   // sprite is below us → we are above it (light side)
    const side = isSolid(x - 1, y) || isSolid(x + 1, y);
    // "selective": outline the dark side only (below + sides), never the lit top.
    const near = mode === "selective" ? (above || side) : (above || below || side);
    if (near) for (let t = 0; t < thickness; t++) v.set(x, y + t, color);
  }
}

/** Hue-shifted highlight/shadow based on a light direction — the "pro" look. */
function opShade(v: LayerView, o: DrawOp): void {
  const dir = String(o.light ?? "nw").toLowerCase();
  const lx = dir.includes("w") ? -1 : dir.includes("e") ? 1 : 0;
  const ly = dir.includes("n") ? -1 : dir.includes("s") ? 1 : 0;
  const strength = Math.max(0, Math.min(1, o.strength ?? 0.55));
  const snap = v.snapshot();
  const w = v.width, h = v.height;
  const pal = v.palette;
  const solid = (x: number, y: number) => x >= 0 && y >= 0 && x < w && y < h && snap[y * w + x] !== 0;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const ci = snap[y * w + x];
    if (!ci) continue;
    const lightEdge = !solid(x + lx, y + ly);
    const darkEdge = !solid(x - lx, y - ly);
    if (lightEdge && !darkEdge) {
      const base = pal.colors[ci];
      const lit = shadeColor(base, 0.45 * strength + 0.18);
      v.set(x, y, resolveColor(pal, toHex(lit)));
    } else if (darkEdge && !lightEdge) {
      const base = pal.colors[ci];
      const dark = shadeColor(base, -(0.45 * strength + 0.18));
      v.set(x, y, resolveColor(pal, toHex(dark)));
    } else if (o.ramp !== false) {
      v.set(x, y, shiftRamp(pal, ci, lightEdge ? 1 : darkEdge ? -1 : 0));
    }
  }
}

/** Tiny 3×5 bitmap font — labels, HP numbers and signatures stay pixel-perfect. */
const FONT3x5: Record<string, string> = {
  A: "010101111101101", B: "110101110101110", C: "011100100100011", D: "110101101101110",
  E: "111100110100111", F: "111100110100100", G: "011100101101011", H: "101101111101101",
  I: "111010010010111", J: "001001001101010", K: "101101110101101", L: "100100100100111",
  M: "101111111101101", N: "101111111111101", O: "010101101101010", P: "110101110100100",
  Q: "010101101011001", R: "110101110101101", S: "011100010001110", T: "111010010010010",
  U: "101101101101111", V: "101101101101010", W: "101101111111101", X: "101101010101101",
  Y: "101101010010010", Z: "111001010100111",
  "0": "111101101101111", "1": "010110010010111", "2": "111001111100111", "3": "111001011001111",
  "4": "101101111001001", "5": "111100111001111", "6": "111100111101111", "7": "111001001001001",
  "8": "111101111101111", "9": "111101111001111",
  "!": "010010010000010", "?": "111001011000010", ".": "000000000000010", ":": "000010000010000",
  "-": "000000111000000", "+": "000010111010000", "/": "001001010100100", "*": "000101010101000",
  "<": "001010100010001", ">": "100010001010100", "%": "101001010100101", "#": "101111101111101",
  " ": "000000000000000",
};

export function drawText(v: LayerView, text: string, x: number, y: number, c: number, scale = 1): void {
  let cursor = x;
  for (const raw of text.toUpperCase()) {
    const glyph = FONT3x5[raw] ?? FONT3x5["?"];
    for (let gy = 0; gy < 5; gy++) for (let gx = 0; gx < 3; gx++) {
      if (glyph[gy * 3 + gx] === "1") rectBrush(v, cursor + gx * scale, y + gy * scale, scale, scale, c);
    }
    cursor += 4 * scale;
  }
}

export function fontChars(): string[] { return Object.keys(FONT3x5); }
