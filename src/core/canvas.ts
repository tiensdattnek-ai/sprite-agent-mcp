/**
 * The indexed sprite model: projects → frames → layers → palette indices.
 *
 * Every pixel is a single byte pointing into the project palette (0 = transparent).
 * That constraint is deliberate: it is what makes the output real pixel art
 * (flat color, exact palette, tiny files, clean scaling) instead of a blurred image.
 */

import { randomUUID } from "node:crypto";
import { Palette } from "./palettes.js";

export interface Layer {
  id: string;
  name: string;
  visible: boolean;
  opacity: number;      // 0..1, applied with ordered dithering (never creates new colors)
  locked: boolean;
  pixels: Uint8Array;   // width * height
}

export interface Frame {
  id: string;
  name: string;
  durationMs: number;   // 100 ms is a classic 10 fps pixel-art feel
  layers: Layer[];
  tags: string[];
}

export interface Project {
  id: string;
  name: string;
  width: number;
  height: number;
  palette: Palette;
  frames: Frame[];
  activeFrame: number;
  tags: string[];
  createdAt: string;
  updatedAt: string;
  meta: Record<string, unknown>;
}

export interface NewProjectOptions {
  id?: string;
  name?: string;
  width?: number;
  height?: number;
  palette: Palette;
  frames?: number;
  layers?: string[];
  durationMs?: number;
  tags?: string[];
}

export const MAX_DIMENSION = 512;
export const MAX_FRAMES = 256;

export function makeLayer(width: number, height: number, name = "art"): Layer {
  return { id: randomUUID(), name, visible: true, opacity: 1, locked: false, pixels: new Uint8Array(width * height) };
}

export function makeFrame(width: number, height: number, opts: { name?: string; layers?: string[]; durationMs?: number; tags?: string[] } = {}): Frame {
  const names = opts.layers && opts.layers.length ? opts.layers : ["art"];
  return {
    id: randomUUID(),
    name: opts.name ?? "frame",
    durationMs: opts.durationMs ?? 100,
    layers: names.map(n => makeLayer(width, height, n)),
    tags: opts.tags ?? [],
  };
}

export function newProject(opts: NewProjectOptions): Project {
  const width = clampInt(opts.width ?? 32, 1, MAX_DIMENSION);
  const height = clampInt(opts.height ?? 32, 1, MAX_DIMENSION);
  const count = clampInt(opts.frames ?? 1, 1, MAX_FRAMES);
  const now = new Date().toISOString();
  const frames = Array.from({ length: count }, (_, i) =>
    makeFrame(width, height, {
      name: `frame_${String(i).padStart(2, "0")}`,
      layers: opts.layers,
      durationMs: opts.durationMs,
    }),
  );
  return {
    id: opts.id ?? slug(opts.name ?? "sprite"),
    name: opts.name ?? "Untitled sprite",
    width, height,
    palette: opts.palette,
    frames,
    activeFrame: 0,
    tags: opts.tags ?? [],
    createdAt: now,
    updatedAt: now,
    meta: { generator: "sprite-agent-mcp", version: 1 },
  };
}

export function slug(s: string): string {
  const base = s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 48);
  return base || "sprite";
}

export function clampInt(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Math.round(Number.isFinite(n) ? n : min)));
}

export function findFrame(project: Project, ref: number | string | undefined): Frame {
  if (ref === undefined || ref === null) return project.frames[project.activeFrame] ?? project.frames[0];
  if (typeof ref === "number") {
    const f = project.frames[ref];
    if (!f) throw new Error(`Frame ${ref} does not exist (project has ${project.frames.length} frames)`);
    return f;
  }
  const byId = project.frames.find(f => f.id === ref || f.name === ref);
  if (!byId) throw new Error(`Frame "${ref}" not found. Frames: ${project.frames.map((f, i) => `${i}:${f.name}`).join(", ")}`);
  return byId;
}

export function findLayer(frame: Frame, ref: string | undefined): Layer {
  if (!ref) return frame.layers[frame.layers.length - 1];
  const l = frame.layers.find(x => x.name === ref || x.id === ref);
  if (!l) throw new Error(`Layer "${ref}" not found. Layers: ${frame.layers.map(x => x.name).join(", ")}`);
  return l;
}

const BAYER4 = [
  0, 8, 2, 10,
  12, 4, 14, 6,
  3, 11, 1, 9,
  15, 7, 13, 5,
];

/** Composite layers (bottom → top) into one indexed buffer. */
export function compositeFrame(project: Project, frame: Frame): Uint8Array {
  const out = new Uint8Array(project.width * project.height);
  for (const layer of frame.layers) {
    if (!layer.visible) continue;
    const op = Math.max(0, Math.min(1, layer.opacity));
    for (let i = 0; i < out.length; i++) {
      const idx = layer.pixels[i];
      if (!idx) continue;
      if (op >= 1) { out[i] = idx; continue; }
      const x = i % project.width, y = (i / project.width) | 0;
      const threshold = (BAYER4[(y % 4) * 4 + (x % 4)] + 0.5) / 16;
      if (op > threshold) out[i] = idx;
    }
  }
  return out;
}

/** A mutable view over one layer, with all pixel ops bounds-checked. */
export class LayerView {
  readonly width: number;
  readonly height: number;
  constructor(readonly pixels: Uint8Array, width: number, height: number, readonly palette: Palette) {
    this.width = width; this.height = height;
  }
  inBounds(x: number, y: number): boolean { return x >= 0 && y >= 0 && x < this.width && y < this.height; }
  get(x: number, y: number): number { return this.inBounds(x, y) ? this.pixels[y * this.width + x] : 0; }
  set(x: number, y: number, index: number): void {
    if (this.inBounds(x, y)) this.pixels[y * this.width + x] = index;
  }
  clear(): void { this.pixels.fill(0); }
  snapshot(): Uint8Array { return new Uint8Array(this.pixels); }
  restore(data: Uint8Array): void { this.pixels.set(data); }
}

export function view(project: Project, frame: Frame, layerName?: string): LayerView {
  return new LayerView(findLayer(frame, layerName).pixels, project.width, project.height, project.palette);
}

export function cloneFrame(frame: Frame, name?: string): Frame {
  return {
    ...frame,
    id: randomUUID(),
    name: name ?? `${frame.name}_copy`,
    tags: [...frame.tags],
    layers: frame.layers.map(l => ({ ...l, id: randomUUID(), pixels: new Uint8Array(l.pixels) })),
  };
}

/** Nearest-neighbour scale — the only correct way to resize pixel art. */
export function scalePixels(src: Uint8Array, sw: number, sh: number, dw: number, dh: number): Uint8Array {
  const out = new Uint8Array(dw * dh);
  for (let y = 0; y < dh; y++) {
    const sy = Math.min(sh - 1, Math.floor((y * sh) / dh));
    for (let x = 0; x < dw; x++) {
      out[y * dw + x] = src[sy * sw + Math.min(sw - 1, Math.floor((x * sw) / dw))] ?? 0;
    }
  }
  return out;
}

export function transformPixels(
  src: Uint8Array, w: number, h: number,
  op: "flipX" | "flipY" | "rotate90" | "rotate180" | "rotate270" | "shift" | "scale" | "crop" | "center",
  opts: { dx?: number; dy?: number; wrap?: boolean; factor?: number; box?: { x: number; y: number; w: number; h: number }; targetW?: number; targetH?: number } = {},
): { pixels: Uint8Array; width: number; height: number } {
  const put = (dst: Uint8Array, dw: number, dh: number, x: number, y: number, idx: number) => {
    if (x >= 0 && y >= 0 && x < dw && y < dh && idx) dst[y * dw + x] = idx;
  };
  if (op === "flipX" || op === "flipY" || op === "rotate180") {
    const out = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const nx = op === "flipY" ? x : w - 1 - x;
      const ny = op === "flipX" ? y : h - 1 - y;
      put(out, w, h, nx, ny, src[y * w + x]);
    }
    return { pixels: out, width: w, height: h };
  }
  if (op === "rotate90" || op === "rotate270") {
    const dw = h, dh = w, out = new Uint8Array(dw * dh);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const nx = op === "rotate90" ? h - 1 - y : y;
      const ny = op === "rotate90" ? x : w - 1 - x;
      put(out, dw, dh, nx, ny, src[y * w + x]);
    }
    return { pixels: out, width: dw, height: dh };
  }
  if (op === "shift") {
    const out = new Uint8Array(w * h);
    const dx = opts.dx ?? 0, dy = opts.dy ?? 0;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      let nx = x + dx, ny = y + dy;
      if (opts.wrap) { nx = ((nx % w) + w) % w; ny = ((ny % h) + h) % h; }
      put(out, w, h, nx, ny, src[y * w + x]);
    }
    return { pixels: out, width: w, height: h };
  }
  if (op === "scale") {
    const f = Math.max(0.25, Math.min(16, opts.factor ?? 2));
    const dw = Math.max(1, Math.round(w * f)), dh = Math.max(1, Math.round(h * f));
    return { pixels: scalePixels(src, w, h, dw, dh), width: dw, height: dh };
  }
  if (op === "crop" || op === "center") {
    const tw = opts.targetW ?? w, th = opts.targetH ?? h;
    const box = opts.box ?? { x: 0, y: 0, w, h };
    const out = new Uint8Array(tw * th);
    const bx = op === "center" ? Math.floor((tw - box.w) / 2) : 0;
    const by = op === "center" ? Math.floor((th - box.h) / 2) : 0;
    for (let y = 0; y < Math.min(box.h, h); y++) for (let x = 0; x < Math.min(box.w, w); x++) {
      const sx = box.x + x, sy = box.y + y;
      if (sx < 0 || sy < 0 || sx >= w || sy >= h) continue;
      put(out, tw, th, x + bx, y + by, src[sy * w + sx]);
    }
    return { pixels: out, width: tw, height: th };
  }
  return { pixels: new Uint8Array(src), width: w, height: h };
}

export function boundingBox(pixels: Uint8Array, w: number, h: number): { x: number; y: number; w: number; h: number } | null {
  let minX = w, minY = h, maxX = -1, maxY = -1;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (pixels[y * w + x]) { if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y; }
  }
  return maxX < 0 ? null : { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 };
}

export function pixelHistogram(pixels: Uint8Array): Record<number, number> {
  const hist: Record<number, number> = {};
  for (const p of pixels) if (p) hist[p] = (hist[p] ?? 0) + 1;
  return hist;
}

/** Deterministic in-memory store shared by every server instance (stdio & HTTP). */
export class SpriteStore {
  readonly projects = new Map<string, Project>();
  private activeId: string | undefined;

  create(opts: NewProjectOptions): Project {
    const p = newProject(opts);
    let id = p.id, n = 2;
    while (this.projects.has(id)) id = `${p.id}-${n++}`;
    p.id = id;
    this.projects.set(id, p);
    this.activeId = id;
    p.updatedAt = new Date().toISOString();
    return p;
  }
  get(id?: string): Project | undefined {
    return id ? this.projects.get(id) : this.activeId ? this.projects.get(this.activeId) : undefined;
  }
  require(id?: string): Project {
    const p = this.get(id);
    if (!p) throw new Error(this.projects.size
      ? `Project "${id ?? "(active)"}" not found. Existing: ${[...this.projects.keys()].join(", ")}. Call sprite_new_project first.`
      : "No project yet. Call sprite_new_project first (or sprite_load_project).");
    this.activeId = p.id;
    return p;
  }
  setActive(id: string): void { this.activeId = id; }
  active(): string | undefined { return this.activeId; }
  list(): Array<{ id: string; name: string; width: number; height: number; frames: number; palette: string; updatedAt: string }> {
    return [...this.projects.values()].map(p => ({
      id: p.id, name: p.name, width: p.width, height: p.height,
      frames: p.frames.length, palette: p.palette.name, updatedAt: p.updatedAt,
    }));
  }
  delete(id: string): boolean { const ok = this.projects.delete(id); if (ok && this.activeId === id) this.activeId = [...this.projects.keys()][0]; return ok; }
  touch(p: Project): void { p.updatedAt = new Date().toISOString(); }
}

export function serializeProject(p: Project): string {
  return JSON.stringify({
    format: "sprite-agent-mcp/project",
    version: 1,
    id: p.id, name: p.name, width: p.width, height: p.height,
    palette: {
      name: p.palette.name,
      description: p.palette.description,
      colors: p.palette.colors.slice(1).map(c => (c.a === 0 ? "#00000000" : rgbHex(c))),
      roles: Object.fromEntries(Object.entries(p.palette.roles).map(([k, v]) => [k, rgbHex(p.palette.colors[v])])),
    },
    activeFrame: p.activeFrame, tags: p.tags, createdAt: p.createdAt, updatedAt: p.updatedAt, meta: p.meta,
    frames: p.frames.map(f => ({
      id: f.id, name: f.name, durationMs: f.durationMs, tags: f.tags,
      layers: f.layers.map(l => ({
        id: l.id, name: l.name, visible: l.visible, opacity: l.opacity, locked: l.locked,
        pixels: Buffer.from(l.pixels).toString("base64"),
      })),
    })),
  }, null, 2);
}

export function deserializeProject(json: string, paletteResolver: (name: string, colors?: string[]) => Palette): Project {
  const raw = JSON.parse(json) as Record<string, any>;
  if (raw.format !== "sprite-agent-mcp/project") throw new Error("Not a sprite-agent-mcp project file");
  const width = clampInt(raw.width, 1, MAX_DIMENSION), height = clampInt(raw.height, 1, MAX_DIMENSION);
  const pal = raw.palette?.colors
    ? paletteResolver(raw.palette.name ?? "custom", raw.palette.colors)
    : paletteResolver(raw.palette?.name ?? "db32");
  if (raw.palette?.roles) {
    for (const [role, hex] of Object.entries(raw.palette.roles as Record<string, string>)) {
      pal.roles[role] = resolveHexInPalette(pal, hex);
    }
  }
  const frames: Frame[] = (raw.frames ?? []).map((f: any) => ({
    id: f.id ?? randomUUID(), name: f.name ?? "frame", durationMs: f.durationMs ?? 100,
    tags: f.tags ?? [],
    layers: (f.layers ?? []).map((l: any) => ({
      id: l.id ?? randomUUID(), name: l.name ?? "art", visible: l.visible ?? true,
      opacity: l.opacity ?? 1, locked: l.locked ?? false,
      pixels: Uint8Array.from(Buffer.from(l.pixels ?? "", "base64").subarray(0, width * height)),
    })),
  }));
  return {
    id: raw.id ?? slug(raw.name ?? "sprite"), name: raw.name ?? "Imported sprite",
    width, height, palette: pal, frames: frames.length ? frames : [makeFrame(width, height)],
    activeFrame: clampInt(raw.activeFrame ?? 0, 0, Math.max(0, frames.length - 1)),
    tags: raw.tags ?? [], createdAt: raw.createdAt ?? new Date().toISOString(),
    updatedAt: new Date().toISOString(), meta: raw.meta ?? {},
  };
}

function resolveHexInPalette(pal: Palette, hex: string): number {
  const i = pal.colors.findIndex(c => rgbHex(c).toLowerCase() === String(hex).toLowerCase());
  return i > 0 ? i : pal.roles.base ?? 1;
}

function rgbHex(c: { r: number; g: number; b: number }): string {
  const h = (n: number) => n.toString(16).padStart(2, "0");
  return `#${h(c.r)}${h(c.g)}${h(c.b)}`;
}
