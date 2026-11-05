/**
 * Sprite animation: procedural motion presets, keyframe region transforms,
 * dithered tweening (inbetweening), timing curves and loop shaping.
 *
 * All transformations stay integer/nearest-neighbour. No interpolation blur.
 */

import { randomUUID } from "node:crypto";
import { Project, Frame, Layer, compositeFrame, cloneFrame, makeFrame, transformPixels, MAX_FRAMES } from "./canvas.js";
import { Palette, resolveColor, shiftRamp } from "./palettes.js";
import { RGBA, hslToRgb, rgbToHsl, shadeColor, toHex } from "./color.js";
import { hashSeed, mulberry32 } from "./draw.js";

export const ANIMATION_PRESETS = [
  "idle_bob", "walk_cycle", "blink", "pulse", "squash_stretch", "spin",
  "shake", "wave", "flicker", "explode", "jump", "glow", "hue_cycle", "float",
] as const;
export type AnimationPreset = (typeof ANIMATION_PRESETS)[number];

export interface AnimationOptions {
  preset: AnimationPreset;
  frames?: number;
  durationMs?: number;
  amplitude?: number;
  seed?: string | number;
  replace?: boolean;          // replace the whole timeline (default true)
  sourceFrame?: number | string;
  easing?: "linear" | "ease-in" | "ease-out" | "ease-in-out";
  tags?: string[];
}

export interface FrameSpec {
  name: string;
  durationMs: number;
  tags?: string[];
  layers: Array<{ name: string; pixels: Uint8Array; visible?: boolean; opacity?: number; locked?: boolean }>;
}

/** Replace or append frames from flat pixel buffers. */
export function setFrames(project: Project, specs: FrameSpec[], replace = true): void {
  const total = (replace ? 0 : project.frames.length) + specs.length;
  if (total > MAX_FRAMES) throw new Error(`Frame limit is ${MAX_FRAMES}; requested ${total}`);
  const built: Frame[] = specs.map(s => ({
    id: randomUUID(),
    name: s.name,
    durationMs: s.durationMs,
    tags: s.tags ?? [],
    layers: s.layers.map(l => ({
      id: randomUUID(), name: l.name, visible: l.visible ?? true, opacity: l.opacity ?? 1,
      locked: l.locked ?? false, pixels: new Uint8Array(l.pixels),
    })),
  }));
  project.frames = replace ? built : [...project.frames, ...built];
  project.activeFrame = replace ? 0 : Math.max(0, project.frames.length - specs.length);
}

function specsFromBase(project: Project, base: Frame, buffers: Uint8Array[], names: string[], durationMs: number, tags: string[] = []): FrameSpec[] {
  return buffers.map((px, i) => ({
    name: names[i] ?? `frame_${String(i).padStart(2, "0")}`,
    durationMs,
    tags,
    layers: base.layers.map((l: Layer, li: number) => ({ name: l.name, pixels: li === 0 ? px : new Uint8Array(project.width * project.height), visible: li === 0, opacity: 1 })),
  }));
}

function ease(t: number, kind: AnimationOptions["easing"]): number {
  switch (kind) {
    case "ease-in": return t * t;
    case "ease-out": return 1 - (1 - t) * (1 - t);
    case "ease-in-out": return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
    default: return t;
  }
}

function fit(src: Uint8Array, w: number, h: number, sx: number, sy: number): Uint8Array {
  // scale about the center, nearest-neighbour, then crop back to canvas size
  const out = new Uint8Array(w * h);
  const cx = (w - 1) / 2, cy = (h - 1) / 2;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const ox = Math.round((x - cx) / sx + cx), oy = Math.round((y - cy) / sy + cy);
    if (ox >= 0 && oy >= 0 && ox < w && oy < h) out[y * w + x] = src[oy * w + ox];
  }
  return out;
}

function regionShift(src: Uint8Array, w: number, h: number, box: { x: number; y: number; w: number; h: number }, dx: number, dy: number): Uint8Array {
  const out = new Uint8Array(src);
  const x0 = Math.max(0, Math.round(box.x)), y0 = Math.max(0, Math.round(box.y));
  const x1 = Math.min(w, Math.round(box.x + box.w)), y1 = Math.min(h, Math.round(box.y + box.h));
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) out[y * w + x] = 0;
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
    const nx = x + dx, ny = y + dy;
    if (nx >= 0 && ny >= 0 && nx < w && ny < h) out[ny * w + nx] = src[y * w + x];
  }
  return out;
}

function hueRotate(c: RGBA, deg: number): RGBA {
  const { h, s, l } = rgbToHsl(c.r, c.g, c.b);
  return { ...hslToRgb(h + deg, s, l), a: c.a };
}

export function applyAnimation(project: Project, opts: AnimationOptions): { frames: number; preset: string; names: string[] } {
  const preset = opts.preset;
  const count = Math.max(1, Math.min(MAX_FRAMES, Math.round(opts.frames ?? defaultFrames(preset))));
  const duration = Math.max(16, Math.min(5000, Math.round(opts.durationMs ?? 100)));
  const amp = Math.max(0, Math.min(16, opts.amplitude ?? 1));
  const rng = mulberry32(hashSeed(opts.seed ?? preset));
  const w = project.width, h = project.height;
  const baseIdx = opts.sourceFrame === undefined ? project.activeFrame : typeof opts.sourceFrame === "number" ? opts.sourceFrame : project.frames.findIndex(f => f.name === opts.sourceFrame || f.id === opts.sourceFrame);
  const baseFrame = project.frames[baseIdx >= 0 ? baseIdx : 0] ?? project.frames[0];
  const src = compositeFrame(project, baseFrame);
  const pal = project.palette;
  const buffers: Uint8Array[] = [];
  const names: string[] = [];

  for (let i = 0; i < count; i++) {
    const t = count === 1 ? 0 : i / (count - 1);
    const phase = (i / count) * Math.PI * 2;
    let px: Uint8Array = new Uint8Array(src);
    switch (preset) {
      case "idle_bob":
      case "float": {
        const dy = Math.round(Math.sin(phase) * amp * (preset === "float" ? 1.5 : 1));
        px = transformPixels(src, w, h, "shift", { dy }).pixels;
        if (preset === "float") px = regionShift(px, w, h, { x: 0, y: h * 0.7, w, h: h * 0.3 }, Math.round(Math.cos(phase) * amp), 0);
        break;
      }
      case "walk_cycle": {
        const step = Math.sin(phase);
        const dy = Math.round(Math.abs(Math.cos(phase)) * -amp);
        let work: Uint8Array = transformPixels(src, w, h, "shift", { dy }).pixels;
        const half = Math.round(w / 2);
        work = regionShift(work, w, h, { x: 0, y: h * 0.68, w: half, h: h * 0.32 }, Math.round(step * amp * 1.5), 0);
        work = regionShift(work, w, h, { x: half, y: h * 0.68, w: w - half, h: h * 0.32 }, Math.round(-step * amp * 1.5), 0);
        px = regionShift(work, w, h, { x: w * 0.15, y: h * 0.35, w: w * 0.7, h: h * 0.3 }, 0, Math.round(Math.abs(step) * amp * 0.5));
        break;
      }
      case "blink": {
        const closed = i === Math.floor(count / 2) || i === Math.floor(count / 2) + 1;
        if (closed) {
          const eyeY = Math.round(h * 0.36);
          for (let x = Math.round(w * 0.22); x < Math.round(w * 0.78); x++) {
            for (let dy = 0; dy < Math.max(1, Math.round(h / 32)); dy++) {
              const j = (eyeY + dy) * w + x;
              if (px[j]) px[j] = pal.roles.outline ?? 1;
            }
          }
        }
        break;
      }
      case "pulse": {
        const k = Math.round(Math.sin(phase) * 2);
        for (let j = 0; j < px.length; j++) if (px[j]) px[j] = shiftRamp(pal, px[j], k);
        break;
      }
      case "squash_stretch": {
        const s = Math.sin(phase) * 0.10 * amp;
        px = fit(src, w, h, 1 - s, 1 + s);
        break;
      }
      case "spin": {
        const turns = Math.round((i / count) * 4) % 4;
        // rotate on a square canvas then fit back, so non-square sprites never shear
        const s = Math.max(w, h);
        const square = new Uint8Array(s * s);
        const ox = Math.floor((s - w) / 2), oy = Math.floor((s - h) / 2);
        for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) square[(y + oy) * s + x + ox] = src[y * w + x];
        let rot: Uint8Array = square;
        for (let k = 0; k < turns; k++) rot = transformPixels(rot, s, s, "rotate90").pixels;
        px = new Uint8Array(w * h);
        for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) px[y * w + x] = rot[(y + oy) * s + x + ox];
        break;
      }
      case "shake": {
        const dx = Math.round((rng() - 0.5) * amp * 3), dy = Math.round((rng() - 0.5) * amp * 3);
        px = transformPixels(src, w, h, "shift", { dx, dy }).pixels;
        break;
      }
      case "wave": {
        px = new Uint8Array(w * h);
        for (let x = 0; x < w; x++) {
          const dy = Math.round(Math.sin(phase + (x / w) * Math.PI * 2) * amp * 2);
          for (let y = 0; y < h; y++) {
            const ny = y + dy;
            if (ny >= 0 && ny < h) px[ny * w + x] = src[y * w + x];
          }
        }
        break;
      }
      case "flicker": {
        for (let j = 0; j < px.length; j++) if (px[j] && rng() < 0.12 * amp) px[j] = 0;
        break;
      }
      case "explode": {
        const progress = ease(t, opts.easing ?? "ease-out");
        px = new Uint8Array(w * h);
        for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
          const c = src[y * w + x];
          if (!c || rng() < progress * 0.85) continue;
          const a = rng() * Math.PI * 2, d = progress * amp * w * 0.5 * rng();
          const nx = Math.round(x + Math.cos(a) * d), ny = Math.round(y + Math.sin(a) * d);
          if (nx >= 0 && ny >= 0 && nx < w && ny < h) px[ny * w + nx] = c;
        }
        break;
      }
      case "jump": {
        const arc = Math.sin(Math.PI * ease(t, opts.easing ?? "ease-out"));
        px = transformPixels(src, w, h, "shift", { dy: -Math.round(arc * amp * h * 0.22) }).pixels;
        px = fit(px, w, h, 1 - arc * 0.06 * amp, 1 + arc * 0.10 * amp);
        break;
      }
      case "glow": {
        const halo = resolveColor(pal, toHex(shadeColor(pal.colors[pal.roles.accent ?? pal.roles.base], 0.5)));
        const snap = new Uint8Array(src);
        for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
          if (snap[y * w + x]) continue;
          const near = snap[y * w + x - 1] || snap[y * w + x + 1] || snap[(y - 1) * w + x] || snap[(y + 1) * w + x];
          if (near && (i % 2 === 0 || (x + y) % 3 === 0)) px[y * w + x] = halo;
        }
        break;
      }
      case "hue_cycle": {
        const deg = (i / count) * 60 * amp;
        const cache = new Map<number, number>();
        for (let j = 0; j < px.length; j++) {
          const ci = src[j];
          if (!ci) continue;
          if (!cache.has(ci)) cache.set(ci, resolveColor(pal, toHex(hueRotate(pal.colors[ci], deg))));
          px[j] = cache.get(ci)!;
        }
        break;
      }
    }
    buffers.push(px);
    names.push(`${preset}_${String(i).padStart(2, "0")}`);
  }
  setFrames(project, specsFromBase(project, baseFrame, buffers, names, duration, opts.tags ?? [preset]), opts.replace ?? true);
  return { frames: count, preset, names };
}

function defaultFrames(preset: AnimationPreset): number {
  switch (preset) {
    case "walk_cycle": return 6;
    case "spin": return 8;
    case "explode": return 8;
    case "blink": return 8;
    case "hue_cycle": return 6;
    default: return 4;
  }
}

/** Ordered-dither cross dissolve between two frames — pixel-art correct inbetweening. */
export function tween(project: Project, fromIndex: number, toIndex: number, steps: number, opts: { insert?: boolean; durationMs?: number; pattern?: "bayer" | "random"; seed?: string | number } = {}): number {
  const a = project.frames[fromIndex], b = project.frames[toIndex];
  if (!a || !b) throw new Error(`Tween needs two existing frame indices (0..${project.frames.length - 1})`);
  const n = Math.max(1, Math.min(32, Math.round(steps)));
  const pa = compositeFrame(project, a), pb = compositeFrame(project, b);
  const rng = mulberry32(hashSeed(opts.seed ?? "tween"));
  const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
  const specs: FrameSpec[] = [];
  for (let s = 1; s <= n; s++) {
    const t = s / (n + 1);
    const px = new Uint8Array(pa.length);
    for (let y = 0; y < project.height; y++) for (let x = 0; x < project.width; x++) {
      const j = y * project.width + x;
      const threshold = opts.pattern === "random" ? rng() : (BAYER[(y % 4) * 4 + (x % 4)] + 0.5) / 16;
      px[j] = t > threshold ? pb[j] : pa[j];
    }
    specs.push({ name: `tween_${String(s).padStart(2, "0")}`, durationMs: opts.durationMs ?? 100, tags: ["tween"], layers: [{ name: "art", pixels: px }] });
  }
  if (opts.insert === false) setFrames(project, specs, true);
  else {
    const before = project.frames.slice(0, fromIndex + 1);
    const after = project.frames.slice(fromIndex + 1);
    const built: Frame[] = specs.map(s => ({
      id: randomUUID(), name: s.name, durationMs: s.durationMs, tags: s.tags ?? [],
      layers: s.layers.map(l => ({ id: randomUUID(), name: l.name, visible: true, opacity: 1, locked: false, pixels: new Uint8Array(l.pixels) })),
    }));
    project.frames = [...before, ...built, ...after].slice(0, MAX_FRAMES);
  }
  return specs.length;
}

export function setTiming(project: Project, opts: { fps?: number; durationMs?: number; durations?: number[]; perFrame?: Record<number, number> }): number[] {
  const frames = project.frames;
  const base = opts.durationMs ?? (opts.fps ? Math.round(1000 / opts.fps) : 100);
  frames.forEach((f, i) => {
    f.durationMs = Math.max(16, Math.min(5000, Math.round(opts.durations?.[i] ?? opts.perFrame?.[i] ?? base)));
  });
  return frames.map(f => f.durationMs);
}

export function shapeLoop(project: Project, mode: "pingpong" | "reverse" | "hold" | "deduplicate", times = 1): number {
  const f = project.frames;
  if (!f.length) return 0;
  if (mode === "reverse") { project.frames = [...f].reverse(); return f.length; }
  if (mode === "hold") {
    const out: Frame[] = [];
    for (const frame of f) for (let k = 0; k < Math.max(1, Math.min(20, times)); k++) out.push(cloneFrame(frame, `${frame.name}_hold${k}`));
    project.frames = out.slice(0, MAX_FRAMES);
    return project.frames.length;
  }
  if (mode === "deduplicate") {
    const seen = new Set<string>();
    const before = f.length;
    project.frames = f.filter(fr => {
      const key = Buffer.from(compositeFrame(project, fr)).toString("base64");
      if (seen.has(key)) return false;
      seen.add(key); return true;
    });
    return before - project.frames.length;
  }
  const tail = [...f].slice(1, -1).reverse();
  let out = [...f, ...tail];
  for (let k = 1; k < Math.max(1, Math.min(10, times)); k++) out = [...out, ...f, ...tail];
  project.frames = out.slice(0, MAX_FRAMES).map((fr, i) => i < f.length ? fr : cloneFrame(fr, `${fr.name}_pp${i}`));
  return project.frames.length;
}

/** Build a frame-tag list for atlas exports: group consecutive frames by tag. */
export function frameTags(frames: Frame[]): Array<{ name: string; from: number; to: number; direction: string }> {
  const tags = new Map<string, { from: number; to: number }>();
  frames.forEach((f, i) => {
    for (const t of f.tags) {
      const cur = tags.get(t);
      if (cur) cur.to = i;
      else tags.set(t, { from: i, to: i });
    }
  });
  return [...tags.entries()].map(([name, r]) => ({ name, from: r.from, to: r.to, direction: "forward" }));
}

export { makeFrame };
export type { Palette };
