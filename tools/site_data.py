# Turns the real street plan around the library (OpenStreetMap) into the site model.
#
# Run from this folder, in this order:
#   python site_data.py layers    → out/layers.pkl + out/site_debug.jpg (look at it first)
#   python site_data.py export    → ../assets/site/site.json (the model for the page) + out/site_bake.json (for Blender)
#   python site_data.py plan      → out/plan_albedo.png (the drawn plan)
#   blender -b -P bake_site.py -- out/site_bake.json out 300 4096     (the soft shading, three images)
#   python site_data.py compose   → ../assets/site/plan.jpg, plan-2k.jpg, ao.jpg, ao-lib.jpg
#
# The map itself is cache/osm.json, an OpenStreetMap extract (© OpenStreetMap contributors, ODbL).
#
# Everything is expressed in the 3D model's own units (x, z) so the model and its
# cameras do not move: the map is fitted onto the model, not the other way round.
import json, math, os, pickle, random, sys
import numpy as np
import shapely
from shapely.geometry import Polygon, LineString, Point, MultiPolygon, GeometryCollection, box
from shapely.ops import unary_union
from shapely import affinity
from PIL import Image, ImageDraw, ImageFont, ImageFilter
from site_common import *

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, 'out'); os.makedirs(OUT, exist_ok=True)
ASSETS = os.path.join(HERE, '..', 'assets', 'site'); os.makedirs(ASSETS, exist_ok=True)
FONT = r'C:\Users\a0556\Downloads\Hadassah Friedlaender TRIAL\HadassahFriedlaenderTRIAL-Regular.otf'

# ---- the base: a round piece cut out of the city, the library a little off-centre
# so that the Knesset fits on it whole
CENTER = (3.0, -4.0)     # model units
R = 30.0                 # radius of the base; everything is cut flush at this cylinder
T_BLOCK = 0.06           # card thickness: the plots stand this much above street level
T_GREEN = 0.035          # a second, thinner card: planted areas
H_PLINTH = 1.1           # thickness of the base under street level

ROAD_W = {  # metres, full width
    'motorway': 18, 'trunk': 16, 'primary': 15, 'secondary': 12, 'tertiary': 10,
    'unclassified': 8, 'residential': 7.5, 'living_street': 6, 'service': 5,
    'motorway_link': 8, 'trunk_link': 8, 'primary_link': 8, 'secondary_link': 7, 'tertiary_link': 7,
}
PED = {'footway': 2.4, 'path': 2.0, 'pedestrian': 4.0, 'steps': 2.4, 'cycleway': 2.4}
GREEN_TAGS = {('leisure', 'park'), ('leisure', 'garden'), ('landuse', 'grass'), ('landuse', 'forest'), ('landuse', 'meadow'),
              ('landuse', 'flowerbed'), ('landuse', 'village_green'), ('landuse', 'recreation_ground'),
              ('natural', 'wood'), ('natural', 'scrub'), ('natural', 'grassland')}


def load():
    els = load_osm(os.path.join(HERE, 'cache', 'osm.json'))
    lib = next(e for e in els if e['type'] == 'way' and e['id'] == LIBRARY_WAY)
    g = lib['geometry'][:-1]
    P = Proj(sum(p['lat'] for p in g) / len(g), sum(p['lon'] for p in g) / len(g))
    foot = [P.en(p['lat'], p['lon']) for p in g]
    s, th, t, rms = fit_model_to_footprint(foot)
    # refine on the four real corners: the nodes nearest to the model's corners
    F0 = ModelFrame(s, th, t)
    fm = np.array([F0.to_model(e, n) for e, n in foot])
    mc, fc = [], []
    for q in Q:
        d = np.hypot(fm[:, 0] - q[0][0], fm[:, 1] - q[0][1])
        k = int(np.argmin(d))
        mc.append(complex(q[0][0], -q[0][1])); fc.append(complex(*foot[k]))
    mc, fc = np.array(mc), np.array(fc)
    a = ((fc - fc.mean()) * np.conj(mc - mc.mean())).sum() / (abs(mc - mc.mean()) ** 2).sum()
    tt = fc.mean() - a * mc.mean()
    res = abs(a * mc + tt - fc)
    F = ModelFrame(abs(a), math.atan2(a.imag, a.real), tt)
    print(f'fit: {abs(a):.3f} m per unit, corner residuals (m): {np.round(res, 1)}, icp rms {rms:.1f} m')

    def xy(e):
        return [F.to_model(*P.en(p['lat'], p['lon'])) for p in e]

    feats = {'roads': [], 'ped': [], 'ped_area': [], 'buildings': [], 'greens': [], 'parking': [], 'lib': fm.tolist()}
    for e in els:
        t = e.get('tags', {})
        if e['type'] == 'node':
            continue
        rings = []
        if e['type'] == 'way' and 'geometry' in e:
            rings = [xy(e['geometry'])]
        elif e['type'] == 'relation':
            rings = [xy(m['geometry']) for m in e.get('members', []) if m.get('role') == 'outer' and 'geometry' in m]
        if not rings:
            continue
        layer = t.get('layer', '0')
        if t.get('tunnel') in ('yes', 'building_passage') or t.get('location') == 'underground' or layer.startswith('-') \
                or t.get('parking') == 'underground' or t.get('covered') == 'yes':
            continue
        hw = t.get('highway')
        if hw:
            closed = len(rings[0]) > 3 and rings[0][0] == rings[0][-1]
            if hw in ROAD_W:
                w = ROAD_W[hw]
                if 'lanes' in t:
                    try: w = max(w * 0.6, float(t['lanes']) * 3.4 + 1.2)
                    except ValueError: pass
                if hw == 'service' and t.get('service') in ('parking_aisle', 'driveway'):
                    w = 4.2
                feats['roads'].append({'pts': rings[0], 'w': w, 'kind': hw, 'name': t.get('name'), 'service': t.get('service')})
            elif hw in PED:
                if closed and (t.get('area') == 'yes' or hw == 'pedestrian'):
                    feats['ped_area'].append(rings[0])
                else:
                    feats['ped'].append({'pts': rings[0], 'w': PED[hw]})
            continue
        if 'building' in t:
            if e['id'] == LIBRARY_WAY:
                continue
            h = None
            try: h = float(str(t.get('height', '')).replace('m', '').strip()) if t.get('height') else None
            except ValueError: h = None
            if h is None and t.get('building:levels'):
                try: h = float(t['building:levels']) * 3.7 + 1.5
                except ValueError: h = None
            if h is None:
                h = {'roof': 4, 'shed': 3, 'hut': 3, 'garage': 3, 'kiosk': 3, 'guardhouse': 3, 'service': 4,
                     'university': 14, 'public': 20, 'office': 20, 'apartments': 16, 'dormitory': 14, 'school': 12}.get(t['building'], 9)
            if e['id'] == 551414758: h = 22   # the Knesset
            for r in rings:
                feats['buildings'].append({'pts': r, 'h': h, 'name': t.get('name'), 'id': e['id'], 'kind': t['building']})
            continue
        if t.get('amenity') == 'parking':
            feats['parking'] += rings
            continue
        for k in ('leisure', 'landuse', 'natural'):
            if (k, t.get(k)) in GREEN_TAGS:
                for r in rings:
                    feats['greens'].append({'pts': r, 'name': t.get('name')})
                break
    return F, feats


def poly(pts):
    if len(pts) < 4:
        return None
    p = Polygon(pts)
    if not p.is_valid:
        p = p.buffer(0)
    return p if (not p.is_empty and p.area > 0) else None


def polys(g, min_area=0.0):
    """flatten any geometry into a list of plain polygons"""
    if g is None or g.is_empty:
        return []
    if isinstance(g, Polygon):
        return [g] if g.area > min_area else []
    out = []
    for q in getattr(g, 'geoms', []):
        out += polys(q, min_area)
    return out


def drop_holes(p, min_area):
    """a polygon without its small holes"""
    return Polygon(p.exterior, [h for h in p.interiors if Polygon(h).area >= min_area])


# ---- the tour's camera, sampled the way js/scene.js moves it (centripetal Catmull-Rom)
def _cr(P, u):
    n = len(P) - 1
    x = u * n; i = min(int(math.floor(x)), n - 1); t = x - i
    p1, p2 = P[i], P[i + 1]
    p0 = P[i - 1] if i > 0 else 2 * P[0] - P[1]
    p3 = P[i + 2] if i + 2 <= n else 2 * P[n] - P[n - 1]
    d0, d1, d2 = (np.linalg.norm(b - a) ** 0.5 for a, b in ((p0, p1), (p1, p2), (p2, p3)))
    if d1 < 1e-4: d1 = 1.0
    if d0 < 1e-4: d0 = d1
    if d2 < 1e-4: d2 = d1
    t1 = ((p1 - p0) / d0 - (p2 - p0) / (d0 + d1) + (p2 - p1) / d1) * d1
    t2 = ((p2 - p1) / d1 - (p3 - p1) / (d1 + d2) + (p3 - p2) / d2) * d1
    return p1 + t1 * t + (-3 * p1 + 3 * p2 - 2 * t1 - t2) * t * t + (2 * p1 - 2 * p2 + t1 + t2) * t ** 3


def cam_path(n=140, dist=(1.0,)):
    cams = np.array([k[0] for k in CAM_KEYS], float); looks = np.array([k[1] for k in CAM_KEYS], float)
    out = []
    for u in np.linspace(0, 1, n):
        c, l = _cr(cams, u), _cr(looks, u)
        for f in dist:
            out.append((l + (c - l) * f, l, u))
    return out


def build_layers(F, feats, verbose=True):
    s = F.s
    C = Point(CENTER)
    disc = C.buffer(R, 128)
    near = C.buffer(R + 3)
    mo, mh = outline(360)
    lib = Polygon(mo)                        # the stone mass in plan

    # ---- streets: carriageways and open car parks, one level below the plots
    g = []
    for r in feats['roads']:
        ls = LineString(r['pts'])
        if not ls.intersects(near):
            continue
        g.append(ls.buffer(r['w'] / s / 2, quad_segs=3, cap_style='round', join_style='round'))
    for ring in feats['parking']:
        p = poly(ring)
        if p is not None and p.intersects(near):
            g.append(p)
    streets = unary_union(g)
    streets = streets.buffer(0.12, join_style='mitre').buffer(-0.12, join_style='mitre')    # closes slivers between lanes
    streets = streets.difference(lib.buffer(0.35))                                            # nothing runs under the building
    streets = streets.intersection(disc)
    blocks = disc.difference(streets)
    tiny = [p for p in polys(blocks) if p.area < 0.6]                                          # traffic islands: part of the street
    streets = unary_union([streets] + tiny)
    streets = unary_union([drop_holes(p, 0.6) for p in polys(streets)]).simplify(0.015)
    streets = streets.intersection(disc).buffer(0)
    blocks = disc.difference(streets).buffer(0)

    # ---- buildings: footprints inside the base, tallest wins where they overlap
    bl = []
    for b in feats['buildings']:
        p = poly(b['pts'])
        if p is None or not p.intersects(disc):
            continue
        p = p.intersection(disc).difference(streets.buffer(0.02))
        if p.is_empty or p.area < 0.22:
            continue
        bl.append({'g': p, 'h': b['h'] / s, 'hm': b['h'], 'name': b['name'], 'id': b['id'], 'kind': b['kind']})
    bl.sort(key=lambda b: -b['h'])
    taken = None; outb = []
    for b in bl:
        gk = b['g'] if taken is None else b['g'].difference(taken)
        for p in polys(gk, 0.2):
            p = p.simplify(0.012)
            if p.is_valid and p.area > 0.2 and p.distance(lib) > 0.3:
                outb.append({**b, 'g': drop_holes(p, 0.25)})
        taken = b['g'] if taken is None else unary_union([taken, b['g']])
    bl = outb
    built = unary_union([b['g'] for b in bl]) if bl else Polygon()

    # ---- paths and paved places
    pg = []
    for r in feats['ped']:
        ls = LineString(r['pts'])
        if ls.intersects(disc):
            pg.append(ls.buffer(r['w'] / s / 2, quad_segs=2, cap_style='flat', join_style='round'))
    paths = unary_union(pg).intersection(blocks) if pg else Polygon()
    pa = [p for p in (poly(r) for r in feats['ped_area']) if p is not None and p.intersects(disc)]
    paved = unary_union(pa).intersection(blocks) if pa else Polygon()

    # ---- planted areas: a second card on top of the plots, cut by the paths
    gg = [p for p in (poly(r['pts']) for r in feats['greens']) if p is not None and p.intersects(disc)]
    greens = unary_union(gg).intersection(blocks)
    greens = greens.difference(built.buffer(0.07)).difference(paths).difference(paved).difference(lib.buffer(0.5))
    greens = greens.buffer(-0.05, join_style='mitre').buffer(0.05, join_style='mitre')             # drops slivers
    greens = unary_union([drop_holes(p, 0.08) for p in polys(greens, 0.35)]).simplify(0.012).buffer(0)
    greens = greens.intersection(blocks).buffer(0)

    L = {'streets': streets, 'blocks': blocks, 'greens': greens, 'paths': paths, 'paved': paved, 'buildings': bl,
         'lib': lib, 'disc': disc, 's': s, 'north': F.north()}
    if verbose:
        nv = lambda g: sum(len(p.exterior.coords) + sum(len(h.coords) for h in p.interiors) for p in polys(g))
        print('vertices  streets %d  blocks %d  greens %d  buildings %d (%d footprints)' % (
            nv(streets), nv(blocks), nv(greens), sum(nv(b['g']) for b in bl), len(bl)))
    return L


def sight(L, verbose=True):
    """Lowers the neighbours that would stand between the camera and the library.
    A block may rise only as far as the line from the camera's eye to the foot of the building."""
    hull = L['lib'].convex_hull
    hb = hull.buffer(0.4)
    samples = cam_path(140, (1.0, 1.45, 2.1))
    cones = []
    for c, l, u in samples:
        if c[1] > 6:                     # the high view of the roof looks over everything
            continue
        c2 = Point(c[0], c[2])
        cones.append((c2, float(c[1]), unary_union([c2.buffer(0.9), hb]).convex_hull))
    n_low = 0
    for b in L['buildings']:
        lim = 1e9
        for c2, hc, cone in cones:
            if not cone.intersects(b['g']):
                continue
            part = b['g'].intersection(cone)
            for p in polys(part):
                for x, z in p.exterior.coords:
                    dc = math.hypot(x - c2.x, z - c2.y); dl = hull.distance(Point(x, z))
                    if dc < 1.6:
                        lim = 0.0
                    else:
                        lim = min(lim, hc * dl / (dl + dc) - 0.12)
        b['lim'] = lim
        b['h0'] = b['h']
        if b['h'] > lim:
            n_low += 1
            b['h'] = lim if lim > max(0.45, 0.45 * b['h']) else 0.05      # too little left: only the footprint stays
            if verbose:
                cx, cz = b['g'].centroid.coords[0]
                print('  lowered %-28s at (%6.1f,%6.1f)  %.2f → %.2f' % (str(b['name'])[:28], cx, cz, b['h0'], b['h']))
    if verbose:
        print('%d of %d neighbours lowered to keep the view clear' % (n_low, len(L['buildings'])))
    return L


def debug(L, name='site_debug.jpg'):
    S = 2600; half = R + 4
    im = Image.new('RGB', (S, S), (250, 250, 250)); d = ImageDraw.Draw(im)
    X = lambda p: ((p[0] - CENTER[0] + half) / (2 * half) * S, (p[1] - CENTER[1] + half) / (2 * half) * S)

    def fill(g, col, outline=None):
        for p in polys(g):
            d.polygon([X(q) for q in p.exterior.coords], fill=col, outline=outline)
            for h in p.interiors:
                d.polygon([X(q) for q in h.coords], fill=(250, 250, 250))
    fill(L['disc'], (232, 226, 214))
    fill(L['streets'], (200, 194, 184))
    fill(L['paved'], (240, 236, 226))
    for p in polys(L['greens']):
        d.polygon([X(q) for q in p.exterior.coords], fill=(196, 208, 180))
        for h in p.interiors:
            d.polygon([X(q) for q in h.coords], fill=(232, 226, 214))
    for p in polys(L['paths']):
        d.polygon([X(q) for q in p.exterior.coords], fill=(246, 242, 232))
    for b in L['buildings']:
        low = b['h'] < b.get('h0', b['h'])
        col = (200, 90, 80) if b['h'] <= 0.06 else ((220, 160, 90) if low else (118, 114, 108))
        for p in polys(b['g']):
            d.polygon([X(q) for q in p.exterior.coords], fill=col)
            for h in p.interiors:
                d.polygon([X(q) for q in h.coords], fill=(232, 226, 214))
    d.polygon([X(q) for q in L['lib'].exterior.coords], fill=(60, 90, 160))
    for f, col in ((1.0, (220, 30, 30)), (2.1, (30, 140, 30))):
        pts = [X((c[0], c[2])) for c, l, u in cam_path(200, (f,))]
        d.line(pts, fill=col, width=4)
    n = L['north']; c = X((CENTER[0] + R - 3, CENTER[1] - R + 3))
    d.line((c[0], c[1], c[0] + n[0] * 110, c[1] + n[1] * 110), fill=(200, 0, 0), width=6)
    f = ImageFont.truetype(FONT, 30)
    for b in L['buildings']:
        if b['name']:
            cx, cz = b['g'].centroid.coords[0]
            d.text(X((cx, cz)), '%s %.1f' % (b['name'][::-1], b['h']), fill=(0, 0, 0), font=f, anchor='mm')
    for k in range(-30, 31, 10):                      # a 10-unit grid, to read positions off the picture
        a, b2 = X((CENTER[0] + k, CENTER[1] - half)), X((CENTER[0] + k, CENTER[1] + half))
        d.line((a, b2), fill=(160, 160, 200), width=1)
        a, b2 = X((CENTER[0] - half, CENTER[1] + k)), X((CENTER[0] + half, CENTER[1] + k))
        d.line((a, b2), fill=(160, 160, 200), width=1)
        d.text(X((CENTER[0] + k, CENTER[1] - half + 0.5)), 'x=%g' % (CENTER[0] + k), fill=(60, 60, 160), font=f)
        d.text(X((CENTER[0] - half + 0.2, CENTER[1] + k)), 'z=%g' % (CENTER[1] + k), fill=(60, 60, 160), font=f)
    im.save(os.path.join(OUT, name), quality=88)


if __name__ == '__main__':
    cmd = sys.argv[1] if len(sys.argv) > 1 else 'layers'
    if cmd == 'layers':
        F, feats = load()
        print('north in model (x, z):', tuple(round(float(v), 3) for v in F.north()))
        L = sight(build_layers(F, feats))
        pickle.dump(L, open(os.path.join(OUT, 'layers.pkl'), 'wb'))
        debug(L)
    else:
        import site_build
        getattr(site_build, cmd)(pickle.load(open(os.path.join(OUT, 'layers.pkl'), 'rb')))
