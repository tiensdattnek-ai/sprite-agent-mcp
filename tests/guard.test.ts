import { describe, it, expect } from "vitest";
import { existsSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";
import { safeOutputPath, writeOutput, outputRoot, PolicyError, POLICY_TEXT } from "../src/core/paths.js";
import { verifyIntegrity } from "../src/core/integrity.js";
import { critique, enhance } from "../src/core/critique.js";
import { applyAnimation, tween, setTiming, shapeLoop, ANIMATION_PRESETS } from "../src/core/animation.js";
import { GENERATORS, generatorNames } from "../src/core/generators.js";
import { newProject, compositeFrame, view } from "../src/core/canvas.js";
import { getPalette } from "../src/core/palettes.js";
import { runGenerator } from "../src/core/generators.js";
import { mulberry32, hashSeed } from "../src/core/draw.js";

describe("WRITE GUARD (the core anti-code-edit promise)", () => {
  it("allows real art outputs inside the output root", () => {
    const r = writeOutput("guard-test/hero.png", Buffer.from([1, 2, 3]));
    expect(existsSync(r.path)).toBe(true);
    expect(readFileSync(r.path)).toEqual(Buffer.from([1, 2, 3]));
    expect(r.relative).toBe("guard-test/hero.png");
    rmSync(path.dirname(r.path), { recursive: true, force: true });
  });
  it("blocks path traversal", () => {
    expect(() => safeOutputPath("../src/hack.png")).toThrow(PolicyError);
    expect(() => safeOutputPath("a/../../package.json")).toThrow(PolicyError);
  });
  it("blocks absolute paths outside the root", () => {
    expect(() => safeOutputPath("/tmp/hack.png")).toThrow(PolicyError);
  });
  it("blocks writing into protected source directories", () => {
    expect(() => writeOutput("src/core/color.ts", "x")).toThrow(PolicyError); // .ts ext
    expect(() => writeOutput("scripts/evil.png", "x")).toThrow(PolicyError);
    expect(() => writeOutput(".github/workflows/evil.png", "x")).toThrow(PolicyError);
  });
  it("blocks source-code extensions and protected config names", () => {
    for (const f of ["evil.js", "evil.mjs", "evil.ts", "evil.sh", "package.json", "tsconfig.json", "README.md", "AGENTS.md"]) {
      expect(() => safeOutputPath(f)).toThrow(PolicyError);
    }
  });
  it("publishes the policy text", () => {
    expect(POLICY_TEXT).toContain("ONLY call MCP tools");
    expect(POLICY_TEXT).toContain("NEVER");
  });
  it("integrity tool reports a structured result", () => {
    const r = verifyIntegrity();
    expect(typeof r.clean).toBe("boolean");
    expect(Array.isArray(r.changed)).toBe(true);
    expect(r.policy).toContain("MCP");
  });
  it("outputRoot is outside the source tree", () => {
    expect(outputRoot()).toContain("sprite-output");
  });
});

describe("generators + animation + critique", () => {
  const project = () => newProject({ name: "Tester", width: 32, height: 32, palette: getPalette("db32"), frames: 1 });

  it("every generator draws non-empty pixels and respects frame count", () => {
    expect(generatorNames().length).toBeGreaterThanOrEqual(18);
    for (const name of generatorNames()) {
      const p = project();
      const v = view(p, p.frames[0]);
      runGenerator(name, v, { seed: hashSeed(name), rng: mulberry32(hashSeed(name)), frameIndex: 0, frameCount: GENERATORS[name].frames, paletteName: "db32" });
      expect(v.pixels.some(Boolean), `${name} drew nothing`).toBe(true);
      expect(GENERATORS[name].frames).toBeGreaterThanOrEqual(1);
    }
  });
  it("every animation preset creates the requested number of frames", () => {
    for (const preset of ANIMATION_PRESETS) {
      const p = project();
      // something to animate
      view(p, p.frames[0]).pixels.fill(p.palette.roles.base);
      const r = applyAnimation(p, { preset, frames: 4, durationMs: 100, amplitude: 1 });
      expect(r.frames).toBe(4);
      expect(p.frames).toHaveLength(4);
      expect(compositeFrame(p, p.frames[0]).length).toBe(32 * 32);
    }
  });
  it("tween inserts ordered-dither inbetweens", () => {
    const p = project();
    const a = view(p, p.frames[0]);
    a.pixels.fill(p.palette.roles.base);
    p.frames.push({ ...p.frames[0], id: "f2", name: "f2", layers: [{ ...p.frames[0].layers[0], id: "l2", pixels: new Uint8Array(32 * 32).fill(p.palette.roles.accent) }] });
    const n = tween(p, 0, 1, 3, { insert: true });
    expect(n).toBe(3);
    expect(p.frames).toHaveLength(5);
  });
  it("timing and loop shaping behave", () => {
    const p = project();
    applyAnimation(p, { preset: "idle_bob", frames: 4 });
    setTiming(p, { fps: 10 });
    expect(p.frames.every(f => f.durationMs === 100)).toBe(true);
    const n = shapeLoop(p, "pingpong");
    expect(n).toBeGreaterThan(4);
    expect(shapeLoop(p, "reverse")).toBe(p.frames.length);
  });
  it("enhance improves or at least does not break the critique", () => {
    const p = project();
    const v = view(p, p.frames[0]);
    // noisy sprite
    const rnd = mulberry32(42);
    for (let i = 0; i < v.pixels.length; i++) if (rnd() > 0.55) v.pixels[i] = 1 + Math.floor(rnd() * 8);
    const before = critique(p);
    const result = enhance(p, { despeckle: true, outline: true, shade: true, limitColors: 12, center: true });
    const after = critique(p);
    expect(typeof result.before).toBe("number");
    expect(after.scores.overall).toBeGreaterThanOrEqual(0);
    expect(after.grade).toMatch(/^[SABCD]$/);
    expect(before.suggestions.length).toBeGreaterThan(0);
  });
});
