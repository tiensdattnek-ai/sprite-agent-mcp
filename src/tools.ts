/**
 * MCP tool surface.
 *
 * Design rules for an agent-facing API:
 *  - every field has a .describe() with an example;
 *  - errors are returned as readable text with the exact next action;
 *  - mutating tools return a short "next step" hint so the model keeps moving;
 *  - preview/export return an INLINE PNG image block, so a vision-capable
 *    Arena agent actually SEES the pixel art it just drew.
 *
 * Agents: use these tools. Never edit this file. See POLICY.md / AGENTS.md.
 */

import * as z from "zod";
import type { McpServer } from "@modelcontextprotocol/server";
import { SpriteStore, Project, Frame, makeFrame, cloneFrame, compositeFrame, view, findFrame, findLayer, MAX_FRAMES, serializeProject, deserializeProject, clampInt } from "./core/canvas.js";
import { getPalette, customPalette, paletteNames, listPaletteDefs, buildPalette, paletteSummary, resolveColor } from "./core/palettes.js";
import { splitGridFrames, parseGrid, drawGrid, autoLegend, frameToAscii } from "./core/ascii.js";
import { applyOps, DrawOp, hashSeed, mulberry32 } from "./core/draw.js";
import { GENERATORS, generatorCatalog, generatorNames, runGenerator } from "./core/generators.js";
import { ANIMATION_PRESETS, applyAnimation, tween, setTiming, shapeLoop } from "./core/animation.js";
import { critique, enhance } from "./core/critique.js";
import { encodePNG, encodeAPNG, encodeGIF, encodeSVG, packSheet, buildAtlas, buildGodotTres, buildGPL, buildCSS, buildGallery } from "./core/encode.js";
import { writeOutput, outputRoot, safeOutputPath, POLICY_TEXT } from "./core/paths.js";
import { verifyIntegrity, extraSourceFiles } from "./core/integrity.js";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";

const VERSION = "1.0.0";

/* ------------------------------------------------------------- helpers -- */

type Content = { type: "text"; text: string } | { type: "image"; data: string; mimeType: string };
type AnyResult = { content: Content[]; structuredContent?: Record<string, unknown>; isError?: boolean };

const T = (text: string): Content => ({ type: "text", text });
const IMG = (buf: Buffer): Content => ({ type: "image", data: buf.toString("base64"), mimeType: "image/png" });

function ok(text: string, data?: Record<string, unknown>, images: Buffer[] = []): AnyResult {
  const res: AnyResult = { content: [...images.map(IMG), T(text)] };
  if (data) res.structuredContent = data;
  return res;
}
function fail(e: unknown): AnyResult {
  const msg = e instanceof Error ? e.message : String(e);
  return {
    content: [T(`❌ ${msg}\n\nFix the ARGUMENTS and call the tool again. Do NOT edit repository source. If stuck, call sprite_quickstart or read the sprite://guide/tools resource.`)],
    isError: true,
  };
}
function guard<A extends unknown[]>(fn: (...a: A) => AnyResult) {
  return (...a: A): AnyResult => { try { return fn(...a); } catch (e) { return fail(e); } };
}

const COMMON = {
  project: z.string().optional().describe("Project id. Omit to use the active project."),
};
const FRAME_REF = {
  frame: z.union([z.number().int(), z.string()]).optional().describe("Frame index (0-based), frame id or frame name. Omit = active frame."),
  layer: z.string().optional().describe("Layer name. Omit = topmost layer."),
};

export function registerTools(server: McpServer, store: SpriteStore, afterMutation: (p: Project) => void): void {
  const tool = (name: string, config: any, handler: (args: any) => AnyResult) => {
    server.registerTool(name, config, guard(handler) as any);
  };
  const P = (id?: string) => store.require(id);
  const framesOf = (p: Project) => p.frames.map((f, i) => ({ index: i, name: f.name, durationMs: f.durationMs, tags: f.tags, layers: f.layers.map(l => l.name) }));
  const summary = (p: Project) => ({
    id: p.id, name: p.name, width: p.width, height: p.height,
    palette: p.palette.name, colorCount: p.palette.colors.length - 1,
    frames: p.frames.length, activeFrame: p.activeFrame, tags: p.tags,
  });

  /* ---------------------------------------------------------- policy -- */

  tool("sprite_quickstart", {
    title: "Quickstart / workflow",
    description: "Call this FIRST. Returns the exact Arena.ai Agent workflow, tool order, the golden rules of pixel art and a ready-to-use example. No source reading needed.",
    inputSchema: z.object({}),
  }, () => ok(`✦ sprite-agent-mcp ${VERSION} — quickstart for Arena.ai Agent Mode

WORKFLOW (call tools in this order):
 1. sprite_new_project { name, width:32, height:32, palette:"db32" }
 2. sprite_generate { kind:"hero" }          ← instant hand-designed base sprite
    or sprite_draw_grid { grid:"..oo..", legend:{o:"outline"} } ← draw it yourself
 3. sprite_draw_ops { ops:[{op:"outline",color:"outline"},{op:"shade",light:"nw"}] }
 4. sprite_enhance { outline:true, shade:true, despeckle:true }
 5. sprite_critique {}                       ← read suggestions, iterate
 6. sprite_animate { preset:"idle_bob", frames:6 }  or sprite_tween
 7. sprite_preview {}                        ← INLINE PNG, you can SEE the art
 8. sprite_export { formats:["png","gif","apng","spritesheet","svg"] }
 9. sprite_gallery {}                        ← standalone HTML player

GOLDEN RULES: ≤16 colors · 1px selective dark outline · hue-shifted shadows
(cooler) and highlights (warmer) · light from north-west · no anti-aliasing ·
nearest-neighbour scaling only · 8–12 fps with 2–4 key poses · mirror for
symmetry · keep the silhouette readable at 1× size.

POLICY: ONLY MCP tools. NEVER edit/create/delete ANY file in this repository.
All output is written to ${outputRoot()} by the server's write guard.
If a tool errors: change the arguments, do NOT patch the code.

TIP: colors can be hex ("#ff0044"), semantic roles ("outline", "shadow",
"base", "light", "highlight", "accent", "skin", "metal", "nature", "water"),
palette indices ("7"), "ramp:4", or "transparent" / ".".
`, { version: VERSION, outputRoot: outputRoot(), tools: TOOL_NAMES, palettes: paletteNames(), generators: generatorNames(), animations: ANIMATION_PRESETS }));

  tool("sprite_policy", {
    title: "Agent operations policy",
    description: "Returns the binding policy: agents MUST only call MCP tools and MUST NOT modify repository code. Also reports source-integrity status. Read this before doing anything else.",
    inputSchema: z.object({}),
  }, () => {
    const r = verifyIntegrity();
    return ok(`${POLICY_TEXT}\n--- integrity ---\n${r.message}\nextra source files: ${extraSourceFiles().join(", ") || "none"}`, { integrity: r, writeGuard: "active", outputRoot: outputRoot() });
  });

  tool("sprite_verify_integrity", {
    title: "Verify source integrity",
    description: "SHA-256 check of every tracked source/config file against integrity/manifest.json. Use it to prove no agent edited the code. If clean=false, STOP and ask the human to restore.",
    inputSchema: z.object({}),
  }, () => {
    const r = verifyIntegrity();
    const extra = extraSourceFiles();
    return ok(`${r.message}\nchanged: ${r.changed.join(", ") || "none"}\nmissing: ${r.missing.join(", ") || "none"}\nextra source files: ${extra.join(", ") || "none"}`, { ...r, extra });
  });

  /* -------------------------------------------------------- palettes -- */

  tool("sprite_list_palettes", {
    title: "List palettes",
    description: "List all built-in curated pixel-art palettes with roles and hex colors. Use the `name` with sprite_new_project or sprite_palette.",
    inputSchema: z.object({}),
  }, () => ok(
    `Available palettes: ${paletteNames().join(", ")}`,
    { palettes: listPaletteDefs().map(d => ({ name: d.name, colorCount: d.colors.length, description: d.description, colors: d.colors, roles: d.roles })) },
  ));

  tool("sprite_palette", {
    title: "Get or set palette",
    description: "Inspect the active palette, switch to a built-in one, or install a custom palette. Also lists all semantic color roles for the current project.",
    inputSchema: z.object({
      ...COMMON,
      name: z.string().optional().describe("Built-in palette name to switch to, e.g. 'db32', 'pico8', 'sweetie16', 'endesga32', 'gameboy', 'neon16'."),
      colors: z.array(z.string()).optional().describe("Custom hex colors (index 0 transparency is automatic). Combine with `name` to install a custom palette."),
      description: z.string().optional(),
    }),
  }, (a) => {
    const p = P(a.project);
    if (a.name && a.colors?.length) p.palette = customPalette(a.name, a.colors, a.description);
    else if (a.name) p.palette = getPalette(a.name);
    afterMutation(p);
    return ok(`Palette: ${p.palette.name} (${p.palette.colors.length - 1} colors). Roles: ${Object.keys(p.palette.roles).join(", ")}. Next: sprite_draw_grid or sprite_generate.`, { ...paletteSummary(p.palette) });
  });

  /* -------------------------------------------------------- projects -- */

  tool("sprite_new_project", {
    title: "New project",
    description: "Create an indexed pixel-art project: canvas size, palette, frames and layers. Always call this first. Classic sizes: 16×16 icons, 32×32 characters, 64×64 bosses.",
    inputSchema: z.object({
      name: z.string().min(1).describe("Project name, e.g. 'Forest Knight'."),
      id: z.string().optional().describe("Optional stable id (slug)."),
      width: z.number().int().min(1).max(512).optional().describe("Canvas width in pixels (default 32)."),
      height: z.number().int().min(1).max(512).optional().describe("Canvas height in pixels (default 32)."),
      palette: z.string().optional().describe("Built-in palette name (default 'db32'). Call sprite_list_palettes for options."),
      frames: z.number().int().min(1).max(256).optional().describe("Initial frame count (default 1)."),
      layers: z.array(z.string()).optional().describe("Layer names bottom→top, e.g. ['background','art','fx'] (default ['art'])."),
      durationMs: z.number().int().min(16).max(5000).optional().describe("Frame duration in ms (default 100 = 10 fps)."),
      tags: z.array(z.string()).optional().describe("Project tags, e.g. ['rpg','hero']."),
    }),
  }, (a) => {
    const pal = a.palette ? resolvePalette(a.palette) : getPalette("db32");
    const p = store.create({ id: a.id, name: a.name, width: a.width, height: a.height, palette: pal, frames: a.frames, layers: a.layers, durationMs: a.durationMs, tags: a.tags });
    afterMutation(p);
    return ok(`✅ Project "${p.name}" (${p.width}×${p.height}, ${p.palette.name}, ${p.frames.length} frame(s)). Next: sprite_generate or sprite_draw_grid.`, { project: summary(p), frames: framesOf(p), roles: p.palette.roles });
  });

  tool("sprite_list_projects", {
    title: "List projects",
    description: "List all projects currently held in the server session (shared across stdio and HTTP connections).",
    inputSchema: z.object({}),
  }, () => ok(`${store.list().length} project(s) in session. Active: ${store.active() ?? "none"}`, { projects: store.list(), active: store.active() ?? null }));

  tool("sprite_project_info", {
    title: "Project info",
    description: "Inspect the whole project state: size, palette, roles, frames, durations, layers and tags.",
    inputSchema: z.object({ ...COMMON }),
  }, (a) => {
    const p = P(a.project);
    return ok(`Project ${p.id} · ${p.width}×${p.height} · ${p.frames.length} frames · ${p.palette.name}`, { ...summary(p), frames: framesOf(p), palette: paletteSummary(p.palette), createdAt: p.createdAt, updatedAt: p.updatedAt });
  });

  tool("sprite_select_project", {
    title: "Select project",
    description: "Make a project the active one, so later calls can omit the `project` argument.",
    inputSchema: z.object({ project: z.string().describe("Project id to activate.") }),
  }, (a) => {
    const p = store.require(a.project);
    store.setActive(p.id);
    return ok(`Active project: ${p.id}`, { project: summary(p) });
  });

  tool("sprite_delete_project", {
    title: "Delete project",
    description: "Remove a project from the in-memory session (does not delete exported files).",
    inputSchema: z.object({ project: z.string().describe("Project id to delete.") }),
  }, (a) => {
    const deleted = store.delete(a.project);
    return ok(deleted ? `Deleted ${a.project}` : `No project ${a.project}`, { deleted });
  });

  tool("sprite_layer", {
    title: "Layer operations",
    description: "Add / remove / rename / show / hide / lock layers, or set layer opacity (opacity uses ordered dithering, never new colors). Layers exist per frame.",
    inputSchema: z.object({
      ...COMMON, ...FRAME_REF,
      action: z.enum(["add", "remove", "rename", "show", "hide", "lock", "unlock", "opacity"]).describe("Operation to perform."),
      layer: z.string().describe("Target layer name (for 'add', this is the NEW layer name)."),
      newName: z.string().optional(),
      opacity: z.number().min(0).max(1).optional(),
      allFrames: z.boolean().optional().describe("Apply add/remove/rename to every frame (default true)."),
    }),
  }, (a) => {
    const p = P(a.project);
    const targets = a.allFrames === false ? [findFrame(p, a.frame)] : p.frames;
    for (const f of targets) {
      if (a.action === "add" && !f.layers.some(l => l.name === a.layer)) {
        const l = makeFrame(p.width, p.height, { layers: [a.layer] }).layers[0];
        f.layers.push(l);
      } else {
        const l = findLayer(f, a.layer);
        switch (a.action) {
          case "remove": f.layers = f.layers.filter(x => x !== l); break;
          case "rename": l.name = a.newName ?? l.name; break;
          case "show": l.visible = true; break;
          case "hide": l.visible = false; break;
          case "lock": l.locked = true; break;
          case "unlock": l.locked = false; break;
          case "opacity": l.opacity = a.opacity ?? l.opacity; break;
        }
      }
    }
    afterMutation(p);
    return ok(`Layer op "${a.action}" applied to ${targets.length} frame(s).`, { frames: framesOf(p) });
  });

  /* ---------------------------------------------------------- drawing -- */

  tool("sprite_draw_grid", {
    title: "Draw with ASCII grid",
    description: `THE PRIMARY DRAWING TOOL for LLMs. Write the sprite as text rows; each character maps to a color via \`legend\`. "." / space = transparent. Use "---" on its own line between grids to create several animation frames in one call. Example: grid:"..ooo..\\n.osssso.\\n..ooo..", legend:{o:"outline",s:"skin"}. If legend is omitted, characters are auto-mapped to palette roles (outline, shadow, base, light, highlight, accent...).`,
    inputSchema: z.object({
      ...COMMON, ...FRAME_REF,
      grid: z.union([z.string(), z.array(z.string())]).describe("Sprite as text rows (or an array of rows). Separate frames with a line of dashes '---'."),
      legend: z.record(z.string(), z.union([z.string(), z.number()])).optional().describe("char → color: hex, semantic role, palette index, 'ramp:3', or 'transparent'."),
      at: z.object({ x: z.number().int(), y: z.number().int() }).optional().describe("Top-left offset in pixels."),
      mirrorX: z.boolean().optional().describe("Mirror every drawn pixel horizontally (draw only the left half)."),
      mirrorY: z.boolean().optional(),
      scale: z.number().int().min(1).max(16).optional().describe("Integer upscale of each grid cell (default 1)."),
      clear: z.boolean().optional().describe("Clear the layer before drawing (default true)."),
      durationMs: z.number().int().min(16).max(5000).optional().describe("Duration for frames created from a multi-frame grid."),
      namePrefix: z.string().optional(),
    }),
  }, (a) => {
    const p = P(a.project);
    const chunks = splitGridFrames(a.grid);
    if (!chunks.length) throw new Error("grid is empty");
    const grids = chunks.map(parseGrid);
    const maxW = Math.max(...grids.map(g => g.width)), maxH = Math.max(...grids.map(g => g.height));
    const scale = a.scale ?? 1;
    if (maxW * scale > p.width || maxH * scale > p.height) {
      // Be helpful instead of silently clipping.
      throw new Error(`Grid is ${maxW}×${maxH} (×${scale}) but canvas is ${p.width}×${p.height}. Reduce the grid, lower scale, or create a bigger project.`);
    }
    const startFrame = p.frames.indexOf(findFrame(p, a.frame));
    const results: Array<{ frame: string; written: number; legend: Record<string, number> }> = [];
    grids.forEach((g, i) => {
      let frame: Frame;
      if (i === 0) frame = p.frames[startFrame];
      else {
        const existing = p.frames[startFrame + i];
        if (existing) frame = existing;
        else {
          frame = cloneFrame(p.frames[startFrame], `${a.namePrefix ?? "frame"}_${String(startFrame + i).padStart(2, "0")}`);
          frame.layers.forEach(l => l.pixels.fill(0));
          p.frames.push(frame);
        }
        frame.durationMs = a.durationMs ?? frame.durationMs;
      }
      const v = view(p, frame, a.layer);
      const r = drawGrid(v, g, { legend: a.legend, at: a.at, mirrorX: a.mirrorX, mirrorY: a.mirrorY, scale, clear: a.clear ?? true });
      results.push({ frame: frame.name, written: r.pixelsWritten, legend: r.legend });
    });
    p.activeFrame = startFrame;
    afterMutation(p);
    const auto = !a.legend ? autoLegend(chunks.join("\n"), p.palette) : undefined;
    return ok(`✅ Drew ${grids.length} frame(s), ${results.reduce((n, r) => n + r.written, 0)} pixels.${auto ? ` Auto-legend: ${JSON.stringify(auto)}` : ""} Next: sprite_draw_ops (shade/outline) → sprite_preview.`, { results, autoLegend: auto, frames: framesOf(p) });
  });

  tool("sprite_draw_ops", {
    title: "Draw with operations",
    description: `Vector-ish pixel ops, all snapped to integer pixels. Ops: clear, pixel(s), rect, line, circle/ellipse, polygon, fill (flood), dither, gradient, noise, scatter, replace, outline, shade, mirror, shift, text (3×5 font), crop. Example ops:[{op:"rect",x:4,y:4,w:8,h:8,color:"base"},{op:"shade",light:"nw"},{op:"outline",color:"outline",mode:"selective"}]. The "shade" op adds hue-shifted light/shadow; "outline" adds a real silhouette outline.`,
    inputSchema: z.object({
      ...COMMON, ...FRAME_REF,
      ops: z.array(z.record(z.string(), z.any())).min(1).describe("Ordered list of draw operations. Each needs an `op` field; colors accept hex/roles/indices."),
      allFrames: z.boolean().optional().describe("Apply the same ops to every frame (default false)."),
    }),
  }, (a) => {
    const p = P(a.project);
    const base = findFrame(p, a.frame);
    const targets = a.allFrames ? p.frames : [base];
    let applied = 0;
    for (const f of targets) {
      const v = view(p, f, a.layer);
      applied += applyOps(v, a.ops as DrawOp[]).applied;
    }
    afterMutation(p);
    return ok(`✅ Applied ${a.ops.length} op(s) to ${targets.length} frame(s). Next: sprite_critique → sprite_preview.`, { applied, frames: framesOf(p) });
  });

  tool("sprite_generate", {
    title: "Generate a sprite procedurally",
    description: `One-call, seeded, hand-designed pixel-art recipes. Kinds: hero, slime, potion, gem, chest, sword, shield, tree, mushroom, ghost, coin, star, torch, planet, cloud, heart, portrait, tile_grass, tile_stone, tile_brick, tile_water, tile_lava. Animated kinds (slime/ghost/coin/star/torch/tile_water/tile_lava) create a full looping timeline automatically. Call sprite_catalog for the full list.`,
    inputSchema: z.object({
      ...COMMON, ...FRAME_REF,
      kind: z.string().describe("Generator name, e.g. 'hero', 'slime', 'tile_water'."),
      seed: z.union([z.string(), z.number()]).optional().describe("Deterministic seed — same seed always gives the same sprite."),
      frames: z.number().int().min(1).max(256).optional().describe("Override the generator's default frame count."),
      durationMs: z.number().int().min(16).max(5000).optional(),
      replace: z.boolean().optional().describe("Replace the whole timeline (default true). false = append."),
      tags: z.array(z.string()).optional(),
    }),
  }, (a) => {
    const p = P(a.project);
    const def = GENERATORS[a.kind];
    if (!def) throw new Error(`Unknown generator "${a.kind}". Available: ${generatorNames().join(", ")}`);
    const count = a.frames ?? def.frames;
    const seed = hashSeed(a.seed ?? `${a.kind}:${p.id}`);
    const baseFrame = findFrame(p, a.frame);
    const built: Frame[] = [];
    for (let i = 0; i < count; i++) {
      const f = makeFrame(p.width, p.height, {
        name: `${a.kind}_${String(i).padStart(2, "0")}`,
        layers: baseFrame.layers.map(l => l.name),
        durationMs: a.durationMs ?? def.durationMs,
        tags: a.tags ?? def.tags,
      });
      const v = view(p, f, a.layer);
      runGenerator(a.kind, v, { seed: seed + i * 7919, rng: mulberry32(seed + i * 7919), frameIndex: i, frameCount: count, paletteName: p.palette.name });
      built.push(f);
    }
    p.frames = a.replace === false ? [...p.frames, ...built].slice(0, MAX_FRAMES) : built;
    p.activeFrame = 0;
    afterMutation(p);
    return ok(`✅ Generated "${a.kind}" · ${built.length} frame(s) · seed ${seed}. Next: sprite_enhance {outline:true,shade:true} → sprite_preview.`, { kind: a.kind, frames: built.length, seed, tags: def.tags, project: summary(p) });
  });

  tool("sprite_catalog", {
    title: "Catalog",
    description: "List every generator, animation preset, palette, built-in font character and available export format. Use it to discover capabilities instead of reading source files.",
    inputSchema: z.object({}),
  }, () => ok(
    `Generators: ${generatorNames().join(", ")}\nAnimations: ${ANIMATION_PRESETS.join(", ")}\nPalettes: ${paletteNames().join(", ")}`,
    {
      generators: generatorCatalog(), animations: ANIMATION_PRESETS, palettes: paletteNames(),
      exportFormats: ["png", "gif", "apng", "svg", "spritesheet", "gpl", "css", "json", "gallery"],
      atlasFlavors: ["aseprite", "phaser3", "simple", "godot"],
      drawOps: ["clear", "pixel", "pixels", "rect", "line", "circle", "ellipse", "polygon", "fill", "dither", "gradient", "noise", "scatter", "replace", "outline", "shade", "mirror", "shift", "text", "crop"],
    },
  ));

  /* ---------------------------------------------------------- frames -- */

  tool("sprite_frame", {
    title: "Frame operations",
    description: "add / duplicate / delete / rename / select / set_duration / tag / reorder frames. Index is 0-based.",
    inputSchema: z.object({
      ...COMMON,
      action: z.enum(["add", "duplicate", "delete", "rename", "select", "set_duration", "tag", "reorder"]),
      frame: z.union([z.number().int(), z.string()]).optional().describe("Target frame index/name (default active)."),
      name: z.string().optional(),
      durationMs: z.number().int().min(16).max(5000).optional(),
      tags: z.array(z.string()).optional(),
      to: z.number().int().optional().describe("Destination index for 'reorder'."),
      all: z.boolean().optional().describe("For set_duration: apply to all frames."),
    }),
  }, (a) => {
    const p = P(a.project);
    const f = findFrame(p, a.frame);
    const i = p.frames.indexOf(f);
    switch (a.action) {
      case "add": {
        const nf = makeFrame(p.width, p.height, { name: a.name ?? `frame_${String(p.frames.length).padStart(2, "0")}`, durationMs: a.durationMs ?? 100, layers: f.layers.map(l => l.name) });
        p.frames.splice(i + 1, 0, nf); p.activeFrame = i + 1; break;
      }
      case "duplicate": { const nf = cloneFrame(f, a.name); p.frames.splice(i + 1, 0, nf); p.activeFrame = i + 1; break; }
      case "delete": if (p.frames.length <= 1) throw new Error("Cannot delete the last frame"); p.frames.splice(i, 1); p.activeFrame = Math.min(i, p.frames.length - 1); break;
      case "rename": f.name = a.name ?? f.name; break;
      case "select": p.activeFrame = i; break;
      case "set_duration": (a.all ? p.frames : [f]).forEach(x => { x.durationMs = a.durationMs ?? 100; }); break;
      case "tag": f.tags = a.tags ?? []; break;
      case "reorder": {
        const to = clampInt(a.to ?? 0, 0, p.frames.length - 1);
        const [moved] = p.frames.splice(i, 1); p.frames.splice(to, 0, moved); p.activeFrame = to; break;
      }
    }
    afterMutation(p);
    return ok(`Frame op "${a.action}" done. ${p.frames.length} frame(s).`, { frames: framesOf(p), activeFrame: p.activeFrame });
  });

  tool("sprite_animate", {
    title: "Animate a sprite",
    description: `Build a full animation timeline from the active frame. Presets: idle_bob, walk_cycle, blink, pulse, squash_stretch, spin, shake, wave, flicker, explode, jump, glow, hue_cycle, float. Integer/nearest-neighbour only — never blurred. Example: {preset:"idle_bob", frames:6, durationMs:120, amplitude:1}.`,
    inputSchema: z.object({
      ...COMMON,
      preset: z.enum(ANIMATION_PRESETS).describe("Motion preset."),
      frames: z.number().int().min(1).max(256).optional(),
      durationMs: z.number().int().min(16).max(5000).optional(),
      amplitude: z.number().min(0).max(16).optional().describe("Motion strength in pixels (default 1)."),
      seed: z.union([z.string(), z.number()]).optional(),
      easing: z.enum(["linear", "ease-in", "ease-out", "ease-in-out"]).optional(),
      sourceFrame: z.union([z.number().int(), z.string()]).optional(),
      replace: z.boolean().optional().describe("Replace the timeline (default true). false = append."),
      tags: z.array(z.string()).optional(),
    }),
  }, (a) => {
    const p = P(a.project);
    const r = applyAnimation(p, a);
    afterMutation(p);
    return ok(`✅ Animation "${r.preset}" · ${r.frames} frames · ${a.durationMs ?? 100}ms each. Next: sprite_loop {mode:"pingpong"} → sprite_preview.`, { ...r, frames: framesOf(p) });
  });

  tool("sprite_tween", {
    title: "Inbetween frames",
    description: "Create intermediate frames between two keyframes using ordered-dither cross dissolve (pixel-art correct, no alpha blur). Example: {from:0,to:2,steps:3}.",
    inputSchema: z.object({
      ...COMMON,
      from: z.number().int().min(0).describe("Index of the first keyframe."),
      to: z.number().int().min(0).describe("Index of the second keyframe."),
      steps: z.number().int().min(1).max(32).describe("Number of inbetween frames."),
      durationMs: z.number().int().min(16).max(5000).optional(),
      pattern: z.enum(["bayer", "random"]).optional(),
      seed: z.union([z.string(), z.number()]).optional(),
      insert: z.boolean().optional().describe("Insert right after `from` (default true). false = replace timeline with only the tween frames."),
    }),
  }, (a) => {
    const p = P(a.project);
    const n = tween(p, a.from, a.to, a.steps, { insert: a.insert ?? true, durationMs: a.durationMs, pattern: a.pattern, seed: a.seed });
    afterMutation(p);
    return ok(`✅ Created ${n} inbetween frame(s). Timeline now has ${p.frames.length} frames.`, { created: n, frames: framesOf(p) });
  });

  tool("sprite_timing", {
    title: "Set frame timing",
    description: "Set a constant fps (10–12 fps is the pixel-art sweet spot), a constant duration, or per-frame durations. Example: {fps:10}.",
    inputSchema: z.object({
      ...COMMON,
      fps: z.number().min(1).max(60).optional(),
      durationMs: z.number().int().min(16).max(5000).optional(),
      durations: z.array(z.number().int()).optional(),
      perFrame: z.record(z.string(), z.number()).optional(),
    }),
  }, (a) => {
    const p = P(a.project);
    const durations = setTiming(p, { fps: a.fps, durationMs: a.durationMs, durations: a.durations, perFrame: a.perFrame });
    afterMutation(p);
    return ok(`⏱ Durations: ${durations.join(", ")} ms (total ${durations.reduce((x, y) => x + y, 0)} ms).`, { durations, totalMs: durations.reduce((x, y) => x + y, 0) });
  });

  tool("sprite_loop", {
    title: "Shape the loop",
    description: "pingpong (seamless back-and-forth), reverse, hold (freeze each frame N times) or deduplicate (remove identical frames). Example: {mode:'pingpong'}.",
    inputSchema: z.object({
      ...COMMON,
      mode: z.enum(["pingpong", "reverse", "hold", "deduplicate"]),
      times: z.number().int().min(1).max(20).optional(),
    }),
  }, (a) => {
    const p = P(a.project);
    const n = shapeLoop(p, a.mode, a.times ?? 1);
    afterMutation(p);
    return ok(`🔁 ${a.mode}: ${n} (resulting ${p.frames.length} frames).`, { affected: n, frames: framesOf(p) });
  });

  /* ---------------------------------------------------- art direction -- */

  tool("sprite_enhance", {
    title: "Auto-beautify",
    description: `One-click pro polish: despeckle jaggies, enforce palette economy, add a selective dark outline, apply hue-shifted light/shadow (cool shadows, warm highlights), fix symmetry and center the silhouette. Example: {outline:true, shade:true, despeckle:true, limitColors:16}.`,
    inputSchema: z.object({
      ...COMMON, ...FRAME_REF,
      despeckle: z.boolean().optional(),
      outline: z.boolean().optional(),
      shade: z.boolean().optional(),
      center: z.boolean().optional(),
      crop: z.boolean().optional(),
      limitColors: z.number().int().min(2).max(64).optional(),
      harmonize: z.boolean().optional(),
      mirrorX: z.boolean().optional(),
      light: z.string().optional().describe("Light direction: nw, ne, sw, se, n, s (default nw)."),
      allFrames: z.boolean().optional().describe("Apply to every frame (default true)."),
    }),
  }, (a) => {
    const p = P(a.project);
    const saved = a.allFrames === false ? p.frames.filter((_, i) => i === p.frames.indexOf(findFrame(p, a.frame))) : p.frames;
    const original = p.frames;
    if (a.allFrames === false) p.frames = saved;
    const r = enhance(p, a);
    p.frames = original;
    afterMutation(p);
    return ok(`✨ Enhanced. Overall score ${r.before} → ${r.after}. Applied: ${r.applied.join(", ") || "nothing (enable at least one option)"}. Next: sprite_critique.`, { ...r, critique: critique(p) });
  });

  tool("sprite_critique", {
    title: "Critique the pixel art",
    description: "Scores color economy, silhouette, outline, shading and animation (0–100, grade S–D) and returns concrete next tool calls. Use it before exporting.",
    inputSchema: z.object({ ...COMMON }),
  }, (a) => {
    const p = P(a.project);
    const c = critique(p);
    return ok(`📊 Grade ${c.grade} · overall ${c.scores.overall}/100\n` +
      `color ${c.scores.colorEconomy} · silhouette ${c.scores.silhouette} · outline ${c.scores.outline} · shading ${c.scores.shading} · animation ${c.scores.animation}\n` +
      `Suggestions:\n${c.suggestions.map((s, i) => ` ${i + 1}. ${s}`).join("\n")}`, { ...c });
  });

  tool("sprite_inspect", {
    title: "Inspect as text",
    description: "Return the frame as an ASCII grid + legend + color histogram. Perfect for text-only reasoning and for iterating on a specific frame without vision.",
    inputSchema: z.object({ ...COMMON, ...FRAME_REF, maxWidth: z.number().int().min(4).max(256).optional() }),
  }, (a) => {
    const p = P(a.project);
    const f = findFrame(p, a.frame);
    const px = compositeFrame(p, f);
    const { ascii, legend } = frameToAscii(px, p.width, p.height);
    const hist: Record<string, number> = {};
    for (const c of px) if (c) hist[c] = (hist[c] ?? 0) + 1;
    return ok(`Frame "${f.name}" (${p.width}×${p.height}) — legend ${JSON.stringify(legend)}\n\n${ascii}`, { frame: f.name, ascii, legend, histogram: hist, colors: p.palette.colors.slice(1).map((c, i) => `#${i + 1} ${c.r},${c.g},${c.b}`) });
  });

  /* ---------------------------------------------------------- output -- */

  tool("sprite_preview", {
    title: "Preview (inline PNG)",
    description: "Render the sprite as an INLINE PNG image content block so you (the agent) can actually SEE the art. Use 'all' to get a contact sheet of the whole animation. Returns a text summary too.",
    inputSchema: z.object({
      ...COMMON,
      frame: z.union([z.number().int(), z.string(), z.literal("all")]).optional().describe("Frame index/name, or 'all' for a contact sheet (default active)."),
      scale: z.number().int().min(1).max(16).optional().describe("Nearest-neighbour zoom (auto when omitted)."),
      columns: z.number().int().min(1).max(16).optional(),
      background: z.string().optional().describe("Optional background hex, e.g. '#1d1b2e'. Default transparent (checkerboard in gallery)."),
      ascii: z.boolean().optional().describe("Also include the ASCII grid (default false)."),
    }),
  }, (a) => {
    const p = P(a.project);
    const w = p.width, h = p.height;
    let image: Buffer;
    let label: string;
    const all = a.frame === "all";
    if (all && p.frames.length > 1) {
      const sheet = packSheet(p.frames.map(f => ({ pixels: compositeFrame(p, f) })), w, h, { padding: 1, columns: a.columns });
      const scale = a.scale ?? Math.max(1, Math.min(8, Math.floor(512 / Math.max(sheet.layout.width, sheet.layout.height))));
      image = encodePNG(sheet.pixels, sheet.layout.width, sheet.layout.height, p.palette.colors, { scale, background: a.background });
      label = `contact sheet · ${p.frames.length} frames · ${sheet.layout.columns}×${sheet.layout.rows}`;
    } else {
      const f = findFrame(p, all ? undefined : a.frame as number | string | undefined);
      const px = compositeFrame(p, f);
      const scale = a.scale ?? Math.max(1, Math.min(16, Math.floor(512 / Math.max(w, h))));
      image = encodePNG(px, w, h, p.palette.colors, { scale, background: a.background });
      label = `frame "${f.name}" · ${w}×${h} · ${scale}×`;
    }
    const extra = a.ascii ? `\n\n${frameToAscii(compositeFrame(p, findFrame(p, all ? undefined : a.frame as number | string | undefined)), w, h).ascii}` : "";
    return ok(`🖼 ${label} · palette ${p.palette.name} · ${p.frames.length} frame(s). Next: sprite_export or sprite_gallery.${extra}`, { label, scale: a.scale ?? "auto", frames: p.frames.length, palette: p.palette.name }, [image]);
  });

  tool("sprite_export", {
    title: "Export everything",
    description: `Write real files (never source files). formats: png (per frame), gif, apng (lossless animated PNG), svg (animated), spritesheet (PNG + atlas JSON), gpl, css, json (project), gallery. Example: {formats:["png","gif","spritesheet","apng"], scale:8, atlas:"aseprite"}. Returns absolute paths and an inline preview.`,
    inputSchema: z.object({
      ...COMMON,
      formats: z.array(z.enum(["png", "gif", "apng", "svg", "spritesheet", "gpl", "css", "json", "gallery", "all"])).min(1).describe("Export formats. 'all' produces every format."),
      name: z.string().optional().describe("Base file name (default project id, sanitized)."),
      dir: z.string().optional().describe("Relative subfolder inside the output root, e.g. 'my-game/hero' (no '..')."),
      scale: z.number().int().min(1).max(32).optional().describe("Integer nearest-neighbour scale for raster exports (default 8)."),
      background: z.string().optional().describe("Optional solid background hex for PNG/APNG."),
      padding: z.number().int().min(0).max(16).optional().describe("Spritesheet gutter in pixels (default 1)."),
      columns: z.number().int().min(1).max(32).optional(),
      atlas: z.enum(["aseprite", "phaser3", "simple", "godot"]).optional().describe("Atlas JSON flavor (default 'aseprite')."),
      loop: z.boolean().optional().describe("GIF loop forever (default true)."),
      title: z.string().optional(),
    }),
  }, (a) => {
    const p = P(a.project);
    const base = safeName(a.name ?? p.id);
    const dir = a.dir ? safeName(a.dir, true) + "/" : "";
    const prefix = `${dir}${base}`;
    const scale = a.scale ?? 8;
    const formats: string[] = a.formats.includes("all") ? ["png", "gif", "apng", "svg", "spritesheet", "gpl", "css", "json", "gallery"] : a.formats;
    const frames = p.frames.map(f => ({ pixels: compositeFrame(p, f), durationMs: f.durationMs, name: f.name }));
    const files: Array<{ format: string; path: string; relative: string; bytes: number }> = [];
    const add = (format: string, rel: string, data: string | Uint8Array) => {
      const r = writeOutput(rel, data);
      files.push({ format, path: r.path, relative: r.relative, bytes: r.bytes });
    };
    let sheetPng: Buffer | undefined;
    for (const fmt of new Set(formats)) {
      switch (fmt) {
        case "png":
          p.frames.forEach((f, i) => add("png", `${prefix}_frame_${String(i).padStart(2, "0")}.png`, encodePNG(frames[i].pixels, p.width, p.height, p.palette.colors, { scale, background: a.background })));
          break;
        case "gif": add("gif", `${prefix}.gif`, encodeGIF(frames, p.width, p.height, p.palette.colors, { scale: Math.min(scale, 16), loop: a.loop ?? true })); break;
        case "apng": add("apng", `${prefix}_animated.png`, encodeAPNG(frames, p.width, p.height, p.palette.colors, { scale, background: a.background })); break;
        case "svg": add("svg", `${prefix}.svg`, encodeSVG(frames, p.width, p.height, p.palette.colors)); break;
        case "gpl": add("gpl", `${prefix}.gpl`, buildGPL(p.palette)); break;
        case "css": add("css", `${prefix}.css`, buildCSS(frames[0].pixels, p.width, p.height, p.palette.colors, Math.min(16, scale))); break;
        case "json": add("json", `${prefix}.spriteproj.json`, serializeProject(p)); break;
        case "gallery": add("gallery", `${prefix}_gallery.html`, buildGallery(p, { scale: Math.min(16, scale), title: a.title, background: a.background })); break;
        case "spritesheet": {
          const sheet = packSheet(frames, p.width, p.height, { padding: a.padding ?? 1, columns: a.columns });
          sheetPng = encodePNG(sheet.pixels, sheet.layout.width, sheet.layout.height, p.palette.colors, { scale: Math.min(scale, 8), background: a.background });
          add("spritesheet", `${prefix}_sheet.png`, sheetPng);
          const flavor = a.atlas ?? "aseprite";
          if (flavor === "godot") {
            add("atlas", `${prefix}_atlas.json`, buildAtlas(p, "aseprite", sheet.layout, `${base}_sheet.png`));
            add("godot", `${prefix}.tres`, buildGodotTres(p, `${base}_sheet.png`, sheet.layout));
          } else {
            add("atlas", `${prefix}_atlas.json`, buildAtlas(p, flavor, sheet.layout, `${base}_sheet.png`));
          }
          break;
        }
      }
    }
    if (!sheetPng && p.frames.length) {
      const sheet = packSheet(frames, p.width, p.height, { padding: 1, columns: a.columns });
      sheetPng = encodePNG(sheet.pixels, sheet.layout.width, sheet.layout.height, p.palette.colors, { scale: Math.min(4, scale) });
    }
    return ok(`📦 Exported ${files.length} file(s) into ${outputRoot()}:\n${files.map(f => ` • ${f.format.padEnd(11)} ${f.relative} (${f.bytes} B)`).join("\n")}\n\nAll writes are guarded: no repository source was touched.`, { files, outputRoot: outputRoot(), project: summary(p) }, sheetPng ? [sheetPng] : []);
  });

  tool("sprite_gallery", {
    title: "Build HTML gallery player",
    description: "Write a fully self-contained HTML animation player (inline base64 PNGs, playback controls, onion skin, zoom, palette swatches, frame tags). Works offline and in a sandboxed preview.",
    inputSchema: z.object({
      ...COMMON,
      name: z.string().optional().describe("File name (default '<project>_gallery.html')."),
      dir: z.string().optional(),
      title: z.string().optional(),
      scale: z.number().int().min(1).max(16).optional(),
      background: z.string().optional(),
    }),
  }, (a) => {
    const p = P(a.project);
    const rel = `${a.dir ? safeName(a.dir, true) + "/" : ""}${safeName(a.name ?? `${p.id}_gallery.html`)}`;
    const html = buildGallery(p, { title: a.title ?? p.name, scale: a.scale ?? 8, background: a.background });
    const r = writeOutput(rel, html);
    return ok(`🖼 Gallery written: ${r.path}\nOpen it to play the animation with onion skin + zoom. It is self-contained (no network).`, { path: r.path, relative: r.relative, bytes: r.bytes, frames: p.frames.length });
  });

  tool("sprite_save_project", {
    title: "Save project (JSON)",
    description: "Serialize the full project (palette, layers, all frames, durations) to a .spriteproj.json inside the output root. Load it later with sprite_load_project.",
    inputSchema: z.object({ ...COMMON, name: z.string().optional(), dir: z.string().optional() }),
  }, (a) => {
    const p = P(a.project);
    const rel = `${a.dir ? safeName(a.dir, true) + "/" : ""}${safeName(a.name ?? `${p.id}.spriteproj.json`)}`;
    const r = writeOutput(rel, serializeProject(p));
    return ok(`💾 Saved ${r.path} (${r.bytes} B).`, { ...r });
  });

  tool("sprite_load_project", {
    title: "Load project (JSON)",
    description: "Load a .spriteproj.json exported by sprite_save_project. Path is relative to the output root, or an absolute path to a project JSON file. Reading is safe; writing is still guarded.",
    inputSchema: z.object({
      path: z.string().describe("Relative path in the output root, or an absolute path to a .spriteproj.json file."),
      id: z.string().optional().describe("Optional new project id."),
      activate: z.boolean().optional(),
    }),
  }, (a) => {
    let abs = a.path;
    if (!path.isAbsolute(abs)) abs = safeOutputPath(abs);
    if (!existsSync(abs)) throw new Error(`File not found: ${abs}`);
    if (!/\.json$/i.test(abs)) throw new Error("Only .json project files can be loaded.");
    const text = readFileSync(abs, "utf8");
    const p = deserializeProject(text, (name, colors) => colors?.length ? customPalette(name, colors) : resolvePalette(name));
    if (a.id) p.id = a.id;
    store.projects.set(p.id, p);
    if (a.activate !== false) store.setActive(p.id);
    return ok(`📂 Loaded "${p.name}" (${p.width}×${p.height}, ${p.frames.length} frames).`, { project: summary(p), frames: framesOf(p) });
  });
}

function resolvePalette(name: string): ReturnType<typeof getPalette> {
  try { return getPalette(name); } catch { throw new Error(`Unknown palette "${name}". Available: ${paletteNames().join(", ")}`); }
}

function safeName(s: string, allowSlash = false): string {
  const cleaned = s.replace(/[^a-zA-Z0-9._\-\/]/g, "_").replace(/\.\./g, "_");
  return allowSlash ? cleaned.replace(/^\/+|\/+$/g, "") : cleaned.replace(/\//g, "_");
}

export const TOOL_NAMES = [
  "sprite_quickstart", "sprite_policy", "sprite_verify_integrity", "sprite_list_palettes", "sprite_palette",
  "sprite_new_project", "sprite_list_projects", "sprite_project_info", "sprite_select_project", "sprite_delete_project", "sprite_layer",
  "sprite_draw_grid", "sprite_draw_ops", "sprite_generate", "sprite_catalog",
  "sprite_frame", "sprite_animate", "sprite_tween", "sprite_timing", "sprite_loop",
  "sprite_enhance", "sprite_critique", "sprite_inspect",
  "sprite_preview", "sprite_export", "sprite_gallery", "sprite_save_project", "sprite_load_project",
];

export const TOOL_DESCRIPTIONS: Record<string, string> = {
  sprite_draw_grid: "Draw pixel art by writing an ASCII grid (LLM-native).",
  sprite_preview: "Return an inline PNG so the agent can see the art.",
  sprite_export: "Export PNG/GIF/APNG/SVG/spritesheet/atlas/GPL/CSS/HTML.",
  sprite_verify_integrity: "Prove repository source was not modified.",
};
