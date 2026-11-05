# ✦ sprite-agent-mcp

> **An MCP server for drawing gorgeous pixel art and sprite animations, built exclusively for [Arena.ai Agent Mode](https://arena.ai/agent).**
> Indexed palettes · seeded sprite generators · hue-shifted shading · animation timelines · PNG/GIF/APNG/SVG/spritesheet export · **inline PNG results so the AI can see what it drew**.

[![MIT](https://img.shields.io/badge/license-MIT-ffcc66?style=flat-square)](LICENSE)
[![MCP](https://img.shields.io/badge/MCP-2026--07--28-2ce8f5?style=flat-square)](https://modelcontextprotocol.io)
[![Node](https://img.shields.io/badge/node-%E2%89%A520-6abe30?style=flat-square)](https://nodejs.org)
[![Arena Agent](https://img.shields.io/badge/made%20for-Arena.ai%20Agent-b55088?style=flat-square)](https://arena.ai/agent)
[![source integrity](https://img.shields.io/badge/source-READ--ONLY%20for%20agents-ac3232?style=flat-square)](POLICY.md)

📄 [Tiếng Việt](README.md) · [Policy](POLICY.md) · [Architecture](docs/ARCHITECTURE.md) · [Tools](docs/TOOLS.md) · [Recipes](docs/RECIPES.md) · [Arena setup](docs/ARENA.md)

---

## 🛑 THE GOLDEN RULE FOR EVERY AI AGENT (READ FIRST)

> ### **USE MCP TOOLS ONLY. NEVER MODIFY CODE IN THIS REPOSITORY.**

| ✅ ALLOWED | ❌ FORBIDDEN |
|---|---|
| Call `sprite_*` tools | Open / edit / create / delete / rename / refactor / format **any file** in the repo |
| Read MCP resources (`sprite://policy`, `sprite://guide/*`) | Run `npm install`, `npm run`, `git`, `sed` or shell commands against the repo |
| Use MCP prompts (`new_sprite`, `walk_cycle`, …) | Add dependencies, config, tests, docs, CI or "helper" scripts |
| Receive art files from `sprite_export` / `sprite_gallery` | "Quickly patch the server" when a tool errors → **change the arguments and call again** |
| Call `sprite_verify_integrity` as proof | Regenerate `integrity/manifest.json` to hide an edit |

**Why:** agents in Arena.ai Agent Mode habitually "help" by editing the repository they are working in. This project is a **read-only tool surface**: the deliverable is the artwork, not the source. So the policy is enforced in code, not just in prose:

- 🧱 **Write guard** (`src/core/paths.ts`) — every file write goes through `writeOutput()`. It rejects `..`, absolute paths, `src/`, `scripts/`, `tests/`, `.github/`, `dist/`, root config files and all source extensions. Only `sprite-output/` (or `SPRITE_OUTPUT_DIR`) is writable.
- 🔐 **Integrity manifest** — SHA-256 of every tracked file, checked at runtime by `sprite_verify_integrity`. If `clean:false`, the agent must **STOP** and ask a human to restore.
- 📜 **Policy in five places** — this README, [`POLICY.md`](POLICY.md), [`AGENTS.md`](AGENTS.md), the `sprite://policy` resource, the `sprite_policy` tool and the `arena_safety` prompt (plus `.cursor/rules`).
- 🚫 **Clean stdout** — all logging goes to stderr so stdio JSON-RPC is never corrupted.

> Want different behaviour? A **human** opens an issue/PR. An agent does not.

---

## ⚡ Install (human, one time)

```bash
npx -y sprite-agent-mcp                 # stdio — recommended
npx -y sprite-agent-mcp --http --port 3100   # Streamable HTTP
```

MCP client config:

```json
{
  "mcpServers": {
    "sprite": {
      "command": "npx",
      "args": ["-y", "sprite-agent-mcp"],
      "env": { "SPRITE_OUTPUT_DIR": "./sprite-output" }
    }
  }
}
```

Built on the MCP TypeScript SDK v2 (`@modelcontextprotocol/server`). `serveStdio()` speaks **2026-07-28** and transparently serves 2025-era clients; HTTP uses `createMcpHandler()` + `toNodeHandler()` (modern + legacy fallback). Node ≥ 20, no native dependencies.

Environment: `SPRITE_OUTPUT_DIR`, `SPRITE_AUTOSAVE=0`, `SPRITE_HTTP_TOKEN`, `SPRITE_STRICT_HOSTS=1`, `SPRITE_ALLOWED_HOSTS`.

---

## 🎯 The 9-step Arena Agent workflow

```
sprite_quickstart → sprite_new_project → sprite_generate / sprite_draw_grid
→ sprite_draw_ops → sprite_enhance → sprite_critique → sprite_animate
→ sprite_preview → sprite_export → sprite_gallery
```

Paste this into Arena Agent Mode:

```
Using sprite-agent-mcp only, draw a 32×32 forest knight (endesga32 palette),
selective outline, north-west light, a 6-frame 8fps idle loop. Export PNG, GIF,
APNG and an Aseprite-atlas spritesheet, then build the HTML gallery.
ONLY call MCP tools — never edit any source file. Finish with sprite_verify_integrity.
```

### Draw with text (the LLM-native interface)

```jsonc
{
  "name": "sprite_draw_grid",
  "arguments": {
    "grid": "..ooo..\n.osssso.\n.obbbbo.\n..oooo..\n---\n..ooo..\n.osssso.\n.obbbbo.\n..oooo..",
    "legend": { "o": "outline", "s": "skin", "b": "base" },
    "mirrorX": true
  }
}
```

`.` = transparent · `---` = next animation frame · omit `legend` and characters auto-map to semantic palette roles. Colors accept hex, role names, palette indices, `ramp:N` or `transparent`.

`sprite_preview` returns an MCP **image content block** — a vision-capable agent literally sees the sprite inside the tool result and can iterate. `sprite_inspect` returns an ASCII grid for text-only models.

---

## 🧰 28 tools · 9 resources · 5 prompts

| Group | Tools | Highlights |
|---|---|---|
| Policy | `sprite_quickstart` `sprite_policy` `sprite_verify_integrity` | workflow, contract, SHA-256 |
| Projects | `sprite_new_project` `sprite_list_projects` `sprite_project_info` `sprite_select_project` `sprite_delete_project` `sprite_layer` | 1–512px canvas, dithered layer opacity |
| Palettes | `sprite_list_palettes` `sprite_palette` | 12 curated palettes + 16 semantic roles |
| Drawing | `sprite_draw_grid` `sprite_draw_ops` `sprite_generate` `sprite_catalog` | ASCII grids, 20 ops, 22 seeded generators, 3×5 font |
| Animation | `sprite_frame` `sprite_animate` `sprite_tween` `sprite_timing` `sprite_loop` | 14 presets, Bayer-dither inbetweening, ping-pong |
| Art direction | `sprite_enhance` `sprite_critique` `sprite_inspect` | S–D grading + concrete next tool calls |
| Output | `sprite_preview` `sprite_export` `sprite_gallery` `sprite_save_project` `sprite_load_project` | inline images, 9 formats, self-contained gallery |

Full parameter docs: [docs/TOOLS.md](docs/TOOLS.md) — every schema field carries a `.describe()` with examples.

**Resources:** `sprite://policy`, `sprite://guide/pixel-art`, `sprite://guide/animation`, `sprite://guide/tools`, `sprite://catalog`, `sprite://state`, `sprite://palettes/{name}`, `sprite://projects/{id}`, `sprite://frames/{index}`.
**Prompts:** `new_sprite`, `walk_cycle`, `tileset`, `critique_loop`, `arena_safety`.

---

## 🎨 The "pro pixel art" tricks, baked in

1. **Indexed palette** — one byte per pixel, slot 0 transparent; no soft alpha, no anti-aliasing, no bilinear resize.
2. **Hue-shifted shading** — shadows are darker, *cooler* and more saturated; highlights lighter and *warmer*.
3. **Selective outline** — 1px dark edge only on the shadow side, computed with an exterior flood fill so eye sockets and belt gaps are never outlined.
4. **Bayer dithering** for gradients, layer opacity and tweening (no new colors ever appear).
5. **Silhouette care** — despeckle 1px noise, center the bounding box, mirror for symmetry.
6. **8–12 fps animation** with integer-pixel motion, easing, smear instead of blur and seamless loops.
7. **Built-in art director** — scores color economy, silhouette, outline, shading and animation, then tells you which tool to call next.

**Generators (22):** `hero`, `slime`, `potion`, `gem`, `chest`, `sword`, `shield`, `tree`, `mushroom`, `ghost`, `coin`, `star`, `torch`, `planet`, `cloud`, `heart`, `portrait`, `tile_grass`, `tile_stone`, `tile_brick`, `tile_water`, `tile_lava`.
**Palettes (12):** `db32`, `pico8`, `sweetie16`, `endesga32`, `gameboy`, `gameboy-pocket`, `mono`, `bubblegum16`, `neon16`, `forest16`, `sepia8`, `pastel16`.

---

## 📦 Exports

| Format | Output | Notes |
|---|---|---|
| `png` | `*_frame_XX.png` | indexed PNG (PLTE + tRNS), integer scale |
| `gif` | `*.gif` | GIF89a, 1-bit transparency, per-frame delay, loop |
| `apng` | `*_animated.png` | lossless animation (`acTL`/`fcTL`/`fdAT`) |
| `svg` | `*.svg` | one `<rect>` per pixel run, SMIL animation, `crispEdges` |
| `spritesheet` | `*_sheet.png` + `*_atlas.json` | Aseprite / Phaser 3 / simple atlas, or Godot `.tres` |
| `gpl` | `*.gpl` | GIMP / Aseprite / Krita palette |
| `css` | `*.css` | one div + `box-shadow`, no image needed |
| `json` | `*.spriteproj.json` | full project: palette, layers, frames, durations |
| `gallery` | `*_gallery.html` | self-contained player: play, onion skin, zoom, swatches |

PNG/APNG encoders are hand-written (`zlib` + CRC32); GIF uses the tiny pure-JS `gifenc`. No `sharp`, no `canvas`, no ImageMagick, no Python — `npx` works anywhere Node ≥ 20 runs.

Run `npm run demo` for `sprite-output/demo/index.html` with six animated scenes.

---

## 🏗️ Architecture

```
src/
├── index.ts            CLI: serveStdio() | createMcpHandler() HTTP
├── server.ts           buildServer() factory shared by all transports
├── tools.ts            28 tools, zod schemas, inline PNG results
├── resources.ts        9 resources + 5 prompts + style guide
└── core/
    ├── color.ts        RGB/HSL, contrast, hue-shifted shading
    ├── palettes.ts     curated palettes, semantic roles, luminance ramps
    ├── canvas.ts       Project → Frame → Layer → Uint8Array of indices
    ├── ascii.ts        grid ⇄ pixels
    ├── draw.ts         20 ops, 3×5 font, exterior-fill outline, shade
    ├── generators.ts   22 seeded sprite recipes
    ├── animation.ts    14 presets, dither tween, timing, loop shaping
    ├── critique.ts     S–D grading + auto-enhance
    ├── encode.ts       PNG/APNG/GIF/SVG/sheet/atlas/GPL/CSS/gallery
    ├── paths.ts        🧱 WRITE GUARD
    └── integrity.ts    🔐 SHA-256 manifest + policy text
```

The project store is a **shared singleton** across stdio and HTTP, so even stateless HTTP requests keep the same working session; it also autosaves to `.sprite-agent-state.json`. See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

---

## 🧪 Development (humans)

```bash
npm install
npm run build        # tsc → dist/ + integrity manifest
npm test             # vitest unit suite
npm run smoke        # real stdio JSON-RPC end-to-end test
npm run verify       # confirm source untampered
npm run demo         # generate the demo gallery
npm run integrity    # ⚠ HUMANS ONLY, only after an intentional source change
```

---

## ❓ FAQ

**My Arena agent keeps trying to edit code.** Add: *"sprite-agent-mcp is read-only. Only call `sprite_*` tools. If a tool errors, change arguments. Never read or edit files, never run commands."* Or use the `arena_safety` prompt. The write guard and integrity check enforce it regardless.

**Do I need Aseprite / Python / ImageMagick?** No. Node ≥ 20 only.

**Can the AI see its art?** Yes — `sprite_preview` returns an MCP image content block. `sprite_inspect` returns ASCII for text-only models.

**Which engines?** Phaser 3, Godot 4, Aseprite-style atlases, plus GIF/APNG/SVG/CSS for the web.

---

**MIT © 2026 sprite-agent-mcp contributors** · [CONTRIBUTING.md](CONTRIBUTING.md) · [SECURITY.md](SECURITY.md)

<sub>Made for ✦ [Arena.ai Agent Mode](https://arena.ai/agent). Repository source is a read-only tool surface.</sub>
