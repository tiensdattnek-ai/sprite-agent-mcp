/**
 * MCP Resources (read-only knowledge) + Prompts (reusable agent recipes).
 * An agent should consume these instead of opening repository files.
 */

import * as z from "zod";
import type { McpServer } from "@modelcontextprotocol/server";
import { ResourceTemplate } from "@modelcontextprotocol/server";
import { SpriteStore, serializeProject, compositeFrame, findFrame } from "./core/canvas.js";
import { getPalette, listPaletteDefs, paletteNames, paletteSummary } from "./core/palettes.js";
import { frameToAscii } from "./core/ascii.js";
import { generatorCatalog } from "./core/generators.js";
import { ANIMATION_PRESETS } from "./core/animation.js";
import { POLICY_TEXT, outputRoot } from "./core/paths.js";
import { TOOL_NAMES } from "./tools.js";

const PIXEL_GUIDE = `# The pixel-art style guide baked into sprite-agent-mcp

## 1. Everything is indexed
One byte per pixel, one palette slot per color, slot 0 transparent. No alpha
blending, no anti-aliasing, no gradients made of blended colors. To suggest a
gradient, use a RAMP of discrete palette colors plus ordered (Bayer) dithering.

## 2. Color economy
4–16 colors for a 32×32 character. A limited palette is what makes pixel art
look intentional. Use \`sprite_enhance {limitColors:16}\` to enforce it.

## 3. Hue-shifted shading (the single biggest upgrade)
Shadows are not "darker": they are darker, COOLER (hue toward blue/purple) and
slightly MORE saturated. Highlights are lighter, WARMER (toward yellow) and
less saturated. \`sprite_draw_ops {ops:[{op:"shade",light:"nw"}]}\` or
\`sprite_enhance {shade:true}\` does this automatically.

## 4. Selective outline
A pure black (\`outline\` role) 1px outline only on the dark side of the
silhouette (bottom + shadow side). Full outlines flatten art; selective
outlines make it pop. \`{op:"outline", mode:"selective", color:"outline"}\`.

## 5. Readable silhouette
At 1× size, shrink the image in your mind: can you still tell what it is?
Keep a clear negative-space gap between limbs, avoid single-pixel jaggies
(\`sprite_enhance {despeckle:true}\`), and center the bounding box.

## 6. Clusters, not noise
Group pixels into 2×2 / 3×3 shapes. Isolated 1px specks read as dirt.
Exception: deliberate sparkles and dithering on large flat areas.

## 7. Animation
8–12 fps, 4–8 keyframes, strong poses over smooth motion. Use anticipation,
overshoot and hold frames. Snap motion to whole pixels. Loop with ping-pong
or a matched first/last frame. Add 1–2px of "smear" instead of blur.

## 8. Never
Never resize with bilinear/bicubic interpolation. Never use drop shadows with
soft edges. Never add semi-transparent anti-aliasing pixels. Never export a
blurry upscale: use integer nearest-neighbour (\`scale\` on export/preview).

## 9. Arena.ai Agent Mode
Call \`sprite_preview\` after every meaningful change — it returns an INLINE PNG
image block so you can actually see the sprite, then iterate with
\`sprite_draw_grid\`. Never edit this repository's source files.
`;

const ANIMATION_GUIDE = `# Sprite animation guide

Timing: 100 ms/frame (10 fps) is the classic pixel-art cadence; 80–125 ms
feels alive. Gameplay animations usually use 4, 6 or 8 frames.

Presets in sprite_animate:
${ANIMATION_PRESETS.map(p => ` - ${p}`).join("\n")}

Recipe — idle loop:
  sprite_generate {kind:"slime"} → sprite_timing {fps:8} → sprite_loop {mode:"pingpong"}

Recipe — walk cycle:
  sprite_generate {kind:"hero"} → sprite_duplicate 4 poses via sprite_draw_grid
  → sprite_animate {preset:"walk_cycle", frames:6, amplitude:1}
  → sprite_timing {durations:[90,90,110,90,90,110]}
  → sprite_preview {frame:"all"}

Recipe — impact FX:
  sprite_generate {kind:"star"} → sprite_animate {preset:"explode", frames:8}
  → sprite_enhance {outline:true} → sprite_export {formats:["gif","apng"]}

Inbetweening: sprite_tween uses an ordered-dither cross dissolve, which keeps
the palette strict (no interpolated colors). Great for fades and morphs.
`;

const TOOLS_GUIDE = `# Tool catalog (${TOOL_NAMES.length} tools)

${TOOL_NAMES.map(n => ` - ${n}`).join("\n")}

Order: quickstart → new_project → generate/draw_grid → draw_ops → enhance →
critique → animate/tween → preview → export → gallery.

Errors are hints: they say exactly which argument to change. Never patch code.
Outputs land in ${outputRoot()} and are guarded by the write policy.
`;

export function registerResources(server: McpServer, store: SpriteStore): void {
  const text = (uri: string, body: string, mimeType = "text/markdown") => ({ contents: [{ uri, mimeType, text: body }] });
  const json = (uri: string, value: unknown) => ({ contents: [{ uri, mimeType: "application/json", text: JSON.stringify(value, null, 2) }] });

  server.registerResource("policy", "sprite://policy", {
    title: "Agent operations policy", description: "MCP-only, no source edits. Read this first.", mimeType: "text/markdown",
  }, async uri => text(uri.href, POLICY_TEXT));

  server.registerResource("pixel-art-guide", "sprite://guide/pixel-art", {
    title: "Pixel-art style guide", description: "Color economy, hue-shifted shading, selective outline, silhouette rules.", mimeType: "text/markdown",
  }, async uri => text(uri.href, PIXEL_GUIDE));

  server.registerResource("animation-guide", "sprite://guide/animation", {
    title: "Animation guide", description: "Timing, loop shaping and animation recipes.", mimeType: "text/markdown",
  }, async uri => text(uri.href, ANIMATION_GUIDE));

  server.registerResource("tools-guide", "sprite://guide/tools", {
    title: "Tool catalog", description: "All MCP tool names and the recommended call order.", mimeType: "text/markdown",
  }, async uri => text(uri.href, TOOLS_GUIDE));

  server.registerResource("catalog", "sprite://catalog", {
    title: "Capability catalog", description: "Palettes, generators, animation presets and tool names as JSON.", mimeType: "application/json",
  }, async uri => json(uri.href, {
    palettes: listPaletteDefs(), generators: generatorCatalog(), animations: ANIMATION_PRESETS, tools: TOOL_NAMES,
  }));

  server.registerResource("state", "sprite://state", {
    title: "Live session state", description: "Current projects and integrity status.", mimeType: "application/json",
  }, async uri => json(uri.href, { active: store.active() ?? null, projects: store.list(), outputRoot: outputRoot() }));

  server.registerResource("palette", new ResourceTemplate("sprite://palettes/{name}", { list: undefined }), {
    title: "Palette by name", description: "A built-in palette as JSON: colors + semantic roles.", mimeType: "application/json",
  }, async (uri, vars) => {
    const name = String(vars.name);
    try { return json(uri.href, paletteSummary(getPalette(name))); }
    catch { return json(uri.href, { error: `Unknown palette "${name}"`, available: paletteNames() }); }
  });

  server.registerResource("project", new ResourceTemplate("sprite://projects/{id}", { list: undefined }), {
    title: "Project snapshot", description: "Full serialized project (read-only), including every layer and frame.", mimeType: "application/json",
  }, async (uri, vars) => {
    const p = store.projects.get(String(vars.id));
    return p ? json(uri.href, JSON.parse(serializeProject(p))) : json(uri.href, { error: "project not found", projects: store.list() });
  });

  server.registerResource("frame-ascii", new ResourceTemplate("sprite://frames/{index}", { list: undefined }), {
    title: "Frame as ASCII", description: "Active project's frame rendered as an ASCII grid + legend.", mimeType: "text/plain",
  }, async (uri, vars) => {
    const p = store.get();
    if (!p) return text(uri.href, "No active project. Call sprite_new_project first.", "text/plain");
    const idx = Math.max(0, Math.min(p.frames.length - 1, parseInt(String(vars.index), 10) || 0));
    const f = findFrame(p, idx);
    const { ascii, legend } = frameToAscii(compositeFrame(p, f), p.width, p.height);
    return text(uri.href, `# ${p.id} / frame ${idx}: ${f.name}\nlegend: ${JSON.stringify(legend)}\n\n${ascii}`, "text/plain");
  });
}

export function registerPrompts(server: McpServer): void {
  const prompt = (name: string, config: any, build: (args: any) => string) => {
    server.registerPrompt(name, config, ((args: any) => ({
      description: config.description,
      messages: [{ role: "user" as const, content: { type: "text" as const, text: build(args) } }],
    })) as any);
  };

  prompt("new_sprite", {
    title: "Create a sprite",
    description: "Recipe prompt: create a polished pixel-art sprite of a subject. Use as a slash-command in Arena.ai Agent Mode.",
    argsSchema: z.object({
      subject: z.string().describe("What to draw, e.g. 'a forest knight with a red cape'"),
      size: z.string().optional().describe("Canvas size, e.g. '32x32'"),
      palette: z.string().optional().describe("Palette name, e.g. 'db32'"),
    }),
  }, a => `Using ONLY sprite-agent-mcp MCP tools (never edit repository files), create a polished pixel-art sprite of: ${a.subject}.

Steps:
1. sprite_quickstart, then sprite_new_project {name, width:${(a.size ?? "32x32").split("x")[0]}, height:${(a.size ?? "32x32").split("x")[1] ?? 32}, palette:"${a.palette ?? "db32"}"}.
2. Start with sprite_generate (closest kind) or write a careful sprite_draw_grid with a legend using semantic roles.
3. Add a selective outline + hue-shifted shading with sprite_draw_ops / sprite_enhance.
4. sprite_critique, fix every suggestion, sprite_preview to SEE the result, iterate at least twice.
5. sprite_animate with a fitting preset, sprite_export {formats:["png","gif","spritesheet","apng"]} and sprite_gallery.
Report the exported file paths. Do not modify any source file.`);

  prompt("walk_cycle", {
    title: "Walk cycle recipe",
    description: "Build a 6-frame looping walk cycle and export a sprite sheet.",
    argsSchema: z.object({ character: z.string().optional(), fps: z.number().optional() }),
  }, a => `Using ONLY sprite-agent-mcp tools, build a 6-frame walk cycle for ${a.character ?? "the active character"}:
sprite_generate {kind:"hero"} → sprite_draw_grid for 4 key poses (contact, down, pass, up) →
sprite_tween {from:0,to:1,steps:1} where needed → sprite_loop {mode:"pingpong"} →
sprite_timing {fps:${a.fps ?? 10}} → sprite_preview {frame:"all"} →
sprite_export {formats:["spritesheet","gif","apng"], atlas:"aseprite"}.
Keep integer-pixel motion, a readable silhouette and a seamless loop. Never edit source.`);

  prompt("tileset", {
    title: "Tileset recipe",
    description: "Generate a seamless animated tileset and its atlas.",
    argsSchema: z.object({ theme: z.string().optional(), tileSize: z.number().optional() }),
  }, a => `Using ONLY sprite-agent-mcp tools, create a seamless ${a.tileSize ?? 16}px ${a.theme ?? "grass/water"} tileset:
sprite_new_project {width:${a.tileSize ?? 16},height:${a.tileSize ?? 16},palette:"endesga32"} →
sprite_generate {kind:"tile_${a.theme ?? "water"}"} → sprite_critique →
sprite_preview → sprite_export {formats:["spritesheet","gif","png"], padding:1}.
Verify the edges wrap visually. Never edit source.`);

  prompt("critique_loop", {
    title: "Critique & polish loop",
    description: "Iteratively improve the active project until grade A or better.",
    argsSchema: z.object({ targetGrade: z.string().optional() }),
  }, a => `Using ONLY sprite-agent-mcp tools, improve the active project until sprite_critique reports grade ${a.targetGrade ?? "A"} or better:
loop: sprite_critique → apply the suggested sprite_enhance / sprite_draw_ops calls →
sprite_preview (look at the inline PNG) → repeat (max 4 iterations).
Then sprite_export {formats:["all"]} and sprite_gallery. Never edit source.`);

  prompt("arena_safety", {
    title: "Arena Agent contract",
    description: "Reminder prompt that pins the read-only repository policy for the whole session.",
    argsSchema: z.object({}),
  }, () => `You are working in Arena.ai Agent Mode with sprite-agent-mcp.

BINDING CONTRACT: this repository is a READ-ONLY TOOL SURFACE. Use ONLY the MCP
tools exposed by sprite-agent-mcp. Do NOT create, edit, patch, refactor, rename,
delete or "improve" any file in the repo; do NOT run npm/git/shell commands
against it; do NOT add dependencies, config, tests, docs or CI. All artwork is
written by the server into the output root via its write guard.

If a tool errors, change the ARGUMENTS and call it again. If you need docs, read
MCP resources (sprite://policy, sprite://guide/pixel-art, sprite://guide/tools)
or call sprite_quickstart / sprite_catalog — never open source files.
Start with sprite_verify_integrity, then sprite_quickstart.`);
}
