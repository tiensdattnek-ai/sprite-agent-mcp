/**
 * ASCII grid I/O — the interface LLMs are genuinely good at.
 *
 * An agent draws by WRITING TEXT:
 *   grid:  "..ooo..\n.osssso.\n.obbbbo.\n..oooo.."
 *   legend: { o: "outline", s: "skin", b: "base" }
 * ...and gets back a real indexed sprite, an inline PNG preview and an export.
 * `---` on its own line starts a new animation frame, so one call can create
 * an entire animation.
 */

import { LayerView } from "./canvas.js";
import { Palette, resolveColor } from "./palettes.js";

export interface GridFrame {
  rows: string[];
  width: number;
  height: number;
  label?: string;
}

/** Characters that always mean "no pixel", regardless of legend. */
export const EMPTY_CHARS = new Set([" ", ".", "_", "0"]);

/** Split a multi-frame grid string on lines containing only dashes. */
export function splitGridFrames(text: string | string[]): string[] {
  const raw = Array.isArray(text) ? text.join("\n") : text;
  const lines = raw.replace(/\r\n/g, "\n").split("\n");
  const chunks: string[][] = [[]];
  for (const line of lines) {
    if (/^\s*-{3,}\s*$/.test(line)) { chunks.push([]); continue; }
    chunks[chunks.length - 1].push(line);
  }
  return chunks.map(c => c.join("\n")).filter(s => s.replace(/\s/g, "").length > 0);
}

export function parseGrid(text: string): GridFrame {
  const lines = text.replace(/\r\n/g, "\n").replace(/^\n+|\n+$/g, "").split("\n").map(l => l.replace(/\t/g, "  "));
  const width = Math.max(1, ...lines.map(l => l.length));
  const rows = lines.map(l => l.padEnd(width, " "));
  return { rows, width, height: rows.length };
}

const AUTO_ROLES = ["outline", "shadow", "base", "light", "highlight", "accent", "accent2", "metal", "skin", "nature", "water", "white"];

/** Deterministic auto-legend so an agent can omit `legend` entirely. */
export function autoLegend(text: string, palette: Palette): Record<string, string> {
  const seen: string[] = [];
  for (const ch of text) {
    if (ch === "\n" || ch === "\r" || ch === "-" || EMPTY_CHARS.has(ch)) continue;
    if (!seen.includes(ch)) seen.push(ch);
  }
  const legend: Record<string, string> = {};
  const ramp = palette.ramp;
  seen.forEach((ch, i) => {
    if (i < AUTO_ROLES.length && palette.roles[AUTO_ROLES[i]] !== undefined) legend[ch] = AUTO_ROLES[i];
    else legend[ch] = `ramp:${Math.min(ramp.length - 1, Math.floor(((i - AUTO_ROLES.length) / Math.max(1, ramp.length)) * ramp.length) + Math.floor(ramp.length / 2))}`;
  });
  return legend;
}

export interface DrawGridOptions {
  legend?: Record<string, string | number>;
  at?: { x: number; y: number };
  mirrorX?: boolean;
  mirrorY?: boolean;
  scale?: number;      // integer nearest-neighbour multiplier
  clear?: boolean;
  transparentChar?: string;
}

export function drawGrid(
  view: LayerView,
  grid: GridFrame,
  opts: DrawGridOptions = {},
): { pixelsWritten: number; legend: Record<string, number> } {
  const project = view.palette;
  const text = grid.rows.join("\n");
  const legend = opts.legend ?? autoLegend(text, project);
  const resolved: Record<string, number> = {};
  for (const [ch, spec] of Object.entries(legend)) resolved[ch] = resolveColor(project, spec);
  if (opts.transparentChar) resolved[opts.transparentChar] = 0;
  const scale = Math.max(1, Math.min(16, Math.round(opts.scale ?? 1)));
  if (opts.clear) view.clear();
  const ox = opts.at?.x ?? 0, oy = opts.at?.y ?? 0;
  let written = 0;
  for (let y = 0; y < grid.height; y++) {
    const row = grid.rows[y];
    for (let x = 0; x < row.length; x++) {
      const ch = row[x];
      if (EMPTY_CHARS.has(ch) && resolved[ch] === undefined) continue;
      const idx = resolved[ch];
      if (idx === undefined) continue; // unknown char = leave existing pixel untouched
      for (let sy = 0; sy < scale; sy++) for (let sx = 0; sx < scale; sx++) {
        const px = ox + x * scale + sx, py = oy + y * scale + sy;
        view.set(px, py, idx);
        if (idx) written++;
        if (opts.mirrorX) view.set(view.width - 1 - px, py, idx);
        if (opts.mirrorY) view.set(px, view.height - 1 - py, idx);
        if (opts.mirrorX && opts.mirrorY) view.set(view.width - 1 - px, view.height - 1 - py, idx);
      }
    }
  }
  return { pixelsWritten: written, legend: resolved };
}

const ASCII_CHARS = "123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";

/** Render a frame back to text + its legend, so a text-only model can iterate. */
export function frameToAscii(pixels: Uint8Array, width: number, height: number): { ascii: string; legend: Record<string, number>; empty: string } {
  const used = [...new Set(Array.from(pixels).filter(Boolean))].sort((a, b) => a - b);
  const legend: Record<string, number> = {};
  used.forEach((idx, i) => { legend[ASCII_CHARS[i % ASCII_CHARS.length]] = idx; });
  const byIndex = new Map(Object.entries(legend).map(([ch, idx]) => [idx, ch]));
  const lines: string[] = [];
  for (let y = 0; y < height; y++) {
    let line = "";
    for (let x = 0; x < width; x++) line += byIndex.get(pixels[y * width + x]) ?? ".";
    lines.push(line);
  }
  return { ascii: lines.join("\n"), legend, empty: "." };
}

/** Compact contact sheet of several frames as one text block. */
export function framesToAsciiSheet(frames: Array<{ pixels: Uint8Array; name: string }>, width: number, height: number): string {
  return frames.map((f, i) => `--- frame ${i}: ${f.name} ---\n${frameToAscii(f.pixels, width, height).ascii}`).join("\n");
}

export function frameName(index: number, prefix = "frame"): string {
  return `${prefix}_${String(index).padStart(2, "0")}`;
}
