/**
 * The built-in art director.
 *
 * `critique` scores a sprite the way a pixel-art lead would (color economy,
 * silhouette readability, outline consistency, hue-shifted shading, timing),
 * and returns concrete next tool calls. `enhance` actually applies the fixes.
 */

import { Project, Frame, LayerView, compositeFrame, boundingBox, view } from "./canvas.js";
import { Palette, resolveColor } from "./palettes.js";
import { RGBA, colorDistance, contrast, luminance } from "./color.js";
import { applyOps } from "./draw.js";

export interface Critique {
  size: { w: number; h: number };
  frameCount: number;
  metrics: {
    opaquePixels: number;
    coverage: number;
    colorsUsed: number;
    boundingBox: { x: number; y: number; w: number; h: number } | null;
    centerOffset: { x: number; y: number };
    isolatedPixels: number;
    outlineCoverage: number;
    contrastRatio: number;
    shadedPixels: number;
    duplicateFrames: number;
    fps: number;
    totalDurationMs: number;
  };
  scores: { colorEconomy: number; silhouette: number; outline: number; shading: number; animation: number; overall: number };
  grade: "S" | "A" | "B" | "C" | "D";
  suggestions: string[];
}

export function critique(project: Project): Critique {
  const w = project.width, h = project.height;
  const buffers = project.frames.map(f => compositeFrame(project, f));
  const first = buffers[0] ?? new Uint8Array(w * h);
  const hist = new Map<number, number>();
  for (const c of first) if (c) hist.set(c, (hist.get(c) ?? 0) + 1);
  const used = [...hist.keys()];
  const box = boundingBox(first, w, h);
  const centerOffset = box ? { x: Math.round(box.x + box.w / 2 - w / 2), y: Math.round(box.y + box.h / 2 - h / 2) } : { x: 0, y: 0 };
  const pal = project.palette;

  // Isolated pixels that are much darker (eyes/ink) or brighter (glints) than
  // their neighbourhood are INTENTIONAL detail. Only mid-tone specks are noise.
  let isolated = 0;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const c = first[y * w + x];
    if (!c) continue;
    const n = [first[y * w + x - 1], first[y * w + x + 1], first[(y - 1) * w + x], first[(y + 1) * w + x]];
    if (x === 0) n[0] = 0; if (x === w - 1) n[1] = 0;
    if (y === 0) n[2] = 0; if (y === h - 1) n[3] = 0;
    if (n.some(v => v === c)) continue;
    const solid = n.filter(Boolean);
    const avg = solid.length ? solid.reduce((s, i) => s + luminance(pal.colors[i]), 0) / solid.length : luminance(pal.colors[c]);
    const lum = luminance(pal.colors[c]);
    if (lum < avg - 38 || lum > avg + 38) continue; // intentional detail
    isolated++;
  }

  // outline coverage: how much of the exterior silhouette edge is dark
  const outlineIdx = pal.roles.outline ?? 1;
  const darkest = pal.ramp[0] ?? 1;
  let edgeCount = 0, edgeDark = 0;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const c = first[y * w + x];
    if (!c) continue;
    const touchingEmpty = x === 0 || y === 0 || x === w - 1 || y === h - 1 ||
      !first[y * w + x - 1] || !first[y * w + x + 1] || !first[(y - 1) * w + x] || !first[(y + 1) * w + x];
    if (!touchingEmpty) continue;
    edgeCount++;
    if (c === outlineIdx || c === darkest || luminance(pal.colors[c]) < luminance(pal.colors[pal.roles.base ?? 1]) * 0.7) edgeDark++;
  }
  const outlineCoverage = edgeCount ? edgeDark / edgeCount : 0;

  // shading: distinct luminance levels actually used
  const lums = used.map(i => luminance(pal.colors[i])).sort((a, b) => a - b);
  const levels = new Set(lums.map(l => Math.round(l / 24))).size;
  let minIdx = used[0] ?? 1, maxIdx = used[0] ?? 1, minL = Infinity, maxL = -Infinity;
  for (const i of used) {
    const l = luminance(pal.colors[i]);
    if (l < minL) { minL = l; minIdx = i; }
    if (l > maxL) { maxL = l; maxIdx = i; }
  }
  const maxContrast = used.length > 1 ? contrast(pal.colors[minIdx], pal.colors[maxIdx]) : 1;
  let duplicateFrames = 0;
  const seen = new Set<string>();
  for (const b of buffers) {
    const key = Buffer.from(b).toString("base64");
    if (seen.has(key)) duplicateFrames++; else seen.add(key);
  }
  const durations = project.frames.map(f => f.durationMs);
  const totalDurationMs = durations.reduce((a, b) => a + b, 0);
  const fps = totalDurationMs ? Math.round(1000 / (totalDurationMs / Math.max(1, durations.length))) : 0;
  const variance = durations.length > 1 ? Math.max(...durations) - Math.min(...durations) : 0;

  // Ideal is ~4–12 colors for a sprite; the ceiling scales with canvas area.
  const colorEconomy = score(used.length, 4, Math.max(20, Math.round((w * h) / 32)), true, 0);
  const silhouette = score(Math.abs(centerOffset.x) + Math.abs(centerOffset.y), 0, Math.max(4, w / 3), true, 0) * 0.6 + score(box ? (box.w * box.h) / (w * h) : 0, 0.12, 0.75, false, 0) * 0.4;
  const outlineScore = outlineCoverage * 92;
  const shadingScore = Math.min(100, levels * 22 + (lums.length > 2 ? 12 : 0));
  // Repeated frames are legitimate HOLD frames in pixel-art timing. Only a
  // large number of them (or wildly uneven timing) is a real problem.
  const animationScore = project.frames.length < 2 ? 70 : Math.max(0, 100 - Math.max(0, duplicateFrames - 2) * 12 - Math.min(25, variance / 10));
  const scores = {
    colorEconomy: Math.round(colorEconomy), silhouette: Math.round(silhouette),
    outline: Math.round(outlineScore), shading: Math.round(shadingScore), animation: Math.round(animationScore),
    overall: 0,
  };
  scores.overall = Math.round(scores.colorEconomy * 0.2 + scores.silhouette * 0.2 + scores.outline * 0.2 + scores.shading * 0.2 + scores.animation * 0.2);

  const suggestions: string[] = [];
  if (used.length > 20) suggestions.push(`Colors used: ${used.length}. Call sprite_enhance with limit_colors:16 to enforce palette economy.`);
  if (isolated > Math.max(2, w * h / 100)) suggestions.push(`${isolated} isolated pixels create jaggies. Call sprite_enhance with despeckle:true.`);
  if (outlineCoverage < 0.45) suggestions.push(`Only ${Math.round(outlineCoverage * 100)}% of the silhouette has a dark edge. Call sprite_enhance with outline:true (selective outline) for readability.`);
  if (levels < 3) suggestions.push(`Only ${levels} luminance level(s). Call sprite_enhance with shade:true for hue-shifted light/shadow.`);
  if (Math.abs(centerOffset.x) > 3 || Math.abs(centerOffset.y) > 3) suggestions.push(`Silhouette is off-center by (${centerOffset.x}, ${centerOffset.y}). Call sprite_enhance with center:true.`);
  if (duplicateFrames > 4) suggestions.push(`${duplicateFrames} repeated frames — that is a lot even for holds. Try sprite_animate with amplitude:2 or call sprite_loop with mode:"deduplicate".`);
  else if (duplicateFrames) suggestions.push(`${duplicateFrames} repeated frame(s) act as holds (good!). Vary sprite_timing per frame for a snappier feel.`);
  if (variance > 60) suggestions.push(`Frame durations vary by ${variance} ms; call sprite_timing with fps:10 for a steady loop.`);
  if (project.frames.length < 2) suggestions.push("Single frame. Try sprite_animate(preset:'idle_bob') or 'walk_cycle' to bring it to life.");
  if (!suggestions.length) suggestions.push("Looks clean. Export with sprite_export({formats:['png','gif','spritesheet','apng']}).");

  const grade: Critique["grade"] = scores.overall >= 90 ? "S" : scores.overall >= 78 ? "A" : scores.overall >= 62 ? "B" : scores.overall >= 45 ? "C" : "D";
  return {
    size: { w, h }, frameCount: project.frames.length,
    metrics: {
      opaquePixels: [...hist.values()].reduce((a, b) => a + b, 0),
      coverage: Math.round((([...hist.values()].reduce((a, b) => a + b, 0)) / (w * h)) * 1000) / 10,
      colorsUsed: used.length, boundingBox: box, centerOffset, isolatedPixels: isolated,
      outlineCoverage: Math.round(outlineCoverage * 100) / 100,
      contrastRatio: Math.round(maxContrast * 100) / 100,
      shadedPixels: levels, duplicateFrames, fps, totalDurationMs,
    },
    scores, grade, suggestions,
  };
}

function score(value: number, good: number, bad: number, lowerIsBetter: boolean, _unused: number): number {
  void _unused;
  const t = Math.max(0, Math.min(1, (value - good) / Math.max(1e-6, bad - good)));
  return Math.max(0, Math.min(100, (lowerIsBetter ? 1 - t : t) * 100));
}

export interface EnhanceOptions {
  despeckle?: boolean;
  outline?: boolean;
  shade?: boolean;
  center?: boolean;
  crop?: boolean;
  limitColors?: number;
  harmonize?: boolean;
  mirrorX?: boolean;
  light?: string;
}

export function enhance(project: Project, opts: EnhanceOptions): { before: number; after: number; applied: string[] } {
  const before = critique(project).scores.overall;
  const applied: string[] = [];
  for (const frame of project.frames) {
    const v: LayerView = view(project, frame);
    // Work on a flattened copy of the frame (all layers baked into the top one).
    const flat = compositeFrame(project, frame);
    v.restore(flat);
    frame.layers.slice(0, -1).forEach(l => l.pixels.fill(0));
    if (opts.harmonize || opts.limitColors) {
      limitColors(v, opts.limitColors ?? 16);
      applied.push(`limit_colors:${opts.limitColors ?? 16}`);
    }
    if (opts.despeckle) { despeckle(v); applied.push("despeckle"); }
    if (opts.mirrorX) { applyOps(v, [{ op: "mirror", axis: "x" }]); applied.push("mirror_x"); }
    if (opts.shade) { applyOps(v, [{ op: "shade", light: opts.light ?? "nw", strength: 0.6 }]); applied.push("hue_shifted_shade"); }
    if (opts.outline) { applyOps(v, [{ op: "outline", color: "outline", mode: "selective", thickness: 1 }]); applied.push("selective_outline"); }
    if (opts.center || opts.crop) { centerContent(v, !!opts.crop); applied.push(opts.crop ? "trim_and_center" : "center"); }
  }
  const after = critique(project).scores.overall;
  return { before, after, applied: [...new Set(applied)] };
}

function despeckle(v: LayerView): void {
  const snap = v.snapshot();
  const w = v.width, h = v.height;
  const pal = v.palette;
  // Eyes, pupils, ink lines and specular glints are intentionally isolated 1px
  // details. Never despeckle the darkest/lightest ramp colors or named roles.
  const intentional = new Set<number>([
    pal.ramp[0], pal.ramp[pal.ramp.length - 1],
    pal.roles.outline, pal.roles.highlight, pal.roles.accent, pal.roles.white, pal.roles.black,
  ].filter((n): n is number => n !== undefined));
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const c = snap[y * w + x];
    if (!c || intentional.has(c)) continue;
    const neighbors = [
      x > 0 ? snap[y * w + x - 1] : 0, x < w - 1 ? snap[y * w + x + 1] : 0,
      y > 0 ? snap[(y - 1) * w + x] : 0, y < h - 1 ? snap[(y + 1) * w + x] : 0,
      x > 0 && y > 0 ? snap[(y - 1) * w + x - 1] : 0, x < w - 1 && y < h - 1 ? snap[(y + 1) * w + x + 1] : 0,
    ];
    if (neighbors.includes(c)) continue;
    const counts = new Map<number, number>();
    const solidNeighbors = neighbors.filter(Boolean);
    const avgLum = solidNeighbors.length
      ? solidNeighbors.reduce((sum, n) => sum + luminance(pal.colors[n]), 0) / solidNeighbors.length
      : luminance(pal.colors[c]);
    // An isolated pixel that is much darker (eye/pupil/ink) or much brighter
    // (specular glint/sparkle) than its surroundings is INTENTIONAL detail.
    // Only mid-tone specks are noise and get merged into the local majority.
    const lum = luminance(pal.colors[c]);
    if (lum < avgLum - 38 || lum > avgLum + 38) continue;
    for (const n of solidNeighbors) counts.set(n, (counts.get(n) ?? 0) + 1);
    let best = 0, bestN = 0;
    for (const [n, count] of counts) if (count > bestN) { best = n; bestN = count; }
    v.set(x, y, best);
  }
}

function limitColors(v: LayerView, max: number): void {
  const pal: Palette = v.palette;
  const counts = new Map<number, number>();
  for (const c of v.pixels) if (c) counts.set(c, (counts.get(c) ?? 0) + 1);
  if (counts.size <= max) return;
  // Always keep semantic role colors (outline, highlight, accent, skin, …) even
  // when they are rare — eye whites, glints and embroidered details are small
  // but essential. Fill the remaining slots by frequency.
  const keepers: number[] = [];
  for (const roleIdx of Object.values(pal.roles)) {
    if (counts.has(roleIdx) && !keepers.includes(roleIdx)) keepers.push(roleIdx);
  }
  for (const [i] of [...counts.entries()].sort((a, b) => b[1] - a[1])) {
    if (keepers.length >= max) break;
    if (!keepers.includes(i)) keepers.push(i);
  }
  keepers.splice(max);
  const keepSet = new Set(keepers);
  for (let j = 0; j < v.pixels.length; j++) {
    const c = v.pixels[j];
    if (!c || keepSet.has(c)) continue;
    let best = keepers[0], bestD = Infinity;
    for (const k of keepers) {
      const d = colorDistance(pal.colors[k], pal.colors[c]);
      if (d < bestD) { bestD = d; best = k; }
    }
    v.pixels[j] = best;
  }
}

function centerContent(v: LayerView, crop: boolean): void {
  const w = v.width, h = v.height;
  const box = boundingBox(v.pixels, w, h);
  if (!box) return;
  const snap = v.snapshot();
  v.clear();
  const nx = crop ? Math.floor((w - box.w) / 2) : Math.floor(w / 2 - (box.x + box.w / 2));
  const ny = crop ? Math.floor((h - box.h) / 2) : Math.floor(h / 2 - (box.y + box.h / 2));
  for (let y = 0; y < box.h; y++) for (let x = 0; x < box.w; x++) {
    v.set(x + nx + (crop ? 0 : box.x), y + ny + (crop ? 0 : box.y), snap[(box.y + y) * w + box.x + x]);
  }
  // when not cropping we want to translate the WHOLE image, not just the box
  if (!crop) {
    v.restore(snap);
    const shifted = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const tx = x + nx, ty = y + ny;
      if (tx >= 0 && ty >= 0 && tx < w && ty < h) shifted[ty * w + tx] = snap[y * w + x];
    }
    v.restore(shifted);
  }
}

export function nearestPaletteColor(pal: Palette, c: RGBA): number {
  return resolveColor(pal, `#${[c.r, c.g, c.b].map(n => Math.round(n).toString(16).padStart(2, "0")).join("")}`);
}
