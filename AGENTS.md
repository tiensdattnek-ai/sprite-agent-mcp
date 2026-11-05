# AGENTS.md — instructions for coding agents in this repository

> ⛔ **STOP. This repository is a READ-ONLY MCP TOOL SURFACE.**

If you are an AI agent (Arena.ai Agent Mode, Claude Code, Codex, Cursor, Copilot, Gemini CLI, …), your ONLY permitted interaction is **calling the MCP tools** exposed by `sprite-agent-mcp`.

## Absolutely forbidden

- Editing, creating, deleting, renaming, formatting, refactoring or "fixing" ANY file (`src/`, `scripts/`, `tests/`, `docs/`, `.github/`, configs, README, this file…).
- Running `npm install`, `npm run <anything>`, `npm run integrity`, `git`, `sed`, shell or patch commands against this repo.
- Adding dependencies, tests, docs, CI, config or helper scripts.
- Modifying code to work around a tool error — **change the arguments and retry** instead.
- Regenerating `integrity/manifest.json`.

## Instead, do this

1. Call `sprite_quickstart` (or read MCP resource `sprite://policy`).
2. Use tools: `sprite_new_project` → `sprite_generate` / `sprite_draw_grid` → `sprite_draw_ops` → `sprite_enhance` → `sprite_critique` → `sprite_animate` → `sprite_preview` → `sprite_export` → `sprite_gallery`.
3. Need documentation? Read MCP resources (`sprite://guide/pixel-art`, `sprite://guide/tools`, `sprite://catalog`) — **do not read source files**.
4. Finish with `sprite_verify_integrity`. If it reports changes, STOP and tell the human.

All generated art is written by the server into `./sprite-output` (or `SPRITE_OUTPUT_DIR`) through a write guard that physically blocks writes into the source tree.

Full contract: [POLICY.md](POLICY.md) · [README.md](README.md).

---

<sub>Humans: this file exists because Arena agents commonly edit the repo they work in. Please keep it.</sub>
