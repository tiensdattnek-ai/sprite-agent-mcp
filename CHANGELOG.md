# Changelog

All notable changes to this project are documented here. Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), versions follow [SemVer](https://semver.org/).

## [1.0.0] — 2026-11-05

The "premium" first release, built for ✦ Arena.ai Agent Mode.

### Added — MCP surface
- 28 tools: policy/quickstart/integrity, projects, layers, palettes, ASCII drawing, 20 draw ops, procedural generators, animation, art direction, preview/export/gallery, save/load.
- 9 resources (incl. `sprite://policy`, pixel-art and animation style guides, dynamic palette/project/frame resources).
- 5 prompts (`new_sprite`, `walk_cycle`, `tileset`, `critique_loop`, `arena_safety`).
- MCP TypeScript SDK **v2** (`@modelcontextprotocol/server` 2.4): `serveStdio()` serves spec `2026-07-28` and 2025-era clients; `--http` uses `createMcpHandler()` + `toNodeHandler()` for Streamable HTTP with modern + legacy fallback.
- Inline `image/png` tool results so vision-capable agents see their art.

### Added — art engine
- Strict indexed canvas: Project → Frame → Layer → palette indices; layer opacity via ordered dithering.
- 12 curated palettes with 16 semantic color roles and luminance ramps.
- Hue-shifted shading, exterior-flood-fill selective outline, Bayer dithering, despeckle, 3×5 pixel font.
- 22 seeded procedural generators; 7 of them produce complete looping animations.
- 14 animation presets, Bayer cross-dissolve tweening, timing/ping-pong/hold/deduplicate.
- Built-in art director: S–D grading across 5 axes with concrete next-tool suggestions.

### Added — export engine (pure JS, zero native deps)
- PNG (indexed PLTE+tRNS / RGBA), APNG (acTL/fcTL/fdAT), GIF89a, animated SVG, spritesheet + Aseprite/Phaser 3/simple atlas + Godot `.tres`, GIMP `.gpl`, CSS box-shadow art, project JSON, self-contained HTML gallery with onion skin and zoom.

### Added — the anti-edit policy, enforced in code
- `src/core/paths.ts` write guard: blocks traversal, absolute paths, source dirs and source extensions; single output root.
- `integrity/manifest.json` + `sprite_verify_integrity` + startup check + human-only `npm run integrity`.
- Policy duplicated in README (VI/EN), POLICY.md, AGENTS.md, `.cursor/rules`, copilot instructions, MCP resource/tool/prompt.
- Shared singleton session store + autosave, clean stderr-only logging.

### Added — project hygiene
- MIT license, CI (Node 20/22, typecheck, unit tests, smoke test, integrity check), Dockerfile, Smithery + MCP Registry manifests, config examples, bilingual docs, issue templates, code of conduct, security policy.

[1.0.0]: https://github.com/arena-agent/sprite-agent-mcp/releases/tag/v1.0.0
