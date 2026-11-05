# Architecture

> Agents: you do not need this file. Use `sprite_quickstart`, `sprite_catalog` and the `sprite://*` resources instead. Never edit source.

## Design goals

1. **Real pixel art, not a blurred image.** Everything is an indexed `Uint8Array` of palette slots (0 = transparent). No alpha blending, no anti-aliasing, no bilinear resize.
2. **LLM-native input.** ASCII grids (`sprite_draw_grid`) and semantic color roles (`outline`, `shadow`, `base`, `light`, `highlight`, `accent`, `skin`, …) are what a language model can actually reason about. Inline PNG results close the perception loop.
3. **Read-only source, enforced.** One write path, one integrity manifest. See below.
4. **Zero native dependencies.** `npx` must work on a clean machine. PNG/APNG are hand-written with `node:zlib` + CRC32; GIF uses the small pure-JS `gifenc` ESM build.
5. **Protocol-current but backwards compatible.** MCP SDK v2, `serveStdio()` (2026-07-28 + 2025-era clients), `createMcpHandler()`/`toNodeHandler()` for HTTP.

## Module map

| Layer | File | Responsibility |
|---|---|---|
| Entry | `src/index.ts` | CLI flags, env, startup banner, session restore/autosave, stdio vs HTTP transport |
| Factory | `src/server.ts` | `buildServer(ctx)` — one fresh `McpServer` per connection, shared `SpriteStore` |
| Protocol | `src/tools.ts` | 28 tools, zod schemas with `.describe()` on every field, text + image results |
| Protocol | `src/resources.ts` | 9 resources (6 static + 3 templates), 5 prompts, style guides |
| Model | `src/core/canvas.ts` | `Project → Frame → Layer → Uint8Array`; `SpriteStore`; serialization |
| Model | `src/core/color.ts`, `palettes.ts` | RGB/HSL, contrast, hue-shifted shading; 12 palettes + roles + ramps |
| IO | `src/core/ascii.ts` | grid ⇄ pixels, auto-legend, multi-frame split |
| Draw | `src/core/draw.ts` | 20 ops, 3×5 font, seeded RNG, exterior-fill outline, shading |
| Draw | `src/core/generators.ts` | 22 seeded recipes via a 32×32 virtual `Pen` |
| Motion | `src/core/animation.ts` | 14 presets, Bayer tween, timing, loop shaping |
| QA | `src/core/critique.ts` | S–D scoring, 5 axes, auto-enhance |
| Export | `src/core/encode.ts` | PNG/APNG/GIF/SVG/sheet/atlas/GPL/CSS/gallery |
| **Policy** | `src/core/paths.ts` | **write guard + policy text** |
| **Policy** | `src/core/integrity.ts` | **SHA-256 verification + startup banner** |

## Data model

```
Project {
  id, name, width, height, palette, activeFrame, tags, timestamps,
  frames: Frame[] {
    id, name, durationMs, tags,
    layers: Layer[] { id, name, visible, opacity, locked, pixels: Uint8Array(w*h) }
  }
}
Palette { name, colors: RGBA[256 max] (colors[0] = transparent), roles, ramp }
```

Compositing walks layers bottom→top. Layer opacity is applied with a Bayer 4×4 threshold, which keeps the sprite strictly indexed (no new colors are ever created). `resolveColor()` adds an unknown hex color to the palette when there is room, otherwise snaps to the nearest existing color.

## Transports

```
stdio : serveStdio(() => buildServer(ctx))   → pinned instance per connection, both protocol eras
HTTP  : createMcpHandler(() => buildServer(ctx)) → toNodeHandler → node:http
        POST/GET/DELETE /mcp · GET /health · GET /
```

`createMcpHandler` is stateless per request, so **all mutable state lives in a module-level `SpriteStore` singleton** shared by every server instance. `saveSession()` writes `.sprite-agent-state.json` into the output root after each mutation and `restoreSession()` reloads it at startup. This makes HTTP and stdio interchangeable.

## The write guard (the important bit)

Every write in the entire codebase goes through `writeOutput()`:

```
writeOutput(rel, data)
  → safeOutputPath(rel, {root})
      → reject absolute paths (unless SPRITE_ALLOW_EXTERNAL_OUTPUT, human-only)
      → reject any ".." segment
      → resolve under outputRoot()
      → reject source extensions: .ts .js .mjs .cjs .sh .py .yml .yaml .toml ...
      → reject protected names: package.json, tsconfig.json, README.md, AGENTS.md ...
      → reject protected directories: src, scripts, tests, .github, dist, docs, integrity ...
      → reject hidden directories / .git
      → cap at 32 MB
  → mkdir -p + writeFileSync
```

There is exactly one other writer: `src/index.ts` → `saveSession()`, which calls `writeOutput()` too. Stdout stays clean (`process.stderr` only).

## Integrity

`scripts/generate-manifest.mjs` (human-only) hashes `src/`, `scripts/`, `tests/`, `.github/`, `.cursor/`, `docs/` and root config/docs into `integrity/manifest.json`. `verifyIntegrity()` recomputes those hashes at startup, in `sprite_verify_integrity`, in `sprite_policy`, on `/health` and in CI. `extraSourceFiles()` also detects untracked `.ts`/`.mjs` files injected into `src/` or `scripts/`.

## Error philosophy

Tool errors are returned as readable text (`isError: true`) with the exact next action — *change the arguments*, never *change the code*. This is a deliberate part of the anti-edit policy: the most common reason an agent patches a repo is to work around an unhelpful error.

## Test strategy

| Suite | What it proves |
|---|---|
| `tests/core.test.ts` | color math, palettes/roles, canvas/layers, transforms, ASCII grids, draw ops, outline exterior detection |
| `tests/encode.test.ts` | PNG chunk structure/CRC/zlib, APNG frame sequence, GIF89a, SVG, atlases, GPL/CSS/gallery |
| `tests/guard.test.ts` | write guard refusals, every generator, every animation preset, tween, timing, enhance/critique |
| `scripts/guard-check.mjs` | CI-level guard assertions |
| `scripts/smoke-test.mjs` | real stdio JSON-RPC: initialize, tools/list, resources, prompts, generate, preview image, export all, save/load, integrity |
| `scripts/demo.mjs` | a full art pipeline that produces the demo pack |
