# The second half of the site pipeline (see site_data.py): meshes for the page and for
# the Blender bake, the drawn plan, and the final textures.
import json, math, os, sys
import numpy as np
import shapely
from shapely.geometry import Polygon, LineString, Point, MultiPolygon
from shapely.geometry.polygon import orient
from shapely.ops import unary_union
from PIL import Image, ImageDraw, ImageFont, ImageFilter
from site_common import *
from site_data import CENTER, R, T_BLOCK, T_GREEN, H_PLINTH, OUT, ASSETS, FONT, polys

QN = 200                       # coordinates are stored as integers, 1/200 of a unit (4.5 cm)
G = 1.0 / QN
MARGIN = 0.25
X0, Z0, SIZE = CENTER[0] - R - MARGIN, CENTER[1] - R - MARGIN, 2 * (R + MARGIN)   # the square the textures cover
LIB_RECT = (-14.0, -11.0, 28.0, 21.0)     # x0, z0, w, h: where the library's own soft shadow is baked
AO_DISTANCE = 5.0

# the palette of the model: grey board, a lighter card for paths, a sage card for planting
PAL = {
    'plate': (180, 174, 165), 'street': (157, 152, 143), 'green': (163, 169, 151), 'dot': (133, 142, 117),
    'walk': (197, 192, 182), 'paved': (190, 185, 176), 'edge': (228, 223, 213), 'block': (236, 233, 226),
}

# names laid flat on the model: text, centre (x, z), direction of the baseline in degrees, letter height, level
LABELS = [
    ('רופין', (-3.5, 3.9), 0.0, 0.5, 'street'),
    ('קפלן', (11.8, -2.83), 21.8, 0.5, 'street'),
    ('משכן הכנסת', (17.2, -15.7), 25.0, 0.95, 2.46),
    ('משרד האוצר', (-15.2, -2.6), -38.0, 0.55, 3.07),
]


# ------------------------------------------------------------------ geometry
def snapped(L):
    """the layers on the integer grid, consistent with each other"""
    disc = shapely.set_precision(L['disc'], G)
    street = shapely.set_precision(L['streets'], G)
    blocks = shapely.difference(disc, street, grid_size=G)
    green = shapely.intersection(shapely.set_precision(L['greens'], G), blocks, grid_size=G)
    green = unary_union(polys(green, 0.3))
    blds, flat = [], []
    for b in L['buildings']:
        g = shapely.intersection(shapely.set_precision(b['g'], G), blocks, grid_size=G)
        for p in polys(g, 0.15):
            # a neighbour that had to be lowered to nothing is not built at all: its footprint is drawn on the plan
            (blds if b['h'] > 0.06 else flat).append({**b, 'g': p})
    return {'disc': disc, 'street': street, 'blocks': blocks, 'green': green, 'blds': blds, 'flat': flat}


def tri_layer(g):
    """polygons → vertices (integers), rings (for the walls) and triangles facing up"""
    idx = {}; v = []; rings = []; tris = []

    def vid(x, z):
        k = (int(round(x * QN)), int(round(z * QN)))
        if k not in idx:
            idx[k] = len(v) // 2; v.extend(k)
        return idx[k]
    for p in polys(g):
        p = orient(p, 1.0)                                   # the inside is on the left of every ring
        for ring in [p.exterior, *p.interiors]:
            rings.append([vid(x, z) for x, z in list(ring.coords)[:-1]])
        for t in shapely.constrained_delaunay_triangles(p).geoms:
            a, b, c = [vid(x, z) for x, z in list(t.exterior.coords)[:3]]
            if len({a, b, c}) < 3:
                continue
            ax, az, bx, bz, cx, cz = v[2 * a], v[2 * a + 1], v[2 * b], v[2 * b + 1], v[2 * c], v[2 * c + 1]
            cr = (bz - az) * (cx - ax) - (bx - ax) * (cz - az)       # y of the face normal
            if cr == 0:
                continue
            tris += [a, b, c] if cr > 0 else [a, c, b]
    return {'v': v, 'r': rings, 'i': tris}


def walls(layer, y0, y1, V, F):
    """vertical quads along every ring of a layer, appended to the lists V (points) and F (triangles)"""
    v = layer['v']
    for ring in layer['r']:
        n = len(ring)
        for k in range(n):
            a, b = ring[k], ring[(k + 1) % n]
            ax, az, bx, bz = v[2 * a] / QN, v[2 * a + 1] / QN, v[2 * b] / QN, v[2 * b + 1] / QN
            o = len(V)
            V += [(ax, y0, az), (bx, y0, bz), (bx, y1, bz), (ax, y1, az)]
            F += [(o, o + 1, o + 2), (o, o + 2, o + 3)]


def tops(layer, y, V, F):
    v = layer['v']; o = len(V)
    V += [(v[2 * k] / QN, y, v[2 * k + 1] / QN) for k in range(len(v) // 2)]
    i = layer['i']
    F += [(o + i[k], o + i[k + 1], o + i[k + 2]) for k in range(0, len(i), 3)]


def library_proxy():
    """the library as the bake sees it: the stone mass on its recessed glass floors"""
    pts, hs = outline(360)
    c = pts.mean(axis=0)
    V, F = [], []
    n = len(pts)
    for k in range(n):                                        # walls of the stone mass and its soffit and roof
        a, b = pts[k], pts[(k + 1) % n]
        o = len(V)
        V += [(a[0], GH, a[1]), (b[0], GH, b[1]), (b[0], hs[(k + 1) % n], b[1]), (a[0], hs[k], a[1]),
              (c[0], GH, c[1]), (c[0], float(hs.mean()) - 0.6, c[1])]
        F += [(o, o + 1, o + 2), (o, o + 2, o + 3), (o, o + 1, o + 4), (o + 3, o + 2, o + 5)]
    q = [np.array([c[0] + (p[0] - c[0]) * 0.76 + 0.5, c[1] + (p[1] - c[1]) * 0.84]) for p in pts[::3]]
    for _ in range(3):                                        # chaikin, as in js/scene.js
        o2 = []
        for k in range(len(q)):
            a, b = q[k], q[(k + 1) % len(q)]
            o2 += [a + (b - a) * 0.25, a + (b - a) * 0.75]
        q = o2
    for k in range(len(q)):
        a, b = q[k], q[(k + 1) % len(q)]
        o = len(V)
        V += [(a[0], 0, a[1]), (b[0], 0, b[1]), (b[0], GH, b[1]), (a[0], GH, a[1])]
        F += [(o, o + 1, o + 2), (o, o + 2, o + 3)]
    return V, F, Polygon([tuple(p) for p in q])


def export(L):
    S = snapped(L)
    street, plate, green = tri_layer(S['street']), tri_layer(S['blocks']), tri_layer(S['green'])
    blds = []
    for b in S['blds']:
        t = tri_layer(b['g'])
        blds.append({'h': round(b['h'], 3), 'v': t['v'], 'r': t['r'], 'i': t['i']})
    site = {
        'q': QN, 'center': CENTER, 'r': R, 'plinth': H_PLINTH, 'm': round(L['s'], 3), 'north': [round(float(x), 4) for x in L['north']],
        'levels': {'street': -T_BLOCK, 'plate': 0, 'green': T_GREEN},
        'tex': {'x0': X0, 'z0': Z0, 'size': SIZE, 'lib': LIB_RECT},
        'pal': {k: '#%02x%02x%02x' % v for k, v in PAL.items()},
        'street': {'v': street['v'], 'i': street['i']}, 'plate': plate, 'green': green, 'bld': blds,
        'labels': [{'t': t, 'x': c[0], 'z': c[1], 'a': a, 's': h, 'y': (-T_BLOCK if y == 'street' else y)} for t, c, a, h, y in LABELS],
    }
    p = os.path.join(ASSETS, 'site.json')
    json.dump(site, open(p, 'w', encoding='utf-8'), separators=(',', ':'), ensure_ascii=False)
    print('site.json %.0f KB' % (os.path.getsize(p) / 1024),
          '| triangles: street %d plate %d green %d buildings %d' % (len(street['i']) // 3, len(plate['i']) // 3, len(green['i']) // 3, sum(len(b['i']) // 3 for b in blds)))

    # ---- the same model for the bake. The tops must not overlap in plan (they share one texture),
    # so the plots are cut where a planted card or a building stands on them.
    under = unary_union([S['green']] + [b['g'].buffer(-0.03) for b in S['blds']])
    plate_cut = tri_layer(shapely.difference(S['blocks'], shapely.set_precision(under, G), grid_size=G))
    GV, GF = [], []
    tops({'v': street['v'], 'i': street['i']}, -T_BLOCK, GV, GF)
    tops(plate_cut, 0.0, GV, GF)
    tops(green, T_GREEN, GV, GF)
    OV, OF = [], []
    walls(plate, -T_BLOCK, 0.0, OV, OF)
    walls(green, 0.0, T_GREEN, OV, OF)
    for b in blds:
        walls(b, 0.0, b['h'], OV, OF)
        tops(b, b['h'], OV, OF)
    LV, LF, inner = library_proxy()
    bake = {'ao_distance': AO_DISTANCE, 'rect': [X0, Z0, SIZE], 'lib_rect': list(LIB_RECT),
            'ground': {'v': GV, 'f': GF}, 'occ': {'v': OV, 'f': OF}, 'lib': {'v': LV, 'f': LF}}
    json.dump(bake, open(os.path.join(OUT, 'site_bake.json'), 'w'))
    print('bake: ground %d tris, occluders %d tris, library %d tris' % (len(GF), len(OF), len(LF)))


# ------------------------------------------------------------------ the drawn plan
def mask(g, W, ss=2):
    """anti-aliased coverage of a geometry, as a float image W×W"""
    S = W * ss
    im = Image.new('L', (S, S), 0); d = ImageDraw.Draw(im)
    X = lambda x, z: ((x - X0) / SIZE * S, (z - Z0) / SIZE * S)
    for p in sorted(polys(g), key=lambda p: -p.area):
        d.polygon([X(*q) for q in p.exterior.coords], fill=255)
        for h in p.interiors:
            d.polygon([X(*q) for q in h.coords], fill=0)
    if ss > 1:
        im = im.resize((W, W), Image.BOX)
    return np.asarray(im, np.float32) / 255.0


def plan(L, W=4096):
    S = snapped(L)
    col = lambda k: np.array(PAL[k], np.float32) / 255.0
    img = np.empty((W, W, 3), np.float32); img[:] = col('plate')

    def over(m, c, a=1.0):
        img[:] = img * (1 - m[..., None] * a) + c * (m[..., None] * a)
    lib = L['lib']
    over(mask(L['paved'], W), col('paved'))
    mg = mask(S['green'].buffer(0.012), W)
    over(mg, col('green'))
    over(mask(L['paths'].difference(lib.buffer(0.3)), W), col('walk'))
    over(mask(S['street'], W), col('street'))
    for b in S['flat']:                                       # neighbours shown as footprints only: a lighter field with a fine outline
        over(mask(b['g'], W), col('paved'))
        over(mask(b['g'].boundary.buffer(0.035), W), col('street'), 0.8)
    for b in S['blds']:                                       # under the blocks: their own tone, so nothing dark bleeds out
        over(mask(b['g'], W, 1), col('block'))
    out = Image.fromarray((np.clip(img, 0, 1) * 255 + 0.5).astype(np.uint8))
    out.save(os.path.join(OUT, 'plan_albedo.png'))
    print('plan_albedo.png', out.size)
    return out


def compose(L):
    """final textures: the plan, and the two baked shading maps"""
    alb = Image.open(os.path.join(OUT, 'plan_albedo.png')).convert('RGB')
    alb.save(os.path.join(ASSETS, 'plan.jpg'), quality=88, optimize=True, subsampling=0)
    alb.resize((2048, 2048), Image.LANCZOS).save(os.path.join(ASSETS, 'plan-2k.jpg'), quality=86, optimize=True, subsampling=0)
    # baked large and reduced, so the thin shade along the kerbs is a soft line and not a row of dashes
    im = Image.open(os.path.join(OUT, 'ao_site.png')).convert('L').filter(ImageFilter.GaussianBlur(1.6))
    im = im.resize((2048, 2048), Image.LANCZOS).filter(ImageFilter.GaussianBlur(0.6))
    im.save(os.path.join(ASSETS, 'ao.jpg'), quality=90, optimize=True)
    a0 = np.asarray(Image.open(os.path.join(OUT, 'ao_lib0.png')).convert('L'), np.float32) / 255
    a1 = np.asarray(Image.open(os.path.join(OUT, 'ao_lib1.png')).convert('L'), np.float32) / 255
    ratio = np.clip(a1 / np.maximum(a0, 0.02), 0, 1)
    ratio[:3, :] = 1; ratio[-3:, :] = 1; ratio[:, :3] = 1; ratio[:, -3:] = 1
    im = Image.fromarray((ratio * 255 + 0.5).astype(np.uint8)).filter(ImageFilter.GaussianBlur(1.6))
    im = im.resize((2048, int(round(2048 * im.height / im.width))), Image.LANCZOS)
    im.save(os.path.join(ASSETS, 'ao-lib.jpg'), quality=90, optimize=True)
    for f in ('plan.jpg', 'plan-2k.jpg', 'ao.jpg', 'ao-lib.jpg', 'site.json'):
        print('  %-12s %5.0f KB' % (f, os.path.getsize(os.path.join(ASSETS, f)) / 1024))
