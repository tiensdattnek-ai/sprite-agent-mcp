/**
 * sprite-agent-mcp — color primitives.
 * Pure, dependency-free, deterministic. Everything is 8-bit RGBA.
 * Copyright (c) 2026 sprite-agent-mcp contributors. MIT.
 */

export interface RGBA {
  r: number;
  g: number;
  b: number;
  a: number;
}

export const TRANSPARENT: RGBA = Object.freeze({ r: 0, g: 0, b: 0, a: 0 });

const NAMED: Record<string, string> = {
  transparent: "#00000000", none: "#00000000", black: "#000000", white: "#ffffff",
  red: "#ff0044", orange: "#ff8c00", yellow: "#ffec27", green: "#00e436",
  cyan: "#29adff", blue: "#1d2b53", purple: "#83769c", magenta: "#ff77a8",
  pink: "#ff77a8", gray: "#9badb7", grey: "#9badb7", brown: "#8f563b",
  skin: "#eec39a", gold: "#fee761", silver: "#c2c3c7", dark: "#222034",
};

export function clamp255(n: number): number {
  return n < 0 ? 0 : n > 255 ? 255 : Math.round(n);
}

/** Parse a CSS-ish color string. Returns null for unknown input. */
export function parseColor(input: string): RGBA | null {
  if (typeof input !== "string") return null;
  let s = input.trim().toLowerCase();
  if (NAMED[s]) s = NAMED[s];
  if (s === "" || s === "." || s === "_" || s === "0" && false) return { ...TRANSPARENT };
  if (s.startsWith("#")) {
    const h = s.slice(1);
    if (/^[0-9a-f]{3}$/.test(h)) return { r: parseInt(h[0] + h[0], 16), g: parseInt(h[1] + h[1], 16), b: parseInt(h[2] + h[2], 16), a: 255 };
    if (/^[0-9a-f]{4}$/.test(h)) return { r: parseInt(h[0] + h[0], 16), g: parseInt(h[1] + h[1], 16), b: parseInt(h[2] + h[2], 16), a: parseInt(h[3] + h[3], 16) };
    if (/^[0-9a-f]{6}$/.test(h)) return { r: parseInt(h.slice(0, 2), 16), g: parseInt(h.slice(2, 4), 16), b: parseInt(h.slice(4, 6), 16), a: 255 };
    if (/^[0-9a-f]{8}$/.test(h)) return { r: parseInt(h.slice(0, 2), 16), g: parseInt(h.slice(2, 4), 16), b: parseInt(h.slice(4, 6), 16), a: parseInt(h.slice(6, 8), 16) };
    return null;
  }
  const rgb = s.match(/^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:[,\s/]+([\d.]+%?))?\s*\)$/);
  if (rgb) {
    const a = rgb[4] === undefined ? 255 : rgb[4].includes("%") ? (parseFloat(rgb[4]) / 100) * 255 : parseFloat(rgb[4]) * 255;
    return { r: clamp255(parseFloat(rgb[1])), g: clamp255(parseFloat(rgb[2])), b: clamp255(parseFloat(rgb[3])), a: clamp255(a) };
  }
  const hsl = s.match(/^hsla?\(\s*([\d.]+)[,\s]+([\d.]+)%[,\s]+([\d.]+)%(?:[,\s/]+([\d.]+%?))?\s*\)$/);
  if (hsl) {
    const a = hsl[4] === undefined ? 255 : hsl[4].includes("%") ? (parseFloat(hsl[4]) / 100) * 255 : parseFloat(hsl[4]) * 255;
    const c = hslToRgb(parseFloat(hsl[1]), parseFloat(hsl[2]) / 100, parseFloat(hsl[3]) / 100);
    return { ...c, a: clamp255(a) };
  }
  return null;
}

export function isTransparent(c: RGBA): boolean {
  return c.a === 0;
}

export function toHex(c: RGBA): string {
  if (c.a === 0) return "transparent";
  const h = (n: number) => clamp255(n).toString(16).padStart(2, "0");
  return `#${h(c.r)}${h(c.g)}${h(c.b)}${c.a < 255 ? h(c.a) : ""}`;
}

export function sameColor(a: RGBA, b: RGBA): boolean {
  return a.r === b.r && a.g === b.g && a.b === b.b && a.a === b.a;
}

export function rgbToHsl(r: number, g: number, b: number): { h: number; s: number; l: number } {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  let h = 0;
  const l = (max + min) / 2;
  const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
  if (d !== 0) {
    switch (max) {
      case r: h = ((g - b) / d) % 6; break;
      case g: h = (b - r) / d + 2; break;
      default: h = (r - g) / d + 4;
    }
    h *= 60;
    if (h < 0) h += 360;
  }
  return { h, s, l };
}

export function hslToRgb(h: number, s: number, l: number): RGBA {
  h = ((h % 360) + 360) % 360;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  let r = 0, g = 0, b = 0;
  if (h < 60) { r = c; g = x; }
  else if (h < 120) { r = x; g = c; }
  else if (h < 180) { g = c; b = x; }
  else if (h < 240) { g = x; b = c; }
  else if (h < 300) { r = x; b = c; }
  else { r = c; b = x; }
  return { r: clamp255((r + m) * 255), g: clamp255((g + m) * 255), b: clamp255((b + m) * 255), a: 255 };
}

/** Perceptual-ish luminance 0..255. */
export function luminance(c: RGBA): number {
  return 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
}

/** WCAG contrast ratio. */
export function contrast(a: RGBA, b: RGBA): number {
  const lin = (v: number) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
  const L = (c: RGBA) => 0.2126 * lin(c.r) + 0.7152 * lin(c.g) + 0.0722 * lin(c.b);
  const l1 = L(a), l2 = L(b);
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
}

export function mix(a: RGBA, b: RGBA, t: number): RGBA {
  return {
    r: clamp255(a.r + (b.r - a.r) * t),
    g: clamp255(a.g + (b.g - a.g) * t),
    b: clamp255(a.b + (b.b - a.b) * t),
    a: clamp255(a.a + (b.a - a.a) * t),
  };
}

/** Shortest signed angular distance from `from` to `to` on the hue wheel. */
export function hueDelta(from: number, to: number): number {
  return ((to - from + 540) % 360) - 180;
}

export function circularHueDistance(a: number, b: number): number {
  return Math.abs(hueDelta(a, b));
}

const COOL_HUE = 250; // blue / violet
const WARM_HUE = 45;  // amber / yellow

/**
 * Hue-shifted shading — the single biggest "pro pixel art" trick.
 * Shadows get darker, COOLER (hue rotates toward blue/violet along the shortest
 * arc) and more saturated; highlights get lighter, WARMER (toward amber) and
 * slightly less saturated. Works for every base hue, unlike a fixed ±rotation.
 */
export function shadeColor(c: RGBA, amount: number): RGBA {
  const { h, s, l } = rgbToHsl(c.r, c.g, c.b);
  const t = Math.max(-1, Math.min(1, amount));
  const target = t < 0 ? COOL_HUE : WARM_HUE;
  const strength = Math.abs(t) * 0.18;
  const nh = h + hueDelta(h, target) * strength;
  const ns = Math.max(0, Math.min(1, s + (t < 0 ? 0.14 * -t : -0.06 * t)));
  const nl = Math.max(0, Math.min(1, l + t * 0.30));
  return { ...hslToRgb(nh, ns, nl), a: c.a };
}

/** Squared perceptual distance; transparent colors are never matched to opaque ones. */
export function colorDistance(a: RGBA, b: RGBA): number {
  if (a.a === 0 || b.a === 0) return a.a === b.a ? 0 : 1e9;
  const dr = a.r - b.r, dg = a.g - b.g, db = a.b - b.b;
  return 0.30 * dr * dr + 0.59 * dg * dg + 0.11 * db * db;
}

export function nearestIndex(colors: RGBA[], target: RGBA, startAt = 1): number {
  let best = startAt, bestD = Infinity;
  for (let i = startAt; i < colors.length; i++) {
    const d = colorDistance(colors[i], target);
    if (d < bestD) { bestD = d; best = i; }
  }
  return best;
}

/** Build a dark→light ramp of `steps` colors around a base color. */
export function makeRamp(base: RGBA, steps = 5): RGBA[] {
  const out: RGBA[] = [];
  for (let i = 0; i < steps; i++) out.push(shadeColor(base, (i / (steps - 1)) * 1.6 - 0.8));
  return out;
}
