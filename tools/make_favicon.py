# The site's icon: the gap between four rounded stones (the building's window), lit, on the
# dark ink of the site. Writes favicon.svg, favicon.ico (16/32/48) and apple-touch-icon.png.
import numpy as np
from PIL import Image

INK = (22, 20, 15)          # --ink
LIT = (255, 208, 143)       # a lit window, as in the game
STAR = 50 / 64              # tip to tip, as a share of the icon
RADIUS = 14 / 64            # corner radius of the tile


def tile(size, star=STAR, radius=RADIUS, ss=8):
    n = size * ss
    y, x = (np.mgrid[0:n, 0:n].astype(np.float64) + 0.5) / ss
    c = size / 2
    if radius > 0:
        r = radius * size
        dx = np.maximum(np.abs(x - c) - (c - r), 0)
        dy = np.maximum(np.abs(y - c) - (c - r), 0)
        bg = (dx * dx + dy * dy) <= r * r
    else:
        bg = np.ones_like(x, dtype=bool)
    R = star * size / 2
    u, v = np.abs(x - c), np.abs(y - c)
    st = (u < R) & (v < R) & ((u - R) ** 2 + (v - R) ** 2 > R * R)   # outside the four stones
    rgba = np.zeros((n, n, 4), np.float64)
    rgba[bg] = (*INK, 255)
    rgba[st & bg] = (*LIT, 255)
    im = Image.fromarray(rgba.astype(np.uint8), 'RGBA')
    return im.resize((size, size), Image.Resampling.BOX)


tile(256).save('favicon.ico', sizes=[(16, 16), (32, 32), (48, 48)])
tile(180, star=0.6, radius=0).convert('RGB').save('apple-touch-icon.png', optimize=True)
open('favicon.svg', 'w', encoding='utf-8', newline='\n').write(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">'
    '<rect width="64" height="64" rx="14" fill="#16140f"/>'
    '<path d="M57 32A25 25 0 0 0 32 57A25 25 0 0 0 7 32A25 25 0 0 0 32 7A25 25 0 0 0 57 32Z" fill="#ffd08f"/>'
    '</svg>\n')
# a sheet to look at the icon at the sizes a browser shows it
sheet = Image.new('RGB', (360, 120), (237, 231, 219))
dark = Image.new('RGB', (180, 120), (40, 40, 44)); sheet.paste(dark, (180, 0))
for i, s in enumerate((16, 32, 48)):
    t = tile(s)
    for ox in (10, 190):
        sheet.paste(t, (ox + i * 56, 60 - s // 2), t)
sheet = sheet.resize((1080, 360), Image.Resampling.NEAREST)
sheet.save('_preview/favicon-sheet.png')
print('ok')
