#!/usr/bin/env node
/**
 * Showcase: drives the MCP server over real stdio JSON-RPC and produces a
 * complete demo pack in sprite-output/demo/ (PNG, GIF, APNG, spritesheet,
 * atlas, GPL, CSS and a self-contained HTML gallery).
 *
 * This script NEVER edits repository source. It only calls MCP tools.
 */
import { StdioMcpClient } from "./mcp-client.mjs";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(ROOT, "sprite-output", "demo");
mkdirSync(OUT, { recursive: true });

const client = new StdioMcpClient(undefined, { SPRITE_AUTOSAVE: "0" });
const log = (...a) => console.log("  ", ...a);

async function scene({ id, name, palette, kind, preset, frames, fps, dir }) {
  log(`▶ ${name}`);
  await client.call("sprite_new_project", { name, id, palette, width: 32, height: 32, tags: [kind] });
  await client.call("sprite_generate", { kind, seed: `${id}-arena-2026` });
  await client.call("sprite_enhance", { outline: true, shade: true, despeckle: true, limitColors: 20 });
  if (preset) await client.call("sprite_animate", { preset, frames, amplitude: 1, durationMs: Math.round(1000 / fps), sourceFrame: 0 });
  await client.call("sprite_timing", { fps });
  const critique = await client.call("sprite_critique");
  log(`   critique grade ${critique.structuredContent.grade} (${critique.structuredContent.scores.overall}/100)`);
  const exported = await client.call("sprite_export", {
    formats: ["png", "gif", "apng", "svg", "spritesheet", "gpl", "gallery", "json"],
    name: id, dir, scale: 4, atlas: "aseprite", title: name,
  });
  log(`   ${exported.structuredContent.files.length} files → ${dir}`);
  return exported.structuredContent.files;
}

try {
  const init = await client.initialize();
  console.log(`\n✦ sprite-agent-mcp demo · ${init.serverInfo.name} ${init.serverInfo.version} / ${init.protocolVersion}\n`);
  console.log(client.text(await client.call("sprite_quickstart")).split("\n")[0]);

  const all = [];
  all.push(...await scene({ id: "forest-knight", name: "Forest Knight — idle", palette: "endesga32", kind: "hero", preset: "idle_bob", frames: 6, fps: 8, dir: "demo/forest-knight" }));
  all.push(...await scene({ id: "slime", name: "Bouncy Slime — loop", palette: "sweetie16", kind: "slime", fps: 8, dir: "demo/slime" }));
  all.push(...await scene({ id: "coin", name: "Spinning Coin — loop", palette: "db32", kind: "coin", fps: 12, dir: "demo/coin" }));
  all.push(...await scene({ id: "torch", name: "Torch Flame — loop", palette: "neon16", kind: "torch", fps: 10, dir: "demo/torch" }));
  all.push(...await scene({ id: "gem", name: "Crystal Gem — glow", palette: "pico8", kind: "gem", preset: "glow", frames: 4, fps: 8, dir: "demo/gem" }));

  // A hand-drawn ASCII sprite (no generator) to show the LLM-native path.
  log("▶ Hand-drawn ASCII heart (sprite_draw_grid)");
  await client.call("sprite_new_project", { id: "ascii-heart", name: "ASCII Heart", palette: "bubblegum16", width: 16, height: 16 });
  await client.call("sprite_draw_grid", {
    grid: [
      "..OO....OO..",
      ".ORRO..ORRO.",
      "ORRRROORRRRO",
      "ORRRRRRRRRRO",
      "ORRRRRRRRRRO",
      ".ORRRRRRRRO.",
      "..ORRRRRRO..",
      "...ORRRRO...",
      "....ORRO....",
      ".....OO.....",
    ],
    legend: { O: "outline", R: "accent", H: "highlight" },
    at: { x: 2, y: 2 },
    clear: true,
  });
  await client.call("sprite_draw_ops", { ops: [{ op: "shade", light: "nw", strength: 0.7 }, { op: "outline", color: "outline", mode: "selective" }] });
  await client.call("sprite_animate", { preset: "pulse", frames: 4, durationMs: 120 });
  const heart = await client.call("sprite_export", { formats: ["all"], name: "ascii-heart", dir: "demo/ascii-heart", scale: 8, title: "ASCII Heart" });
  all.push(...heart.structuredContent.files);
  log(`   ${heart.structuredContent.files.length} files`);

  // Master index that links every scene gallery.
  const galleries = all.filter(f => f.format === "gallery").map(f => ({
    name: f.relative.split("/").pop().replace("_gallery.html", "").replace(/[-_]/g, " "),
    href: path.relative(OUT, f.path).replace(/\\/g, "/"),
  }));
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>sprite-agent-mcp · demo pack</title>
<style>body{background:radial-gradient(900px 500px at 50% -10%,#2a2340,#14121c);color:#f3eaff;font:15px/1.6 ui-monospace,monospace;margin:0;padding:8vh 24px}main{max-width:900px;margin:auto}h1{color:#ffcc66;font-size:28px}small{color:#a99fc4}ul{list-style:none;padding:0;display:grid;grid-template-columns:repeat(auto-fit,minmax(230px,1fr));gap:14px;margin-top:28px}a{display:block;padding:18px;background:#1e1b2b;border:1px solid #332e49;border-radius:12px;color:#2ce8f5;text-decoration:none}a:hover{border-color:#ffcc66}code{color:#ffcc66}</style></head>
<body><main><h1>✦ sprite-agent-mcp</h1><p><small>Pixel art &amp; sprite animation for <b>Arena.ai Agent Mode</b> — generated live through MCP tools only. Repository source untouched.</small></p>
<p>${all.length} files · ${galleries.length} animated scenes · PNG / GIF / APNG / SVG / spritesheet+atlas / GPL / CSS / HTML players.</p>
<ul>${galleries.map(g => `<li><a href="${g.href}">▶ ${g.name}</a></li>`).join("")}</ul>
<p style="margin-top:40px"><small>Policy: <code>ONLY MCP tools · NEVER edit source</code>. Run <code>sprite_verify_integrity</code> to prove it.</small></p>
</main></body></html>`;
  writeFileSync(path.join(OUT, "index.html"), html);
  console.log(`\n🎉 Demo complete → ${OUT}/index.html (${all.length} files)\n`);
} catch (e) {
  console.error("Demo failed:", e);
  process.exitCode = 1;
} finally {
  await client.close();
}
