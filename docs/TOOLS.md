# Tool reference

> Agents: this file is for humans. `tools/list` returns the same information with a `.describe()` example on every field, and `sprite_quickstart` / `sprite_catalog` summarise it. **Never edit this file.**

Conventions used by every tool:

- `project` — optional id; omit to use the active project.
- `frame` — 0-based index, frame id or name; omit = active frame.
- `layer` — layer name; omit = topmost layer.
- Colors — `#rrggbb`, `#rrggbbaa`, `transparent` / `.`, a semantic role (`outline`, `shadow`, `dark`, `base`, `light`, `highlight`, `skin`, `skinShadow`, `accent`, `accent2`, `metal`, `metalLight`, `nature`, `water`, `white`, `black`), a palette index (`"7"`), or `ramp:N`.
- Results — text summary + `structuredContent` JSON; `sprite_preview`/`sprite_export` additionally return an inline `image/png` block.

## Policy & discovery

| Tool | Arguments | Returns |
|---|---|---|
| `sprite_quickstart` | – | Workflow, golden rules, tool/palette/generator/animation names |
| `sprite_policy` | – | Full read-only contract + integrity status |
| `sprite_verify_integrity` | – | `{clean, checked, changed[], missing[], message, policy}` |
| `sprite_catalog` | – | Generators, animations, palettes, export formats, draw ops |
| `sprite_list_palettes` | – | 12 palette definitions with colors and roles |

## Projects & palettes

| Tool | Key arguments |
|---|---|
| `sprite_new_project` | `name`, `id?`, `width?=32`, `height?=32`, `palette?="db32"`, `frames?=1`, `layers?=["art"]`, `durationMs?=100`, `tags?` |
| `sprite_list_projects` | – |
| `sprite_project_info` | `project?` |
| `sprite_select_project` | `project` |
| `sprite_delete_project` | `project` |
| `sprite_palette` | `name?`, `colors?[]`, `description?` — installs a built-in or custom palette |
| `sprite_layer` | `action`: add/remove/rename/show/hide/lock/unlock/opacity; `layer`, `newName?`, `opacity?`, `allFrames?` |

## Drawing

### `sprite_draw_grid`
`grid` (string or array of rows), `legend?`, `at?{x,y}`, `mirrorX?`, `mirrorY?`, `scale?`, `clear?=true`, `durationMs?`, `namePrefix?`, `frame?`, `layer?`.
`.`/space/`_`/`0` mean transparent. A line of `---` starts a new frame. Unknown characters leave existing pixels untouched. Omitting `legend` auto-maps characters to roles in first-appearance order.

### `sprite_draw_ops`
`ops[]`, `allFrames?`. Operations:

| op | fields |
|---|---|
| `clear` | – |
| `pixel` / `pixels` | `x`,`y` / `points:[[x,y,color?]]`, `color`, `size` |
| `rect` | `x,y,w,h,color`, `fill:false` for outline, `round?` |
| `line` | `x1,y1,x2,y2,color`, `thickness` |
| `circle` / `ellipse` | `cx,cy,r` or `rx,ry`, `color`, `fill?` |
| `polygon` | `points`, `color`, `fill?` |
| `fill` | `x,y,color` (4-way flood fill) |
| `dither` | `x,y,w,h,colorA,colorB,pattern:"bayer2|bayer4|checker",ratio` |
| `gradient` | `x,y,w,h,from,to,direction:"vertical|horizontal",steps` (palette ramp, no blending) |
| `noise` | `x,y,w,h,colors[],density,seed` |
| `scatter` | `x,y,w,h,count,color,seed` |
| `replace` | `from,color` |
| `outline` | `color`, `mode:"outside|inside|selective"`, `thickness` |
| `shade` | `light:"nw|ne|sw|se|n|s"`, `strength` — hue-shifted light/shadow |
| `mirror` | `axis:"x|y|both"` |
| `shift` | `dx,dy,wrap` |
| `text` | `x,y,text,color,scale` (3×5 font, A–Z 0–9 `!?.:-+/*<>%#`) |
| `crop` | `x,y,w,h` |

### `sprite_generate`
`kind`, `seed?`, `frames?`, `durationMs?`, `replace?=true`, `tags?`. Kinds: `hero`, `slime`, `potion`, `gem`, `chest`, `sword`, `shield`, `tree`, `mushroom`, `ghost`, `coin`, `star`, `torch`, `planet`, `cloud`, `heart`, `portrait`, `tile_grass`, `tile_stone`, `tile_brick`, `tile_water`, `tile_lava`.

## Frames & animation

| Tool | Key arguments |
|---|---|
| `sprite_frame` | `action`: add/duplicate/delete/rename/select/set_duration/tag/reorder; `frame`, `name`, `durationMs`, `tags`, `to`, `all` |
| `sprite_animate` | `preset` (14), `frames`, `durationMs`, `amplitude`, `seed`, `easing`, `sourceFrame`, `replace`, `tags` |
| `sprite_tween` | `from`, `to`, `steps`, `durationMs`, `pattern:"bayer|random"`, `seed`, `insert` |
| `sprite_timing` | `fps` / `durationMs` / `durations[]` / `perFrame{}` |
| `sprite_loop` | `mode:"pingpong|reverse|hold|deduplicate"`, `times` |

Presets: `idle_bob`, `walk_cycle`, `blink`, `pulse`, `squash_stretch`, `spin`, `shake`, `wave`, `flicker`, `explode`, `jump`, `glow`, `hue_cycle`, `float`.

## Art direction

| Tool | Key arguments | Returns |
|---|---|---|
| `sprite_enhance` | `despeckle`, `outline`, `shade`, `center`, `crop`, `limitColors`, `harmonize`, `mirrorX`, `light`, `allFrames` | before/after overall score + applied steps |
| `sprite_critique` | `project?` | 5 axis scores, grade S–D, metrics, concrete next tool calls |
| `sprite_inspect` | `frame?`, `maxWidth?` | ASCII grid + legend + histogram |

## Output

| Tool | Key arguments |
|---|---|
| `sprite_preview` | `frame` (index/name/`"all"`), `scale`, `columns`, `background`, `ascii` → **inline PNG** |
| `sprite_export` | `formats[]`, `name`, `dir`, `scale`, `background`, `padding`, `columns`, `atlas`, `loop`, `title` → files + inline sheet PNG |
| `sprite_gallery` | `name`, `dir`, `title`, `scale`, `background` → self-contained HTML player |
| `sprite_save_project` | `name`, `dir` → `.spriteproj.json` |
| `sprite_load_project` | `path` (relative to output root or absolute project JSON), `id`, `activate` |

Formats: `png`, `gif`, `apng`, `svg`, `spritesheet`, `gpl`, `css`, `json`, `gallery`, `all`.
Atlas flavours: `aseprite`, `phaser3`, `simple`, `godot`.

## Resources & prompts

Resources: `sprite://policy`, `sprite://guide/pixel-art`, `sprite://guide/animation`, `sprite://guide/tools`, `sprite://catalog`, `sprite://state`, `sprite://palettes/{name}`, `sprite://projects/{id}`, `sprite://frames/{index}`.
Prompts: `new_sprite`, `walk_cycle`, `tileset`, `critique_loop`, `arena_safety`.
