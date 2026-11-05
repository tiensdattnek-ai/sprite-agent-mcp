# Recipes

> All recipes use **only MCP tools**. Never edit source files.

## 1. 32×32 RPG hero, polished idle loop

```jsonc
{"name":"sprite_quickstart","arguments":{}}
{"name":"sprite_new_project","arguments":{"name":"Forest Knight","width":32,"height":32,"palette":"endesga32","tags":["rpg"]}}
{"name":"sprite_generate","arguments":{"kind":"hero","seed":"knight-01"}}
{"name":"sprite_draw_ops","arguments":{"ops":[
  {"op":"shade","light":"nw","strength":0.6},
  {"op":"outline","color":"outline","mode":"selective"}
]}}
{"name":"sprite_enhance","arguments":{"despeckle":true,"limitColors":16,"center":true}}
{"name":"sprite_critique","arguments":{}}
{"name":"sprite_animate","arguments":{"preset":"idle_bob","frames":6,"durationMs":125,"amplitude":1}}
{"name":"sprite_timing","arguments":{"durations":[125,125,140,125,125,140]}}
{"name":"sprite_preview","arguments":{"frame":"all"}}
{"name":"sprite_export","arguments":{"formats":["png","gif","apng","spritesheet"],"atlas":"aseprite","scale":8}}
{"name":"sprite_gallery","arguments":{"title":"Forest Knight · idle"}}
```

## 2. Walk cycle with hand-authored key poses

```jsonc
{"name":"sprite_new_project","arguments":{"name":"Walk","width":32,"height":32,"palette":"db32"}}
{"name":"sprite_generate","arguments":{"kind":"hero"}}
// draw 4 poses, each separated by ---
{"name":"sprite_draw_grid","arguments":{"grid":"<pose 1>\n---\n<pose 2>\n---\n<pose 3>\n---\n<pose 4>","legend":{"o":"outline","s":"skin","b":"base","h":"highlight"}}}
{"name":"sprite_tween","arguments":{"from":0,"to":1,"steps":1}}
{"name":"sprite_loop","arguments":{"mode":"pingpong"}}
{"name":"sprite_timing","arguments":{"fps":10}}
{"name":"sprite_export","arguments":{"formats":["spritesheet","gif"],"atlas":"phaser3"}}
```

## 3. Seamless animated water tileset

```jsonc
{"name":"sprite_new_project","arguments":{"name":"Water","width":16,"height":16,"palette":"pico8"}}
{"name":"sprite_generate","arguments":{"kind":"tile_water","seed":"lake"}}
{"name":"sprite_timing","arguments":{"fps":6}}
{"name":"sprite_preview","arguments":{"frame":"all","scale":12}}
{"name":"sprite_export","arguments":{"formats":["spritesheet","gif","apng"],"padding":1,"columns":4,"scale":8}}
```

## 4. Item icons in a consistent style

```jsonc
{"name":"sprite_new_project","arguments":{"name":"Items","width":16,"height":16,"palette":"db32"}}
{"name":"sprite_generate","arguments":{"kind":"potion","seed":"i1","replace":true}}
{"name":"sprite_export","arguments":{"formats":["png"],"name":"potion","scale":16}}
{"name":"sprite_generate","arguments":{"kind":"gem","seed":"i2","replace":true}}
{"name":"sprite_export","arguments":{"formats":["png"],"name":"gem","scale":16}}
// repeat for chest / sword / shield / heart …
```

## 5. Custom palette & brand-consistent art

```jsonc
{"name":"sprite_new_project","arguments":{"name":"Brand Mascot","width":24,"height":24,"palette":"db32"}}
{"name":"sprite_palette","arguments":{"name":"brand","colors":["#0d0b1a","#3b2d6e","#7a4bd0","#c08bff","#ffe9a8","#ffffff","#ff5470"],"description":"Our brand colors"}}
{"name":"sprite_generate","arguments":{"kind":"slime","seed":"brand"}}
{"name":"sprite_enhance","arguments":{"outline":true,"shade":true}}
{"name":"sprite_export","arguments":{"formats":["all"]}}
```

## 6. Explosion VFX from an existing sprite

```jsonc
{"name":"sprite_animate","arguments":{"preset":"explode","frames":8,"durationMs":70,"amplitude":2,"easing":"ease-out"}}
{"name":"sprite_draw_ops","arguments":{"ops":[{"op":"scatter","x":0,"y":0,"w":32,"h":32,"count":12,"color":"highlight","seed":9}],"allFrames":true}}
{"name":"sprite_export","arguments":{"formats":["gif","apng","spritesheet"],"scale":6}}
```

## 7. Iterative quality loop (the "art director" pattern)

```
sprite_critique → read suggestions → sprite_enhance / sprite_draw_ops
→ sprite_preview (look at the inline PNG) → repeat ≤4× → grade ≥ A
→ sprite_export{formats:["all"]} → sprite_verify_integrity
```

## 8. Preserve and resume work

```jsonc
{"name":"sprite_save_project","arguments":{"name":"wip/knight.spriteproj.json"}}
// later, even in a new session:
{"name":"sprite_load_project","arguments":{"path":"wip/knight.spriteproj.json","id":"knight","activate":true}}
```

Session autosave (`.sprite-agent-state.json` in the output root) also restores projects automatically on restart unless `SPRITE_AUTOSAVE=0`.

## Anti-patterns (don't do these)

- ❌ Editing `src/` because a tool errored → ✅ change the arguments.
- ❌ Adding a script to "batch generate" → ✅ call `sprite_generate` repeatedly with different seeds.
- ❌ Writing files with shell commands → ✅ `sprite_export` / `sprite_gallery`.
- ❌ Regenerating the integrity manifest → ✅ `git checkout -- .` (human).
- ❌ Upscaling with an external image editor → ✅ `scale` on preview/export (nearest-neighbour).
