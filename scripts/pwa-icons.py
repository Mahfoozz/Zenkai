"""Regenerates the install icons in public/icons/ from docs/logo.svg (the shapes below mirror that file).
Run: python3 scripts/pwa-icons.py   (needs Pillow)"""
import math
import os
from PIL import Image, ImageDraw

SS = 4  # supersample, then downscale for clean edges
BG, RED, WHITE = (5, 5, 6, 255), (232, 41, 76, 255), (255, 255, 255, 255)
OUT = 'public/icons'

# --- docs/logo.svg geometry, in its 256x256 viewBox
k = math.tan(math.radians(-10))
Z = [(62, 80), (190, 80), (190, 104), (108, 152), (190, 152), (190, 176), (62, 176), (62, 152), (144, 104), (62, 104)]
Z = [(x + k * y + 30, y) for x, y in Z]  # translate(30 0) skewX(-10)
SLASH = [(x - 6, y) for x, y in [(190, 56), (106, 200), (121, 200), (205, 56)]]  # translate(-6 0)

# scaled about the tile centre, so glyph=1 is the SVG exactly
reach = max(math.hypot(x - 128, y - 128) for x, y in Z + SLASH)  # farthest corner from the centre


def render(size, rounded, glyph):
    """rounded: rx like the SVG (transparent corners) or a full-bleed square. glyph: scale vs the SVG."""
    S = size * SS
    u = S / 256
    img = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    if rounded:
        d.rounded_rectangle((0, 0, S - 1, S - 1), 56 * u, fill=BG)
    else:
        d.rectangle((0, 0, S, S), fill=BG)
    place = lambda poly: [((128 + (x - 128) * glyph) * u, (128 + (y - 128) * glyph) * u) for x, y in poly]
    d.polygon(place(Z), fill=RED)
    d.polygon(place(SLASH), fill=WHITE)
    return img.resize((size, size), Image.LANCZOS)


# maskable: launchers crop to a circle of radius 40% of the icon, so keep every corner inside ~38%
safe = 0.38 * 256 / reach

os.makedirs(OUT, exist_ok=True)
render(192, True, 1).save(f'{OUT}/icon-192.png', optimize=True)
render(512, True, 1).save(f'{OUT}/icon-512.png', optimize=True)
render(512, False, safe).save(f'{OUT}/maskable-512.png', optimize=True)
# iOS rounds the corners itself and turns transparency black, so: full-bleed with a little air
render(180, False, 0.86).convert('RGB').save(f'{OUT}/apple-touch-icon.png', optimize=True)
print('ok')
