#!/usr/bin/env node
/** Tiny newline-delimited JSON-RPC MCP client over stdio, for tests and demos. */

import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export class StdioMcpClient {
  constructor(entry = path.join(ROOT, "dist", "index.js"), env = {}) {
    this.proc = spawn(process.execPath, [entry], {
      cwd: ROOT,
      env: { ...process.env, ...env },
      stdio: ["pipe", "pipe", "pipe"],
    });
    this.buffer = "";
    this.pending = new Map();
    this.nextId = 1;
    this.stderr = "";
    this.proc.stdout.setEncoding("utf8");
    this.proc.stdout.on("data", chunk => {
      this.buffer += chunk;
      let i;
      while ((i = this.buffer.indexOf("\n")) >= 0) {
        const line = this.buffer.slice(0, i).trim();
        this.buffer = this.buffer.slice(i + 1);
        if (!line) continue;
        try {
          const msg = JSON.parse(line);
          if (msg.id !== undefined && this.pending.has(msg.id)) {
            const { resolve } = this.pending.get(msg.id);
            this.pending.delete(msg.id);
            resolve(msg);
          }
        } catch { /* ignore non-JSON log lines */ }
      }
    });
    this.proc.stderr.setEncoding("utf8");
    this.proc.stderr.on("data", chunk => { this.stderr += chunk; });
  }

  request(method, params = {}, timeoutMs = 30000) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Timeout waiting for ${method} (id ${id})`));
      }, timeoutMs);
      this.pending.set(id, { resolve: msg => { clearTimeout(timer); resolve(msg); } });
      this.proc.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
    });
  }

  notify(method, params = {}) {
    this.proc.stdin.write(JSON.stringify({ jsonrpc: "2.0", method, params }) + "\n");
  }

  async initialize(protocolVersion = "2025-06-18") {
    const r = await this.request("initialize", {
      protocolVersion,
      capabilities: {},
      clientInfo: { name: "sprite-agent-mcp-test-client", version: "1.0.0" },
    });
    if (r.error) throw new Error(`initialize failed: ${JSON.stringify(r.error)}`);
    this.notify("notifications/initialized", {});
    return r.result;
  }

  async call(name, args = {}) {
    const r = await this.request("tools/call", { name, arguments: args });
    if (r.error) throw new Error(`${name}: ${JSON.stringify(r.error)}`);
    const result = r.result;
    if (result?.isError) throw new Error(`${name}: ${result.content?.[0]?.text ?? "tool error"}`);
    return result;
  }

  text(result) { return (result?.content ?? []).filter(c => c.type === "text").map(c => c.text).join("\n"); }
  images(result) { return (result?.content ?? []).filter(c => c.type === "image"); }

  async close() {
    try { this.proc.stdin.end(); } catch { /* noop */ }
    await new Promise(resolve => {
      const timer = setTimeout(() => { this.proc.kill("SIGKILL"); resolve(); }, 2000);
      this.proc.on("exit", () => { clearTimeout(timer); resolve(); });
    });
  }
}
