#!/usr/bin/env python3
"""Genera assets/icon.ico e assets/icon.png (icona app/tray/installer).

Disegnata con primitive Pillow (niente rasterizzazione SVG), così è riproducibile
ovunque. Render in 4x con downscale per bordi puliti.
"""

from pathlib import Path
from PIL import Image, ImageDraw

OUT = Path(__file__).resolve().parent.parent / 'assets'
OUT.mkdir(exist_ok=True)

S = 1024                      # canvas di lavoro (supersampling)
C1 = (91, 141, 239)          # #5b8def
C2 = (132, 92, 246)          # #845cf6


def _gradient(size: int, a, b) -> Image.Image:
    """Gradiente diagonale a → b."""
    base = Image.new('RGB', (size, size))
    px = base.load()
    for y in range(size):
        for x in range(size):
            t = (x + y) / (2 * (size - 1))
            px[x, y] = (
                int(a[0] + (b[0] - a[0]) * t),
                int(a[1] + (b[1] - a[1]) * t),
                int(a[2] + (b[2] - a[2]) * t),
            )
    return base


def build() -> Image.Image:
    grad = _gradient(S, C1, C2).convert('RGBA')

    # maschera squircle
    mask = Image.new('L', (S, S), 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, S - 1, S - 1], radius=int(S * 0.225), fill=255)

    icon = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    icon.paste(grad, (0, 0), mask)

    d = ImageDraw.Draw(icon)
    w = int(S * 0.052)        # spessore tratto
    white = (255, 255, 255, 255)

    # corpo fotocamera (rettangolo arrotondato)
    bx0, by0, bx1, by1 = S * 0.235, S * 0.345, S * 0.765, S * 0.695
    d.rounded_rectangle([bx0, by0, bx1, by1], radius=int(S * 0.05), outline=white, width=w)
    # gobbetta del mirino
    d.line([(S * 0.38, by0), (S * 0.44, S * 0.285), (S * 0.56, S * 0.285), (S * 0.62, by0)],
           fill=white, width=w, joint='curve')
    # obiettivo
    r = S * 0.105
    cx, cy = S * 0.5, S * 0.52
    d.ellipse([cx - r, cy - r, cx + r, cy + r], outline=white, width=w)

    return icon


def main() -> None:
    icon = build()
    png = icon.resize((256, 256), Image.LANCZOS)
    png.save(OUT / 'icon.png')
    sizes = [(s, s) for s in (16, 24, 32, 48, 64, 128, 256)]
    icon.resize((256, 256), Image.LANCZOS).save(OUT / 'icon.ico', sizes=sizes)
    print('Creati:', OUT / 'icon.png', '|', OUT / 'icon.ico')


if __name__ == '__main__':
    main()
