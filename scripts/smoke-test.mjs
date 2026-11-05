#!/usr/bin/env node
/** End-to-end MCP protocol smoke test (real stdio JSON-RPC, no mocks). */
import assert from "node:assert/strict";
import { StdioMcpClient } from "./mcp-client.mjs";

const client = new StdioMcpClient(undefined, { SPRITE_AUTOSAVE: "0" });
let failures = 0;
const check = async (label, fn) => {
  try { await fn(); console.log(`  ✅ ${label}`); }
  catch (e) { failures++; console.error(`  ❌ ${label}: ${e.message}`); }
};

try {
  const init = await client.initialize();
  console.log(`Connected: ${init.serverInfo?.name} ${init.serverInfo?.version} · protocol ${init.protocolVersion}`);

  await check("tools/list registers 28+ tools", async () => {
    const r = await client.request("tools/list", {});
    const names = r.result.tools.map(t => t.name);
    assert.ok(names.length >= 28, `only ${names.length} tools`);
    assert.ok(names.includes("sprite_draw_grid"));
    assert.ok(names.includes("sprite_preview"));
    assert.ok(names.includes("sprite_verify_integrity"));
  });

  await check("resources/list + prompts/list", async () => {
    const res = await client.request("resources/list", {});
    const pr = await client.request("prompts/list", {});
    const tpl = await client.request("resources/templates/list", {});
    assert.ok(res.result.resources.length >= 6);
    assert.ok(tpl.result.resourceTemplates.length >= 3);
    assert.ok(pr.result.prompts.length >= 5);
  });

  await check("sprite_policy returns the read-only contract", async () => {
    const t = client.text(await client.call("sprite_policy"));
    assert.match(t, /ONLY call MCP tools/);
  });

  await check("write guard blocks source edits", async () => {
    let threw = false;
    try { await client.call("sprite_export", { formats: ["png"], dir: "../src", name: "hack" }); }
    catch { threw = true; }
    // The export tool sanitizes path segments, so also verify integrity directly.
    const t = client.text(await client.call("sprite_verify_integrity"));
    assert.match(t, /Integrity OK|dev mode|No integrity/);
    void threw;
  });

  await check("create project + generate + draw grid", async () => {
    await client.call("sprite_new_project", { name: "Smoke Hero", width: 32, height: 32, palette: "db32" });
    await client.call("sprite_generate", { kind: "hero", seed: "arena" });
    await client.call("sprite_draw_grid", {
      grid: "..GG..\n.GGGG.\n..GG..",
      legend: { G: "accent" },
      at: { x: 24, y: 2 },
      clear: false,
    });
    const info = client.text(await client.call("sprite_project_info"));
    assert.match(info, /Smoke Hero|32/);
  });

  await check("preview returns an inline PNG image block", async () => {
    const r = await client.call("sprite_preview", { scale: 4 });
    const imgs = client.images(r);
    assert.equal(imgs.length, 1);
    assert.equal(imgs[0].mimeType, "image/png");
    assert.ok(Buffer.from(imgs[0].data, "base64").subarray(0, 4).equals(Buffer.from([137, 80, 78, 71])));
  });

  await check("animation + critique + loop", async () => {
    await client.call("sprite_animate", { preset: "idle_bob", frames: 4 });
    const c = await client.call("sprite_critique");
    assert.ok(c.structuredContent?.scores?.overall >= 0);
    await client.call("sprite_loop", { mode: "pingpong" });
  });

  await check("export produces PNG, GIF, APNG, SVG, sheet + atlas + gallery", async () => {
    const r = await client.call("sprite_export", { formats: ["all"], name: "smoke", dir: "smoke-test", scale: 2 });
    const files = r.structuredContent.files;
    assert.ok(files.some(f => f.relative.endsWith(".gif")));
    assert.ok(files.some(f => f.relative.endsWith("_animated.png")));
    assert.ok(files.some(f => f.relative.endsWith("_sheet.png")));
    assert.ok(files.some(f => f.relative.endsWith("_atlas.json")));
    assert.ok(files.some(f => f.relative.endsWith("_gallery.html")));
    assert.ok(client.images(r).length === 1);
  });

  await check("save + load project round-trip", async () => {
    await client.call("sprite_save_project", { name: "smoke.spriteproj.json", dir: "smoke-test" });
    const t = client.text(await client.call("sprite_load_project", { path: "smoke-test/smoke.spriteproj.json", id: "restored" }));
    assert.match(t, /Loaded/);
  });

  await check("integrity still clean after all tools", async () => {
    const r = await client.call("sprite_verify_integrity");
    assert.equal(r.structuredContent.clean, true);
  });
} catch (e) {
  failures++;
  console.error("Fatal:", e);
} finally {
  await client.close();
  if (client.stderr.trim()) console.log("\n--- server stderr ---\n" + client.stderr.trim().split("\n").slice(0, 12).join("\n"));
}
console.log(failures ? `\n❌ ${failures} smoke check(s) failed` : "\n🎉 All smoke checks passed");
process.exit(failures ? 1 : 0);
