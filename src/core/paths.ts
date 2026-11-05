/**
 * WRITE GUARD — policy enforced in code, not just in the README.
 *
 * Arena agents love to "helpfully" patch the repo. Every output of this server
 * goes through `writeOutput()`; there is no other file-writing path. The guard:
 *   1. resolves everything under one output root,
 *   2. rejects `..` traversal and absolute paths outside that root,
 *   3. rejects ANY write into the package's own source/config tree,
 *   4. rejects source-code file extensions,
 *   5. caps file size.
 *
 * So an agent physically cannot overwrite src/*.ts, package.json, tsconfig,
 * AGENTS.md, the README or CI config — it can only create art in sprite-output/.
 */

import { mkdirSync, writeFileSync, statSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
/** dist/core → package root (or src/core → package root). */
export const PACKAGE_ROOT = path.resolve(HERE, "..", "..");

export class PolicyError extends Error {
  constructor(message: string) {
    super(`[sprite-agent-mcp POLICY] ${message}`);
    this.name = "PolicyError";
  }
}

const FORBIDDEN_EXT = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".mts", ".cts", ".sh", ".bash", ".py", ".rb", ".go", ".rs", ".yml", ".yaml", ".toml", ".lock", ".env", ".gitignore", ".npmignore"]);
const PROTECTED_DIRS = ["src", "scripts", "tests", "test", "node_modules", ".git", ".github", "integrity", "docs", "assets", ".cursor", ".vscode", "dist"];
const PROTECTED_FILES = new Set([
  "package.json", "package-lock.json", "tsconfig.json", "vitest.config.ts", "readme.md",
  "readme.en.md", "agents.md", "policy.md", "license", "changelog.md", "contributing.md",
  "dockerfile", "server.json", "smithery.yaml", "mcp.json", "code_of_conduct.md", "security.md",
]);

export function defaultOutputRoot(): string {
  const env = process.env.SPRITE_OUTPUT_DIR;
  if (env && env.trim()) return path.resolve(env.trim());
  const cwd = process.cwd();
  // When launched from inside this package (dev / demo), keep outputs in a
  // dedicated subfolder that is explicitly allowed.
  if (cwd === PACKAGE_ROOT || cwd.startsWith(PACKAGE_ROOT + path.sep)) return path.join(PACKAGE_ROOT, "sprite-output");
  return path.join(cwd, "sprite-output");
}

export function outputRoot(): string {
  return defaultOutputRoot();
}

export function isInsidePackageRoot(target: string): boolean {
  const rel = path.relative(PACKAGE_ROOT, target);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

/** Validate and resolve a user-supplied relative output path. */
export function safeOutputPath(userPath: string, opts: { allowOutsideRoot?: boolean; root?: string } = {}): string {
  if (!userPath || typeof userPath !== "string") throw new PolicyError("an output path is required");
  const root = opts.root ?? outputRoot();
  const normalized = userPath.replace(/\\/g, "/");
  if (path.isAbsolute(normalized) || /^[a-zA-Z]:/.test(normalized)) {
    if (!opts.allowOutsideRoot && !process.env.SPRITE_ALLOW_EXTERNAL_OUTPUT) {
      throw new PolicyError("absolute output paths are disabled. Set SPRITE_OUTPUT_DIR (human operator) and use a RELATIVE path. Agents must never write outside the output root.");
    }
  }
  if (normalized.split("/").includes("..")) throw new PolicyError(`path traversal ".." is not allowed: ${userPath}`);
  const resolved = path.resolve(root, normalized);
  const relToRoot = path.relative(root, resolved);
  if (opts.allowOutsideRoot !== true && (relToRoot.startsWith("..") || path.isAbsolute(relToRoot))) {
    throw new PolicyError(`output must stay inside ${root}. Got: ${userPath}`);
  }
  assertSafeTarget(resolved, root);
  return resolved;
}

function assertSafeTarget(resolved: string, root: string): void {
  const ext = path.extname(resolved).toLowerCase();
  if (FORBIDDEN_EXT.has(ext)) throw new PolicyError(`refusing to write a source/config file (${ext}). Only art assets + JSON/HTML metadata are allowed.`);
  const base = path.basename(resolved).toLowerCase();
  if (PROTECTED_FILES.has(base)) throw new PolicyError(`"${base}" is a protected repository file.`);
  // A protected directory name is forbidden ANYWHERE in the relative path,
  // not just at the package root. Even `<outputRoot>/scripts/foo.png` is
  // rejected: the policy is deliberately conservative and unambiguous.
  const relParts = path.relative(root, resolved).split(path.sep).map(s => s.toLowerCase());
  if (relParts.slice(0, -1).some(seg => PROTECTED_DIRS.includes(seg))) {
    throw new PolicyError(`"${relParts.find(seg => PROTECTED_DIRS.includes(seg))}/" is a protected directory name. Choose another output folder.`);
  }
  if (isInsidePackageRoot(resolved)) {
    const rel = path.relative(PACKAGE_ROOT, resolved).split(path.sep).map(s => s.toLowerCase());
    if (rel.length > 1 && PROTECTED_DIRS.includes(rel[0])) {
      throw new PolicyError(`"${rel[0]}/" is protected source. Use a folder under ${root}.`);
    }
    if (rel.length === 1 && !PROTECTED_FILES.has(base)) {
      // root-level files (other than known config) are still forbidden
      const allowedRoot = path.resolve(root) === path.join(PACKAGE_ROOT, "sprite-output") || path.resolve(root) === path.join(PACKAGE_ROOT, "examples");
      if (!allowedRoot) throw new PolicyError("refusing to write a file at the package root.");
    }
  }
  // Never allow hidden DIRECTORIES or git internals (hidden files are fine).
  const dirSegments = path.dirname(resolved).split(path.sep);
  if (dirSegments.some(seg => seg === ".git" || (seg.startsWith(".") && seg !== "." && seg !== ".."))) {
    throw new PolicyError("hidden directories are not writable.");
  }
}

export interface WriteResult { path: string; bytes: number; relative: string }

export function writeOutput(userPath: string, data: string | Uint8Array, opts: { root?: string; allowOutsideRoot?: boolean } = {}): WriteResult {
  const resolved = safeOutputPath(userPath, opts);
  const buf = typeof data === "string" ? Buffer.from(data, "utf8") : Buffer.from(data);
  if (buf.byteLength > 32 * 1024 * 1024) throw new PolicyError("output exceeds the 32 MB limit");
  mkdirSync(path.dirname(resolved), { recursive: true });
  writeFileSync(resolved, buf);
  const root = opts.root ?? outputRoot();
  return { path: resolved, bytes: buf.byteLength, relative: path.relative(root, resolved).replace(/\\/g, "/") };
}

export function outputExists(rel: string): boolean {
  try { return existsSync(safeOutputPath(rel)); } catch { return false; }
}

export function outputSize(rel: string): number {
  try { return statSync(safeOutputPath(rel)).size; } catch { return 0; }
}

export const POLICY_TEXT = `# sprite-agent-mcp — Agent Operations Policy (v1)

You are an AI agent (Arena.ai Agent Mode or any MCP client) using this server.

## HARD RULES — never break these
1. ONLY call MCP tools. Never open, edit, create, delete, patch, refactor,
   rename, format or "improve" ANY file in this repository.
2. NEVER run npm install / npm run / git / sed / shell commands against the repo.
   Never add dependencies, scripts, tests, config, docs, or CI files.
3. Do NOT "fix" the server. If a tool errors, read the error, change the ARGUMENTS,
   and call the tool again. Do not edit source to work around it.
4. All generated art goes to the output root (default ./sprite-output). The
   write guard blocks paths into src/, scripts/, tests/, .github/ and root config.
5. To change behaviour, a HUMAN must file an issue or PR. Agents do not.
6. Everything you need is already exposed: tools, resources (sprite://...),
   prompts and the sprite_quickstart / sprite_policy tools. Read those instead
   of reading source files.
7. Call sprite_verify_integrity if you suspect the source was modified. If it
   reports changes, STOP and ask the human to restore with git.

## The intended workflow
sprite_quickstart → sprite_new_project → sprite_generate OR sprite_draw_grid
→ sprite_draw_ops → sprite_enhance → sprite_critique → sprite_animate
→ sprite_preview (inline image) → sprite_export → sprite_gallery.

## Why
Arena agents commonly modify the repos they work in. This server is a
READ-ONLY TOOL SURFACE: the art is the deliverable, the code is not.
`;
