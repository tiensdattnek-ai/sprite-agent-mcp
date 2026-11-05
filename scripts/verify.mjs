#!/usr/bin/env node
/** Human CLI: verify source integrity without starting the MCP server. */
import { createHash } from "node:crypto";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MANIFEST = path.join(ROOT, "integrity", "manifest.json");
if (!existsSync(MANIFEST)) { console.log("⚠ No manifest. Run `npm run integrity`."); process.exit(0); }
const m = JSON.parse(readFileSync(MANIFEST, "utf8"));
const changed = [], missing = [];
for (const [rel, hash] of Object.entries(m.files)) {
  const abs = path.join(ROOT, rel);
  if (!existsSync(abs)) { missing.push(rel); continue; }
  if (createHash("sha256").update(readFileSync(abs)).digest("hex") !== hash) changed.push(rel);
}
if (changed.length || missing.length) {
  console.error(`⛔ INTEGRITY FAILED\nchanged: ${changed.join(", ") || "none"}\nmissing: ${missing.join(", ") || "none"}`);
  process.exit(1);
}
console.log(`✅ Integrity OK — ${Object.keys(m.files).length} tracked files unchanged (${m.generatedAt})`);
