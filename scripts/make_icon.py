"""Render the Verbosely icon (concept 6a, "bubble unfolds") to PNG.

Geometry is the canvas artboard's 128-unit SVG, drawn at 8x and downsampled so
edges are smooth. Usage: python -I make_icon.py <out_dir>
"""
import sys
from pathlib import Path

from PIL import Image, ImageDraw

S = 8  # supersampling factor: 128 units -> 1024 px
BG = (13, 17, 23, 255)  # #0d1117
BORDER = (42, 49, 64, 255)  # #2a3140
BUBBLE = (236, 238, 251, 255)  # #eceefb
VIOLET = (139, 123, 255, 255)  # #8b7bff
BLUE = (79, 156, 255, 255)  # #4f9cff
STEP = (166, 171, 192, 255)  # #a6abc0
STEP_DIM = (107, 112, 136, 255)  # #6b7088


def u(*values):
    return [v * S for v in values]


def lerp(a, b, t):
    return tuple(round(a[i] + (b[i] - a[i]) * t) for i in range(4))


def render(size):
    img = Image.new("RGBA", (128 * S, 128 * S), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)

    # Tile and its hairline border (keeps the edge visible on dark themes).
    d.rounded_rectangle(u(4, 4, 124, 124), radius=28 * S, fill=BG)
    d.rounded_rectangle(u(4.5, 4.5, 123.5, 123.5), radius=27.5 * S, outline=BORDER, width=S)

    # Speech bubble: a pill with a tail at the bottom left.
    d.rounded_rectangle(u(22, 20, 106, 54), radius=17 * S, fill=BUBBLE)
    d.polygon([tuple(u(46, 53)), tuple(u(46, 54)), tuple(u(36, 63)), tuple(u(36, 53))], fill=BUBBLE)
    d.rounded_rectangle(u(34, 32.5, 80, 41.5), radius=4.5 * S, fill=VIOLET)

    # Thread from the tail down through the steps, white fading to violet.
    x, y0, y1, half = 36 * S, 63 * S, 96 * S, 2.5 * S
    for y in range(y0, y1 + 1):
        t = (y - 56 * S) / (48 * S)
        d.line([(x - half, y), (x + half, y)], fill=lerp(BUBBLE, VIOLET, max(0, min(1, t))))
    d.ellipse([x - half, y1 - half, x + half, y1 + half], fill=VIOLET)

    # Steps: a dot on the thread and a label bar beside it.
    for cy, dot, bar_w, bar in ((76, BLUE, 48, STEP), (98, VIOLET, 34, STEP_DIM)):
        d.ellipse(u(36 - 6.5, cy - 6.5, 36 + 6.5, cy + 6.5), fill=dot)
        d.rounded_rectangle(u(50, cy - 4.5, 50 + bar_w, cy + 4.5), radius=4.5 * S, fill=bar)

    return img.resize((size, size), Image.LANCZOS)


out = Path(sys.argv[1])
render(256).save(out / "icon.png")
render(128).save(out / "icon-128.png")
print("wrote", out / "icon.png", "and icon-128.png")
