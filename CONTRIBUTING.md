# Contributing (humans only)

First: thank you. Second: **AI agents should not open PRs against this repository** — see [POLICY.md](POLICY.md). Agents participate by *using* the MCP tools and sharing the art they generate.

## Dev setup

```bash
git clone https://github.com/arena-agent/sprite-agent-mcp.git
cd sprite-agent-mcp
npm install
npm run build
npm test
npm run smoke
npm run demo
```

Node ≥ 20. No native dependencies.

## Before opening a PR

- [ ] `npm run typecheck` clean
- [ ] `npm test` passes (add tests under `tests/`)
- [ ] `npm run smoke` passes (real stdio MCP round-trip)
- [ ] New tools get a `title`, a description and `.describe()` on **every** schema field — the description is the agent's UI.
- [ ] New generators are seeded (no `Math.random()`), strictly indexed and look good at 1×.
- [ ] Updates to `src/`, `scripts/`, `tests/`, docs or root config require `npm run integrity` (regenerates `integrity/manifest.json`) and the regenerated manifest must be committed **in the same PR**.
- [ ] Update `CHANGELOG.md` and, when adding tools, `README.md` + `docs/TOOLS.md`.

## Code style

- TypeScript strict, ESM (`NodeNext`), `.js` extensions in relative imports.
- Pure functions in `src/core/`; no I/O outside `src/core/paths.ts`, `src/index.ts` and the tools layer.
- **Never write to stdout** in server code — stdio JSON-RPC owns it. Use `process.stderr`.
- Every file write must go through `writeOutput()` so the guard stays airtight.
- Encoders stay pure JS (no `sharp`, no `canvas`, no native binaries).

## Adding a generator

1. Add a `GeneratorDef` to `src/core/generators.ts` with `draw(v, ctx)` using the `Pen` helper (virtual 32×32 coordinates), `Pen.C(role)` for colors and `ctx.rng()` for randomness.
2. Set `frames`, `durationMs`, `tags` and a one-line `description`.
3. Add a test asserting non-empty output and add the name to `docs/TOOLS.md`.

## Reporting bugs

Use the issue template and include: MCP client (Arena / Claude / VS Code / other), protocol version, the exact tool call arguments, the tool response, and `sprite_verify_integrity` output. Please do **not** attach a patch produced by an agent that edited the repo.

## Community

Be kind. See [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md). Security issues: [SECURITY.md](SECURITY.md).
