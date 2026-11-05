#!/usr/bin/env node
/**
 * sprite-agent-mcp — CLI entry point.
 *
 *   npx -y sprite-agent-mcp                     stdio (Arena / Claude / VS Code)
 *   npx -y sprite-agent-mcp --http             Streamable HTTP on :3100
 *   npx -y sprite-agent-mcp --http --port 8080
 *
 * stdout is RESERVED for JSON-RPC on stdio. All logs go to stderr.
 */

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { createMcpHandler } from "@modelcontextprotocol/server";
import { toNodeHandler } from "@modelcontextprotocol/node";
import { buildServer, SERVER_NAME, SERVER_VERSION } from "./server.js";
import { SpriteStore, serializeProject, deserializeProject } from "./core/canvas.js";
import { getPalette, customPalette } from "./core/palettes.js";
import { outputRoot, writeOutput, POLICY_TEXT } from "./core/paths.js";
import { startupBanner, verifyIntegrity } from "./core/integrity.js";

const args = process.argv.slice(2);
const has = (...flags: string[]) => flags.some(f => args.includes(f));
const argValue = (flag: string, fallback: string) => {
  const i = args.indexOf(flag);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith("--") ? args[i + 1] : fallback;
};

if (has("--help", "-h")) {
  process.stdout.write(`sprite-agent-mcp ${SERVER_VERSION}\n
Usage:
  sprite-agent-mcp                 stdio transport (default)
  sprite-agent-mcp --http          Streamable HTTP transport
  sprite-agent-mcp --port 3100     HTTP port
  sprite-agent-mcp --version

Environment:
  SPRITE_OUTPUT_DIR       output root (default ./sprite-output)
  SPRITE_AUTOSAVE=0       disable session autosave
  SPRITE_HTTP_TOKEN       bearer token required on /mcp
  SPRITE_ALLOWED_HOSTS    comma-separated extra allowed Host names
  SPRITE_STRICT_HOSTS=1   reject unknown Host/Origin headers
  SPRITE_ALLOW_EXTERNAL_OUTPUT=1  allow absolute output paths (human only)

${POLICY_TEXT}\n`);
  process.exit(0);
}
if (has("--version", "-v")) { process.stdout.write(`${SERVER_VERSION}\n`); process.exit(0); }

const autosaveEnabled = process.env.SPRITE_AUTOSAVE !== "0";
const stateFile = process.env.SPRITE_STATE_FILE || ".sprite-agent-state.json";
const store = new SpriteStore();

function saveSession(): void {
  if (!autosaveEnabled) return;
  try {
    const state = { format: "sprite-agent-mcp/session", version: 1, active: store.active() ?? null, projects: [...store.projects.values()].map(p => serializeProject(p)) };
    writeOutput(stateFile, JSON.stringify(state));
  } catch (e) {
    process.stderr.write(`[autosave skipped] ${(e as Error).message}\n`);
  }
}

function restoreSession(): void {
  if (!autosaveEnabled) return;
  const abs = path.join(outputRoot(), stateFile);
  if (!existsSync(abs)) return;
  try {
    const raw = JSON.parse(readFileSync(abs, "utf8"));
    if (raw.format !== "sprite-agent-mcp/session") return;
    for (const text of raw.projects as string[]) {
      const p = deserializeProject(text, (name, colors) => colors?.length ? customPalette(name, colors) : getPalette(name));
      store.projects.set(p.id, p);
    }
    if (raw.active) store.setActive(raw.active);
    process.stderr.write(`[session restored] ${store.projects.size} project(s)\n`);
  } catch (e) {
    process.stderr.write(`[session restore skipped] ${(e as Error).message}\n`);
  }
}

const afterMutation = (project: { updatedAt: string }) => {
  project.updatedAt = new Date().toISOString();
  saveSession();
};

startupBanner();
const integrity = verifyIntegrity();
if (integrity.manifestFound && !integrity.clean) {
  process.stderr.write(`⚠ Source integrity FAILED: ${integrity.changed.join(", ")}. Agents must stop and ask a human to restore.\n`);
}
restoreSession();

const ctx = { store, afterMutation };
const httpMode = has("--http", "--streamable-http");

if (!httpMode) {
  // serveStdio speaks BOTH the 2026-07-28 revision and the 2025-era protocol,
  // so older MCP hosts (including Arena.ai Agent Mode) connect transparently.
  serveStdio(() => buildServer(ctx), {
    onerror: err => process.stderr.write(`[stdio] ${err.message}\n`),
  });
} else {
  const port = parseInt(argValue("--port", process.env.SPRITE_HTTP_PORT || "3100"), 10);
  const host = argValue("--host", process.env.SPRITE_HTTP_HOST || "0.0.0.0");
  const token = process.env.SPRITE_HTTP_TOKEN;
  const handler = createMcpHandler(() => buildServer(ctx), {
    onerror: err => process.stderr.write(`[http] ${err.message}\n`),
  });
  const mcp = toNodeHandler(handler, { onerror: err => process.stderr.write(`[http-adapter] ${err.message}\n`) });
  const extraHosts = (process.env.SPRITE_ALLOWED_HOSTS ?? "").split(",").map(s => s.trim()).filter(Boolean);
  const strict = process.env.SPRITE_STRICT_HOSTS === "1";

  const allowedHost = (hostname: string) =>
    hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]" ||
    hostname.endsWith(".e2b.app") || extraHosts.some(h => hostname === h || hostname.endsWith("." + h));

  const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
    res.setHeader("Access-Control-Allow-Origin", req.headers.origin ?? "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "content-type, authorization, mcp-session-id, mcp-protocol-version, last-event-id, accept");
    res.setHeader("Access-Control-Expose-Headers", "mcp-session-id, mcp-protocol-version");
    if (req.method === "OPTIONS") { res.writeHead(204); res.end(); return; }
    const hostname = (req.headers.host ?? "").split(":")[0];
    if (strict && !allowedHost(hostname)) {
      res.writeHead(403, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "host not allowed", host: hostname }));
      return;
    }
    if (url.pathname === "/" || url.pathname === "/health") {
      const info = {
        name: SERVER_NAME, version: SERVER_VERSION,
        protocol: ["2026-07-28", "2025-11-25", "2025-06-18", "2025-03-26"],
        endpoint: "/mcp", transport: "Streamable HTTP (stateless + legacy fallback)",
        tools: 28, resources: 9, prompts: 5,
        outputRoot: outputRoot(), projects: store.list(),
        integrity: verifyIntegrity().clean,
        policy: "MCP tools only — repository source is READ-ONLY for agents",
      };
      if (url.pathname === "/health") { res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify(info, null, 2)); return; }
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(`<!doctype html><html><head><meta charset="utf-8"><title>sprite-agent-mcp</title>
<style>body{background:#14121c;color:#f3eaff;font:15px/1.6 ui-monospace,monospace;max-width:820px;margin:8vh auto;padding:24px}code{color:#ffcc66}h1{color:#ffcc66}pre{background:#1e1b2b;padding:16px;border-radius:10px;overflow:auto;border:1px solid #332e49}a{color:#2ce8f5}</style></head>
<body><h1>✦ sprite-agent-mcp</h1><p>Pixel-art &amp; sprite-animation MCP server for <b>Arena.ai Agent Mode</b>.</p>
<pre>POST /mcp   → Streamable HTTP MCP endpoint
GET  /health → JSON health + integrity status</pre>
<p>Connect any MCP client to <code>http://${req.headers.host}/mcp</code>, or use
<code>npx -y sprite-agent-mcp</code> over stdio.</p>
<p><b>HARD POLICY:</b> agents must only call MCP tools. Never edit repository source.
Generated art is written to <code>${outputRoot()}</code> by the write guard.</p>
<p>${store.list().length} project(s) in session · integrity ${info.integrity ? "OK" : "MODIFIED"}</p>
<p>See <a href="https://github.com/arena-agent/sprite-agent-mcp">README</a> · sprite://policy · sprite://guide/pixel-art</p>
</body></html>`);
      return;
    }
    if (url.pathname === "/mcp" || url.pathname.startsWith("/mcp/")) {
      if (token) {
        const auth = req.headers.authorization;
        if (auth !== `Bearer ${token}`) {
          res.writeHead(401, { "content-type": "application/json" });
          res.end(JSON.stringify({ error: "unauthorized", hint: "Send Authorization: Bearer <SPRITE_HTTP_TOKEN>" }));
          return;
        }
      }
      await mcp(req, res);
      return;
    }
    res.writeHead(404, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "not found" }));
  });

  server.listen(port, host, () => {
    process.stderr.write(`\n  ✦ ${SERVER_NAME} HTTP ready → http://${host}:${port}/mcp\n  health: http://localhost:${port}/health\n\n`);
  });
  const shutdown = () => server.close(() => process.exit(0));
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}
