#!/usr/bin/env python3
"""
Regenerates the app icon set from one definition, so the launcher icon, the
adaptive Android layers, the splash mark and the favicon can never drift
apart.

The mark is the same geometry as `src/components/BrandMark.tsx`: a rounded
tile in muted clay, an upward arc that resolves into a dot, and a faint
baseline bar. Flat colour — no gradient.

Usage:  python3 scripts/generate-icons.py
Requires Pillow.  Re-run after changing BRAND.
"""
from pathlib import Path

from PIL import Image, ImageDraw

BRAND = (164, 86, 58)  # #A4563A — brand clay
WHITE = (255, 255, 255)
OUT = Path(__file__).resolve().parent.parent / "assets" / "images"

S = 1024          # master size
SS = 4            # supersample factor for smooth curves
R = 230           # corner radius at master size

# Arc control points (master coordinates), mirroring the SVG path.
ARC = [(250, 700), (330, 700), (420, 640), (480, 540), (540, 440), (610, 360), (720, 330)]
DOT = (744, 322, 70)
BAR = (250, 760, 774, 794, 17)


def bezier_points(pts, steps=240):
    """Samples the two cubic segments of the mark's arc."""
    out = []
    for seg in (pts[0:4], pts[3:7]):
        (x0, y0), (x1, y1), (x2, y2), (x3, y3) = seg
        for i in range(steps + 1):
            t = i / steps
            u = 1 - t
            out.append(
                (
                    u**3 * x0 + 3 * u**2 * t * x1 + 3 * u * t**2 * x2 + t**3 * x3,
                    u**3 * y0 + 3 * u**2 * t * y1 + 3 * u * t**2 * y2 + t**3 * y3,
                )
            )
    return out


def draw_mark(size, background, foreground, rounded=True, alpha_bar=0.35):
    """Draws the mark at `size`, supersampled then reduced."""
    big = size * SS
    scale = big / S
    img = Image.new("RGBA", (big, big), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)

    if background is not None:
        if rounded:
            d.rounded_rectangle([0, 0, big - 1, big - 1], radius=R * scale, fill=background)
        else:
            d.rectangle([0, 0, big - 1, big - 1], fill=background)

    # The stroke is drawn as a dense run of filled discs — a round pen. PIL's
    # line(joint="curve") leaves visible seams where the segments overlap.
    pts = [(x * scale, y * scale) for x, y in bezier_points(ARC, steps=900)]
    r = 46 * scale
    for x, y in pts:
        d.ellipse([x - r, y - r, x + r, y + r], fill=foreground)

    cx, cy, cr = (v * scale for v in DOT)
    d.ellipse([cx - cr, cy - cr, cx + cr, cy + cr], fill=foreground)

    if alpha_bar:
        bar = Image.new("RGBA", (big, big), (0, 0, 0, 0))
        bd = ImageDraw.Draw(bar)
        x0, y0, x1, y1, br = (v * scale for v in BAR)
        bd.rounded_rectangle([x0, y0, x1, y1], radius=br, fill=(*foreground, int(255 * alpha_bar)))
        img = Image.alpha_composite(img, bar)

    return img.resize((size, size), Image.LANCZOS)


def main():
    OUT.mkdir(parents=True, exist_ok=True)

    # iOS / web launcher icon: a full-bleed opaque square — iOS applies its own
    # corner mask, and a pre-rounded icon would show black corners.
    draw_mark(S, BRAND, WHITE, rounded=False).convert("RGB").save(OUT / "icon.png")

    # Android adaptive icon: flat background layer + transparent foreground.
    # The foreground is inset so the system's mask cannot clip the mark.
    Image.new("RGB", (S, S), BRAND).save(OUT / "android-icon-background.png")

    fg = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    mark = draw_mark(int(S * 0.62), None, WHITE, rounded=False)
    off = (S - mark.width) // 2
    fg.paste(mark, (off, off), mark)
    fg.save(OUT / "android-icon-foreground.png")

    mono = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    mark_mono = draw_mark(int(S * 0.62), None, (0, 0, 0), rounded=False, alpha_bar=0.35)
    mono.paste(mark_mono, (off, off), mark_mono)
    mono.save(OUT / "android-icon-monochrome.png")

    # Splash: transparent background, the splash screen supplies the colour.
    draw_mark(512, None, BRAND, rounded=False, alpha_bar=0).save(OUT / "splash-icon.png")

    draw_mark(48, BRAND, WHITE, rounded=True).save(OUT / "favicon.png")  # rounded: shown as-is in a tab

    print("Wrote icon.png, android-icon-{background,foreground,monochrome}.png, splash-icon.png, favicon.png")


if __name__ == "__main__":
    main()
