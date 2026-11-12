# Generates the tileable textures the Blender model uses.
# Run with the system Python (needs Pillow):  python tools/textures.py <out_dir>
import math, os, random, sys
from PIL import Image, ImageDraw, ImageFilter

out = sys.argv[1] if len(sys.argv) > 1 else 'tools/tex'
os.makedirs(out, exist_ok=True)
rnd = random.Random(7)

# ---------------------------------------------------------------- limestone slabs
# 2048 px = 8.4 m. Courses 0.7 m high, slabs 0.7–1.6 m long, rounded corners.
S = 2048
M = S / 8.4                       # px per metre
img = Image.new('RGB', (S, S), (168, 158, 140))      # concrete in the joints
rough = Image.new('L', (S, S), 235)
d, dr = ImageDraw.Draw(img), ImageDraw.Draw(rough)
rows = 12
h = S / rows
for r in range(rows):
    y0 = r * h
    x = -rnd.uniform(0, 1.0) * M
    while x < S:
        w = rnd.choice([0.7, 0.95, 1.2, 1.6]) * M
        t = rnd.random()
        col = (int(222 + 16 * t), int(213 + 15 * t), int(193 + 15 * t))
        rad = h * 0.3
        for off in (0, -S, S):    # wrap horizontally so the texture tiles
            box = (x + 3 + off, y0 + 3, x + w - 3 + off, y0 + h - 3)
            if box[2] < 0 or box[0] > S:
                continue
            d.rounded_rectangle(box, radius=rad, fill=col)
            dr.rounded_rectangle(box, radius=rad, fill=int(200 + 30 * rnd.random()))
        x += w
# tooling / pores
px = img.load()
for _ in range(260000):
    xx, yy = rnd.randrange(S), rnd.randrange(S)
    c = px[xx, yy]
    k = rnd.choice((-14, -8, 6, 10))
    px[xx, yy] = (max(0, min(255, c[0] + k)), max(0, min(255, c[1] + k)), max(0, min(255, c[2] + k)))
img = img.filter(ImageFilter.GaussianBlur(0.6))
img.save(os.path.join(out, 'stone.jpg'), quality=88)
rough.save(os.path.join(out, 'stone_rough.png'))

# ---------------------------------------------------------------- roof paving (finer, flatter)
R = 1024
roof = Image.new('RGB', (R, R), (196, 188, 172))
d = ImageDraw.Draw(roof)
n = 16
for j in range(n):
    for i in range(n):
        t = rnd.random()
        col = (int(214 + 14 * t), int(206 + 13 * t), int(188 + 13 * t))
        d.rounded_rectangle((i * R / n + 2, j * R / n + 2, (i + 1) * R / n - 2, (j + 1) * R / n - 2), radius=R / n * 0.18, fill=col)
roof.save(os.path.join(out, 'roof.jpg'), quality=88)

# ---------------------------------------------------------------- photovoltaic modules
P = 512
pv = Image.new('RGB', (P, P), (18, 24, 34))
d = ImageDraw.Draw(pv)
for i in range(0, P, 64):
    d.line((i, 0, i, P), fill=(70, 84, 104), width=2)
for j in range(0, P, 40):
    d.line((0, j, P, j), fill=(70, 84, 104), width=2)
pv.save(os.path.join(out, 'pv.jpg'), quality=90)

# ---------------------------------------------------------------- glazed ground floor: glass in timber frames
G = (1024, 512)                    # 1024 px = 6.4 m (four bays), 512 px = 3.2 m
gl = Image.new('RGB', G, (40, 50, 58))
d = ImageDraw.Draw(gl)
for y in range(G[1]):              # sky reflection, darker toward the bottom
    t = y / G[1]
    d.line((0, y, G[0], y), fill=(int(92 - 52 * t), int(108 - 58 * t), int(118 - 60 * t)))
timber = (150, 112, 74)
for i in range(0, G[0], 256):
    d.rectangle((i, 0, i + 14, G[1]), fill=timber)
d.rectangle((0, 0, G[0], 12), fill=timber)
d.rectangle((0, int(G[1] * 0.18), G[0], int(G[1] * 0.18) + 6), fill=timber)
gl.save(os.path.join(out, 'glass.jpg'), quality=88)

print('textures ->', out)
