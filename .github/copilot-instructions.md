# Copilot / coding-agent instructions

🛑 This repository is a **read-only MCP tool surface** for [sprite-agent-mcp](../README.md).

**Do not** edit, create, delete, rename, format, refactor or "fix" any file here. **Do not** run npm/git/shell commands against this repo. **Do not** add dependencies, tests, docs, config or CI. **Do not** regenerate `integrity/manifest.json`.

If a tool errors, alter the tool **arguments** and retry — never patch the server.

Use ONLY the MCP tools (`sprite_*`), MCP resources (`sprite://policy`, `sprite://guide/pixel-art`, `sprite://guide/tools`, `sprite://catalog`) and MCP prompts (`new_sprite`, `walk_cycle`, `tileset`, `critique_loop`, `arena_safety`). Start with `sprite_quickstart`; finish with `sprite_verify_integrity`.

All artwork is written by the server into `./sprite-output` via the write guard. Full contract: [POLICY.md](../POLICY.md) and [AGENTS.md](../AGENTS.md).
