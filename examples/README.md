# Examples

> Agents: do not add files here. Use MCP tools; outputs go to `sprite-output/`.

Run `npm run demo` from the repo root. It drives the built MCP server over real stdio JSON-RPC and writes a full showcase into `sprite-output/demo/`:

- **Forest Knight** — `hero` + `idle_bob`, endesga32
- **Bouncy Slime** — built-in 4-frame loop, sweetie16
- **Spinning Coin** — 6-frame rotation, db32
- **Torch Flame** — 4-frame flicker, neon16
- **Crystal Gem** — `glow` animation, pico8
- **ASCII Heart** — hand-drawn with `sprite_draw_grid`, no generator, bubblegum16

Each scene exports PNG frames, GIF, APNG, animated SVG, spritesheet + Aseprite atlas, GPL palette, project JSON and a self-contained HTML gallery. `sprite-output/demo/index.html` links all of them.

## Copy-paste ASCII grids

```
heart 16×16                  potion 16×16                 slime 16×16
..OO....OO..                 ....CCCC....                ....GGGG....
.ORRO..ORRO.                 ...CCCCCC...              ..GGGGGGGG..
ORRRROORRRRO                 ..CLLLLC..                .GGHHGGGGGG.
ORRRRRRRRRRO                 ..CLLLLC..                GGGGGGGGGGGG
ORRRRRRRRRRO                 .CCLLLLCC.               GGEEGGGGEEGG
.ORRRRRRRRO.                 .CLLLLLLC.               GGEEGGGGEEGG
..ORRRRRRO..                 .CLLLLLLC.               GGGGGGGGGGGG
...ORRRRO...                 ..CLLLLC..                .GGGSSSSGGG.
....ORRO....                 ...CCCC...                 ..GGGGGGGG..
.....OO.....                 ....KK....                  ....GGGG....
```

Legend for the heart: `{ "O": "outline", "R": "accent", "H": "highlight" }`.
Use `at: {x:2,y:2}` on a 16×16 canvas and `mirrorX: true` to draw only half.

## Minimal MCP session (raw JSON-RPC lines)

```json
{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"demo","version":"1"}}}
{"jsonrpc":"2.0","method":"notifications/initialized","params":{}}
{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"sprite_new_project","arguments":{"name":"Demo","width":16,"height":16,"palette":"pico8"}}}
{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"sprite_generate","arguments":{"kind":"heart"}}}
{"jsonrpc":"2.0","id":4,"method":"tools/call","params":{"name":"sprite_preview","arguments":{"scale":16}}}
{"jsonrpc":"2.0","id":5,"method":"tools/call","params":{"name":"sprite_export","arguments":{"formats":["all"]}}}
```
