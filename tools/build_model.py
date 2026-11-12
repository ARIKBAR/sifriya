# Builds a model of the National Library of Israel (Herzog & de Meuron, 2023)
# from the published plans and long section, as separate named parts,
# renders check views and exports a GLB.
#
#   blender -b -P tools/build_model.py -- <tex_dir> <out_dir> [render]
#
# Coordinates: metres. Blender Z up; the street (west) facade faces -Y.
import bpy, bmesh, math, os, sys, random
from mathutils import Vector

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
TEX = os.path.abspath(argv[0] if len(argv) > 0 else 'tools/tex')
OUT = os.path.abspath(argv[1] if len(argv) > 1 else 'tools/out')
RENDER = len(argv) > 2 and argv[2] == 'render'
os.makedirs(OUT, exist_ok=True)
rnd = random.Random(11)

S = 8.8  # metres per plan unit
lerp = lambda a, b, t: a + (b - a) * t
c01 = lambda t: max(0.0, min(1.0, t))

# ------------------------------------------------------------------ massing (plan units)
Q = [  # corner x, z (z toward the street), roof height, fillet radius
    ((-8.5, 2.4), 3.45, 0.12),   # A  street side, south end
    ((6.3, 2.8), 2.45, 0.16),    # B  street side, north end
    ((8.8, 0.0), 2.75, 0.10),    # C  north tip
    ((-3.7, -4.5), 3.75, 0.06),  # D  the peak: south end, at the back
]
SAG = [0.28, 0.05, 0.85, 0.10]   # sag of each roof edge, A→B, B→C, C→D, D→A
BOW = [0.12, 0.06, 0.55, 0.0]    # inward curve of each facade in plan
GH = 1.05                        # two glazed floors under the stone
OC = (-1.8, -0.35)               # oculus centre
OC_R, OC_G = 2.25, 1.4           # outer radius of the PV ring, radius of the glass


def edge_y(i, t):
    ha, hb = Q[i][1], Q[(i + 1) % 4][1]
    return lerp(ha, hb, t) - SAG[i] * math.sin(math.pi * t)


def inv_bilinear(x, z):
    A, B, C, D = [q[0] for q in Q]
    u = v = 0.5
    for _ in range(14):
        px = (1-u)*(1-v)*A[0] + u*(1-v)*B[0] + u*v*C[0] + (1-u)*v*D[0]
        pz = (1-u)*(1-v)*A[1] + u*(1-v)*B[1] + u*v*C[1] + (1-u)*v*D[1]
        xu = (1-v)*(B[0]-A[0]) + v*(C[0]-D[0]); zu = (1-v)*(B[1]-A[1]) + v*(C[1]-D[1])
        xv = (1-u)*(D[0]-A[0]) + u*(C[0]-B[0]); zv = (1-u)*(D[1]-A[1]) + u*(C[1]-B[1])
        det = xu*zv - xv*zu; ex, ez = x - px, z - pz
        u += (ex*zv - ez*xv) / det; v += (xu*ez - zu*ex) / det
    return c01(u), c01(v)


def roof_y(x, z):
    """Coons patch between the four sagging roof edges, plus a slight dish."""
    u, v = inv_bilinear(x, z)
    bot, top = edge_y(0, u), edge_y(2, 1 - u)
    left, right = edge_y(3, 1 - v), edge_y(1, v)
    hs = [q[1] for q in Q]
    corners = (1-u)*(1-v)*hs[0] + u*(1-v)*hs[1] + u*v*hs[2] + (1-u)*v*hs[3]
    return (1-v)*bot + v*top + (1-u)*left + u*right - corners - 0.3*math.sin(math.pi*u)*math.sin(math.pi*v)


def outline(N=320):
    """Plan outline with small fillets and bowed facades, evenly resampled."""
    P = [Vector(q[0]) for q in Q]
    mid = sum(P, Vector((0, 0))) / 4
    pts = []
    for i in range(4):
        prev, cur, nxt = P[(i - 1) % 4], P[i], P[(i + 1) % 4]
        r = Q[i][2]
        a = cur + (prev - cur).normalized() * r
        b = cur + (nxt - cur).normalized() * r
        for k in range(9):
            t = k / 8; s = 1 - t
            pts.append((a*s*s + cur*2*s*t + b*t*t, Q[i][1]))
        nA = nxt + (cur - nxt).normalized() * Q[(i + 1) % 4][2]
        L = (nA - b).length; n = max(2, round(L * 6))
        nrm = Vector((-(nA.y - b.y), nA.x - b.x)).normalized()
        if nrm.dot(mid - b) < 0:
            nrm = -nrm
        for k in range(1, n):
            pts.append((b.lerp(nA, k / n) + nrm * BOW[i] * math.sin(math.pi * k / n), edge_y(i, k / n)))
    seg = [0.0]
    for i in range(1, len(pts) + 1):
        seg.append(seg[-1] + (pts[i % len(pts)][0] - pts[i - 1][0]).length)
    per = seg[-1]; res = []; hs = []; j = 0
    for i in range(N):
        d = i / N * per
        while seg[j + 1] < d:
            j += 1
        t = (d - seg[j]) / ((seg[j + 1] - seg[j]) or 1)
        a, b = pts[j], pts[(j + 1) % len(pts)]
        res.append(a[0].lerp(b[0], t)); hs.append(lerp(a[1], b[1], t))
    return res, hs


def W(p, y):
    """plan point (x, z) + height → Blender world, metres"""
    return Vector((p[0] * S, -p[1] * S, y * S))


# ------------------------------------------------------------------ scene + materials
bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene


def image(name, file, srgb=True):
    im = bpy.data.images.load(os.path.join(TEX, file))
    im.name = name
    if not srgb:
        im.colorspace_settings.name = 'Non-Color'
    return im


def material(name, color=(0.8, 0.8, 0.8), rough=0.8, metal=0.0, tex=None, rough_tex=None, emission=None):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    bsdf = nt.nodes['Principled BSDF']
    bsdf.inputs['Base Color'].default_value = (*color, 1)
    bsdf.inputs['Roughness'].default_value = rough
    bsdf.inputs['Metallic'].default_value = metal
    if tex:
        t = nt.nodes.new('ShaderNodeTexImage'); t.image = tex
        nt.links.new(t.outputs['Color'], bsdf.inputs['Base Color'])
    if rough_tex:
        t = nt.nodes.new('ShaderNodeTexImage'); t.image = rough_tex
        nt.links.new(t.outputs['Color'], bsdf.inputs['Roughness'])
    if emission:
        bsdf.inputs['Emission Color'].default_value = (*emission, 1)
        bsdf.inputs['Emission Strength'].default_value = 0.0  # switched on in the browser at night
    return m


M_STONE = material('stone', tex=image('stone', 'stone.jpg'), rough_tex=image('stone_rough', 'stone_rough.png', False))
M_ROOF = material('roof_paving', rough=0.85, tex=image('roof', 'roof.jpg'))
M_PV = material('pv', rough=0.25, metal=0.3, tex=image('pv', 'pv.jpg'))
M_SKY = material('skylight_glass', color=(0.025, 0.04, 0.065), rough=0.12, metal=0.4)
M_GLASS = material('glass_floor', rough=0.06, metal=0.35, tex=image('glass', 'glass.jpg'))
M_WIN = material('window_glass', color=(0.08, 0.10, 0.12), rough=0.05, metal=0.4, emission=(1.0, 0.78, 0.48))
M_COL = material('columns_stone', color=(0.86, 0.82, 0.74), rough=0.8)
M_GROUND = material('ground', color=(0.80, 0.77, 0.71), rough=0.95)


def make_obj(name, bm, mat):
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me); bm.free()
    me.materials.append(mat)
    ob = bpy.data.objects.new(name, me)
    scene.collection.objects.link(ob)
    for poly in me.polygons:
        poly.use_smooth = True
    return ob


def face_out(bm, f, ref, up=None):
    """flip face f so it points away from ref (or along up)"""
    f.normal_update()
    want = up if up is not None else (f.calc_center_median() - ref)
    if f.normal.dot(want) < 0:
        f.normal_flip()


pts, edge_h = outline(320)
N = len(pts)
arc = [0.0]
for i in range(1, N + 1):
    arc.append(arc[-1] + (pts[i % N] - pts[i - 1]).length * S)
centroid_plan = sum(pts, Vector((0, 0))) / N
centre = W(centroid_plan, GH + 1.0)
TILE = 8.4  # metres covered by one repeat of the stone texture

# ------------------------------------------------------------------ stone_mass: facades + soffit
bm = bmesh.new(); uvl = bm.loops.layers.uv.new('UVMap')
ROWS = 28
grid = []
for i in range(N + 1):
    p = pts[i % N]; top = edge_h[i % N]
    col = [bm.verts.new(W(p, lerp(GH, top, j / ROWS))) for j in range(ROWS + 1)]
    grid.append(col)
for i in range(N):
    for j in range(ROWS):
        vs = [grid[i][j], grid[i + 1][j], grid[i + 1][j + 1], grid[i][j + 1]]
        f = bm.faces.new(vs)
        face_out(bm, f, Vector((centre.x, centre.y, f.calc_center_median().z)))
        for loop in f.loops:
            k = vs.index(loop.vert)
            ii = i + (1 if k in (1, 2) else 0)
            loop[uvl].uv = (arc[ii] / TILE, (loop.vert.co.z - GH * S) / TILE)
# soffit (underside of the mass)
bottom = [bm.verts.new(W(p, GH)) for p in pts]
f = bm.faces.new(bottom)
face_out(bm, f, None, up=Vector((0, 0, -1)))
for loop in f.loops:
    loop[uvl].uv = (loop.vert.co.x / TILE, loop.vert.co.y / TILE)
bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=0.001)
stone = make_obj('stone_mass', bm, M_STONE)

# ------------------------------------------------------------------ roof (with the oculus hole), solar_ring, oculus_glass
def polar(px, pz, r_in, r_out_fn, rings, mat_name, mat, y_off=0.0, uv_scale=TILE / 2, hole=True):
    bm = bmesh.new(); uvl = bm.loops.layers.uv.new('UVMap')
    ring = []
    for i in range(N + 1):
        p = pts[i % N]
        d = Vector((p.x - px, p.y - pz)); L = d.length; d.normalize()
        r1 = r_out_fn(L)
        col = []
        for j in range(rings + 1):
            r = lerp(r_in, r1, (j / rings) ** 0.9)
            x, z = px + d.x * r, pz + d.y * r
            to_edge = r1 >= L - 1e-6   # only the roof itself reaches the facade
            y = roof_y(x, z) if not to_edge else lerp(roof_y(x, z), edge_h[i % N], ((j / rings) ** 0.9) ** 6)
            col.append(bm.verts.new(W(Vector((x, z)), y + y_off)))
        ring.append(col)
    for i in range(N):
        for j in range(rings):
            vs = [ring[i][j], ring[i + 1][j], ring[i + 1][j + 1], ring[i][j + 1]]
            f = bm.faces.new(vs)
            face_out(bm, f, None, up=Vector((0, 0, 1)))
            for loop in f.loops:
                loop[uvl].uv = (loop.vert.co.x / uv_scale, loop.vert.co.y / uv_scale)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=0.001)
    return make_obj(mat_name, bm, mat)


roof = polar(OC[0], OC[1], OC_R, lambda L: L, 26, 'roof', M_ROOF)
ring = polar(OC[0], OC[1], OC_G, lambda L: OC_R, 10, 'solar_ring', M_PV, y_off=0.002, uv_scale=4.0)
# glass: a disc that follows the roof surface
bm = bmesh.new(); uvl = bm.loops.layers.uv.new('UVMap')
SEG, RG = 96, 8
centre_v = bm.verts.new(W(Vector(OC), roof_y(*OC) - 0.003))
rings_v = []
for j in range(1, RG + 1):
    r = OC_G * j / RG
    rings_v.append([bm.verts.new(W(Vector((OC[0] + math.cos(a) * r, OC[1] + math.sin(a) * r)), roof_y(OC[0] + math.cos(a) * r, OC[1] + math.sin(a) * r) - 0.003)) for a in [k / SEG * 2 * math.pi for k in range(SEG)]])
for k in range(SEG):
    f = bm.faces.new([centre_v, rings_v[0][k], rings_v[0][(k + 1) % SEG]]); face_out(bm, f, None, up=Vector((0, 0, 1)))
for j in range(RG - 1):
    for k in range(SEG):
        f = bm.faces.new([rings_v[j][k], rings_v[j][(k + 1) % SEG], rings_v[j + 1][(k + 1) % SEG], rings_v[j + 1][k]]); face_out(bm, f, None, up=Vector((0, 0, 1)))
sky = make_obj('oculus_glass', bm, M_SKY)
# small round skylight near the north end
bm = bmesh.new(); sx, sz, sr = 5.5, 0.75, 0.26
cv = [bm.verts.new(W(Vector((sx + math.cos(a) * sr, sz + math.sin(a) * sr)), roof_y(sx, sz) + 0.004)) for a in [k / 32 * 2 * math.pi for k in range(32)]]
f = bm.faces.new(cv); face_out(bm, f, None, up=Vector((0, 0, 1)))
make_obj('skylight_small', bm, M_SKY)

# ------------------------------------------------------------------ windows: four-pointed star openings in a band
def band_at(p):
    if p.y > 1.9 and p.x > -2.2: return True      # street side, northern half
    if p.x > 6.2: return True                     # north end
    if p.y < 0 and p.x > 3.2: return True         # back, near the north tip
    return False


def star(R, n=7):
    out = []
    arcs = [lambda t: (R - R*math.sin(t), R - R*math.cos(t)), lambda t: (-R + R*math.cos(t), R - R*math.sin(t)),
            lambda t: (-R + R*math.sin(t), -R + R*math.cos(t)), lambda t: (R - R*math.cos(t), -R + R*math.sin(t))]
    for f in arcs:
        for k in range(n):
            out.append(f(k / n * math.pi / 2))
    return out


bm = bmesh.new()
step = 1.25  # metres between windows
s = 0.0
count = 0
while s < arc[-1]:
    i = max(0, min(N - 1, next(k for k in range(N) if arc[k + 1] >= s)))
    t = (s - arc[i]) / max(1e-6, arc[i + 1] - arc[i])
    p = pts[i].lerp(pts[(i + 1) % N], t)
    if band_at(p):
        a, b = W(pts[i], 0), W(pts[(i + 1) % N], 0)
        tang = (b - a).normalized()
        nrm = Vector((tang.y, -tang.x, 0))
        if nrm.dot(W(p, 0) - Vector((centre.x, centre.y, 0))) < 0:
            nrm = -nrm
        base = W(p, GH) + nrm * 0.03
        for row, (z, shift) in enumerate([(4.3, 0.0), (5.55, step / 2)]):
            if rnd.random() < 0.22:
                continue
            Rr = rnd.choice([0.42, 0.5, 0.58])
            c0 = base + tang * shift + Vector((0, 0, z))
            vs = [bm.verts.new(c0 + tang * x + Vector((0, 0, y))) for x, y in star(Rr)]
            f = bm.faces.new(vs)
            f.normal_update()
            if f.normal.dot(nrm) < 0:
                f.normal_flip()
            count += 1
    s += step
windows = make_obj('windows', bm, M_WIN)
print('windows:', count)

# ------------------------------------------------------------------ glass_floor + columns (set back under the mass)
inner = [Vector((centroid_plan.x + (p.x - centroid_plan.x) * 0.76 + 0.5, centroid_plan.y + (p.y - centroid_plan.y) * 0.84)) for p in pts[::4]]
for _ in range(3):  # chaikin: rounds the tips of the glazed floors
    nxt = []
    for i in range(len(inner)):
        a, b = inner[i], inner[(i + 1) % len(inner)]
        nxt += [a.lerp(b, 0.25), a.lerp(b, 0.75)]
    inner = nxt
bm = bmesh.new(); uvl = bm.loops.layers.uv.new('UVMap')
lo = [bm.verts.new(W(p, 0.0)) for p in inner]
hi = [bm.verts.new(W(p, GH - 0.004)) for p in inner]
acc = [0.0]
for i in range(1, len(inner) + 1):
    acc.append(acc[-1] + (inner[i % len(inner)] - inner[i - 1]).length * S)
ic = sum(inner, Vector((0, 0))) / len(inner)
for i in range(len(inner)):
    j = (i + 1) % len(inner)
    vs = [lo[i], lo[j], hi[j], hi[i]]
    f = bm.faces.new(vs)
    face_out(bm, f, W(ic, GH / 2))
    for loop in f.loops:
        k = vs.index(loop.vert)
        u = acc[i + 1] if k in (1, 2) else acc[i]
        loop[uvl].uv = (u / 6.4, (loop.vert.co.z / (GH * S)))
f = bm.faces.new(hi[::-1]); face_out(bm, f, None, up=Vector((0, 0, -1)))
glass = make_obj('glass_floor', bm, M_GLASS)

bm = bmesh.new()
acc_m = 0.0
for i in range(1, len(inner)):
    acc_m += (inner[i] - inner[i - 1]).length * S
    if acc_m < 13.0:
        continue
    acc_m = 0.0
    p, q = inner[i], inner[(i + 1) % len(inner)]
    ang = math.atan2(-(q.y - p.y), q.x - p.x)
    m = bmesh.ops.create_cube(bm, size=1.0)
    vs = m['verts']
    bmesh.ops.scale(bm, vec=(2.2, 1.6, GH * S), verts=vs)
    bmesh.ops.rotate(bm, cent=(0, 0, 0), matrix=__import__('mathutils').Matrix.Rotation(ang, 3, 'Z'), verts=vs)
    bmesh.ops.translate(bm, vec=W(p, GH / 2) + Vector((0, 0, 0)), verts=vs)
make_obj('columns', bm, M_COL)

# ------------------------------------------------------------------ ground
bm = bmesh.new()
bmesh.ops.create_grid(bm, x_segments=1, y_segments=1, size=300)
ground = make_obj('ground', bm, M_GROUND)
ground.location.z = -0.02

# ------------------------------------------------------------------ export
for ob in scene.objects:
    ob.select_set(True)
glb = os.path.join(OUT, 'nli.glb')
bpy.ops.export_scene.gltf(filepath=glb, export_format='GLB', export_yup=True, export_apply=True,
                          export_image_format='JPEG', export_jpeg_quality=82)
print('exported', glb, os.path.getsize(glb) // 1024, 'KB')

# ------------------------------------------------------------------ check renders
if RENDER:
    world = bpy.data.worlds.new('sky'); scene.world = world
    world.use_nodes = True
    world.node_tree.nodes['Background'].inputs['Color'].default_value = (0.55, 0.68, 0.85, 1)
    world.node_tree.nodes['Background'].inputs['Strength'].default_value = 0.9
    sun = bpy.data.objects.new('sun', bpy.data.lights.new('sun', 'SUN'))
    sun.data.energy = 4.0; sun.data.angle = math.radians(2)
    sun.rotation_euler = (math.radians(50), 0, math.radians(-35))
    scene.collection.objects.link(sun)
    scene.render.engine = 'CYCLES'
    scene.cycles.samples = 24
    scene.cycles.use_denoising = True
    scene.render.resolution_x, scene.render.resolution_y = 1280, 720
    scene.view_settings.view_transform = 'AgX'
    cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam'))
    scene.collection.objects.link(cam); scene.camera = cam
    target = Vector((5, 0, 14))
    views = {
        'aerial': (Vector((-55, -235, 150)), 45),     # like the drone photo from the street side
        'street': (Vector((70, -120, 2.5)), 24),       # pedestrian, street side
        'south': (Vector((-170, -95, 6)), 30),         # toward the high south end
        'top': (Vector((10, -40, 320)), 40),
    }
    for name, (loc, lens) in views.items():
        cam.location = loc
        cam.data.lens = lens
        cam.rotation_euler = (target - loc).to_track_quat('-Z', 'Y').to_euler()
        scene.render.filepath = os.path.join(OUT, f'view_{name}.png')
        bpy.ops.render.render(write_still=True)
        print('rendered', name)
