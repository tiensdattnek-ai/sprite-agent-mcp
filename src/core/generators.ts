/**
 * Seeded procedural sprite generators.
 *
 * These are NOT random noise: each generator is a small, hand-designed pixel
 * recipe (silhouette → blocks → shade → outline → specular detail) tuned for
 * 16×16 / 32×32 art. They give an agent a strong starting point in one call;
 * the agent then refines it with sprite_draw_grid / sprite_draw_ops.
 */

import { LayerView } from "./canvas.js";
import { Palette, resolveColor, shiftRamp } from "./palettes.js";
import { RGBA, shadeColor, toHex } from "./color.js";
import { mulberry32, hashSeed, line, ellipse } from "./draw.js";
import { drawText } from "./draw.js";

export interface GeneratorContext {
  seed: number;
  rng: () => number;
  frameIndex: number;
  frameCount: number;
  paletteName: string;
}

export interface GeneratorDef {
  description: string;
  frames: number;
  durationMs: number;
  tags: string[];
  draw: (v: LayerView, ctx: GeneratorContext) => void;
}

/** Pen with a virtual 32×32 coordinate space; works at any canvas size. */
class Pen {
  private readonly c: Record<string, number> = {};
  constructor(readonly v: LayerView, readonly vw = 32, readonly vh = 32) {}
  get pal(): Palette { return this.v.palette; }
  /** Semantic role → palette index, with graceful fallbacks for minimal palettes. */
  C(role: string): number {
    if (this.c[role] !== undefined) return this.c[role];
    const pal = this.pal;
    if (pal.roles[role] !== undefined) { this.c[role] = pal.roles[role]; return this.c[role]; }
    const fallbacks: Record<string, [string, number]> = {
      metalLight: ["metal", 0.45], skinShadow: ["skin", -0.42], skinHi: ["skin", 0.4],
      white: ["highlight", 0.2], black: ["outline", -0.2], dark: ["shadow", -0.2],
      light: ["base", 0.4], metal: ["base", -0.1], nature: ["base", 0.1],
      water: ["base", -0.3], accent2: ["accent", -0.4], skin: ["highlight", -0.25],
    };
    const fb = fallbacks[role];
    const idx = fb ? this.derived(fb[0], fb[1]) : pal.roles.base ?? 1;
    this.c[role] = idx;
    return idx;
  }
  derived(role: string, amount: number): number {
    const key = `derived:${role}:${amount}`;
    if (this.c[key] !== undefined) return this.c[key];
    const base: RGBA = this.pal.colors[this.C(role)];
    const idx = resolveColor(this.pal, toHex(shadeColor(base, amount)));
    this.c[key] = idx;
    return idx;
  }
  X(n: number): number { return Math.round((n / this.vw) * this.v.width); }
  Y(n: number): number { return Math.round((n / this.vh) * this.v.height); }
  W(n: number): number { return Math.max(1, this.X(n)); }
  H(n: number): number { return Math.max(1, this.Y(n)); }
  px(x: number, y: number, c: number, size = 1): void {
    for (let dy = 0; dy < size; dy++) for (let dx = 0; dx < size; dx++) this.v.set(this.X(x + dx), this.Y(y + dy), c);
  }
  rect(x: number, y: number, w: number, h: number, c: number): void {
    const x0 = this.X(x), y0 = this.Y(y), x1 = this.X(x + w), y1 = this.Y(y + h);
    for (let yy = y0; yy < y1; yy++) for (let xx = x0; xx < x1; xx++) this.v.set(xx, yy, c);
  }
  frame(x: number, y: number, w: number, h: number, c: number): void {
    this.line(x, y, x + w - 1, y, c); this.line(x, y + h - 1, x + w - 1, y + h - 1, c);
    this.line(x, y, x, y + h - 1, c); this.line(x + w - 1, y, x + w - 1, y + h - 1, c);
  }
  line(x1: number, y1: number, x2: number, y2: number, c: number, t = 1): void {
    line(this.v, this.X(x1), this.Y(y1), this.X(x2), this.Y(y2), c, Math.max(1, this.W(t)));
  }
  ell(cx: number, cy: number, rx: number, ry: number, c: number, fill = true): void {
    ellipse(this.v, this.X(cx), this.Y(cy), Math.max(1, this.W(rx)), Math.max(1, this.H(ry)), c, fill);
  }
  dither(x: number, y: number, w: number, h: number, a: number, b: number, ratio = 0.5, ctx?: GeneratorContext): void {
    const rnd = ctx?.rng ?? mulberry32(1);
    const x0 = this.X(x), y0 = this.Y(y), x1 = this.X(x + w), y1 = this.Y(y + h);
    for (let yy = y0; yy < y1; yy++) for (let xx = x0; xx < x1; xx++) this.v.set(xx, yy, rnd() < ratio ? b : a);
  }
  text(t: string, x: number, y: number, c: number, scale = 1): void {
    drawText(this.v, t, this.X(x), this.Y(y), c, Math.max(1, this.W(scale)));
  }
}

function baseShadow(p: Pen, y = 29): void {
  p.ell(16, y, 10, 1.6, p.derived("outline", -0.12));
}

function nudge(ctx: GeneratorContext, frames: number): number {
  return Math.round(Math.sin((ctx.frameIndex / frames) * Math.PI * 2) * 1);
}

export const GENERATORS: Record<string, GeneratorDef> = {
  hero: {
    description: "32×32 RPG hero: symmetric silhouette, hair, eyes, tunic, belt, boots and selective outline.",
    frames: 1, durationMs: 100, tags: ["character", "rpg"],
    draw(v, ctx) {
      const p = new Pen(v);
      const O = p.C("outline"), skin = p.C("skin"), skinSh = p.derived("skin", -0.42);
      const tunic = p.C("base"), tunicSh = p.derived("base", -0.42), tunicHi = p.derived("base", 0.35);
      const hair = p.C("shadow"), hairHi = p.derived("shadow", 0.5);
      const metal = p.C("metal"), gold = p.C("accent");
      baseShadow(p, 30.5);
      // boots + legs
      p.rect(10, 26, 5, 4, O); p.rect(17, 26, 5, 4, O);
      p.rect(10, 26, 5, 3, hair); p.rect(17, 26, 5, 3, hair);
      p.rect(11, 26, 3, 1, metal); p.rect(18, 26, 3, 1, metal);
      p.rect(11, 22, 4, 5, O); p.rect(17, 22, 4, 5, O);
      p.rect(11, 22, 4, 4, skinSh); p.rect(17, 22, 4, 4, skinSh);
      // tunic
      p.ell(16, 20, 8, 7, O); p.ell(16, 19.5, 7, 6, tunic);
      p.rect(16, 15, 7, 9, tunicSh);
      p.rect(9, 16, 2, 7, tunicHi);
      // arms
      p.rect(6, 17, 4, 7, O); p.rect(22, 17, 4, 7, O);
      p.rect(7, 17, 3, 6, tunicSh); p.rect(22, 17, 3, 6, tunic);
      p.rect(7, 23, 3, 2, skin); p.rect(22, 23, 3, 2, skin);
      // belt
      p.rect(9, 22, 14, 2, O); p.rect(10, 22, 12, 1, hair); p.rect(15, 22, 2, 2, gold);
      // neck + head
      p.rect(14, 13, 4, 3, skinSh);
      p.ell(16, 10, 7, 6, O); p.ell(16, 10, 6, 5, skin);
      p.rect(16, 7, 6, 8, skinSh);
      // hair cap (asymmetric fringe for character, kept above the eyes)
      p.ell(16, 7, 7, 4, hair); p.rect(9, 7, 14, 3, hair);
      p.rect(10, 9, 3, 2, hair); p.rect(21, 8, 2, 2, hair);
      p.rect(11, 6, 6, 1, hairHi); p.rect(12, 5, 3, 1, hairHi);
      // face — symmetric 2×2 eyes with a 1px specular glint, drawn LAST
      const ink = p.C("outline"), glint = p.C("highlight");
      p.rect(12, 11, 2, 2, ink); p.rect(18, 11, 2, 2, ink);
      p.px(12, 11, glint); p.px(18, 11, glint);
      p.rect(15, 13, 2, 1, skinSh);                  // mouth / nose shadow
      p.px(10, 13, p.derived("accent", -0.3), 1);   // blush
      p.px(21, 13, p.derived("accent", -0.3), 1);
      // collar + shoulder glint
      p.rect(13, 15, 6, 1, metal); p.px(10, 17, tunicHi, 1); p.px(9, 18, tunicHi, 1);
      void ctx;
    },
  },
  slime: {
    description: "Bouncy slime with specular highlight, wobbling 4-frame idle loop.",
    frames: 4, durationMs: 130, tags: ["character", "idle", "loop"],
    draw(v, ctx) {
      const p = new Pen(v);
      const wob = [0, -1, 0, 1][ctx.frameIndex % 4];
      const squash = [0, 1, 0, -1][ctx.frameIndex % 4];
      const O = p.C("outline"), body = p.C("nature"), dark = p.derived("nature", -0.5), hi = p.derived("nature", 0.55);
      baseShadow(p, 29);
      const cy = 21 + wob, rx = 10 + (wob ? 1 : 0), ry = 8 - squash;
      p.ell(16, cy + 2, rx, ry, O);
      p.rect(6, cy + 2, 20, 7, O);
      p.ell(16, cy, rx - 1, ry - 1, body);
      p.rect(6, cy, 20, 7, body);
      p.rect(6, cy + 5, 20, 2, dark);
      p.ell(12, cy - 3, 3, 2, hi); p.px(10, cy - 4, p.C("highlight"), 2);
      p.px(13, cy, O, 2); p.px(19, cy, O, 2);
      p.px(13, cy + 1, p.C("highlight"), 1); p.px(19, cy + 1, p.C("highlight"), 1);
      p.rect(14, cy + 3, 4, 1, dark);
      void nudge;
    },
  },
  potion: {
    description: "Glass potion bottle with cork, liquid meniscus, bubbles and shine. Optional shimmer loop.",
    frames: 1, durationMs: 120, tags: ["item", "rpg"],
    draw(v, ctx) {
      const p = new Pen(v);
      const O = p.C("outline"), glass = p.C("metalLight"), liquid = p.C("accent"), liquidSh = p.derived("accent", -0.5), hi = p.C("highlight");
      baseShadow(p, 29);
      p.rect(13, 4, 6, 4, O); p.rect(14, 4, 4, 3, p.C("skin")); p.rect(14, 3, 4, 1, p.C("skinShadow"));
      p.rect(14, 8, 4, 2, O);
      p.ell(16, 20, 9, 9, O); p.rect(7, 13, 18, 14, O);
      p.ell(16, 20, 8, 8, glass); p.rect(8, 13, 16, 14, glass);
      p.rect(9, 17, 14, 9, liquid); p.ell(16, 18, 7, 2, liquid);
      p.rect(9, 24, 14, 2, liquidSh);
      p.rect(10, 15, 2, 9, hi); p.px(11, 14, hi, 1);
      const r = ctx.rng;
      for (let i = 0; i < 4; i++) p.px(12 + Math.floor(r() * 8), 19 + Math.floor(r() * 6), p.derived("accent", 0.5));
      p.rect(13, 8, 6, 1, p.C("metal"));
    },
  },
  gem: {
    description: "Faceted crystal with internal refraction planes and a 4-point sparkle.",
    frames: 1, durationMs: 100, tags: ["item", "shine"],
    draw(v) {
      const p = new Pen(v);
      const O = p.C("outline"), main = p.C("water"), dark = p.derived("water", -0.5), light = p.derived("water", 0.5);
      baseShadow(p, 29);
      for (let y = 5; y < 27; y++) {
        const t = y - 5;
        const half = t < 6 ? 2 + t : 14 - Math.floor((t - 6) / 2.2);
        p.rect(16 - half, y, half * 2, 1, O);
        p.rect(16 - half + 1, y, half * 2 - 2, 1, main);
      }
      p.rect(16, 8, 7, 16, dark);
      p.rect(9, 8, 4, 12, light);
      p.line(16, 8, 16, 25, p.C("highlight"));
      p.line(9, 14, 16, 10, p.C("highlight")); p.line(16, 10, 23, 14, dark);
      p.px(11, 12, p.C("highlight"), 2);
      p.px(7, 9, p.C("highlight"), 1); p.px(25, 7, p.C("highlight"), 1);
      p.line(26, 4, 26, 10, p.C("highlight")); p.line(23, 7, 29, 7, p.C("highlight"));
    },
  },
  chest: {
    description: "Treasure chest: wood grain, iron bands, gold lock, lid highlight.",
    frames: 1, durationMs: 100, tags: ["item", "rpg"],
    draw(v) {
      const p = new Pen(v);
      const O = p.C("outline"), wood = p.C("dark"), woodHi = p.derived("dark", 0.4), woodSh = p.derived("dark", -0.4), iron = p.C("metal"), gold = p.C("accent");
      baseShadow(p, 29);
      p.ell(16, 13, 12, 6, O); p.rect(4, 13, 24, 3, woodHi);
      p.rect(4, 15, 24, 13, O); p.rect(5, 16, 22, 11, wood);
      p.rect(5, 22, 22, 1, woodSh); p.rect(5, 26, 22, 1, woodSh);
      for (let i = 0; i < 5; i++) p.rect(6 + i * 4, 18 + (i % 2) * 4, 2, 1, woodHi);
      p.rect(8, 12, 2, 16, iron); p.rect(22, 12, 2, 16, iron);
      p.rect(4, 15, 24, 2, iron);
      p.rect(14, 17, 4, 6, O); p.rect(15, 18, 2, 4, gold); p.px(16, 21, O);
      p.rect(6, 12, 20, 1, woodHi);
    },
  },
  sword: {
    description: "Diagonal longsword with bevel highlight, fuller, crossguard and wrapped grip.",
    frames: 1, durationMs: 100, tags: ["item", "weapon"],
    draw(v) {
      const p = new Pen(v);
      const O = p.C("outline"), steel = p.C("metal"), steelHi = p.C("metalLight"), steelSh = p.derived("metal", -0.45), gold = p.C("accent"), grip = p.C("shadow");
      for (let i = 0; i < 19; i++) {
        const x = 8 + Math.floor(i * 0.72), y = 27 - i;
        p.rect(x, y, 4, 1, O); p.rect(x + 1, y, 2, 1, steel);
        if (i > 2) p.px(x + 1, y, steelHi); else p.px(x + 3, y, steelSh);
      }
      p.px(9, 7, p.C("highlight"), 2);
      p.rect(20, 24, 3, 2, O); p.line(18, 23, 25, 28, gold, 2);
      p.rect(22, 26, 3, 2, O);
      for (let i = 0; i < 4; i++) { p.px(23 + i, 28 + i, grip, 1); p.px(24 + i, 28 + i, O); }
      p.px(27, 31, gold, 2);
    },
  },
  shield: {
    description: "Heraldic shield with bevel, rivets and a centered crest.",
    frames: 1, durationMs: 100, tags: ["item", "icon"],
    draw(v) {
      const p = new Pen(v);
      const O = p.C("outline"), metal = p.C("metal"), hi = p.C("metalLight"), base = p.C("base"), gold = p.C("accent");
      for (let y = 4; y < 29; y++) {
        const t = y - 4;
        const half = t < 16 ? 11 : Math.max(1, 11 - Math.floor((t - 16) * 1.7));
        p.rect(16 - half, y, half * 2, 1, O);
        p.rect(16 - half + 1, y, half * 2 - 2, 1, metal);
        p.rect(16 - half + 2, y, half * 2 - 4, 1, base);
      }
      p.rect(7, 5, 2, 14, hi); p.rect(23, 5, 2, 14, p.derived("metal", -0.4));
      for (const [x, y] of [[8, 8], [24, 8], [9, 17], [23, 17]]) p.px(x, y, gold, 1);
      p.rect(15, 10, 2, 12, gold); p.rect(11, 14, 10, 2, gold);
      p.px(15, 9, p.C("highlight"), 2);
    },
  },
  tree: {
    description: "Dithered canopy, trunk knots and ground shadow; gentle 4-frame breeze optional.",
    frames: 1, durationMs: 140, tags: ["environment"],
    draw(v, ctx) {
      const p = new Pen(v);
      const O = p.C("outline"), trunk = p.C("dark"), trunkHi = p.derived("dark", 0.4), leaf = p.C("nature"), leafSh = p.derived("nature", -0.45), leafHi = p.derived("nature", 0.45);
      baseShadow(p, 29);
      p.rect(13, 19, 6, 10, O); p.rect(14, 19, 4, 10, trunk); p.rect(14, 19, 1, 9, trunkHi);
      p.px(16, 24, O, 1);
      p.ell(16, 13, 12, 9, O); p.ell(16, 13, 11, 8, leaf);
      p.dither(6, 8, 20, 12, leaf, leafSh, 0.32, ctx);
      p.ell(16, 12, 11, 8, 0); // keep outline ring only around the canopy
      // redraw canopy with dithered texture
      p.ell(16, 13, 10, 7, leaf);
      const r = ctx.rng;
      for (let y = 6; y < 20; y++) for (let x = 6; x < 26; x++) {
        const dx = (x - 16) / 10, dy = (y - 13) / 7;
        if (dx * dx + dy * dy > 1) continue;
        const q = r();
        p.px(x, y, q < 0.22 ? leafHi : q < 0.58 ? leafSh : leaf);
      }
      p.ell(16, 13, 12, 9, 0);
      // crisp silhouette ring
      for (let y = 4; y < 22; y++) for (let x = 4; x < 28; x++) {
        const dx = (x - 16) / 12, dy = (y - 13) / 9;
        const d = dx * dx + dy * dy;
        if (d >= 0.78 && d <= 1.02) p.px(x, y, O);
      }
      p.px(10, 10, leafHi, 2); p.px(20, 9, leafHi, 1);
    },
  },
  mushroom: {
    description: "Spotted toadstool with gills, stem and rim light.",
    frames: 1, durationMs: 100, tags: ["environment", "item"],
    draw(v) {
      const p = new Pen(v);
      const O = p.C("outline"), cap = p.C("accent"), capSh = p.derived("accent", -0.45), capHi = p.derived("accent", 0.45), stem = p.C("highlight");
      baseShadow(p, 29);
      p.rect(13, 17, 6, 11, O); p.rect(14, 17, 4, 11, stem); p.rect(14, 17, 1, 10, p.C("skinShadow"));
      p.ell(16, 15, 11, 7, O); p.ell(16, 14, 10, 6, cap);
      p.rect(6, 15, 20, 2, capSh); p.rect(7, 17, 18, 1, O);
      p.ell(11, 11, 2, 2, stem); p.ell(20, 12, 2, 1, stem); p.px(16, 10, stem, 2); p.px(24, 14, stem);
      p.rect(9, 9, 4, 1, capHi); p.px(12, 8, capHi, 1);
    },
  },
  ghost: {
    description: "Floating ghost with wavy hem and hollow eyes; 4-frame hover loop.",
    frames: 4, durationMs: 140, tags: ["character", "loop", "halloween"],
    draw(v, ctx) {
      const p = new Pen(v);
      const bob = [0, -1, 0, 1][ctx.frameIndex % 4];
      const O = p.C("outline"), body = p.C("highlight"), bodySh = p.derived("highlight", -0.28);
      p.ell(16, 13 + bob, 9, 9, O);
      p.rect(7, 13 + bob, 18, 12, O);
      p.ell(16, 13 + bob, 8, 8, body);
      p.rect(8, 13 + bob, 16, 11, body);
      p.rect(8, 20 + bob, 16, 4, bodySh);
      const wave = ctx.frameIndex % 2;
      for (let x = 8; x < 24; x += 4) {
        if (wave) { p.rect(x, 24 + bob, 2, 2, body); p.rect(x + 2, 24 + bob, 2, 1, O); }
        else { p.rect(x, 24 + bob + 1, 2, 1, body); p.rect(x + 2, 24 + bob, 2, 2, body); }
      }
      p.ell(13, 13 + bob, 2, 3, O); p.ell(19, 13 + bob, 2, 3, O);
      p.px(12, 12 + bob, p.C("shadow")); p.px(18, 12 + bob, p.C("shadow"));
      p.px(10, 10 + bob, p.C("white"), 2);
    },
  },
  coin: {
    description: "Spinning gold coin — 6 frames of a rotating disc with a stamped emblem.",
    frames: 6, durationMs: 90, tags: ["item", "loop", "ui"],
    draw(v, ctx) {
      const p = new Pen(v);
      const O = p.C("outline"), gold = p.C("accent"), goldHi = p.derived("accent", 0.55), goldSh = p.derived("accent", -0.5);
      const widths = [10, 7, 3, 1, 3, 7];
      const rx = widths[ctx.frameIndex % widths.length];
      p.ell(16, 16, rx + 1, 11, O);
      p.ell(16, 16, rx, 10, gold);
      p.rect(16 - rx, 7, rx, 19, goldHi);
      p.rect(16 + Math.floor(rx / 2), 7, Math.ceil(rx / 2), 19, goldSh);
      p.ell(16, 16, Math.max(1, rx - 2), 8, O);
      p.ell(16, 16, Math.max(0, rx - 3), 7, gold);
      if (rx >= 5) { p.rect(15, 11, 2, 10, goldHi); p.rect(12, 15, 8, 2, goldHi); }
      p.px(12, 10, p.C("highlight"), 2);
    },
  },
  star: {
    description: "4-point sparkle with a pulsing 4-frame twinkle.",
    frames: 4, durationMs: 90, tags: ["fx", "loop"],
    draw(v, ctx) {
      const p = new Pen(v);
      const sizes = [5, 7, 9, 6];
      const s = sizes[ctx.frameIndex % 4];
      const c = p.C("highlight"), c2 = p.C("accent");
      p.line(16, 16 - s, 16, 16 + s, c); p.line(16 - s, 16, 16 + s, 16, c);
      p.line(16, 16 - s - 2, 16, 16 - s, c2); p.line(16, 16 + s, 16, 16 + s + 2, c2);
      p.line(16 - s - 2, 16, 16 - s, 16, c2); p.line(16 + s, 16, 16 + s + 2, 16, c2);
      p.px(15, 15, p.C("white"), 2);
      if (s >= 7) { p.line(11, 11, 13, 13, c2); p.line(21, 21, 19, 19, c2); }
    },
  },
  torch: {
    description: "Wall torch with a flickering 4-frame flame and ember particles.",
    frames: 4, durationMs: 110, tags: ["fx", "loop", "environment"],
    draw(v, ctx) {
      const p = new Pen(v);
      const O = p.C("outline"), wood = p.C("dark"), fire = p.C("accent"), fireHi = p.C("highlight"), fireSh = p.derived("accent", -0.4);
      p.rect(14, 18, 4, 12, O); p.rect(15, 18, 2, 11, wood);
      p.rect(12, 17, 8, 3, p.C("metal")); p.rect(13, 18, 6, 1, p.C("metalLight"));
      const sway = [0, 1, 0, -1][ctx.frameIndex % 4];
      const h = [8, 10, 7, 9][ctx.frameIndex % 4];
      p.ell(16 + sway, 14, 5, h, O);
      p.ell(16 + sway, 14, 4, h - 1, fire);
      p.ell(16 + sway, 16, 2, h - 4, fireHi);
      p.rect(16 + sway, 8, 4, h, fireSh);
      const r = ctx.rng;
      for (let i = 0; i < 3; i++) p.px(10 + Math.floor(r() * 13), 3 + Math.floor(r() * 6), fireHi);
    },
  },
  planet: {
    description: "Shaded planet with terminator, craters and a subtle atmosphere rim.",
    frames: 1, durationMs: 100, tags: ["environment", "space"],
    draw(v, ctx) {
      const p = new Pen(v);
      const O = p.C("outline"), base = p.C("water"), dark = p.derived("water", -0.55), hi = p.derived("water", 0.5);
      p.ell(16, 16, 12, 12, O); p.ell(16, 16, 11, 11, base);
      for (let y = 5; y < 28; y++) for (let x = 5; x < 28; x++) {
        const dx = (x - 16) / 11, dy = (y - 16) / 11;
        if (dx * dx + dy * dy > 1) continue;
        if (dx > 0.25 || dy > 0.35) p.px(x, y, dark);
        else if (dx < -0.4 && dy < -0.3) p.px(x, y, hi);
      }
      const r = ctx.rng;
      for (let i = 0; i < 7; i++) {
        const a = r() * Math.PI * 2, d = r() * 8;
        p.ell(16 + Math.cos(a) * d, 16 + Math.sin(a) * d, 1 + r() * 2, 1 + r(), dark);
      }
      p.ell(12, 11, 2, 1, hi);
      p.rect(4, 14, 2, 5, p.derived("water", 0.7));
      p.rect(25, 18, 2, 3, p.derived("water", 0.7));
    },
  },
  cloud: {
    description: "Puffy cloud with layered rim light and dithered underside.",
    frames: 1, durationMs: 100, tags: ["environment", "background"],
    draw(v, ctx) {
      const p = new Pen(v);
      const O = p.C("outline"), body = p.C("highlight"), sh = p.derived("highlight", -0.3), hi = p.C("white");
      for (const [cx, cy, rx, ry] of [[10, 18, 6, 5], [16, 14, 7, 6], [23, 18, 6, 5], [16, 20, 12, 4]]) {
        p.ell(cx, cy, rx + 1, ry + 1, O); p.ell(cx, cy, rx, ry, body);
      }
      p.rect(5, 20, 24, 3, body); p.rect(5, 23, 24, 1, O);
      p.rect(5, 21, 24, 2, sh);
      for (let x = 7; x < 28; x += 2) if (ctx.rng() > 0.4) p.px(x, 19 - Math.floor(ctx.rng() * 3), hi, 1);
      p.rect(9, 13, 4, 1, hi); p.rect(15, 10, 4, 1, hi);
    },
  },
  heart: {
    description: "16×16-style heart icon with glossy highlight and thick outline.",
    frames: 1, durationMs: 100, tags: ["ui", "icon"],
    draw(v) {
      const p = new Pen(v);
      const O = p.C("outline"), red = p.C("accent"), redSh = p.derived("accent", -0.45), hi = p.C("highlight");
      for (let y = 8; y < 27; y++) {
        const t = (y - 8) / 19;
        const half = t < 0.42 ? 4 + t * 20 : 12 - (t - 0.42) * 20;
        const w = Math.max(1, Math.round(half));
        const split = y < 15 && Math.abs(16 - 16) < 0 ? 0 : 0;
        void split;
        if (y < 14) {
          p.rect(9, y, 7, 1, O); p.rect(17, y, 7, 1, O);
          p.rect(10, y, 5, 1, red); p.rect(18, y, 5, 1, red);
        } else {
          p.rect(16 - w, y, w * 2, 1, O);
          p.rect(16 - w + 1, y, w * 2 - 2, 1, red);
          p.rect(16 + Math.floor(w / 2), y, Math.ceil(w / 2), 1, redSh);
        }
      }
      p.rect(11, 11, 3, 2, hi); p.px(12, 11, p.C("white"), 1);
      p.px(20, 17, p.C("white"), 1);
    },
  },
  tile_grass: {
    description: "Seamless grass tile: dithered two-tone ground, blades, pebbles, wrapped edges.",
    frames: 1, durationMs: 100, tags: ["tileset", "seamless"],
    draw(v, ctx) { tileBase(v, ctx, "grass"); },
  },
  tile_stone: {
    description: "Seamless cobblestone tile with mortar, bevels and cracks.",
    frames: 1, durationMs: 100, tags: ["tileset", "seamless"],
    draw(v, ctx) { tileBase(v, ctx, "stone"); },
  },
  tile_brick: {
    description: "Seamless offset brick wall with bevel highlight.",
    frames: 1, durationMs: 100, tags: ["tileset", "seamless"],
    draw(v, ctx) { tileBase(v, ctx, "brick"); },
  },
  tile_water: {
    description: "Animated seamless water: 4 frames of scrolling wave crests and foam.",
    frames: 4, durationMs: 150, tags: ["tileset", "seamless", "loop"],
    draw(v, ctx) { tileBase(v, ctx, "water"); },
  },
  tile_lava: {
    description: "Animated seamless lava: 4 frames of dithered molten flow and dark crust.",
    frames: 4, durationMs: 150, tags: ["tileset", "seamless", "loop"],
    draw(v, ctx) { tileBase(v, ctx, "lava"); },
  },
  portrait: {
    description: "Pixel portrait bust: hair, eyes, blush, collar — designed for 32×32 avatars.",
    frames: 1, durationMs: 100, tags: ["character", "avatar"],
    draw(v) {
      const p = new Pen(v);
      const O = p.C("outline"), skin = p.C("skin"), skinSh = p.derived("skin", -0.4), skinHi = p.derived("skin", 0.4);
      const hair = p.C("shadow"), hairHi = p.derived("shadow", 0.5), cloth = p.C("base"), eye = p.C("accent");
      p.ell(16, 30, 13, 6, O); p.ell(16, 30, 12, 5, cloth); p.rect(13, 25, 6, 4, skinSh);
      p.ell(16, 15, 9, 11, O); p.ell(16, 15, 8, 10, skin);
      p.rect(16, 9, 8, 15, skinSh); p.rect(9, 9, 3, 12, skinHi);
      p.ell(16, 9, 9, 6, hair); p.rect(7, 8, 18, 4, hair); p.rect(7, 11, 3, 7, hair); p.rect(22, 11, 3, 7, hair);
      p.rect(10, 6, 8, 1, hairHi);
      p.rect(11, 14, 4, 1, O); p.rect(18, 14, 4, 1, O);
      p.px(12, 15, eye, 2); p.px(19, 15, eye, 2);
      p.px(12, 15, p.C("white")); p.px(19, 15, p.C("white"));
      p.px(10, 18, p.derived("accent", -0.3), 2); p.px(21, 18, p.derived("accent", -0.3), 2);
      p.rect(15, 19, 3, 1, skinSh);
      p.rect(12, 26, 8, 1, p.C("metalLight"));
    },
  },
};

function tileBase(v: LayerView, ctx: GeneratorContext, kind: string): void {
  const p = new Pen(v, v.width, v.height);
  const W = v.width, H = v.height;
  const rng = ctx.rng;
  const O = p.C("outline");
  const put = (x: number, y: number, c: number) => v.set(((x % W) + W) % W, ((y % H) + H) % H, c);
  const fill = (c: number) => v.pixels.fill(c);
  switch (kind) {
    case "grass": {
      const dark = p.C("nature"), light = p.derived("nature", 0.35), deep = p.derived("nature", -0.45);
      fill(dark);
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (rng() < 0.22) put(x, y, light);
      for (let i = 0; i < Math.floor(W * H / 14); i++) {
        const x = Math.floor(rng() * W), y = Math.floor(rng() * H);
        put(x, y, deep); put(x, y - 1, light); put(x + 1, y - 1, light);
        if (rng() > 0.6) put(x, y - 2, light);
      }
      break;
    }
    case "stone": {
      const stone = p.C("metal"), hi = p.C("metalLight"), mortar = p.derived("metal", -0.6);
      fill(mortar);
      const bh = Math.max(3, Math.floor(H / 4));
      for (let row = 0; row < Math.ceil(H / bh); row++) {
        const offset = (row % 2) * Math.floor(W / 4);
        for (let bx = -offset; bx < W; bx += Math.max(4, Math.floor(W / 2))) {
          const x0 = bx + 1, y0 = row * bh + 1, w = Math.max(3, Math.floor(W / 2) - 2), h = bh - 2;
          for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) put(x, y, stone);
          for (let x = x0; x < x0 + w; x++) { put(x, y0, hi); put(x, y0 + h - 1, O); }
          for (let y = y0; y < y0 + h; y++) put(x0, y, hi);
          if (rng() > 0.6) { const cx = x0 + 1 + Math.floor(rng() * (w - 2)); put(cx, y0 + 1 + Math.floor(rng() * (h - 2)), O); }
        }
      }
      break;
    }
    case "brick": {
      const brick = p.C("dark"), hi = p.derived("dark", 0.4), sh = p.derived("dark", -0.4);
      fill(sh);
      const bh = Math.max(3, Math.floor(H / 5));
      for (let row = 0; row * bh < H; row++) {
        const off = (row % 2) * Math.floor(W / 2);
        for (let bx = -off; bx < W; bx += Math.max(4, Math.floor(W / 2))) {
          for (let y = row * bh + 1; y < row * bh + bh - 1; y++) for (let x = bx + 1; x < bx + Math.floor(W / 2) - 1; x++) put(x, y, brick);
          for (let x = bx + 1; x < bx + Math.floor(W / 2) - 1; x++) put(x, row * bh + 1, hi);
        }
      }
      break;
    }
    case "water": {
      const deep = p.derived("water", -0.5), mid = p.C("water"), foam = p.C("metalLight"), hi = p.C("highlight");
      fill(deep);
      const phase = ctx.frameIndex * 2;
      for (let y = 0; y < H; y++) {
        const wave = Math.sin((y / H) * Math.PI * 4 + phase) * 2;
        for (let x = 0; x < W; x++) {
          const wx = ((x + Math.round(wave) + y) % W + W) % W;
          if ((wx + y * 2 + phase) % 11 < 4) put(x, y, mid);
          if ((wx + y * 2 + phase) % 17 === 0) put(x, y, foam);
          if ((wx + y * 3 + phase) % 23 === 0) put(x, y, hi);
        }
      }
      break;
    }
    case "lava": {
      const hot = p.C("accent"), hotHi = p.C("highlight"), crust = p.derived("accent", -0.7);
      fill(crust);
      const phase = ctx.frameIndex * 3;
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        const n = Math.sin((x + phase) / 4) + Math.cos((y - phase) / 3) + rng() * 0.6;
        if (n > 0.6) put(x, y, hot);
        if (n > 1.5) put(x, y, hotHi);
      }
      break;
    }
  }
  void O;
}

export function generatorNames(): string[] { return Object.keys(GENERATORS); }

export function runGenerator(kind: string, v: LayerView, ctx: GeneratorContext): void {
  const def = GENERATORS[kind];
  if (!def) throw new Error(`Unknown generator "${kind}". Available: ${generatorNames().join(", ")}`);
  def.draw(v, ctx);
}

export function generatorCatalog() {
  return Object.entries(GENERATORS).map(([name, d]) => ({ name, description: d.description, frames: d.frames, durationMs: d.durationMs, tags: d.tags }));
}

export { hashSeed, shiftRamp };
