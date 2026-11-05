/**
 * Export engine — zero native dependencies.
 *
 * PNG / APNG / GIF / animated SVG / sprite sheet + atlases (Aseprite, Phaser 3,
 * Godot) / GIMP palette / CSS box-shadow art / self-contained HTML gallery.
 * Everything is built from the indexed pixel buffer + palette, so exports are
 * byte-for-byte faithful to what the agent drew.
 */

import { deflateSync } from "node:zlib";
// gifenc has no "exports" map: import its ESM build directly so the named
// export is real (the CJS default interop yields an object, not a function).
import { GIFEncoder } from "gifenc/dist/gifenc.esm.js";
import { Project, Frame, compositeFrame, scalePixels } from "./canvas.js";
import { Palette } from "./palettes.js";
import { RGBA, parseColor, toHex } from "./color.js";

/* ------------------------------------------------------------------ PNG -- */

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf: Uint8Array): number {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Uint8Array): Buffer {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), Buffer.from(data)]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function u32(n: number): Buffer { const b = Buffer.alloc(4); b.writeUInt32BE(n >>> 0); return b; }
function u16(n: number): Buffer { const b = Buffer.alloc(2); b.writeUInt16BE(n); return b; }

const PNG_SIG = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

export interface EncodeOptions {
  scale?: number;         // integer nearest-neighbour
  background?: string;    // hex color; omit = transparent
  padding?: number;       // spritesheet gutter
  columns?: number;
}

function ihdr(w: number, h: number, colorType: number): Buffer {
  return chunk("IHDR", Buffer.concat([u32(w), u32(h), Buffer.from([8, colorType, 0, 0, 0])]));
}

/** Indexed PNG (color type 3) with tRNS making index 0 transparent. */
export function encodePNGIndexed(pixels: Uint8Array, w: number, h: number, palette: RGBA[], scale = 1): Buffer {
  const s = Math.max(1, Math.min(32, Math.round(scale)));
  const data = s > 1 ? scalePixels(pixels, w, h, w * s, h * s) : pixels;
  const width = w * s, height = h * s;
  const plte = Buffer.alloc(Math.min(256, palette.length) * 3);
  for (let i = 0; i < Math.min(256, palette.length); i++) {
    plte[i * 3] = palette[i].r; plte[i * 3 + 1] = palette[i].g; plte[i * 3 + 2] = palette[i].b;
  }
  const rows = Buffer.alloc(height * (width + 1));
  for (let y = 0; y < height; y++) {
    rows[y * (width + 1)] = 0; // filter: none
    Buffer.from(data.buffer, data.byteOffset + y * width, width).copy(rows, y * (width + 1) + 1);
  }
  return Buffer.concat([
    PNG_SIG,
    ihdr(width, height, 3),
    chunk("PLTE", plte),
    chunk("tRNS", Buffer.from([0])),
    chunk("IDAT", deflateSync(rows, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

/** RGBA PNG (color type 6) — used when a background color is requested. */
export function encodePNGRgba(pixels: Uint8Array, w: number, h: number, palette: RGBA[], scale = 1, background?: RGBA): Buffer {
  const s = Math.max(1, Math.min(32, Math.round(scale)));
  const data = s > 1 ? scalePixels(pixels, w, h, w * s, h * s) : pixels;
  const width = w * s, height = h * s;
  const bg = background ?? { r: 0, g: 0, b: 0, a: 0 };
  const rows = Buffer.alloc(height * (width * 4 + 1));
  for (let y = 0; y < height; y++) {
    const off = y * (width * 4 + 1);
    rows[off] = 0;
    for (let x = 0; x < width; x++) {
      const c = palette[data[y * width + x]] ?? bg;
      const o = off + 1 + x * 4;
      rows[o] = c.a ? c.r : bg.r;
      rows[o + 1] = c.a ? c.g : bg.g;
      rows[o + 2] = c.a ? c.b : bg.b;
      rows[o + 3] = c.a ? c.a : bg.a;
    }
  }
  return Buffer.concat([PNG_SIG, ihdr(width, height, 6), chunk("IDAT", deflateSync(rows, { level: 9 })), chunk("IEND", Buffer.alloc(0))]);
}

export function encodePNG(pixels: Uint8Array, w: number, h: number, palette: RGBA[], opts: EncodeOptions = {}): Buffer {
  const bg = opts.background ? parseColor(opts.background) : null;
  if (bg && bg.a > 0) return encodePNGRgba(pixels, w, h, palette, opts.scale ?? 1, bg);
  return encodePNGIndexed(pixels, w, h, palette, opts.scale ?? 1);
}

/** Animated PNG (APNG) — lossless animation with per-frame durations. */
export function encodeAPNG(frames: Array<{ pixels: Uint8Array; durationMs: number }>, w: number, h: number, palette: RGBA[], opts: EncodeOptions = {}): Buffer {
  const s = Math.max(1, Math.min(32, Math.round(opts.scale ?? 1)));
  const bg = opts.background ? parseColor(opts.background) : null;
  const width = w * s, height = h * s;
  const plte = Buffer.alloc(Math.min(256, palette.length) * 3);
  for (let i = 0; i < Math.min(256, palette.length); i++) {
    plte[i * 3] = palette[i].r; plte[i * 3 + 1] = palette[i].g; plte[i * 3 + 2] = palette[i].b;
  }
  const scanlines = (px: Uint8Array): Buffer => {
    const scaled = s > 1 ? scalePixels(px, w, h, width, height) : px;
    const rows = Buffer.alloc(height * (width + 1));
    for (let y = 0; y < height; y++) {
      rows[y * (width + 1)] = 0;
      Buffer.from(scaled.buffer, scaled.byteOffset + y * width, width).copy(rows, y * (width + 1) + 1);
    }
    return deflateSync(rows, { level: 9 });
  };
  const fctl = (seq: number, delayMs: number): Buffer => chunk("fcTL", Buffer.concat([
    u32(seq), u32(width), u32(height), u32(0), u32(0),
    u16(Math.max(1, Math.round(delayMs))), u16(1000),
    Buffer.from([0, 0]), // dispose: none (full frames), blend: source
  ]));
  const parts: Buffer[] = [PNG_SIG, ihdr(width, height, 3), chunk("PLTE", plte), chunk("tRNS", Buffer.from([0]))];
  if (bg && bg.a > 0) parts.push(chunk("bKGD", Buffer.from([0])));
  parts.push(chunk("acTL", Buffer.concat([u32(frames.length), u32(0)])));
  let seq = 0;
  frames.forEach((f, i) => {
    const payload = scanlines(f.pixels);
    parts.push(fctl(seq++, f.durationMs));
    if (i === 0) parts.push(chunk("IDAT", payload));
    else parts.push(chunk("fdAT", Buffer.concat([u32(seq++), payload])));
  });
  parts.push(chunk("IEND", Buffer.alloc(0)));
  return Buffer.concat(parts);
}

/** GIF89a with 1-bit transparency and a global palette. */
export function encodeGIF(frames: Array<{ pixels: Uint8Array; durationMs: number }>, w: number, h: number, palette: RGBA[], opts: EncodeOptions & { loop?: boolean } = {}): Buffer {
  const s = Math.max(1, Math.min(16, Math.round(opts.scale ?? 1)));
  const width = w * s, height = h * s;
  const colors: number[][] = palette.slice(0, 256).map(c => [c.r, c.g, c.b]);
  while (colors.length < 2) colors.push([0, 0, 0]);
  const gif = GIFEncoder();
  frames.forEach((f, i) => {
    const scaled = s > 1 ? scalePixels(f.pixels, w, h, width, height) : f.pixels;
    gif.writeFrame(scaled, width, height, {
      palette: i === 0 ? colors : undefined,
      delay: Math.max(20, Math.round(f.durationMs)),
      transparent: true,
      transparentIndex: 0,
      dispose: 2,
      repeat: opts.loop === false ? -1 : 0,
    });
  });
  gif.finish();
  return Buffer.from(gif.bytes());
}

/* ----------------------------------------------------------------- SVG -- */

function escapeXml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function rectRuns(pixels: Uint8Array, w: number, h: number, palette: RGBA[]): string {
  const parts: string[] = [];
  for (let y = 0; y < h; y++) {
    let x = 0;
    while (x < w) {
      const c = pixels[y * w + x];
      if (!c) { x++; continue; }
      let run = 1;
      while (x + run < w && pixels[y * w + x + run] === c) run++;
      parts.push(`<rect x="${x}" y="${y}" width="${run}" height="1" fill="${toHex(palette[c])}"/>`);
      x += run;
    }
  }
  return parts.join("");
}

/** Single-frame or SMIL-animated SVG. One `<rect>` per horizontal pixel run. */
export function encodeSVG(frames: Array<{ pixels: Uint8Array; durationMs: number }>, w: number, h: number, palette: RGBA[]): string {
  const head = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w * 8}" height="${h * 8}" shape-rendering="crispEdges" style="image-rendering:pixelated">`;
  if (frames.length <= 1) return `${head}${frames[0] ? rectRuns(frames[0].pixels, w, h, palette) : ""}</svg>`;
  const total = frames.reduce((a, f) => a + f.durationMs, 0) || 1;
  // Discrete opacity animation: each group is visible during exactly one frame.
  let acc = 0;
  const keyTimes: number[] = [0];
  for (const f of frames) { acc += f.durationMs; keyTimes.push(acc / total); }
  const groups = frames.map((f, i) => {
    const values = frames.map((_, k) => (k === i ? "1" : "0"));
    values.push(values[0]); // loop back
    const anim = `<animate attributeName="opacity" calcMode="discrete" values="${values.join(";")}" keyTimes="${keyTimes.map(k => k.toFixed(5)).join(";")}" dur="${total}ms" repeatCount="indefinite"/>`;
    return `<g opacity="0">${rectRuns(f.pixels, w, h, palette)}${anim}</g>`;
  }).join("");
  return `${head}${groups}</svg>`;
}

/* -------------------------------------------------------- spritesheet -- */

export interface SheetLayout {
  columns: number;
  rows: number;
  padding: number;
  cellW: number;
  cellH: number;
  width: number;
  height: number;
  rects: Array<{ x: number; y: number; w: number; h: number }>;
}

export function packSheet(frames: Array<{ pixels: Uint8Array }>, w: number, h: number, opts: EncodeOptions = {}): { pixels: Uint8Array; layout: SheetLayout } {
  const padding = Math.max(0, Math.min(16, Math.round(opts.padding ?? 0)));
  const columns = Math.max(1, Math.min(frames.length, Math.round(opts.columns ?? Math.ceil(Math.sqrt(frames.length)))));
  const rows = Math.ceil(frames.length / columns);
  const cellW = w + padding * 2, cellH = h + padding * 2;
  const width = cellW * columns, height = cellH * rows;
  const out = new Uint8Array(width * height);
  const rects: SheetLayout["rects"] = [];
  frames.forEach((f, i) => {
    const cx = (i % columns) * cellW, cy = Math.floor(i / columns) * cellH;
    rects.push({ x: cx + padding, y: cy + padding, w, h });
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) out[(cy + padding + y) * width + cx + padding + x] = f.pixels[y * w + x];
  });
  return { pixels: out, layout: { columns, rows, padding, cellW, cellH, width, height, rects } };
}

export type AtlasFlavor = "aseprite" | "phaser3" | "simple";

export function buildAtlas(project: Project, flavor: AtlasFlavor, layout: SheetLayout, imageName: string): string {
  const frames = project.frames;
  const entries = frames.map((f, i) => ({
    name: `frame_${String(i).padStart(2, "0")}`,
    label: f.name,
    filename: `${project.name.replace(/\s+/g, "_")}_${String(i).padStart(2, "0")}.png`,
    rect: layout.rects[i],
    duration: f.durationMs,
    tags: f.tags,
  }));
  const size = { w: layout.width, h: layout.height };
  const sourceSize = { w: project.width, h: project.height };
  if (flavor === "simple") {
    return JSON.stringify({ image: imageName, size, frameSize: sourceSize, columns: layout.columns, rows: layout.rows, padding: layout.padding, frames: entries }, null, 2);
  }
  if (flavor === "phaser3") {
    return JSON.stringify({
      frames: entries.map(e => ({
        filename: e.filename,
        frame: { x: e.rect.x, y: e.rect.y, w: e.rect.w, h: e.rect.h },
        rotated: false, trimmed: false,
        spriteSourceSize: { x: 0, y: 0, w: e.rect.w, h: e.rect.h },
        sourceSize,
      })),
      meta: { app: "sprite-agent-mcp", version: "1.0", image: imageName, format: "RGBA8888", size, scale: "1" },
    }, null, 2);
  }
  return JSON.stringify({
    frames: entries.map(e => ({
      filename: e.filename,
      frame: { x: e.rect.x, y: e.rect.y, w: e.rect.w, h: e.rect.h },
      rotated: false, trimmed: false,
      spriteSourceSize: { x: 0, y: 0, w: e.rect.w, h: e.rect.h },
      sourceSize,
      duration: e.duration,
    })),
    meta: {
      app: "sprite-agent-mcp", version: "1.0.0", image: imageName,
      format: "RGBA8888", size, scale: "1",
      frameTags: buildFrameTags(frames),
      layers: [{ name: "art", opacity: 255, blendMode: "normal" }],
      slices: [],
    },
  }, null, 2);
}

function buildFrameTags(frames: Frame[]): Array<{ name: string; from: number; to: number; direction: string }> {
  const map = new Map<string, { from: number; to: number }>();
  frames.forEach((f, i) => f.tags.forEach(t => {
    const cur = map.get(t);
    if (cur) cur.to = i; else map.set(t, { from: i, to: i });
  }));
  const tags = [...map.entries()].map(([name, r]) => ({ name, from: r.from, to: r.to, direction: "forward" }));
  if (!tags.length && frames.length) tags.push({ name: "loop", from: 0, to: frames.length - 1, direction: "forward" });
  return tags;
}

/** Godot 4 SpriteFrames-style .tres snippet (texture path must be filled by the user). */
export function buildGodotTres(project: Project, imageName: string, layout: SheetLayout): string {
  const animName = project.tags[0] ?? "default";
  const fps = 1000 / (project.frames[0]?.durationMs ?? 100);
  let s = `[gd_resource type="SpriteFrames" load_steps=2 format=3]\n\n`;
  s += `[ext_resource type="Texture2D" path="res://${imageName}" id="1_tex"]\n\n`;
  s += `[resource]\n`;
  s += `animations = [{\n"frames": [\n`;
  project.frames.forEach((f, i) => {
    const r = layout.rects[i] ?? { x: 0, y: 0, w: project.width, h: project.height };
    s += `  {"duration": ${(1 / fps).toFixed(3)}, "texture": ExtResource("1_tex"), "region": Rect2(${r.x}, ${r.y}, ${r.w}, ${r.h})},\n`;
  });
  s += `], "loop": true, "name": &"${escapeXml(animName)}", "speed": ${fps.toFixed(2)}\n}]\n`;
  return s;
}

export function buildGPL(palette: Palette): string {
  const lines = ["GIMP Palette", `Name: ${palette.name}`, `Columns: ${Math.min(8, Math.max(2, Math.ceil(Math.sqrt(palette.colors.length - 1))))}`, "# sprite-agent-mcp"];
  for (let i = 1; i < palette.colors.length; i++) {
    const c = palette.colors[i];
    lines.push(`${String(c.r).padStart(3)} ${String(c.g).padStart(3)} ${String(c.b).padStart(3)}\t${toHex(c)}`);
  }
  return lines.join("\n") + "\n";
}

/** CSS box-shadow pixel art — a single div, no image files at all. */
export function buildCSS(pixels: Uint8Array, w: number, h: number, palette: RGBA[], scale = 8): string {
  if (w * h > 4096) throw new Error("CSS export is limited to 4096 pixels; export PNG instead.");
  const shadows: string[] = [];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const c = pixels[y * w + x];
    if (c) shadows.push(`${x * scale}px ${y * scale}px 0 ${toHex(palette[c])}`);
  }
  return `.sprite {\n  width: ${scale}px;\n  height: ${scale}px;\n  background: transparent;\n  box-shadow: ${shadows.join(", ")};\n  image-rendering: pixelated;\n}\n/* ${w}×${h} · ${shadows.length} pixels · palette ${palette.length - 1} colors */\n`;
}

/* -------------------------------------------------------------- gallery -- */

export interface GalleryOptions {
  title?: string;
  scale?: number;
  background?: string;
}

/** Fully self-contained HTML player (inline images/CSS/JS) — works offline & in sandboxed iframes. */
export function buildGallery(project: Project, opts: GalleryOptions = {}): string {
  const scale = Math.max(1, Math.min(16, Math.round(opts.scale ?? 8)));
  const frames = project.frames.map((f, i) => ({
    name: f.name,
    duration: f.durationMs,
    tags: f.tags,
    data: encodePNG(compositeFrame(project, f), project.width, project.height, project.palette.colors, { scale }).toString("base64"),
  }));
  const swatches = project.palette.colors.slice(1).map((c, i) => `<span class="sw" style="background:${toHex(c)}" title="#${i + 1} ${toHex(c)}"></span>`).join("");
  const payload = JSON.stringify({
    frames, w: project.width * scale, h: project.height * scale,
    sw: project.width, sh: project.height, scale,
    project: project.name, palette: project.palette.name,
    colorCount: project.palette.colors.length - 1, count: frames.length,
  });
  const bg = opts.background ?? "#14121c";
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeXml(opts.title ?? project.name)} — sprite-agent-mcp</title>
<style>
:root{--bg:${bg};--panel:#1e1b2b;--line:#332e49;--txt:#f3eaff;--muted:#a99fc4;--hi:#ffcc66}
*{box-sizing:border-box}body{margin:0;background:radial-gradient(1200px 600px at 50% -10%,#2a2340,var(--bg));color:var(--txt);font:14px/1.5 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;min-height:100vh}
.wrap{max-width:1080px;margin:0 auto;padding:28px 20px 60px}
header{display:flex;flex-wrap:wrap;gap:12px;align-items:baseline;justify-content:space-between;border-bottom:1px solid var(--line);padding-bottom:14px;margin-bottom:22px}
h1{margin:0;font-size:22px;letter-spacing:.5px}h1 b{color:var(--hi)}.sub{color:var(--muted);font-size:12px}
.badge{border:1px solid var(--line);border-radius:99px;padding:3px 10px;color:var(--muted);font-size:11px}
.grid{display:grid;grid-template-columns:minmax(280px,1fr) 300px;gap:22px}@media(max-width:820px){.grid{grid-template-columns:1fr}}
.card{background:var(--panel);border:1px solid var(--line);border-radius:14px;padding:18px;box-shadow:0 18px 50px #0005}
.stage{position:relative;display:grid;place-items:center;min-height:340px;background:
 linear-gradient(45deg,#232033 25%,transparent 25%,transparent 75%,#232033 75%),
 linear-gradient(45deg,#232033 25%,transparent 25%,transparent 75%,#232033 75%);
 background-size:20px 20px;background-position:0 0,10px 10px;border-radius:10px;overflow:hidden;padding:24px;border:1px solid var(--line)}
.stage canvas{image-rendering:pixelated;image-rendering:crisp-edges;filter:drop-shadow(0 10px 16px #0008)}
.controls{display:flex;flex-wrap:wrap;gap:10px;align-items:center;margin-top:16px}
button{background:#2c2642;color:var(--txt);border:1px solid var(--line);border-radius:9px;padding:8px 14px;cursor:pointer;font:inherit}
button:hover{border-color:var(--hi);color:var(--hi)}button.primary{background:var(--hi);color:#241c0a;border-color:var(--hi);font-weight:700}
input[type=range]{accent-color:var(--hi);width:120px}label{color:var(--muted);font-size:12px;display:flex;gap:8px;align-items:center}
.strip{display:flex;gap:8px;overflow-x:auto;margin-top:16px;padding:4px 2px 10px}
.strip canvas{image-rendering:pixelated;width:64px;height:64px;object-fit:contain;background:#191625;border:1px solid var(--line);border-radius:8px;cursor:pointer;padding:4px}
.strip canvas.on{border-color:var(--hi);box-shadow:0 0 0 2px #ffcc6655}
.swatches{display:flex;flex-wrap:wrap;gap:5px;margin-top:12px}.sw{width:20px;height:20px;border-radius:4px;border:1px solid #0006}
table{width:100%;border-collapse:collapse;font-size:12px}td,th{text-align:left;padding:6px 4px;border-bottom:1px solid var(--line)}th{color:var(--muted);font-weight:400}
a{color:var(--hi)}.hint{color:var(--muted);font-size:11px;margin-top:14px;border-top:1px solid var(--line);padding-top:12px}
.tag{display:inline-block;background:#2c2642;border-radius:6px;padding:1px 6px;margin:2px;font-size:10px;color:var(--muted)}
</style></head><body><div class="wrap">
<header><div><h1>✦ <b>${escapeXml(opts.title ?? project.name)}</b> <span class="sub">/ sprite-agent-mcp</span></h1>
<div class="sub" id="meta"></div></div><div class="badge">MCP · READ-ONLY REPO · DO NOT EDIT SOURCE</div></header>
<div class="grid"><div class="card">
<div class="stage"><canvas id="main"></canvas><canvas id="onion" style="position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);opacity:0;pointer-events:none"></canvas></div>
<div class="controls"><button id="play" class="primary">▶ Play</button><button id="prev">◀</button><button id="next">▶</button>
<label>zoom <input id="zoom" type="range" min="1" max="16" value="8"></label>
<label>onion <input id="onionChk" type="checkbox"></label><span class="sub" id="status"></span></div>
<div class="strip" id="strip"></div></div>
<div class="card"><h3 style="margin:0 0 10px;font-size:14px">Project</h3><table id="info"></table>
<h3 style="margin:20px 0 8px;font-size:14px">Palette <span class="sub" id="palName"></span></h3><div class="swatches">${swatches}</div>
<h3 style="margin:20px 0 8px;font-size:14px">Frames</h3><div id="frameTags"></div>
<div class="hint">Generated by <b>sprite-agent-mcp</b>. Agents must only call MCP tools — never edit repository source files. Export with <code>sprite_export</code>.</div>
</div></div>
<script>
const D=${payload};
const main=document.getElementById('main'),onion=document.getElementById('onion'),strip=document.getElementById('strip');
let cur=0,playing=false,timer=null,zoom=8;
const imgs=D.frames.map(f=>{const i=new Image();i.src='data:image/png;base64,'+f.data;return i;});
function applyZoom(){const px=D.sw*zoom;main.style.width=px+'px';main.style.height=D.sh*zoom+'px';onion.style.width=px+'px';onion.style.height=D.sh*zoom+'px';}
function draw(){const w=D.w,h=D.h;main.width=w;main.height=h;onion.width=w;onion.height=h;applyZoom();
 const c=main.getContext('2d');c.imageSmoothingEnabled=false;c.clearRect(0,0,w,h);
 if(imgs[cur].complete)c.drawImage(imgs[cur],0,0,w,h);else imgs[cur].onload=()=>c.drawImage(imgs[cur],0,0,w,h);
 const prev=(cur-1+D.count)%D.count;const oc=onion.getContext('2d');oc.clearRect(0,0,w,h);oc.imageSmoothingEnabled=false;
 onion.style.opacity=document.getElementById('onionChk').checked?'0.28':'0';
 if(imgs[prev].complete)oc.drawImage(imgs[prev],0,0,w,h);else imgs[prev].onload=()=>oc.drawImage(imgs[prev],0,0,w,h);
 document.getElementById('status').textContent='frame '+(cur+1)+'/'+D.count+' · '+D.frames[cur].duration+'ms · '+D.frames[cur].name;
 [...strip.children].forEach((e,i)=>e.classList.toggle('on',i===cur));}
function step(n){cur=(cur+n+D.count)%D.count;draw();if(playing)schedule();}
function schedule(){clearTimeout(timer);timer=setTimeout(()=>step(1),D.frames[cur].duration);}
document.getElementById('play').onclick=()=>{playing=!playing;document.getElementById('play').textContent=playing?'❚❚ Pause':'▶ Play';if(playing)schedule();else clearTimeout(timer);};
document.getElementById('prev').onclick=()=>step(-1);document.getElementById('next').onclick=()=>step(1);
document.getElementById('onionChk').onchange=draw;
document.getElementById('zoom').value=D.scale;zoom=D.scale;
document.getElementById('zoom').onchange=e=>{zoom=+e.target.value;applyZoom();};
imgs.forEach((im,i)=>{const c=document.createElement('canvas');c.width=c.height=64;c.title=D.frames[i].name;
 if(im.complete){const x=c.getContext('2d');x.imageSmoothingEnabled=false;x.drawImage(im,0,0,64,64);}else im.onload=()=>{const x=c.getContext('2d');x.imageSmoothingEnabled=false;x.drawImage(im,0,0,64,64);};
 c.onclick=()=>{cur=i;draw();};strip.appendChild(c);});
document.getElementById('meta').textContent=D.project+' · '+D.sw+'×'+D.sh+' px · '+D.count+' frames · palette '+D.palette+' ('+D.colorCount+' colors)';
document.getElementById('info').innerHTML='<tr><th>Size</th><td>'+D.sw+'×'+D.sh+' px</td></tr>'+'<tr><th>Frames</th><td>'+D.count+'</td></tr>'+
 '<tr><th>Total time</th><td>'+D.frames.reduce((a,f)=>a+f.duration,0)+' ms</td></tr>'+'<tr><th>Palette</th><td>'+D.palette+' · '+D.colorCount+' colors</td></tr>'+
 '<tr><th>Export</th><td>PNG · GIF · APNG · SVG · atlas</td></tr>';
document.getElementById('palName').textContent=D.palette;
document.getElementById('frameTags').innerHTML=D.frames.map((f,i)=>'<span class="tag">'+(i+1)+' '+f.name+(f.tags.length?' · '+f.tags.join('/'):'')+'</span>').join('');
draw();
</script></body></html>`;
}
