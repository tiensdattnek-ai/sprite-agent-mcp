/**
 * Curated pixel-art palettes + role resolution.
 *
 * A palette is INDEXED: slot 0 is always transparent. Slot 1..255 are colors.
 * `roles` map semantic names ("outline", "shadow", "base", "light",
 * "highlight", "accent", "skin", "metal", ...) to palette indices, so an AI
 * agent can draw with intent instead of memorising hex codes.
 */

import { RGBA, TRANSPARENT, parseColor, luminance, nearestIndex, sameColor, toHex } from "./color.js";

export interface Palette {
  name: string;
  colors: RGBA[];               // colors[0] === transparent sentinel
  roles: Record<string, number>; // semantic name -> palette index
  ramp: number[];               // indices sorted dark -> light
  description?: string;
}

export interface PaletteDef {
  name: string;
  colors: string[];
  roles?: Record<string, string>;
  description?: string;
}

const DEFS: PaletteDef[] = [
  {
    name: "db32",
    description: "DawnBringer 32 — the all-round RPG / platformer workhorse. Warm ramps, great skin and metal.",
    colors: [
      "#000000", "#222034", "#45283c", "#663931", "#8f563b", "#df7126", "#d9a066", "#eec39a",
      "#fbf236", "#99e550", "#6abe30", "#37946e", "#4b692f", "#524b24", "#323c39", "#3f3f74",
      "#306082", "#5b6ee1", "#639bff", "#5fcde4", "#cbdbfc", "#ffffff", "#9badb7", "#847e87",
      "#696a6a", "#595652", "#76428a", "#ac3232", "#d95763", "#d77bba", "#8f974a", "#8a6f30",
    ],
    roles: {
      outline: "#222034", shadow: "#45283c", dark: "#663931", base: "#8f563b",
      light: "#d9a066", highlight: "#eec39a", skin: "#eec39a", skinShadow: "#d9a066",
      accent: "#fbf236", accent2: "#d95763", metal: "#9badb7", metalLight: "#cbdbfc",
      nature: "#6abe30", water: "#5b6ee1", white: "#ffffff", black: "#000000",
    },
  },
  {
    name: "pico8",
    description: "PICO-8 fantasy console — 16 colors, brutally readable, perfect for game jams.",
    colors: [
      "#000000", "#1d2b53", "#7e2553", "#008751", "#ab5236", "#5f574f", "#c2c3c7", "#fff1e8",
      "#ff004d", "#ffa300", "#ffec27", "#00e436", "#29adff", "#83769c", "#ff77a8", "#ffccaa",
    ],
    roles: {
      outline: "#1d2b53", shadow: "#7e2553", dark: "#ab5236", base: "#ffa300",
      light: "#ffec27", highlight: "#fff1e8", skin: "#ffccaa", accent: "#ff004d",
      accent2: "#ff77a8", metal: "#c2c3c7", nature: "#00e436", water: "#29adff",
      white: "#fff1e8", black: "#000000",
    },
  },
  {
    name: "sweetie16",
    description: "Sweetie 16 (GrafxKid) — soft, modern, high-contrast. Beautiful UI and characters.",
    colors: [
      "#1a1c2c", "#5d275d", "#b13e53", "#ef7d57", "#ffcd75", "#a7f070", "#38b764", "#257179",
      "#29366f", "#3b5dc9", "#41a6f6", "#73eff7", "#f4f4f4", "#94b0c2", "#566c86", "#333c57",
    ],
    roles: {
      outline: "#1a1c2c", shadow: "#5d275d", dark: "#b13e53", base: "#ef7d57",
      light: "#ffcd75", highlight: "#f4f4f4", skin: "#ffcd75", accent: "#41a6f6",
      accent2: "#b13e53", metal: "#94b0c2", nature: "#a7f070", water: "#3b5dc9",
      white: "#f4f4f4", black: "#1a1c2c",
    },
  },
  {
    name: "endesga32",
    description: "Endesga-inspired 32 — lush ramps made for hue-shifted shading and rich materials.",
    colors: [
      "#be4a2f", "#d77643", "#ead4aa", "#e4a672", "#b86f50", "#733e39", "#3e2731", "#a22633",
      "#e43b44", "#f77622", "#feae34", "#fee761", "#63c74d", "#3e8948", "#265c42", "#193c3e",
      "#124e89", "#0099db", "#2ce8f5", "#ffffff", "#c0cbdc", "#8b9bb4", "#5a6988", "#3a4466",
      "#262b44", "#181425", "#ff0044", "#68386c", "#b55088", "#f6757a", "#e8b796", "#c28569",
    ],
    roles: {
      outline: "#181425", shadow: "#262b44", dark: "#a22633", base: "#e43b44",
      light: "#f77622", highlight: "#fee761", skin: "#ead4aa", skinShadow: "#e4a672",
      accent: "#2ce8f5", accent2: "#ff0044", metal: "#8b9bb4", metalLight: "#c0cbdc",
      nature: "#63c74d", water: "#0099db", white: "#ffffff", black: "#181425",
    },
  },
  {
    name: "gameboy",
    description: "Original DMG Game Boy — 4 shades of green. Pure nostalgia, ruthless color economy.",
    colors: ["#0f380f", "#306230", "#8bac0f", "#9bbc0f"],
    roles: { outline: "#0f380f", shadow: "#306230", base: "#8bac0f", light: "#9bbc0f", highlight: "#9bbc0f", white: "#9bbc0f", black: "#0f380f" },
  },
  {
    name: "gameboy-pocket",
    description: "Game Boy Pocket / 1-bit LCD — monochrome, crisp, ideal for icons.",
    colors: ["#181818", "#4a4a4a", "#8c8c8c", "#c6c6c6", "#e8e8e8"],
    roles: { outline: "#181818", shadow: "#4a4a4a", base: "#8c8c8c", light: "#c6c6c6", highlight: "#e8e8e8", white: "#e8e8e8", black: "#181818" },
  },
  {
    name: "mono",
    description: "Strict 1-bit. Only pure black + pure white; dithering does the rest.",
    colors: ["#000000", "#ffffff"],
    roles: { outline: "#000000", shadow: "#000000", base: "#ffffff", light: "#ffffff", highlight: "#ffffff", white: "#ffffff", black: "#000000" },
  },
  {
    name: "bubblegum16",
    description: "Bubblegum 16 — candy pastels with strong darks; great for cozy games and stickers.",
    colors: [
      "#16171a", "#2a2b2e", "#46474d", "#7e7f86", "#c4c4cc", "#f2f2f5", "#ffd9d9", "#ff8f8f",
      "#f65555", "#a82222", "#ffe3a3", "#ffc247", "#e08e17", "#9ad9ea", "#5aa9d6", "#2f5d8c",
    ],
    roles: {
      outline: "#16171a", shadow: "#a82222", dark: "#e08e17", base: "#ff8f8f",
      light: "#ffd9d9", highlight: "#f2f2f5", skin: "#ffe3a3", accent: "#5aa9d6",
      accent2: "#f65555", metal: "#c4c4cc", nature: "#ffc247", water: "#9ad9ea",
      white: "#f2f2f5", black: "#16171a",
    },
  },
  {
    name: "neon16",
    description: "Cyberpunk neon — deep blues with electric cyan/magenta for glow effects.",
    colors: [
      "#080a18", "#121936", "#1c2b5a", "#273c7d", "#2b6ea8", "#00b8d4", "#26e6ff", "#b3f7ff",
      "#3b1163", "#711a9c", "#b02ccf", "#ff3cc7", "#ff7ae0", "#ffd1f2", "#f7f7ff", "#ffffff",
    ],
    roles: {
      outline: "#080a18", shadow: "#1c2b5a", dark: "#273c7d", base: "#2b6ea8",
      light: "#00b8d4", highlight: "#b3f7ff", accent: "#ff3cc7", accent2: "#26e6ff",
      metal: "#273c7d", nature: "#00b8d4", water: "#1c2b5a", white: "#ffffff", black: "#080a18",
    },
  },
  {
    name: "forest16",
    description: "Moody forest / dungeon — moss, bark, stone and torchlight.",
    colors: [
      "#111a14", "#1d2b21", "#2f4030", "#46563b", "#5e7143", "#7f9554", "#a8b96b", "#d4dc95",
      "#3a2c22", "#5c4230", "#826047", "#a9825c", "#d2aa7c", "#e8cfa5", "#d97b34", "#f2b552",
    ],
    roles: {
      outline: "#111a14", shadow: "#1d2b21", dark: "#3a2c22", base: "#5e7143",
      light: "#a8b96b", highlight: "#d4dc95", accent: "#d97b34", accent2: "#f2b552",
      metal: "#826047", nature: "#7f9554", water: "#2f4030", white: "#e8cfa5", black: "#111a14",
    },
  },
  {
    name: "sepia8",
    description: "8-color sepia — parchment, ink and warm bronze for storybook art.",
    colors: ["#211510", "#43291c", "#6b4229", "#96613c", "#c08a55", "#ddb077", "#f0d3a4", "#fff2d6"],
    roles: { outline: "#211510", shadow: "#43291c", dark: "#6b4229", base: "#96613c", light: "#c08a55", highlight: "#f0d3a4", white: "#fff2d6", black: "#211510" },
  },
  {
    name: "pastel16",
    description: "Pastel dream — low-contrast kawaii palette for stickers and UI.",
    colors: [
      "#3b3355", "#6b5b8e", "#9a86b8", "#c4b4dc", "#f3e8ff", "#ffd6e8", "#ffb3c6", "#f7879c",
      "#ffe9b0", "#ffd166", "#f6a96b", "#a8e6cf", "#7bc9ae", "#a9d8f5", "#79b8e8", "#ffffff",
    ],
    roles: {
      outline: "#3b3355", shadow: "#6b5b8e", dark: "#9a86b8", base: "#ffb3c6",
      light: "#ffd6e8", highlight: "#f3e8ff", skin: "#ffe9b0", accent: "#a9d8f5",
      accent2: "#a8e6cf", metal: "#c4b4dc", nature: "#7bc9ae", water: "#79b8e8",
      white: "#ffffff", black: "#3b3355",
    },
  },
];

export function listPaletteDefs(): PaletteDef[] {
  return DEFS.map(d => ({ ...d, colors: [...d.colors], roles: d.roles ? { ...d.roles } : undefined }));
}

export function paletteNames(): string[] {
  return DEFS.map(d => d.name);
}

export function buildPalette(def: PaletteDef): Palette {
  const parsed = def.colors.map(h => parseColor(h)).filter((c): c is RGBA => c !== null);
  if (parsed.length === 0) throw new Error(`Palette "${def.name}" has no valid colors`);
  if (parsed.length > 255) throw new Error(`Palette "${def.name}" exceeds 255 colors`);
  const colors: RGBA[] = [{ ...TRANSPARENT }, ...parsed];
  const roles: Record<string, number> = {};
  for (const [role, hex] of Object.entries(def.roles ?? {})) {
    const c = parseColor(hex);
    if (!c) continue;
    const idx = colors.findIndex((x, i) => i > 0 && sameColor(x, c));
    if (idx > 0) roles[role] = idx;
  }
  if (!roles.outline) roles.outline = darkestIndex(colors);
  if (!roles.highlight) roles.highlight = lightestIndex(colors);
  if (!roles.base) roles.base = medianIndex(colors);
  const ramp = colors.map((_, i) => i).slice(1).sort((a, b) => luminance(colors[a]) - luminance(colors[b]));
  return { name: def.name, colors, roles, ramp, description: def.description };
}

export function getPalette(name: string): Palette {
  const def = DEFS.find(d => d.name.toLowerCase() === name.toLowerCase());
  if (!def) throw new Error(`Unknown palette "${name}". Available: ${paletteNames().join(", ")}`);
  return buildPalette(def);
}

export function customPalette(name: string, hexColors: string[], description?: string): Palette {
  return buildPalette({ name, colors: hexColors, description: description ?? `Custom palette (${hexColors.length} colors)` });
}

function darkestIndex(colors: RGBA[]): number {
  let best = 1, bestL = Infinity;
  for (let i = 1; i < colors.length; i++) { const l = luminance(colors[i]); if (l < bestL) { bestL = l; best = i; } }
  return best;
}
function lightestIndex(colors: RGBA[]): number {
  let best = 1, bestL = -Infinity;
  for (let i = 1; i < colors.length; i++) { const l = luminance(colors[i]); if (l > bestL) { bestL = l; best = i; } }
  return best;
}
function medianIndex(colors: RGBA[]): number {
  return colors.length > 2 ? colors.length >> 1 : 1;
}

/**
 * Resolve a color specification to a palette index.
 * Accepts: "transparent" | "." | "#rrggbb" | role name | "3" (index) | "ramp:7".
 * Unknown opaque colors are added to the palette when there is room, otherwise
 * snapped to the nearest existing color. This keeps every sprite strictly indexed.
 */
export function resolveColor(palette: Palette, spec: string | number): number {
  if (spec === undefined || spec === null) return 0;
  if (typeof spec === "number") return spec >= 0 && spec < palette.colors.length ? spec : 0;
  const s = String(spec).trim();
  if (s === "" || s === "." || s === "_" || /^(transparent|none|empty)$/i.test(s)) return 0;
  if (s.startsWith("ramp:")) {
    const n = parseInt(s.slice(5), 10);
    return palette.ramp[Math.max(0, Math.min(palette.ramp.length - 1, n))] ?? 1;
  }
  if (/^\d+$/.test(s)) {
    const n = parseInt(s, 10);
    return n >= 0 && n < palette.colors.length ? n : 0;
  }
  const role = palette.roles[s.toLowerCase()];
  if (role !== undefined) return role;
  const c = parseColor(s);
  if (!c) throw new Error(`Cannot parse color "${s}". Use a hex color, a role name (${Object.keys(palette.roles).slice(0, 8).join(", ")}, ...), or a palette index.`);
  if (c.a === 0) return 0;
  const exact = palette.colors.findIndex((x, i) => i > 0 && sameColor(x, c));
  if (exact > 0) return exact;
  if (palette.colors.length < 256) {
    palette.colors.push(c);
    palette.ramp = palette.colors.map((_, i) => i).slice(1).sort((a, b) => luminance(palette.colors[a]) - luminance(palette.colors[b]));
    return palette.colors.length - 1;
  }
  return nearestIndex(palette.colors, c);
}

/** Move `steps` along the dark→light ramp from a given index. */
export function shiftRamp(palette: Palette, index: number, steps: number): number {
  if (index === 0) return 0;
  const pos = palette.ramp.indexOf(index);
  if (pos < 0) return index;
  return palette.ramp[Math.max(0, Math.min(palette.ramp.length - 1, pos + steps))] ?? index;
}

export function paletteToHex(palette: Palette): string[] {
  return palette.colors.map(toHex);
}

export function paletteSummary(palette: Palette) {
  return {
    name: palette.name,
    description: palette.description ?? "",
    colorCount: palette.colors.length - 1,
    colors: paletteToHex(palette),
    roles: Object.fromEntries(Object.entries(palette.roles).map(([k, v]) => [k, { index: v, hex: toHex(palette.colors[v]) }])),
  };
}
