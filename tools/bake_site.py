# Bakes the soft, shadowless shading of the site model (ambient occlusion) with Cycles.
#
#   blender -b -P bake_site.py -- out/site_bake.json out [samples] [size]
#
# Three images come out, all looking straight down, x to the right and z downward:
#   ao_site.png   the whole base without the library      (the kerbs, the cards, the neighbours)
#   ao_lib0.png   the surroundings of the library, without it
#   ao_lib1.png   the same, with the library standing there (their ratio is its own soft shadow)
import bpy, json, os, sys, time

argv = sys.argv[sys.argv.index('--') + 1:]
data = json.load(open(os.path.abspath(argv[0])))
out = os.path.abspath(argv[1])
samples = int(argv[2]) if len(argv) > 2 else 128
size = int(argv[3]) if len(argv) > 3 else 2048

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
scene.render.engine = 'CYCLES'
scene.cycles.device = 'CPU'
scene.cycles.samples = samples
scene.cycles.use_denoising = False
world = bpy.data.worlds.new('w'); scene.world = world
world.light_settings.distance = data['ao_distance']
scene.render.bake.margin = 6
scene.render.bake.margin_type = 'EXTEND'
scene.render.bake.use_clear = True

B = lambda p: (p[0], -p[2], p[1])              # the model's (x, y up, z) → Blender's (x, y, z up)


def mesh(name, d, face_up=False):
    v = [B(p) for p in d['v']]
    f = [tuple(t) for t in d['f']]
    if face_up:                                 # the ground must look at the sky
        g = []
        for a, b, c in f:
            ax, ay = v[a][0], v[a][1]; bx, by = v[b][0], v[b][1]; cx, cy = v[c][0], v[c][1]
            g.append((a, b, c) if (bx - ax) * (cy - ay) - (by - ay) * (cx - ax) > 0 else (a, c, b))
        f = g
    me = bpy.data.meshes.new(name); me.from_pydata(v, [], f); me.update()
    ob = bpy.data.objects.new(name, me); scene.collection.objects.link(ob)
    return ob


ground = mesh('ground', data['ground'], True)
occ = mesh('occ', data['occ'])
lib = mesh('lib', data['lib'])

me = ground.data
x0, z0, s = data['rect']
lx, lz, lw, lh = data['lib_rect']
full = me.uv_layers.new(name='full'); near = me.uv_layers.new(name='near')
for loop in me.loops:
    x, y, _ = me.vertices[loop.vertex_index].co          # y = -z of the model
    full.data[loop.index].uv = ((x - x0) / s, 1 - (-y - z0) / s)
    near.data[loop.index].uv = ((x - lx) / lw, 1 - (-y - lz) / lh)

mat = bpy.data.materials.new('bake'); mat.use_nodes = True
node = mat.node_tree.nodes.new('ShaderNodeTexImage')
mat.node_tree.nodes.active = node; node.select = True
me.materials.append(mat)
bpy.context.view_layer.objects.active = ground
ground.select_set(True)


def bake(name, uv, with_lib, w, h):
    img = bpy.data.images.new(name, w, h, alpha=False)
    img.colorspace_settings.name = 'Non-Color'
    node.image = img
    me.uv_layers.active = me.uv_layers[uv]
    me.uv_layers[uv].active_render = True
    lib.hide_render = not with_lib
    t = time.time()
    bpy.ops.object.bake(type='AO')
    img.filepath_raw = os.path.join(out, name + '.png'); img.file_format = 'PNG'; img.save()
    print('baked %s %dx%d in %.0f s' % (name, w, h, time.time() - t), flush=True)


bake('ao_site', 'full', False, size, size)
nh = int(round(size * lh / lw / 4) * 4)
bake('ao_lib0', 'near', False, size, nh)
bake('ao_lib1', 'near', True, size, nh)
