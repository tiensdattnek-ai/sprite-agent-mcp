#!/usr/bin/env node
/** CI guard: prove the write policy really refuses to touch source files. */
import { safeOutputPath, writeOutput, PolicyError } from "../dist/core/paths.js";
import { verifyIntegrity } from "../dist/core/integrity.js";

const forbidden = [
  "../src/core/color.ts", "src/evil.png", "scripts/evil.png", "tests/evil.png",
  ".github/workflows/evil.png", "dist/evil.png", "package.json", "tsconfig.json",
  "README.md", "AGENTS.md", "POLICY.md", "evil.js", "evil.mjs", "evil.ts",
  "a/../../package.json", "/tmp/evil.png", ".git/config",
];
let blocked = 0;
for (const p of forbidden) {
  try {
    safeOutputPath(p);
    console.error(`❌ WRITE GUARD FAILED: allowed "${p}"`);
    process.exitCode = 1;
  } catch (e) {
    if (!(e instanceof PolicyError)) throw e;
    blocked++;
  }
}
// A legitimate art output must still succeed.
const r = writeOutput("guard-check/test.png", Buffer.from([137, 80, 78, 71]));
console.log(`✅ write guard blocked ${blocked}/${forbidden.length} forbidden paths; allowed ${r.relative}`);
const integrity = verifyIntegrity();
console.log(integrity.clean ? `✅ integrity OK (${integrity.checked} files)` : `⚠ integrity dev-mode: ${integrity.message}`);
