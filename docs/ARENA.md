# Dùng với Arena.ai Agent Mode

> Mục đích của repo này: biến AI trong [arena.ai/agent](https://arena.ai/agent) thành một hoạ sĩ pixel art thực thụ — **mà không bao giờ sửa code repo**.

## 1. Kết nối (con người làm 1 lần)

Trong phần **Connectors / MCP servers** của Arena Agent Mode, thêm server stdio:

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

Hoặc chạy remote rồi trỏ tới URL do môi trường preview cung cấp:

```bash
npx -y sprite-agent-mcp --http --port 3100
# POST /mcp · GET /health
```

Nếu Arena của bạn dùng cấu hình dạng `{"servers": {...}}` (VS Code style), xem [`mcp.json`](../mcp.json).

## 2. "Hợp đồng" dán vào prompt (rất quan trọng)

Arena Agent có xu hướng **sửa code trong repo đang làm việc**. Hãy dán đoạn này vào đầu mỗi tác vụ:

```
BẮT BUỘC: sprite-agent-mcp là repo CHỈ-ĐỌC. Chỉ gọi các MCP tool sprite_*.
KHÔNG đọc/sửa/tạo/xoá file, KHÔNG chạy npm/git/shell, KHÔNG thêm dependency/config/test/docs.
Nếu tool báo lỗi → đổi arguments rồi gọi lại, không sửa server.
Bắt đầu bằng sprite_quickstart, kết thúc bằng sprite_verify_integrity.
```

Hoặc dùng MCP prompt `arena_safety` / resource `sprite://policy` / tool `sprite_policy`.

Có 3 lớp bảo vệ nếu agent vẫn cố sửa:
1. `AGENTS.md`, `POLICY.md`, `.cursor/rules/...`, `.github/copilot-instructions.md` — các file quy ước mà agent thường tự đọc.
2. **Write guard**: tool chỉ ghi được vào `sprite-output/`; mọi đường vào `src/`, `scripts/`, config đều bị `PolicyError`.
3. **Integrity**: `sprite_verify_integrity` so SHA-256 → nếu `clean:false`, agent phải dừng và báo con người.

## 3. Prompt mẫu (copy-paste)

### Nhân vật + idle loop
```
Dùng sprite-agent-mcp vẽ hiệp sĩ rừng 32×32, palette endesga32, ánh sáng tây-bắc,
outline chọn lọc, 6 khung idle 8fps. Xuất PNG/GIF/APNG/spritesheet (atlas Aseprite)
và gallery HTML. Chỉ gọi MCP tools, không sửa code. Cuối cùng gọi sprite_verify_integrity.
```

### Tileset + animation nước
```
Tạo tileset nước 16×16 seamless 4 khung với sprite_generate{kind:"tile_water"},
xuất spritesheet padding 1 + GIF, rồi cho tôi xem sprite_preview{frame:"all"}.
```

### Icon từ ASCII (không dùng generator)
```
Vẽ tim 16×16 bằng sprite_draw_grid với legend {O:"outline",R:"accent"},
thêm shade + outline, animate preset "pulse" 4 khung, xuất mọi định dạng.
```

### Vòng lặp tự cải thiện
```
Gọi sprite_critique, sửa theo từng gợi ý bằng sprite_enhance/sprite_draw_ops,
sprite_preview để nhìn ảnh, lặp tối đa 4 lần tới khi grade ≥ A, rồi sprite_export{formats:["all"]}.
```
(hoặc dùng prompt `critique_loop`)

## 4. Agent "nhìn" ảnh thế nào?

`sprite_preview` trả về MCP content block kiểu:

```json
{ "type": "image", "mimeType": "image/png", "data": "<base64>" }
```

Arena Agent có thị giác sẽ thấy trực tiếp sprite trong kết quả tool → tự sửa bố cục/màu ở lượt tiếp theo. Với model chỉ đọc text: `sprite_inspect` trả ASCII grid + legend, `sprite://frames/{index}` cũng vậy.

## 5. Kết quả nhận được

Mọi file nằm trong `SPRITE_OUTPUT_DIR` (mặc định `./sprite-output`):

```
sprite-output/
├── <tên>_frame_00.png …       PNG từng khung
├── <tên>.gif                   animation
├── <tên>_animated.png          APNG lossless
├── <tên>.svg                   SVG động
├── <tên>_sheet.png             spritesheet
├── <tên>_atlas.json            Aseprite / Phaser 3
├── <tên>.gpl / .css / .spriteproj.json
└── <tên>_gallery.html          player tự chứa, mở là chạy ngay
```

`gallery.html` có phát lại, onion skin, zoom, swatch palette, tag khung hình — **không cần network**, mở trực tiếp trong workspace preview của Arena.

## 6. Xử lý sự cố

| Triệu chứng | Cách xử lý (chỉ đổi arguments) |
|---|---|
| `grid is 40×40 but canvas is 32×32` | Giảm grid, bỏ `scale`, hoặc `sprite_new_project` to hơn |
| `Unknown palette "x"` | `sprite_list_palettes` rồi dùng đúng tên |
| `Unknown generator "x"` | `sprite_catalog` |
| `Frame 5 does not exist` | `sprite_project_info` để xem số khung |
| `POLICY refusing to write ...` | Dùng đường dẫn tương đối trong output root, không `..`, không absolute |
| `Integrity MODIFIED` | **DỪNG**, báo con người `git checkout -- .` |

## 7. Vì sao dự án "dành riêng cho Arena Agent"?

- Tool description được viết như **hướng dẫn cho model** (có ví dụ, có "Next: ..." sau mỗi tool).
- ASCII grid + vai trò màu phù hợp với cách LLM sinh nội dung.
- Ảnh inline + `sprite_critique` tạo vòng lặp tự cải thiện.
- Chính sách chống sửa code được **mã hoá**, vì đây là lỗi phổ biến nhất của agent trong Arena.
- Không có bước build/cài đặt nào trong quy trình của agent: `npx` là đủ.
