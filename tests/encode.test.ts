import { describe, it, expect } from "vitest";
import { inflateSync } from "node:zlib";
import { getPalette } from "../src/core/palettes.js";
import { newProject, compositeFrame } from "../src/core/canvas.js";
import {
  encodePNG, encodePNGIndexed, encodePNGRgba, encodeAPNG, encodeGIF, encodeSVG,
  packSheet, buildAtlas, buildGPL, buildCSS, buildGallery,
} from "../src/core/encode.js";

const PNG_MAGIC = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

function chunks(buf: Buffer): Array<{ type: string; data: Buffer }> {
  const out: Array<{ type: string; data: Buffer }> = [];
  let off = 8;
  while (off < buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString("ascii", off + 4, off + 8);
    out.push({ type, data: buf.subarray(off + 8, off + 8 + len) });
    off += 12 + len;
  }
  return out;
}

function makeProject() {
  const p = newProject({ name: "Encode Test", width: 8, height: 8, palette: getPalette("pico8"), frames: 3 });
  p.frames.forEach((f, i) => {
    for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
      if ((x + y + i) % 3 === 0) f.layers[0].pixels[y * 8 + x] = 3 + i;
    }
  });
  return p;
}

describe("PNG", () => {
  it("writes a valid indexed PNG with PLTE + tRNS", () => {
    const p = makeProject();
    const png = encodePNGIndexed(compositeFrame(p, p.frames[0]), 8, 8, p.palette.colors);
    expect(png.subarray(0, 8)).toEqual(PNG_MAGIC);
    const cs = chunks(png);
    expect(cs.map(c => c.type)).toEqual(["IHDR", "PLTE", "tRNS", "IDAT", "IEND"]);
    expect(cs[0].data.readUInt32BE(0)).toBe(8);
    expect(cs[0].data.readUInt32BE(4)).toBe(8);
    expect(cs[0].data[9]).toBe(3); // color type: indexed
    expect(cs[2].data[0]).toBe(0); // index 0 transparent
    const raw = inflateSync(cs[3].data);
    expect(raw).toHaveLength(8 * (8 + 1));
  });
  it("scales with nearest-neighbour (no new colors)", () => {
    const p = makeProject();
    const px = compositeFrame(p, p.frames[0]);
    const png = encodePNG(px, 8, 8, p.palette.colors, { scale: 4 });
    const cs = chunks(png);
    expect(cs[0].data.readUInt32BE(0)).toBe(32);
    const raw = inflateSync(cs.find(c => c.type === "IDAT")!.data);
    expect(raw).toHaveLength(32 * (32 + 1));
  });
  it("writes RGBA PNG with a solid background", () => {
    const p = makeProject();
    // Fully transparent sprite → every pixel must be the requested background.
    const png = encodePNGRgba(new Uint8Array(64), 8, 8, p.palette.colors, 1, { r: 12, g: 34, b: 56, a: 255 });
    const cs = chunks(png);
    expect(cs[0].data[9]).toBe(6);
    const raw = inflateSync(cs.find(c => c.type === "IDAT")!.data);
    expect(raw[1]).toBe(12);
    expect(raw[2]).toBe(34);
    expect(raw[3]).toBe(56);
    expect(raw[4]).toBe(255);
  });
});

describe("animation encoders", () => {
  const framesOf = (p: ReturnType<typeof makeProject>) => p.frames.map(f => ({ pixels: compositeFrame(p, f), durationMs: f.durationMs }));
  it("APNG has acTL, fcTL/fdAT sequence and correct frame count", () => {
    const p = makeProject();
    const apng = encodeAPNG(framesOf(p), 8, 8, p.palette.colors);
    const cs = chunks(apng);
    expect(cs.filter(c => c.type === "fcTL")).toHaveLength(3);
    expect(cs.filter(c => c.type === "fdAT")).toHaveLength(2);
    expect(cs.find(c => c.type === "acTL")!.data.readUInt32BE(0)).toBe(3);
    const seq = cs.filter(c => c.type === "fcTL" || c.type === "fdAT").map(c => c.data.readUInt32BE(0));
    expect(seq).toEqual([0, 1, 2, 3, 4]);
    expect(cs[cs.length - 1].type).toBe("IEND");
  });
  it("GIF89a has a global color table, 3 frames and NETSCAPE loop", () => {
    const p = makeProject();
    const gif = encodeGIF(framesOf(p), 8, 8, p.palette.colors, { scale: 2 });
    expect(gif.toString("ascii", 0, 6)).toBe("GIF89a");
    expect(gif.readUInt16LE(6)).toBe(16);
    const s = gif.toString("latin1");
    expect(s).toContain("NETSCAPE2.0");
    expect((s.match(/\x2c/g) ?? []).length).toBeGreaterThanOrEqual(3);
    expect(gif[gif.length - 1]).toBe(0x3b);
  });
  it("SVG is crisp and animated for multiple frames", () => {
    const p = makeProject();
    const svg1 = encodeSVG([{ pixels: compositeFrame(p, p.frames[0]), durationMs: 100 }], 8, 8, p.palette.colors);
    expect(svg1).toContain('shape-rendering="crispEdges"');
    expect(svg1).toContain("<rect");
    const svgN = encodeSVG(framesOf(p), 8, 8, p.palette.colors);
    expect((svgN.match(/<animate /g) ?? []).length).toBe(3);
    expect(svgN).toContain('calcMode="discrete"');
  });
});

describe("spritesheet + metadata", () => {
  it("packs frames and emits Aseprite / Phaser / simple atlases", () => {
    const p = makeProject();
    const frames = p.frames.map(f => ({ pixels: compositeFrame(p, f) }));
    const { pixels, layout } = packSheet(frames, 8, 8, { columns: 2, padding: 1 });
    expect(layout.rects).toHaveLength(3);
    expect(pixels).toHaveLength(layout.width * layout.height);
    const ase = JSON.parse(buildAtlas(p, "aseprite", layout, "sheet.png"));
    expect(ase.frames).toHaveLength(3);
    expect(ase.meta.frameTags).toHaveLength(1);
    const phaser = JSON.parse(buildAtlas(p, "phaser3", layout, "sheet.png"));
    expect(phaser.frames[0].frame.x).toBe(layout.rects[0].x);
    const simple = JSON.parse(buildAtlas(p, "simple", layout, "sheet.png"));
    expect(simple.columns).toBe(2);
  });
  it("GPL, CSS and gallery are self-contained", () => {
    const p = makeProject();
    expect(buildGPL(p.palette)).toContain("GIMP Palette");
    const css = buildCSS(compositeFrame(p, p.frames[0]), 8, 8, p.palette.colors);
    expect(css).toContain("box-shadow:");
    const html = buildGallery(p, { scale: 4 });
    expect(html).toContain("data:image/png;base64");
    expect(html).toContain("sprite-agent-mcp");
    expect(html).not.toMatch(/https?:\/\/[^\s"']+\.(js|css)/); // no external assets
    expect(html).toContain("<script>");
  });
});
