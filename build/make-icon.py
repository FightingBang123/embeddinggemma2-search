"""生成应用图标：build/icon.png (1024) + build/icon.ico (多尺寸)。

用法：python build/make-icon.py
图形：圆角渐变底 + 放大镜（检索）+ 三个向量点（embedding）。
"""
from __future__ import annotations

from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter

HERE = Path(__file__).resolve().parent
# 图标要落在 desktop/build，electron-builder 的 buildResources 指向那里
OUT = HERE.parent / "desktop" / "build"
OUT.mkdir(parents=True, exist_ok=True)
SIZE = 1024


def lerp(a: int, b: int, t: float) -> int:
    return round(a + (b - a) * t)


def gradient(size: int, top: tuple[int, int, int], bottom: tuple[int, int, int]) -> Image.Image:
    img = Image.new("RGB", (1, size))
    px = img.load()
    for y in range(size):
        t = y / max(size - 1, 1)
        px[0, y] = (lerp(top[0], bottom[0], t), lerp(top[1], bottom[1], t), lerp(top[2], bottom[2], t))
    return img.resize((size, size))


def rounded_mask(size: int, radius: int) -> Image.Image:
    mask = Image.new("L", (size, size), 0)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, size - 1, size - 1), radius=radius, fill=255)
    return mask


def build(size: int = SIZE) -> Image.Image:
    canvas = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    radius = int(size * 0.225)

    base = gradient(size, (79, 70, 229), (124, 58, 237)).convert("RGBA")
    # 顶部高光，让纯色不死板
    glow = Image.new("L", (size, size), 0)
    gd = ImageDraw.Draw(glow)
    gd.ellipse((-size * 0.25, -size * 0.55, size * 1.25, size * 0.55), fill=70)
    glow = glow.filter(ImageFilter.GaussianBlur(size * 0.06))
    highlight = Image.new("RGBA", (size, size), (255, 255, 255, 0))
    highlight.putalpha(glow)

    card = Image.alpha_composite(base, highlight)
    card.putalpha(rounded_mask(size, radius))
    canvas.alpha_composite(card)

    draw = ImageDraw.Draw(canvas)
    s = size / 1024.0

    # 放大镜：环 + 手柄
    cx, cy, r = 455 * s, 445 * s, 205 * s
    ring = 74 * s
    draw.ellipse((cx - r, cy - r, cx + r, cy + r), outline=(255, 255, 255, 255), width=int(ring))
    hx1, hy1, hx2, hy2 = 610 * s, 600 * s, 790 * s, 780 * s
    draw.line((hx1, hy1, hx2, hy2), fill=(255, 255, 255, 255), width=int(86 * s))
    for (x, y) in ((hx1, hy1), (hx2, hy2)):
        rr = 43 * s
        draw.ellipse((x - rr, y - rr, x + rr, y + rr), fill=(255, 255, 255, 255))

    # 环内三个向量点 + 细连线
    dots = [(360 * s, 380 * s), (545 * s, 340 * s), (450 * s, 545 * s)]
    lw = int(16 * s)
    for i in range(len(dots)):
        for j in range(i + 1, len(dots)):
            draw.line((*dots[i], *dots[j]), fill=(255, 255, 255, 140), width=lw)
    for (x, y) in dots:
        rr = 34 * s
        draw.ellipse((x - rr, y - rr, x + rr, y + rr), fill=(255, 255, 255, 255))

    return canvas


def main() -> None:
    icon = build()
    png = OUT / "icon.png"
    icon.save(png)
    ico = OUT / "icon.ico"
    icon.save(ico, sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)])
    print(f"wrote {png} ({png.stat().st_size // 1024} KB)")
    print(f"wrote {ico} ({ico.stat().st_size // 1024} KB)")


if __name__ == "__main__":
    main()
