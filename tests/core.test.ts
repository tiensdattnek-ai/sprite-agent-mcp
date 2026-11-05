import { describe, it, expect } from "vitest";
import { parseColor, toHex, shadeColor, luminance, contrast, makeRamp, rgbToHsl, circularHueDistance } from "../src/core/color.js";
import { getPalette, paletteNames, customPalette, resolveColor, shiftRamp, paletteSummary } from "../src/core/palettes.js";
import { newProject, compositeFrame, transformPixels, boundingBox, serializeProject, deserializeProject } from "../src/core/canvas.js";
import { splitGridFrames, parseGrid, drawGrid, frameToAscii, autoLegend } from "../src/core/ascii.js";
import { applyOps } from "../src/core/draw.js";
import { view } from "../src/core/canvas.js";

describe("color", () => {
  it("parses hex, short hex, rgba and named colors", () => {
    expect(parseColor("#ff0044")).toEqual({ r: 255, g: 0, b: 68, a: 255 });
    expect(parseColor("#f04")?.r).toBe(255);
    expect(parseColor("#00000000")?.a).toBe(0);
    expect(parseColor("rgba(10, 20, 30, 0.5)")?.a).toBe(128);
    expect(parseColor("transparent")?.a).toBe(0);
    expect(parseColor("not-a-color")).toBeNull();
  });
  it("round-trips hex", () => {
    expect(toHex(parseColor("#2ce8f5")!)).toBe("#2ce8f5");
    expect(toHex({ r: 0, g: 0, b: 0, a: 0 })).toBe("transparent");
  });
  it("hue-shifted shadows get darker/cooler, highlights lighter/warmer", () => {
    const base = parseColor("#e43b44")!;
    const shadow = shadeColor(base, -0.6), light = shadeColor(base, 0.6);
    expect(luminance(shadow)).toBeLessThan(luminance(base));
    expect(luminance(light)).toBeGreaterThan(luminance(base));
    const h0 = rgbToHsl(base.r, base.g, base.b).h;
    const hs = rgbToHsl(shadow.r, shadow.g, shadow.b).h;
    const hl = rgbToHsl(light.r, light.g, light.b).h;
    expect(circularHueDistance(hs, 250)).toBeLessThan(circularHueDistance(h0, 250));
    expect(circularHueDistance(hl, 45)).toBeLessThan(circularHueDistance(h0, 45));
    // also true for a green base — a fixed rotation would fail here
    const green = parseColor("#6abe30")!;
    const gs = shadeColor(green, -0.7);
    const hg = rgbToHsl(green.r, green.g, green.b).h;
    expect(circularHueDistance(rgbToHsl(gs.r, gs.g, gs.b).h, 250)).toBeLessThan(circularHueDistance(hg, 250));
  });
  it("builds a monotonic ramp", () => {
    const ramp = makeRamp(parseColor("#6abe30")!, 5);
    for (let i = 1; i < ramp.length; i++) expect(luminance(ramp[i])).toBeGreaterThan(luminance(ramp[i - 1]));
    expect(contrast(parseColor("#000000")!, parseColor("#ffffff")!)).toBeGreaterThan(20);
  });
});

describe("palettes", () => {
  it("ships curated palettes with usable roles", () => {
    const names = paletteNames();
    expect(names.length).toBeGreaterThanOrEqual(10);
    for (const name of names) {
      const p = getPalette(name);
      expect(p.colors[0].a).toBe(0);
      expect(p.colors.length - 1).toBeLessThanOrEqual(255);
      expect(p.roles.outline).toBeGreaterThan(0);
      expect(p.ramp.length).toBe(p.colors.length - 1);
      expect(luminance(p.colors[p.ramp[0]])).toBeLessThanOrEqual(luminance(p.colors[p.ramp[p.ramp.length - 1]]));
    }
  });
  it("resolves roles, indices, ramp positions and adds new exact colors", () => {
    const p = getPalette("db32");
    expect(resolveColor(p, "outline")).toBe(p.roles.outline);
    expect(resolveColor(p, "transparent")).toBe(0);
    expect(resolveColor(p, 3)).toBe(3);
    expect(resolveColor(p, "ramp:0")).toBe(p.ramp[0]);
    const before = p.colors.length;
    const idx = resolveColor(p, "#123456");
    expect(idx).toBe(before);
    expect(toHex(p.colors[idx])).toBe("#123456");
    expect(resolveColor(p, "#123456")).toBe(idx); // no duplicate
    expect(shiftRamp(p, p.ramp[0], 3)).toBe(p.ramp[3]);
  });
  it("supports custom palettes and JSON summaries", () => {
    const p = customPalette("my", ["#000000", "#ffffff", "#ff0000"]);
    expect(p.colors.length).toBe(4);
    expect(paletteSummary(p).colorCount).toBe(3);
  });
});

describe("canvas", () => {
  it("creates projects with frames and layers", () => {
    const p = newProject({ name: "Test Hero", width: 16, height: 16, palette: getPalette("pico8"), frames: 3, layers: ["bg", "art"] });
    expect(p.id).toBe("test-hero");
    expect(p.frames).toHaveLength(3);
    expect(p.frames[0].layers.map(l => l.name)).toEqual(["bg", "art"]);
    expect(p.frames[0].layers[0].pixels).toHaveLength(256);
  });
  it("composites layers and applies ordered-dither opacity", () => {
    const p = newProject({ name: "Layers", width: 4, height: 4, palette: getPalette("db32"), layers: ["bg", "art"] });
    const f = p.frames[0];
    f.layers[0].pixels.fill(p.palette.roles.base);
    f.layers[1].pixels[0] = p.palette.roles.outline;
    expect(compositeFrame(p, f)[0]).toBe(p.palette.roles.outline);
    expect(compositeFrame(p, f)[1]).toBe(p.palette.roles.base);
    f.layers[1].opacity = 0;
    expect(compositeFrame(p, f)[0]).toBe(p.palette.roles.base);
    f.layers[1].visible = false;
    expect(compositeFrame(p, f)[5]).toBe(p.palette.roles.base);
  });
  it("transforms are strictly nearest-neighbour / lossless", () => {
    const src = new Uint8Array([1, 2, 3, 4]);
    expect([...transformPixels(src, 2, 2, "flipX").pixels]).toEqual([2, 1, 4, 3]);
    expect([...transformPixels(src, 2, 2, "flipY").pixels]).toEqual([3, 4, 1, 2]);
    expect([...transformPixels(src, 2, 2, "rotate90").pixels]).toEqual([3, 1, 4, 2]);
    expect([...transformPixels(src, 2, 2, "scale", { factor: 2 }).pixels]).toEqual([1, 1, 2, 2, 1, 1, 2, 2, 3, 3, 4, 4, 3, 3, 4, 4]);
  });
  it("computes bounding boxes", () => {
    const px = new Uint8Array(16);
    px[5] = 1; px[6] = 1; px[10] = 1;
    expect(boundingBox(px, 4, 4)).toEqual({ x: 1, y: 1, w: 2, h: 2 });
    expect(boundingBox(new Uint8Array(16), 4, 4)).toBeNull();
  });
  it("round-trips a project through JSON", () => {
    const p = newProject({ name: "Save Me", width: 8, height: 8, palette: getPalette("sweetie16"), frames: 2 });
    p.frames[0].layers[0].pixels[9] = 4;
    const json = serializeProject(p);
    const q = deserializeProject(json, (name, colors) => colors?.length ? customPalette(name, colors) : getPalette(name));
    expect(q.name).toBe("Save Me");
    expect(q.frames).toHaveLength(2);
    expect(q.frames[0].layers[0].pixels[9]).toBe(4);
  });
});

describe("ASCII grid", () => {
  it("splits multi-frame grids on ---", () => {
    expect(splitGridFrames("aa\nbb\n---\ncc\ndd")).toHaveLength(2);
    const g = parseGrid("abc\n de");
    expect(g.width).toBe(3);
    expect(g.rows[1]).toBe(" de");
  });
  it("draws a legend grid and renders it back", () => {
    const p = newProject({ name: "Grid", width: 8, height: 8, palette: getPalette("db32") });
    const v = view(p, p.frames[0]);
    const r = drawGrid(v, parseGrid("..oo..\n.obbo.\n..oo.."), { legend: { o: "outline", b: "base" } });
    expect(r.pixelsWritten).toBeGreaterThan(0);
    expect(v.get(2, 0)).toBe(p.palette.roles.outline);
    expect(v.get(3, 1)).toBe(p.palette.roles.base);
    const ascii = frameToAscii(v.pixels, 8, 8);
    expect(ascii.ascii.split("\n")).toHaveLength(8);
    expect(Object.keys(ascii.legend).length).toBe(2);
  });
  it("auto-legend is deterministic and maps roles first", () => {
    const p = getPalette("db32");
    const l1 = autoLegend("ab\nba", p), l2 = autoLegend("ab\nba", p);
    expect(l1).toEqual(l2);
    expect(l1.a).toBe("outline");
    expect(l1.b).toBe("shadow");
  });
  it("mirrorX works", () => {
    const p = newProject({ name: "Mirror", width: 8, height: 4, palette: getPalette("db32") });
    const v = view(p, p.frames[0]);
    drawGrid(v, parseGrid("a..."), { legend: { a: "accent" }, mirrorX: true });
    expect(v.get(0, 0)).toBe(p.palette.roles.accent);
    expect(v.get(7, 0)).toBe(p.palette.roles.accent);
  });
});

describe("drawing ops", () => {
  it("applies rect, line, circle and flood fill", () => {
    const p = newProject({ name: "Ops", width: 16, height: 16, palette: getPalette("db32") });
    const v = view(p, p.frames[0]);
    applyOps(v, [
      { op: "rect", x: 2, y: 2, w: 6, h: 6, color: "base" },
      { op: "line", x1: 0, y1: 0, x2: 15, y2: 15, color: "outline" },
      { op: "circle", cx: 8, cy: 8, r: 3, color: "accent", fill: false },
    ]);
    expect(v.get(4, 3)).toBe(p.palette.roles.base); // off the diagonal line
    expect(v.get(0, 0)).toBe(p.palette.roles.outline);
    const n = applyOps(v, [{ op: "fill", x: 5, y: 5, color: "light" }]);
    expect(n.applied).toBe(1);
    expect(v.get(5, 5)).toBe(p.palette.roles.light);
  });
  it("outline only touches exterior-adjacent empty pixels", () => {
    const p = newProject({ name: "Outline", width: 10, height: 10, palette: getPalette("db32") });
    const v = view(p, p.frames[0]);
    applyOps(v, [{ op: "rect", x: 3, y: 3, w: 4, h: 4, color: "base" }]);
    // interior hole
    v.set(4, 4, 0);
    applyOps(v, [{ op: "outline", color: "outline", mode: "outside" }]);
    expect(v.get(4, 4)).toBe(0); // interior hole must stay transparent
    expect(v.get(2, 3)).toBe(p.palette.roles.outline); // exterior edge outlined
  });
  it("text renders a 3x5 font", () => {
    const p = newProject({ name: "Text", width: 32, height: 8, palette: getPalette("mono") });
    const v = view(p, p.frames[0]);
    applyOps(v, [{ op: "text", x: 1, y: 1, text: "HI", color: "#ffffff", scale: 1 }]);
    expect(v.pixels.some(x => x > 0)).toBe(true);
  });
});
