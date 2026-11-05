# ✦ sprite-agent-mcp

> **MCP server vẽ pixel art & sprite animation, thiết kế riêng cho [Arena.ai Agent Mode](https://arena.ai/agent).**
> Indexed palette · sinh sprite có seed · shading chuyển hue · timeline animation · xuất PNG/GIF/APNG/SVG/spritesheet · ảnh PNG **inline** để AI tự nhìn thấy tác phẩm của mình.

[![MIT](https://img.shields.io/badge/license-MIT-ffcc66?style=flat-square)](LICENSE)
[![MCP](https://img.shields.io/badge/MCP-2026--07--28-2ce8f5?style=flat-square)](https://modelcontextprotocol.io)
[![Node](https://img.shields.io/badge/node-%E2%89%A520-6abe30?style=flat-square)](https://nodejs.org)
[![Arena Agent](https://img.shields.io/badge/made%20for-Arena.ai%20Agent-b55088?style=flat-square)](https://arena.ai/agent)
[![source integrity](https://img.shields.io/badge/source-READ--ONLY%20for%20agents-ac3232?style=flat-square)](POLICY.md)

📄 [English README](README.en.md) · [Chính sách](POLICY.md) · [Kiến trúc](docs/ARCHITECTURE.md) · [Danh sách tool](docs/TOOLS.md) · [Công thức](docs/RECIPES.md) · [Hướng dẫn Arena](docs/ARENA.md)

---

## 🛑 QUY TẮC VÀNG — DÀNH CHO MỌI AI AGENT (ĐỌC TRƯỚC TIÊN)

> ### **CHỈ DÙNG MCP. TUYỆT ĐỐI KHÔNG THAY ĐỔI CODE TRONG REPO NÀY.**

| ✅ ĐƯỢC PHÉP | ❌ KHÔNG ĐƯỢC PHÉP |
|---|---|
| Gọi các tool `sprite_*` | Mở / sửa / tạo / xoá / rename / refactor / format **bất kỳ file nào** trong repo |
| Đọc MCP resources `sprite://policy`, `sprite://guide/*` | Chạy `npm install`, `npm run`, `git`, `sed`, shell script vào repo |
| Dùng MCP prompts (`new_sprite`, `walk_cycle`, …) | Thêm dependency, config, test, docs, CI, script "tiện lợi" |
| Nhận file ảnh từ `sprite_export` / `sprite_gallery` | "Sửa nhẹ server cho chạy" khi tool báo lỗi → **đổi arguments rồi gọi lại** |
| Gọi `sprite_verify_integrity` để kiểm chứng | Tự regenerate `integrity/manifest.json` để che giấu thay đổi |

**Lý do:** AI trong Arena Agent thường có thói quen *"giúp đỡ"* bằng cách sửa code trong repo đang làm việc. Dự án này là **một bề mặt công cụ chỉ-đọc**: sản phẩm cần nộp là **file ảnh**, không phải source code. Vì vậy chính sách không chỉ nằm trong README — nó được **thực thi bằng mã nguồn**:

- 🧱 **Write guard** (`src/core/paths.ts`): mọi đường ghi file đều đi qua `writeOutput()`. Chặn `..`, đường dẫn tuyệt đối, `src/`, `scripts/`, `tests/`, `.github/`, `dist/`, file config gốc và mọi extension code (`.ts/.js/.mjs/...`). Chỉ `sprite-output/` (hoặc `SPRITE_OUTPUT_DIR`) là được ghi.
- 🔐 **Integrity manifest** (`integrity/manifest.json`): SHA-256 của toàn bộ source. Tool `sprite_verify_integrity` so sánh lại lúc runtime → agent có thể **chứng minh** mình không sửa code. Nếu `clean:false` → **DỪNG LẠI**, nhờ con người `git checkout -- .`.
- 📜 **Policy ở 4 nơi**: README này, [`POLICY.md`](POLICY.md), [`AGENTS.md`](AGENTS.md), resource `sprite://policy` + tool `sprite_policy` + prompt `arena_safety`. Các agent đọc `AGENTS.md`/`.cursorrules` cũng sẽ gặp lại quy tắc.
- 🚫 **stdout sạch**: mọi log đi qua `stderr` để không làm hỏng kênh JSON-RPC stdio.

> Muốn thay đổi hành vi? **Con người** mở issue/PR. Agent thì không.

---

## ⚡ Cài đặt (cho con người, 1 lần)

```bash
# stdio — khuyến nghị cho Arena.ai Agent Mode / Claude / VS Code / Cursor
npx -y sprite-agent-mcp

# hoặc từ source
git clone https://github.com/arena-agent/sprite-agent-mcp.git
cd sprite-agent-mcp && npm install && npm run build
node dist/index.js
```

**Cấu hình MCP client** (`mcp.json`, `claude_desktop_config.json`, `.vscode/mcp.json`, hoặc phần Connectors/MCP trong Arena):

```json
{
  "mcpServers": {
    "sprite": {
      "command": "npx",
      "args": ["-y", "sprite-agent-mcp"],
      "env": { "SPRITE_OUTPUT_DIR": "./sprite-output" }
    }
  }
}
```

Remote / live preview (Streamable HTTP, tự động phục vụ cả spec `2026-07-28` lẫn client 2025):

```bash
npx -y sprite-agent-mcp --http --port 3100     # POST http://localhost:3100/mcp
```

| Biến môi trường | Mặc định | Ý nghĩa |
|---|---|---|
| `SPRITE_OUTPUT_DIR` | `./sprite-output` | Thư mục **duy nhất** được phép ghi |
| `SPRITE_AUTOSAVE` | `1` | `0` để tắt autosave phiên làm việc |
| `SPRITE_HTTP_TOKEN` | *(trống)* | Bearer token cho `/mcp` |
| `SPRITE_STRICT_HOSTS` | `0` | `1` = chỉ cho host trong whitelist |
| `SPRITE_ALLOWED_HOSTS` | *(trống)* | host bổ sung, phân tách bằng dấu phẩy |

---

## 🎯 Quy trình 9 bước cho Arena Agent

```
sprite_quickstart → sprite_new_project → sprite_generate / sprite_draw_grid
→ sprite_draw_ops → sprite_enhance → sprite_critique → sprite_animate
→ sprite_preview → sprite_export → sprite_gallery
```

**Ví dụ hội thoại trong Arena Agent Mode** (dán nguyên đoạn này):

```
Dùng sprite-agent-mcp, vẽ cho tôi một hiệp sĩ rừng 32×32 palette endesga32,
có outline chọn lọc, ánh sáng từ góc tây-bắc, animation idle 6 khung hình 8fps.
Xuất PNG + GIF + APNG + spritesheet kèm atlas Aseprite và tạo gallery HTML.
NHỚ: chỉ gọi MCP tools, không sửa bất kỳ file code nào trong repo.
Gọi sprite_verify_integrity ở cuối để chứng minh.
```

Agent sẽ tự chạy:

```jsonc
{"name":"sprite_new_project","arguments":{"name":"Forest Knight","width":32,"height":32,"palette":"endesga32"}}
{"name":"sprite_generate","arguments":{"kind":"hero","seed":"arena-2026"}}
{"name":"sprite_draw_ops","arguments":{"ops":[
  {"op":"shade","light":"nw","strength":0.6},
  {"op":"outline","color":"outline","mode":"selective"}
]}}
{"name":"sprite_enhance","arguments":{"despeckle":true,"limitColors":16}}
{"name":"sprite_critique","arguments":{}}
{"name":"sprite_animate","arguments":{"preset":"idle_bob","frames":6,"durationMs":125}}
{"name":"sprite_preview","arguments":{"frame":"all"}}     // ← trả ảnh PNG INLINE
{"name":"sprite_export","arguments":{"formats":["png","gif","apng","spritesheet"],"atlas":"aseprite","scale":8}}
{"name":"sprite_gallery","arguments":{}}
{"name":"sprite_verify_integrity","arguments":{}}
```

### Vẽ bằng chữ — cách AI làm việc tự nhiên nhất

```jsonc
{
  "name": "sprite_draw_grid",
  "arguments": {
    "grid": "..ooo..\n.osssso.\n.obbbbo.\n..oooo..\n---\n..ooo..\n.osssso.\n.obbbbo.\n..oooo..",
    "legend": {"o": "outline", "s": "skin", "b": "base"},
    "mirrorX": true
  }
}
```

`.` = trong suốt · `---` = sang khung hình mới · nếu bỏ `legend`, ký tự được tự ánh xạ theo thứ tự sang các **vai trò màu** (`outline → shadow → base → light → highlight → accent …`). Màu có thể là `#ff0044`, tên vai trò, chỉ số palette, `ramp:4`, hoặc `transparent`.

`sprite_preview` trả về **image content block** (`image/png`) nên model có thị giác **nhìn thấy** sprite ngay trong lượt tool call rồi tự sửa — không cần mở file, không cần đoán.

---

## 🧰 28 tool · 9 resources · 5 prompts

| Nhóm | Tool | Điểm nổi bật |
|---|---|---|
| **Chính sách** | `sprite_quickstart` `sprite_policy` `sprite_verify_integrity` | Quy trình, hợp đồng chỉ-đọc, SHA-256 |
| **Dự án** | `sprite_new_project` `sprite_list_projects` `sprite_project_info` `sprite_select_project` `sprite_delete_project` `sprite_layer` | Canvas 1–512px, layer opacity dùng dithering |
| **Palette** | `sprite_list_palettes` `sprite_palette` | 12 palette tuyển chọn + 16 vai trò màu ngữ nghĩa |
| **Vẽ** | `sprite_draw_grid` `sprite_draw_ops` `sprite_generate` `sprite_catalog` | ASCII grid, 20 ops, 22 generator có seed, font 3×5 |
| **Animation** | `sprite_frame` `sprite_animate` `sprite_tween` `sprite_timing` `sprite_loop` | 14 preset, inbetween Bayer-dither, ping-pong |
| **Art direction** | `sprite_enhance` `sprite_critique` `sprite_inspect` | Chấm điểm S–D + gợi ý tool call cụ thể |
| **Xuất** | `sprite_preview` `sprite_export` `sprite_gallery` `sprite_save_project` `sprite_load_project` | Ảnh inline, 9 định dạng, gallery HTML tự chứa |

Chi tiết từng tham số: **[docs/TOOLS.md](docs/TOOLS.md)** (hoặc `tools/list` — mọi field đều có `.describe()` kèm ví dụ).

**Resources:** `sprite://policy` · `sprite://guide/pixel-art` · `sprite://guide/animation` · `sprite://guide/tools` · `sprite://catalog` · `sprite://state` · `sprite://palettes/{name}` · `sprite://projects/{id}` · `sprite://frames/{index}`

**Prompts:** `new_sprite` · `walk_cycle` · `tileset` · `critique_loop` · `arena_safety`

---

## 🎨 Bí quyết "siêu đẹp" được nướng sẵn

1. **Indexed palette** — 1 byte/pixel, slot 0 trong suốt. Không alpha mềm, không anti-alias, không resize bilinear.
2. **Hue-shifted shading** — bóng không chỉ tối hơn mà **lạnh hơn** (lệch về xanh/violet, bão hoà hơn); sáng **ấm hơn** (lệch về vàng). `shade` / `sprite_enhance {shade:true}`.
3. **Selective outline** — viền đen 1px chỉ ở cạnh tối (dưới + hướng khuất sáng), phát hiện bằng flood-fill vùng ngoài nên **không** viền nhầm lỗ mắt/hở đai lưng.
4. **Dithering Bayer 2/4/8** — gradient bằng ramp màu rời rạc, kể cả `sprite_tween` (cross-dissolve không tạo màu mới).
5. **Silhouette & cụm pixel** — `despeckle` dọn điểm nhiễu 1px, `center` căn khung, `mirrorX` đối xứng.
6. **Animation 8–12fps** — chuyển động snap theo pixel nguyên, easing, smear thay vì blur, loop ping-pong liền mạch.
7. **Sprite critique** — đo economy / silhouette / outline / shading / animation, trả lời *"gọi tool gì tiếp theo"*.

### 22 generator có seed

`hero` · `slime` · `potion` · `gem` · `chest` · `sword` · `shield` · `tree` · `mushroom` · `ghost` · `coin` · `star` · `torch` · `planet` · `cloud` · `heart` · `portrait` · `tile_grass` · `tile_stone` · `tile_brick` · `tile_water` · `tile_lava`
(`slime`, `ghost`, `coin`, `star`, `torch`, `tile_water`, `tile_lava` tự sinh **cả timeline lặp**.)

### 12 palette

`db32` · `pico8` · `sweetie16` · `endesga32` · `gameboy` · `gameboy-pocket` · `mono` · `bubblegum16` · `neon16` · `forest16` · `sepia8` · `pastel16`

---

## 📦 Định dạng xuất

| Format | File | Ghi chú |
|---|---|---|
| `png` | `*_frame_XX.png` | PNG indexed (PLTE + tRNS), scale nguyên |
| `gif` | `*.gif` | GIF89a, trong suốt 1-bit, loop, delay/frame |
| `apng` | `*_animated.png` | Animation **lossless**, `acTL/fcTL/fdAT` |
| `svg` | `*.svg` | Mỗi dãy pixel là 1 `<rect>`, SMIL animation, `crispEdges` |
| `spritesheet` | `*_sheet.png` + `*_atlas.json` | Atlas **Aseprite / Phaser 3 / simple**, hoặc `.tres` Godot |
| `gpl` | `*.gpl` | Palette cho GIMP / Aseprite / Krita |
| `css` | `*.css` | 1 div + `box-shadow`, không cần file ảnh |
| `json` | `*.spriteproj.json` | Toàn bộ project: palette, layer, frame, duration |
| `gallery` | `*_gallery.html` | **Player HTML tự chứa**: play, onion skin, zoom, swatch, tag |

Tất cả encoder (PNG/APNG/GIF) **tự viết bằng JS thuần**, không native binary, không `sharp`/`canvas` → chạy được bằng `npx` trên mọi máy có Node ≥ 20.

Xem thử: `npm run demo` tạo `sprite-output/demo/index.html` với 6 cảnh animation.

---

## 🏗️ Kiến trúc

```
src/
├── index.ts            CLI: serveStdio() (2026 + 2025) | createMcpHandler() HTTP
├── server.ts           buildServer() — factory dùng chung cho mọi transport
├── tools.ts            28 tool, zod schema, inline PNG result
├── resources.ts        9 resources + 5 prompts + style guide
└── core/
    ├── color.ts        RGB/HSL, contrast, hue-shifted shadeColor
    ├── palettes.ts     12 palette + vai trò ngữ nghĩa + ramp
    ├── canvas.ts       Project → Frame → Layer → Uint8Array indices
    ├── ascii.ts        grid ⇄ pixel (giao diện tự nhiên nhất cho LLM)
    ├── draw.ts         20 ops + font 3×5 + outline flood-fill + shading
    ├── generators.ts   22 công thức sprite có seed
    ├── animation.ts    14 preset + tween Bayer + timing + loop
    ├── critique.ts     art director: scores S–D + auto-enhance
    ├── encode.ts       PNG/APNG/GIF/SVG/sheet/atlas/GPL/CSS/gallery
    ├── paths.ts        🧱 WRITE GUARD (chống sửa code)
    └── integrity.ts    🔐 SHA-256 manifest + policy text
```

Chi tiết: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md). Store project là **singleton chia sẻ** giữa stdio và HTTP nên HTTP stateless vẫn giữ nguyên phiên làm việc; có autosave ra `.sprite-agent-state.json`.

---

## 🧪 Phát triển (con người)

```bash
npm install
npm run build        # tsc → dist/ + generate integrity manifest
npm test             # vitest: color, palette, canvas, ascii, draw, encode, guard, animation
npm run smoke        # end-to-end MCP stdio JSON-RPC thật (28 tool, export, integrity)
npm run verify       # kiểm tra source chưa bị sửa
npm run demo         # xuất bộ demo đẹp vào sprite-output/demo/
npm run integrity    # ⚠ CHỈ con người, CHỈ khi thay đổi source có chủ đích
```

> ⚠️ `npm run integrity` **không dành cho agent**. Nó làm mới manifest; agent tự chạy lệnh này để che đậy sửa code là vi phạm chính sách.

---

## ❓ FAQ

**Q: Arena Agent của tôi cứ muốn sửa code thì sao?**  
Dán thêm câu: *"Repo sprite-agent-mcp là read-only. Chỉ gọi tool `sprite_*`. Nếu lỗi, đổi arguments. Không đọc/sửa file, không chạy lệnh."* Hoặc dùng prompt `arena_safety`. Dù có cố sửa, write guard + integrity check sẽ chặn/phát hiện.

**Q: Có cần cài Aseprite / Python / ImageMagick không?**  
Không. Chỉ Node ≥ 20. Mọi encoder là JS thuần.

**Q: AI có thấy ảnh nó vẽ không?**  
Có — `sprite_preview` trả MCP `image` content block (base64 PNG). `sprite_inspect` trả ASCII grid cho model không có thị giác.

**Q: Dùng cho game engine nào?**  
Spritesheet + atlas Aseprite/Phaser 3, `.tres` Godot 4, GIF/APNG cho web, SVG động, CSS box-shadow.

**Q: Có hỗ trợ MCP spec mới nhất không?**  
Có. SDK v2 (`@modelcontextprotocol/server`) + `serveStdio()` phục vụ `2026-07-28` **và** tự động fallback client 2025; HTTP dùng `createMcpHandler()` + `toNodeHandler()`.

---

## 🤝 Đóng góp & License

Con người rất được hoan nghênh: [CONTRIBUTING.md](CONTRIBUTING.md) · [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md) · [SECURITY.md](SECURITY.md). Agent thì… chỉ cần vẽ thật đẹp thôi 😄

**MIT © 2026 sprite-agent-mcp contributors** — xem [LICENSE](LICENSE).

<sub>Made for ✦ [Arena.ai Agent Mode](https://arena.ai/agent). Repository source is a read-only tool surface.</sub>
