# Export formats

All writers go through `writeOutput()`; only `SPRITE_OUTPUT_DIR` (default `./sprite-output`) is writable.

| Format | Files | Details |
|---|---|---|
| `png` | `<name>_frame_00.png`, … | Indexed PNG color type 3, `PLTE` + `tRNS` (index 0 transparent), filter 0, zlib level 9. `scale` is integer nearest-neighbour. With `background`, an RGBA color-type-6 PNG is written instead. |
| `gif` | `<name>.gif` | GIF89a, global color table from the project palette, 1-bit transparency at index 0, per-frame delay in ms, `NETSCAPE2.0` loop, dispose=2. `scale` capped at 16. |
| `apng` | `<name>_animated.png` | `acTL` (num_frames, loop forever), `fcTL` per frame, `IDAT` for frame 0 and `fdAT` for the rest, shared sequence numbers, full-frame `dispose=0`/`blend=0`. Lossless, alpha-correct. |
| `svg` | `<name>.svg` | One `<rect>` per horizontal run of identical pixels, `shape-rendering="crispEdges"`. Multi-frame files use discrete SMIL `<animate>` with `keyTimes` derived from frame durations. |
| `spritesheet` | `<name>_sheet.png`, `<name>_atlas.json` | Grid packing with configurable `columns` and `padding`, plus atlas metadata. With `atlas:"godot"` also emits `<name>.tres` (Godot 4 `SpriteFrames`). |
| `gpl` | `<name>.gpl` | GIMP palette, importable in Aseprite / Krita / GIMP. |
| `css` | `<name>.css` | A 1-pixel `<div>` and one `box-shadow` entry per opaque pixel. Limited to 4096 pixels. |
| `json` | `<name>.spriteproj.json` | Full project: palette + roles, frames, layers (base64 pixel buffers), durations, tags. Loadable with `sprite_load_project`. |
| `gallery` | `<name>_gallery.html` | Standalone player: inline base64 PNGs, play/pause, prev/next, onion skin, zoom 1–16×, palette swatches, frame tags. No external CSS/JS/fonts/images → works offline and in sandboxed iframes. |

## Atlas flavours

- **Aseprite** — hash-array `frames` with `frame`, `spriteSourceSize`, `sourceSize`, `duration`, plus `meta.frameTags`, `layers`, `slices`.
- **Phaser 3** — array atlas JSON with `filename`, `frame`, `rotated`, `trimmed`, `meta`.
- **simple** — minimal `{image, size, frameSize, columns, rows, padding, frames}`.
- **Godot 4** — `.tres` `SpriteFrames` resource text with `Rect2` regions matching the packed sheet (fill in the real `res://` texture path).

`frameTags` are derived from frame `tags`: consecutive frames sharing a tag become one animation range — ideal for `walk`, `idle`, `attack` clips inside a single sheet.

## Examples

```jsonc
// Everything, 8× zoom
{"name":"sprite_export","arguments":{"formats":["all"],"scale":8,"atlas":"aseprite"}}

// A game-ready sheet, 4 columns, 2px gutter, Phaser 3 atlas
{"name":"sprite_export","arguments":{"formats":["spritesheet"],"columns":4,"padding":2,"atlas":"phaser3","scale":1}}

// Transparent GIF for a web page
{"name":"sprite_export","arguments":{"formats":["gif"],"scale":6,"loop":true}}

// Presentation only
{"name":"sprite_gallery","arguments":{"title":"Boss idle","scale":10,"background":"#14121c"}}
```

## Fidelity guarantees

- Every export is generated from `compositeFrame()` — the exact indexed bytes the agent drew.
- No color quantization, resampling, gamma correction or compression artifacts (PNG/APNG are lossless; GIF uses the existing palette, so no requantization).
- Upscaling is strictly nearest-neighbour and never modifies the stored project.
- Deterministic given the same project + options.
