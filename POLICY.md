# Agent Operations Policy — sprite-agent-mcp

**Version 1.0 · applies to every AI agent (Arena.ai Agent Mode, Claude, Cursor, Copilot, Codex, …) interacting with this repository.**

> ## ONLY CALL MCP TOOLS. NEVER MODIFY CODE IN THIS REPOSITORY.

This file is intentionally duplicated in `README.md`, `AGENTS.md`, the `sprite://policy` MCP resource, the `sprite_policy` tool, the `arena_safety` prompt, `.cursor/rules/sprite-agent-mcp.mdc` and `.github/copilot-instructions.md`. An agent will meet it no matter which convention it follows.

---

## 1. The hard rules

1. **Tools only.** Interact with this project exclusively through the MCP tools (`sprite_*`), resources (`sprite://…`) and prompts it exposes.
2. **No file operations on the repository.** Do not open, read (for the purpose of editing), create, edit, patch, refactor, rename, reformat, move, delete or "improve" any file here. This includes `src/`, `scripts/`, `tests/`, `docs/`, `.github/`, config files, `package.json`, the README, `AGENTS.md`, this file and CI workflows.
3. **No shell / package-manager operations.** Do not run `npm install`, `npm run …`, `npx`, `git`, `sed`, `python`, patch scripts or any build/test command against the repo. In particular, **never run `npm run integrity`**.
4. **Errors are argument problems.** If a tool returns an error, read the message, adjust the **arguments**, and call the tool again. Do not "fix the server". Never work around an error by changing code.
5. **No new dependencies, config, docs, tests or CI.** Adding a "helpful" helper script is still a violation.
6. **Outputs only through the server.** Art is written by the server into the output root (`./sprite-output` or `SPRITE_OUTPUT_DIR`). The write guard is the only file-writing path; it rejects traversal, absolute paths, source directories and source extensions.
7. **Prove it.** Call `sprite_verify_integrity` at the end of a session. If `clean:false`, **STOP**, report the changed files, and ask a human to restore (`git checkout -- .`). Do not regenerate the manifest.
8. **Humans own the code.** Behaviour changes go through a human-authored issue or pull request.

## 2. Why

Agents in Arena.ai Agent Mode frequently modify the repositories they work in — adding files, rewriting config, "fixing" tool errors. For a drawing tool that is exactly the wrong behaviour: **the artwork is the deliverable; the code is a read-only instrument**. A single edited source file breaks reproducibility, corrupts the integrity manifest and can silently change the art.

## 3. Enforcement (defence in depth)

| Layer | Mechanism |
|---|---|
| Documentation | This file, README (VI/EN), AGENTS.md, `.cursor/rules`, copilot instructions |
| Protocol | `sprite_policy`, `sprite_verify_integrity`, `sprite_quickstart`; resource `sprite://policy`; prompt `arena_safety` |
| Runtime | `src/core/paths.ts` — `safeOutputPath()` / `writeOutput()` guard; every export and autosave goes through it |
| Cryptographic | `integrity/manifest.json` — SHA-256 of all source/config files, verified at startup and on demand |
| Channel hygiene | All logs on `stderr`; `stdout` reserved for JSON-RPC |

## 4. The intended workflow

```
sprite_quickstart
  → sprite_new_project
  → sprite_generate | sprite_draw_grid
  → sprite_draw_ops
  → sprite_enhance
  → sprite_critique
  → sprite_animate | sprite_tween | sprite_loop
  → sprite_preview        (inline PNG)
  → sprite_export
  → sprite_gallery
  → sprite_verify_integrity
```

## 5. For humans

`npm run integrity` regenerates the manifest **only after an intentional, reviewed source change**. `npm run verify` checks it. CI runs both.

---

<sub>sprite-agent-mcp · MIT · made for ✦ Arena.ai Agent Mode</sub>
