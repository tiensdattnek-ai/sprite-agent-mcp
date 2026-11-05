/**
 * Source-integrity verification.
 *
 * `scripts/generate-manifest.mjs` ships integrity/manifest.json containing
 * SHA-256 hashes of every source/config file. At runtime the MCP tool
 * `sprite_verify_integrity` recomputes them, so an agent (or a human) can
 * prove that nobody edited the code. This is the enforcement companion to
 * AGENTS.md / POLICY.md / the README contract.
 */

import { createHash } from "node:crypto";
import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { PACKAGE_ROOT, POLICY_TEXT, outputRoot } from "./paths.js";

export interface IntegrityReport {
  clean: boolean;
  manifestFound: boolean;
  generatedAt: string | null;
  checked: number;
  changed: string[];
  missing: string[];
  message: string;
  policy: string;
}

const MANIFEST_PATH = path.join(PACKAGE_ROOT, "integrity", "manifest.json");

export function hashFile(abs: string): string {
  return createHash("sha256").update(readFileSync(abs)).digest("hex");
}

export function verifyIntegrity(): IntegrityReport {
  if (!existsSync(MANIFEST_PATH)) {
    return {
      clean: true, manifestFound: false, generatedAt: null, checked: 0, changed: [], missing: [],
      message: "No integrity/manifest.json (source checkout / dev mode). Run `npm run integrity` to generate one. The write guard is still active.",
      policy: POLICY_TEXT,
    };
  }
  let manifest: { generatedAt?: string; files?: Record<string, string> };
  try {
    manifest = JSON.parse(readFileSync(MANIFEST_PATH, "utf8"));
  } catch (e) {
    return { clean: false, manifestFound: true, generatedAt: null, checked: 0, changed: [], missing: [], message: `Manifest is unreadable: ${(e as Error).message}`, policy: POLICY_TEXT };
  }
  const files = manifest.files ?? {};
  const changed: string[] = [], missing: string[] = [];
  for (const [rel, expected] of Object.entries(files)) {
    const abs = path.join(PACKAGE_ROOT, rel);
    if (!existsSync(abs)) { missing.push(rel); continue; }
    if (hashFile(abs) !== expected) changed.push(rel);
  }
  const clean = changed.length === 0 && missing.length === 0;
  return {
    clean, manifestFound: true, generatedAt: manifest.generatedAt ?? null,
    checked: Object.keys(files).length, changed, missing,
    message: clean
      ? `✅ Integrity OK — ${Object.keys(files).length} tracked files unchanged. Keep using MCP tools only.`
      : `⛔ Source was modified (${changed.length} changed, ${missing.length} missing). Agent: STOP. Ask the human to restore with \`git checkout -- .\` or \`npm run integrity\` (only if the change was intentional).`,
    policy: POLICY_TEXT,
  };
}

/** Extra source files present in a published package but not in the manifest. */
export function extraSourceFiles(): string[] {
  if (!existsSync(MANIFEST_PATH)) return [];
  const manifest = JSON.parse(readFileSync(MANIFEST_PATH, "utf8")) as { files: Record<string, string> };
  const tracked = new Set(Object.keys(manifest.files ?? {}));
  const found: string[] = [];
  const walk = (dir: string) => {
    if (!existsSync(dir)) return;
    for (const entry of readdirSync(dir)) {
      if (entry === "node_modules" || entry.startsWith(".")) continue;
      const abs = path.join(dir, entry);
      if (statSync(abs).isDirectory()) walk(abs);
      else {
        const rel = path.relative(PACKAGE_ROOT, abs).replace(/\\/g, "/");
        if ((rel.startsWith("src/") || rel.startsWith("scripts/")) && !tracked.has(rel)) found.push(rel);
      }
    }
  };
  walk(path.join(PACKAGE_ROOT, "src"));
  walk(path.join(PACKAGE_ROOT, "scripts"));
  return found;
}

export function startupBanner(): void {
  const report = verifyIntegrity();
  const lines = [
    "",
    "  ✦ sprite-agent-mcp · pixel-art MCP server for Arena.ai Agent Mode",
    `  output root : ${outputRoot()}`,
    `  integrity   : ${report.manifestFound ? (report.clean ? "OK (" + report.checked + " files)" : "MODIFIED: " + report.changed.join(", ")) : "dev mode (no manifest)"}`,
    "  policy      : MCP tools only · repository source is READ-ONLY for agents",
    "",
  ];
  // stderr ONLY: stdout is the JSON-RPC channel on stdio transport.
  process.stderr.write(lines.join("\n") + "\n");
}
