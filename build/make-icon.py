"""生成应用图标：build/icon.png (1024) + build/icon.ico (16–256 多尺寸)。

用法：python build/make-icon.py            生成图标
      python build/make-icon.py --preview  生成并在终端用字符预览 16/32/48/64

图形：圆角渐变底（靛蓝 → 紫）+ 放大镜（检索）+ 三个向量点（embedding）。

设计取舍：
  · 每个尺寸单独绘制，而不是"画 1024 再缩小"——16px 上的细线会被糊成一团；
  · 细节随尺寸递减（这是图标设计的常规做法）：
      16/24/32/48  只留放大镜环 + 手柄 + 中心点
      64           再加上三个向量点（去掉连线）
      128/256/1024  完整版：三个点 + 细连线
    这样任务栏、列表中是小而清楚的放大镜，大图标和 macOS 上才露出"embedding"细节。
"""

from __future__ import annotations

import io
import struct
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter

HERE = Path(__file__).resolve().parent
# 图标要落在 desktop/build，electron-builder 的 buildResources 指向那里
OUT = HERE.parent / "desktop" / "build"
OUT.mkdir(parents=True, exist_ok=True)

SIZE = 1024
BG_TOP = (79, 70, 229)      # indigo-600
BG_BOTTOM = (124, 58, 237)  # violet-600
WHITE = (255, 255, 255, 255)

# (尺寸, 细节级别)
FRAMES = [
    (16, "simple"),
    (24, "simple"),
    (32, "simple"),
    (48, "simple"),
    (64, "simple"),
    (128, "simple"),
    (256, "full"),
]


def lerp(a: int, b: int, t: float) -> int:
    return round(a + (b - a) * t)


def gradient(size: int) -> Image.Image:
    img = Image.new("RGB", (1, size))
    px = img.load()
    for y in range(size):
        t = y / max(size - 1, 1)
        px[0, y] = (
            lerp(BG_TOP[0], BG_BOTTOM[0], t),
            lerp(BG_TOP[1], BG_BOTTOM[1], t),
            lerp(BG_TOP[2], BG_BOTTOM[2], t),
        )
    return img.resize((size, size))


def rounded_mask(size: int) -> Image.Image:
    mask = Image.new("L", (size, size), 0)
    # 半径按比例走，但小尺寸至少留 2px 圆角，否则看起来像个歪方块
    radius = max(2, int(round(size * 0.225)))
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, size - 1, size - 1), radius=radius, fill=255)
    return mask


def background(size: int) -> Image.Image:
    canvas = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    base = gradient(size).convert("RGBA")

    # 顶部高光，让纯色不死板（小尺寸上加了反而脏，跳过）
    if size >= 64:
        glow = Image.new("L", (size, size), 0)
        gd = ImageDraw.Draw(glow)
        gd.ellipse((-size * 0.25, -size * 0.55, size * 1.25, size * 0.55), fill=70)
        glow = glow.filter(ImageFilter.GaussianBlur(size * 0.06))
        highlight = Image.new("RGBA", (size, size), (255, 255, 255, 0))
        highlight.putalpha(glow)
        base = Image.alpha_composite(base, highlight)

    base.putalpha(rounded_mask(size))
    canvas.alpha_composite(base)
    return canvas


def build(size: int, mode: str = "full") -> Image.Image:
    """按目标尺寸直接绘制。mode: simple | dots | full。"""
    canvas = background(size)
    draw = ImageDraw.Draw(canvas)
    s = size / 1024.0

    if mode == "simple":
        # —— 小尺寸：放大镜环 + 手柄 + 中心点 ——
        cx, cy = 0.43 * size, 0.43 * size
        r = 0.31 * size
        ring = max(1, int(round(0.10 * size)))
        draw.ellipse((cx - r, cy - r, cx + r, cy + r), outline=WHITE, width=ring)

        start = (cx + r * 0.60, cy + r * 0.60)
        end = (0.84 * size, 0.84 * size)
        draw.line((*start, *end), fill=WHITE, width=ring)
        cap = ring / 2.0
        for (x, y) in (start, end):
            draw.ellipse((x - cap, y - cap, x + cap, y + cap), fill=WHITE)

        if size >= 32:
            dot = max(1.0, 0.062 * size)
            draw.ellipse((cx - dot, cy - dot, cx + dot, cy + dot), fill=WHITE)
        return canvas

    # —— 中/大尺寸：放大镜 + 环内三个向量点（full 再加细连线）——
    cx, cy, r = 455 * s, 445 * s, 205 * s
    ring = max(1, int(round(74 * s)))
    draw.ellipse((cx - r, cy - r, cx + r, cy + r), outline=WHITE, width=ring)

    handle_w = max(1, int(round(86 * s)))
    hx1, hy1 = cx + r * 0.70, cy + r * 0.70
    hx2, hy2 = 790 * s, 780 * s
    draw.line((hx1, hy1, hx2, hy2), fill=WHITE, width=handle_w)
    for (x, y) in ((hx1, hy1), (hx2, hy2)):
        rr = handle_w / 2.0
        draw.ellipse((x - rr, y - rr, x + rr, y + rr), fill=WHITE)

    # 三个点向环心收 0.70 倍：原始坐标里有一点会压在环上，缩小后各级尺寸都不打架
    raw_dots = [(360, 380), (545, 340), (450, 545)]
    dots = [(cx + (x * s - cx) * 0.70, cy + (y * s - cy) * 0.70) for (x, y) in raw_dots]
    if mode == "full":
        lw = max(1, int(round(12 * s)))
        for i in range(len(dots)):
            for j in range(i + 1, len(dots)):
                draw.line((*dots[i], *dots[j]), fill=(255, 255, 255, 150), width=lw)

    # 点的大小随尺寸走：128 上约 4px 半径，256 上约 8px，不会糊成一团
    dot_r = max(1.5, 0.030 * size)
    for (x, y) in dots:
        draw.ellipse((x - dot_r, y - dot_r, x + dot_r, y + dot_r), fill=WHITE)

    return canvas


def png_bytes(image: Image.Image) -> bytes:
    buf = io.BytesIO()
    image.save(buf, format="PNG", optimize=True)
    return buf.getvalue()


def write_ico(path: Path, frames: list) -> None:
    """自己拼 ICO：每帧都是独立绘制的结果，全部用 PNG 压缩（Vista+ 支持）。"""
    payload = [(size, png_bytes(image)) for size, image in frames]

    header = struct.pack("<HHH", 0, 1, len(payload))
    entries = b""
    offset = 6 + 16 * len(payload)
    for size, data in payload:
        w = 0 if size >= 256 else size
        entries += struct.pack("<BBBBHHII", w, w, 0, 0, 1, 32, len(data), offset)
        offset += len(data)

    with open(path, "wb") as fh:
        fh.write(header)
        fh.write(entries)
        for _, data in payload:
            fh.write(data)


def preview(image: Image.Image, label: str) -> None:
    """在终端用字符画图标，直接看可读性（@ = 白色笔画，. = 渐变底）。"""
    size = image.width
    px = image.load()
    print(f"--- {label} ({size}x{size}) ---")
    for y in range(size):
        row = []
        for x in range(size):
            r, g, b, a = px[x, y]
            if a < 40:
                row.append(" ")
            elif r > 200 and g > 200 and b > 200:
                row.append("@")
            else:
                row.append(".")
        print("".join(row))


def main() -> None:
    master = build(SIZE, "full")
    png = OUT / "icon.png"
    master.save(png)

    ico = OUT / "icon.ico"
    frames = [(size, build(size, mode)) for size, mode in FRAMES]
    write_ico(ico, frames)

    print(f"wrote {png} ({png.stat().st_size // 1024} KB)")
    print(f"wrote {ico} ({ico.stat().st_size // 1024} KB, {len(frames)} frames)")

    if "--preview" in sys.argv:
        for size, mode in FRAMES:
            if size <= 128:
                preview(build(size, mode), f"{mode}/{size}")


if __name__ == "__main__":
    main()
