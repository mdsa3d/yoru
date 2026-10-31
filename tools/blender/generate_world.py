"""Realistic World Infrastructure, Props & Road Hazards Generator using Blender Python API.
Generates high-detail 3D models in assets/models/world/:
- gantry.glb  (Highway overhead space-frame steel truss gantry with LED matrix signs & radar pods)
- tower.glb   (Architectural curtain-wall skyscraper with mullions, setbacks, helipad & comms spire)
- barrier.glb (Contoured F-profile Jersey crash barrier with drainage cutouts, chevron panel & beacons)
- debris.glb  (3 road debris nodes: `debris1` concrete/rebar slab, `debris2` wrecked tire/rim, `debris3` cargo case)
- props.glb   (World infrastructure nodes: `streetlamp`, `pylon`, `wind-turbine`, `air-gate`)

Run via: blender --background --python tools/blender/generate_world.py
"""

import bpy
import bmesh
import math
import os
from mathutils import Vector, Matrix


def init_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    if not bpy.data.collections:
        col = bpy.data.collections.new("Scene Collection")
        bpy.context.scene.collection.children.link(col)


def create_pbr_mat(name, base_color, metallic=0.0, roughness=0.5, emissive=None, emissive_strength=1.0):
    mat = bpy.data.materials.new(name=name)
    mat.use_nodes = True
    nodes = mat.node_tree.nodes
    nodes.clear()

    out_node = nodes.new(type='ShaderNodeOutputMaterial')
    bsdf_node = nodes.new(type='ShaderNodeBsdfPrincipled')

    if 'Base Color' in bsdf_node.inputs:
        bsdf_node.inputs['Base Color'].default_value = base_color
    if 'Metallic' in bsdf_node.inputs:
        bsdf_node.inputs['Metallic'].default_value = metallic
    if 'Roughness' in bsdf_node.inputs:
        bsdf_node.inputs['Roughness'].default_value = roughness

    if emissive:
        if 'Emission Color' in bsdf_node.inputs:
            bsdf_node.inputs['Emission Color'].default_value = emissive
        elif 'Emission' in bsdf_node.inputs:
            bsdf_node.inputs['Emission'].default_value = emissive
        if 'Emission Strength' in bsdf_node.inputs:
            bsdf_node.inputs['Emission Strength'].default_value = emissive_strength

    mat.node_tree.links.new(bsdf_node.outputs['BSDF'], out_node.inputs['Surface'])
    return mat


def add_cylinder_between(bm, p1, p2, r1, r2=None, segments=10, cap_ends=True):
    if r2 is None:
        r2 = r1
    v1 = Vector(p1)
    v2 = Vector(p2)
    diff = v2 - v1
    length = diff.length
    if length < 1e-5:
        return []
    direction = diff.normalized()
    up = Vector((0, 0, 1))
    if abs(direction.dot(up)) > 0.999:
        rot = Matrix.Identity(3) if direction.z > 0 else Matrix.Rotation(math.pi, 3, 'X')
    else:
        axis = up.cross(direction).normalized()
        angle = math.acos(max(-1.0, min(1.0, up.dot(direction))))
        rot = Matrix.Rotation(angle, 3, axis)

    mid = (v1 + v2) * 0.5
    xform = Matrix.Translation(mid) @ rot.to_4x4()
    ret = bmesh.ops.create_cone(
        bm,
        cap_ends=cap_ends,
        cap_tris=False,
        segments=segments,
        radius1=r1,
        radius2=r2,
        depth=length,
        matrix=xform,
    )
    verts_set = set(ret['verts'])
    return [f for f in bm.faces if all(v in verts_set for v in f.verts)]


def add_beveled_box(bm, center, size, bevel=0.02, rx=0.0, ry=0.0, rz=0.0):
    hx, hy, hz = size[0] * 0.5, size[1] * 0.5, size[2] * 0.5
    rot = (
        Matrix.Rotation(rz, 4, 'Z')
        @ Matrix.Rotation(ry, 4, 'Y')
        @ Matrix.Rotation(rx, 4, 'X')
    )
    xform = Matrix.Translation(center) @ rot
    b = min(bevel, hx * 0.35, hy * 0.35, hz * 0.35)
    profiles = [
        (-hy, hx - b, hz - b),
        (-hy + b, hx, hz),
        (hy - b, hx, hz),
        (hy, hx - b, hz - b),
    ]
    pts_circle = [
        (1, 0.65), (0.65, 1), (-0.65, 1), (-1, 0.65),
        (-1, -0.65), (-0.65, -1), (0.65, -1), (1, -0.65),
    ]
    rings = []
    for py, pw, ph in profiles:
        ring = []
        for cx, cz in pts_circle:
            ring.append(bm.verts.new(xform @ Vector((cx * pw, py, cz * ph))))
        rings.append(ring)

    faces = []
    for i in range(len(rings) - 1):
        for j in range(len(pts_circle)):
            nj = (j + 1) % len(pts_circle)
            faces.append(bm.faces.new((rings[i][j], rings[i + 1][j], rings[i + 1][nj], rings[i][nj])))
    faces.append(bm.faces.new(rings[0][::-1]))
    faces.append(bm.faces.new(rings[-1]))
    return faces


def generate_gantry(out_path):
    """Generates a space-frame truss highway gantry spanning the 18m roadway (`gantry.glb`)."""
    init_scene()
    materials = [
        create_pbr_mat("GantrySteel", (0.20, 0.25, 0.30, 1.0), metallic=0.88, roughness=0.30),
        create_pbr_mat("GantryConcrete", (0.34, 0.37, 0.40, 1.0), metallic=0.08, roughness=0.82),
        create_pbr_mat("SignNeonCyan", (0.15, 0.92, 1.0, 1.0), emissive=(0.15, 0.92, 1.0, 1.0), emissive_strength=4.5),
        create_pbr_mat("SignNeonAmber", (1.0, 0.62, 0.12, 1.0), emissive=(1.0, 0.62, 0.12, 1.0), emissive_strength=4.8),
    ]

    bm = bmesh.new()
    face_mats = []

    # 1. Left & Right Concrete Crash Plinths & Dual Lattice Columns (at x = +-9.8m)
    for side in [-1, 1]:
        cx = side * 9.8
        # Concrete base plinth
        for f in add_beveled_box(bm, (cx, 0.0, 0.65), (1.1, 1.6, 1.3), bevel=0.08):
            face_mats.append((f, 1))
        # Front & rear tubular steel uprights + diagonal lattice bracing
        for y_col in (-0.48, 0.48):
            for f in add_cylinder_between(bm, (cx, y_col, 1.2), (cx, y_col, 9.2), 0.16, 0.14, segments=12):
                face_mats.append((f, 0))
        for z_step in range(1, 9):
            z0 = float(z_step)
            z1 = float(z_step + 1)
            for f in add_cylinder_between(bm, (cx, -0.48, z0), (cx, 0.48, z0), 0.065, segments=8):
                face_mats.append((f, 0))
            for f in add_cylinder_between(bm, (cx, -0.48, z0), (cx, 0.48, z1), 0.055, segments=8):
                face_mats.append((f, 0))
        # Diagonal knee brace to overhead truss
        for y_col in (-0.48, 0.48):
            for f in add_cylinder_between(bm, (cx, y_col, 6.4), (side * 7.6, y_col, 8.2), 0.11, segments=10):
                face_mats.append((f, 0))

    # 2. Overhead 3-Chord Space-Frame Truss Bridge (spanning -10.2m to +10.2m)
    chords = [(0.48, 8.2), (-0.48, 8.2), (0.0, 9.35)]
    for cy, cz in chords:
        for f in add_cylinder_between(bm, (-10.2, cy, cz), (10.2, cy, cz), 0.11, segments=12):
            face_mats.append((f, 0))

    n_bays = 12
    for b_idx in range(n_bays + 1):
        bx = -9.6 + (19.2 * b_idx) / n_bays
        # Triangle frame ribs
        for i_c in range(3):
            y1, z1 = chords[i_c]
            y2, z2 = chords[(i_c + 1) % 3]
            for f in add_cylinder_between(bm, (bx, y1, z1), (bx, y2, z2), 0.055, segments=8):
                face_mats.append((f, 0))
        # Diagonal web members
        if b_idx < n_bays:
            nx = -9.6 + (19.2 * (b_idx + 1)) / n_bays
            for i_c in range(3):
                y1, z1 = chords[i_c]
                y2, z2 = chords[(i_c + 1) % 3]
                for f in add_cylinder_between(bm, (bx, y1, z1), (nx, y2, z2), 0.045, segments=8):
                    face_mats.append((f, 0))

    # 3. Variable Message LED Lane Matrix Signs & Radar Camera Pods (for lanes at -4.5, 0, +4.5)
    for lx in (-4.8, 0.0, 4.8):
        # Sign housing
        for f in add_beveled_box(bm, (lx, -0.62, 8.55), (3.4, 0.22, 1.35), bevel=0.03):
            face_mats.append((f, 0))
        # Illuminated LED matrix display face (both sides so visible approaching)
        for sy in (-0.74, 0.74):
            for f in add_beveled_box(bm, (lx, sy, 8.55), (3.1, 0.03, 1.05), bevel=0.01):
                face_mats.append((f, 2))
        # Under-slung radar/optical scanner pod
        for f in add_beveled_box(bm, (lx, -0.55, 7.65), (0.45, 0.42, 0.26), bevel=0.02, rx=0.25):
            face_mats.append((f, 0))

    # 4. Corner Amber Hazard Beacons
    for sx in (-9.8, 9.8):
        for f in add_cylinder_between(bm, (sx, 0.0, 9.25), (sx, 0.0, 9.65), 0.16, 0.12, segments=12):
            face_mats.append((f, 3))

    mesh = bpy.data.meshes.new("GantryMesh")
    bm.to_mesh(mesh)
    bm.free()
    for m in materials:
        mesh.materials.append(m)
    for idx, poly in enumerate(mesh.polygons):
        poly.use_smooth = True
        if idx < len(face_mats):
            poly.material_index = face_mats[idx][1]

    obj = bpy.data.objects.new("gantry", mesh)
    bpy.context.scene.collection.objects.link(obj)
    bpy.ops.export_scene.gltf(filepath=out_path, export_format='GLB', export_yup=True)
    print(f"Exported: {out_path} ({os.path.getsize(out_path)} bytes)")


def generate_tower(out_path):
    """Generates a detailed architectural curtain-wall skyscraper (`tower.glb`)."""
    init_scene()
    materials = [
        create_pbr_mat("TowerFacade", (0.10, 0.14, 0.19, 1.0), metallic=0.45, roughness=0.52),
        create_pbr_mat("TowerGlass", (0.05, 0.11, 0.17, 1.0), metallic=0.88, roughness=0.08),
        create_pbr_mat("TowerNeon", (0.24, 0.88, 1.0, 1.0), emissive=(0.24, 0.88, 1.0, 1.0), emissive_strength=5.2),
        create_pbr_mat("TowerBeacon", (1.0, 0.22, 0.18, 1.0), emissive=(1.0, 0.22, 0.18, 1.0), emissive_strength=6.0),
    ]

    bm = bmesh.new()
    face_mats = []

    tiers = [
        # (z_bottom, z_top, width, depth)
        (0.0,  42.0, 34.0, 34.0),
        (42.0, 82.0, 26.0, 26.0),
        (82.0, 114.0, 18.0, 18.0),
    ]
    for zb, zt, tw, td in tiers:
        th = zt - zb
        zc = (zb + zt) * 0.5
        # Inner glass curtain-wall core
        for f in add_beveled_box(bm, (0, 0, zc), (tw - 0.8, td - 0.8, th), bevel=0.3):
            face_mats.append((f, 1))
        # Structural corner megacolumns
        for sx in (-1, 1):
            for sy in (-1, 1):
                for f in add_beveled_box(bm, (sx * tw * 0.48, sy * td * 0.48, zc), (2.4, 2.4, th + 0.4), bevel=0.15):
                    face_mats.append((f, 0))
        # Vertical facade mullions & horizontal mechanical floor bands
        for m_off in (-0.22, 0.0, 0.22):
            for side in (-1, 1):
                for f in add_beveled_box(bm, (m_off * tw, side * td * 0.49, zc), (0.65, 0.65, th), bevel=0.05):
                    face_mats.append((f, 0))
                for f in add_beveled_box(bm, (side * tw * 0.49, m_off * td, zc), (0.65, 0.65, th), bevel=0.05):
                    face_mats.append((f, 0))
        for z_band in [zb + th * 0.33, zb + th * 0.66, zt]:
            for f in add_beveled_box(bm, (0, 0, z_band), (tw + 0.6, td + 0.6, 1.1), bevel=0.12):
                face_mats.append((f, 0))
        # Vertical neon edge fins on upper two tiers
        if zb > 0:
            for sx in (-1, 1):
                for sy in (-1, 1):
                    for f in add_beveled_box(bm, (sx * tw * 0.51, sy * td * 0.51, zc), (0.32, 0.32, th - 2.0), bevel=0.04):
                        face_mats.append((f, 2))

    # Rooftop Mechanical Penthouse, Helipad Deck & Lattice Antenna Mast
    for f in add_beveled_box(bm, (0, 0, 117.0), (11.5, 11.5, 6.0), bevel=0.25):
        face_mats.append((f, 0))
    for f in add_cylinder_between(bm, (0, 0, 120.0), (0, 0, 120.8), 4.8, 5.2, segments=20):
        face_mats.append((f, 0))
    for f in add_cylinder_between(bm, (0, 0, 120.8), (0, 0, 138.0), 0.55, 0.18, segments=12):
        face_mats.append((f, 0))
    for f in add_cylinder_between(bm, (0, 0, 138.0), (0, 0, 139.6), 0.35, 0.35, segments=12):
        face_mats.append((f, 3))

    mesh = bpy.data.meshes.new("TowerMesh")
    bm.to_mesh(mesh)
    bm.free()
    for m in materials:
        mesh.materials.append(m)
    for idx, poly in enumerate(mesh.polygons):
        poly.use_smooth = False
        if idx < len(face_mats):
            poly.material_index = face_mats[idx][1]

    obj = bpy.data.objects.new("tower", mesh)
    bpy.context.scene.collection.objects.link(obj)
    bpy.ops.export_scene.gltf(filepath=out_path, export_format='GLB', export_yup=True)
    print(f"Exported: {out_path} ({os.path.getsize(out_path)} bytes)")


def generate_barrier(out_path):
    """Generates a true F-profile concrete/polymer Jersey crash barrier with chevron board & beacons (`barrier.glb`)."""
    init_scene()
    materials = [
        create_pbr_mat("BarrierRed", (0.88, 0.16, 0.14, 1.0), metallic=0.18, roughness=0.45),
        create_pbr_mat("BarrierConcrete", (0.38, 0.41, 0.44, 1.0), metallic=0.08, roughness=0.82),
        create_pbr_mat("BarrierNeonStrip", (1.0, 0.72, 0.12, 1.0), emissive=(1.0, 0.72, 0.12, 1.0), emissive_strength=4.8),
        create_pbr_mat("BarrierSteel", (0.24, 0.28, 0.32, 1.0), metallic=0.88, roughness=0.28),
    ]

    bm = bmesh.new()
    face_mats = []

    # True F-shape Jersey Barrier profile extruded along X (-1.25m to +1.25m)
    # Cross section in YZ plane:
    jersey_profile = [
        (-0.34, 0.00),
        ( 0.34, 0.00),
        ( 0.34, 0.08),
        ( 0.22, 0.32),
        ( 0.13, 0.88),
        ( 0.11, 0.96),
        (-0.11, 0.96),
        (-0.13, 0.88),
        (-0.22, 0.32),
        (-0.34, 0.08),
    ]
    x_stations = [-1.25, -0.75, -0.25, 0.25, 0.75, 1.25]
    rings = []
    for x_val in x_stations:
        rings.append([bm.verts.new((x_val, py, pz)) for py, pz in jersey_profile])

    n_p = len(jersey_profile)
    for s in range(len(x_stations) - 1):
        # Alternate red/concrete high-visibility hazard segments
        seg_mat = 0 if s % 2 == 0 else 1
        for j in range(n_p):
            nj = (j + 1) % n_p
            f = bm.faces.new((rings[s][j], rings[s + 1][j], rings[s + 1][nj], rings[s][nj]))
            face_mats.append((f, 1 if j in (0, 1, 9) else seg_mat))
    face_mats.append((bm.faces.new(rings[0][::-1]), 1))
    face_mats.append((bm.faces.new(rings[-1]), 1))

    # Top Steel Hazard Frame, Illuminated Chevron Warning Bar & Dual Flashing Beacons
    for sx in (-0.85, 0.85):
        for f in add_cylinder_between(bm, (sx, 0.0, 0.96), (sx, 0.0, 1.34), 0.032, segments=10):
            face_mats.append((f, 3))
        # Flashing beacon dome on top
        for f in add_cylinder_between(bm, (sx, 0.0, 1.34), (sx, 0.0, 1.46), 0.068, 0.052, segments=14):
            face_mats.append((f, 2))
    for f in add_beveled_box(bm, (0.0, 0.0, 1.18), (2.25, 0.09, 0.24), bevel=0.015):
        face_mats.append((f, 3))
    for sy in (-0.05, 0.05):
        for f in add_beveled_box(bm, (0.0, sy, 1.18), (2.10, 0.015, 0.16), bevel=0.005):
            face_mats.append((f, 2))

    mesh = bpy.data.meshes.new("BarrierMesh")
    bm.to_mesh(mesh)
    bm.free()
    for m in materials:
        mesh.materials.append(m)
    for idx, poly in enumerate(mesh.polygons):
        poly.use_smooth = True
        if idx < len(face_mats):
            poly.material_index = face_mats[idx][1]

    obj = bpy.data.objects.new("barrier", mesh)
    bpy.context.scene.collection.objects.link(obj)
    bpy.ops.export_scene.gltf(filepath=out_path, export_format='GLB', export_yup=True)
    print(f"Exported: {out_path} ({os.path.getsize(out_path)} bytes)")


def generate_debris(out_path):
    """Generates 3 realistic road-hazard debris nodes (`debris1`, `debris2`, `debris3`) in `debris.glb`."""
    init_scene()
    mat_concrete = create_pbr_mat("DebrisConcrete", (0.44, 0.43, 0.39, 1.0), metallic=0.08, roughness=0.88)
    mat_rubber = create_pbr_mat("DebrisRubber", (0.08, 0.09, 0.11, 1.0), metallic=0.12, roughness=0.84)
    mat_crate = create_pbr_mat("DebrisCrate", (0.58, 0.36, 0.16, 1.0), metallic=0.42, roughness=0.52)

    # 1. `debris1`: Fractured Concrete Highway Slab with Protruding Rebar Rods
    bm1 = bmesh.new()
    # Irregular fractured rock/concrete polyhedron + rebar rods
    top_pts = [
        (-0.34, -0.26, 0.28), (0.05, -0.38, 0.34), (0.38, -0.18, 0.24),
        (0.32, 0.28, 0.32), (-0.08, 0.36, 0.29), (-0.38, 0.16, 0.22),
    ]
    bot_pts = [
        (-0.42, -0.32, 0.0), (0.08, -0.44, 0.0), (0.44, -0.22, 0.0),
        (0.38, 0.34, 0.0), (-0.12, 0.42, 0.0), (-0.44, 0.20, 0.0),
    ]
    tv = [bm1.verts.new(p) for p in top_pts]
    bv = [bm1.verts.new(p) for p in bot_pts]
    center_top = bm1.verts.new((0.02, 0.03, 0.39))
    for i in range(len(tv)):
        ni = (i + 1) % len(tv)
        bm1.faces.new((bv[i], bv[ni], tv[ni], tv[i]))
        bm1.faces.new((tv[i], tv[ni], center_top))
    bm1.faces.new(bv[::-1])
    # Protruding bent steel rebar rods
    add_cylinder_between(bm1, (0.18, 0.05, 0.16), (0.48, 0.14, 0.24), 0.018, segments=8)
    add_cylinder_between(bm1, (-0.15, -0.12, 0.18), (-0.46, -0.22, 0.28), 0.018, segments=8)

    m1 = bpy.data.meshes.new("debris1_mesh")
    bm1.to_mesh(m1)
    bm1.free()
    m1.materials.append(mat_concrete)
    for p in m1.polygons:
        p.use_smooth = False
    o1 = bpy.data.objects.new("debris1", m1)
    bpy.context.scene.collection.objects.link(o1)

    # 2. `debris2`: Wrecked Heavy Radial Tire & Bent Spoked Rim lying canted on the road
    bm2 = bmesh.new()
    segs = 24
    cross = 10
    r_c = 0.28
    r_t = 0.11
    tilt = Matrix.Rotation(0.22, 4, 'X') @ Matrix.Rotation(-0.18, 4, 'Y')
    rings = []
    for i in range(segs):
        phi = (2.0 * math.pi * i) / segs
        cp, sp = math.cos(phi), math.sin(phi)
        ring = []
        for j in range(cross):
            th = (2.0 * math.pi * j) / cross
            rd = r_c + math.cos(th) * r_t
            zv = 0.14 + math.sin(th) * 0.10
            co = tilt @ Vector((cp * rd, sp * rd, zv))
            ring.append(bm2.verts.new((co.x, co.y, max(0.01, co.z))))
        rings.append(ring)
    for i in range(segs):
        ni = (i + 1) % segs
        for j in range(cross):
            nj = (j + 1) % cross
            bm2.faces.new((rings[i][j], rings[ni][j], rings[ni][nj], rings[i][nj]))
    # Inner hub & spokes
    add_cylinder_between(bm2, (0, 0, 0.05), (0, 0, 0.22), 0.08, segments=12)
    for s in range(5):
        a = (2.0 * math.pi * s) / 5.0
        add_cylinder_between(bm2, (0, 0, 0.14), (math.cos(a) * 0.22, math.sin(a) * 0.22, 0.14), 0.022, segments=8)

    m2 = bpy.data.meshes.new("debris2_mesh")
    bm2.to_mesh(m2)
    bm2.free()
    m2.materials.append(mat_rubber)
    for p in m2.polygons:
        p.use_smooth = True
    o2 = bpy.data.objects.new("debris2", m2)
    bpy.context.scene.collection.objects.link(o2)

    # 3. `debris3`: Crushed Industrial Cargo Case with Structural Ribs
    bm3 = bmesh.new()
    add_beveled_box(bm3, (0.0, 0.0, 0.24), (0.76, 0.56, 0.46), bevel=0.04, rz=0.28)
    for rib_x in (-0.24, 0.0, 0.24):
        add_beveled_box(bm3, (rib_x, 0.0, 0.25), (0.08, 0.60, 0.49), bevel=0.015, rz=0.28)

    m3 = bpy.data.meshes.new("debris3_mesh")
    bm3.to_mesh(m3)
    bm3.free()
    m3.materials.append(mat_crate)
    for p in m3.polygons:
        p.use_smooth = True
    o3 = bpy.data.objects.new("debris3", m3)
    bpy.context.scene.collection.objects.link(o3)

    bpy.ops.export_scene.gltf(filepath=out_path, export_format='GLB', export_yup=True)
    print(f"Exported: {out_path} ({os.path.getsize(out_path)} bytes)")


def generate_props(out_path):
    """Generates world infrastructure props (`streetlamp`, `pylon`, `wind-turbine`) in `props.glb`."""
    init_scene()
    mat_steel = create_pbr_mat("PropSteel", (0.48, 0.54, 0.60, 1.0), metallic=0.88, roughness=0.28)
    mat_concrete = create_pbr_mat("PropConcrete", (0.32, 0.36, 0.40, 1.0), metallic=0.08, roughness=0.84)
    mat_neon = create_pbr_mat("PropNeon", (0.35, 0.95, 1.0, 1.0), emissive=(0.35, 0.95, 1.0, 1.0), emissive_strength=4.5)
    mat_beacon = create_pbr_mat("PropBeacon", (1.0, 0.36, 0.22, 1.0), emissive=(1.0, 0.36, 0.22, 1.0), emissive_strength=5.5)

    # 1. `streetlamp`: Tapered Highway Cantilever LED Streetlamp (at origin, arm reaching -X toward road)
    bm_lamp = bmesh.new()
    lamp_mats = []
    # Concrete base pedestal
    for f in add_cylinder_between(bm_lamp, (0, 0, 0.0), (0, 0, 0.8), 0.22, 0.16, segments=12):
        lamp_mats.append((f, 1))
    # Tapered octagonal steel mast
    for f in add_cylinder_between(bm_lamp, (0, 0, 0.8), (0, 0, 7.6), 0.13, 0.075, segments=12):
        lamp_mats.append((f, 0))
    # Curved cantilever arm reaching 2.6m over road (-X)
    arm_pts = [(0, 0, 7.4), (-0.6, 0, 7.85), (-1.5, 0, 8.05), (-2.6, 0, 8.10)]
    for i in range(len(arm_pts) - 1):
        for f in add_cylinder_between(bm_lamp, arm_pts[i], arm_pts[i + 1], 0.065 - i * 0.01, 0.055 - i * 0.01, segments=10):
            lamp_mats.append((f, 0))
    # Aerodynamic cobra-head LED luminaire housing & glowing downward lens
    for f in add_beveled_box(bm_lamp, (-2.35, 0.0, 8.12), (1.15, 0.32, 0.11), bevel=0.02):
        lamp_mats.append((f, 0))
    for f in add_beveled_box(bm_lamp, (-2.35, 0.0, 8.05), (0.98, 0.24, 0.03), bevel=0.005):
        lamp_mats.append((f, 2))

    m_lamp = bpy.data.meshes.new("streetlamp_mesh")
    bm_lamp.to_mesh(m_lamp)
    bm_lamp.free()
    for m in (mat_steel, mat_concrete, mat_neon):
        m_lamp.materials.append(m)
    for idx, poly in enumerate(m_lamp.polygons):
        poly.use_smooth = True
        if idx < len(lamp_mats):
            poly.material_index = lamp_mats[idx][1]
    o_lamp = bpy.data.objects.new("streetlamp", m_lamp)
    bpy.context.scene.collection.objects.link(o_lamp)

    # 2. `pylon`: Monumental 38m Tapered Megastructure Pylon (5m x 7m footprint matching world-data.js)
    bm_pylon = bmesh.new()
    pylon_mats = []
    # Main tapered concrete core with buttress base
    for f in add_beveled_box(bm_pylon, (0, 0, 3.5), (5.4, 7.4, 7.0), bevel=0.35):
        pylon_mats.append((f, 1))
    for f in add_beveled_box(bm_pylon, (0, 0, 20.0), (4.8, 6.8, 34.0), bevel=0.30):
        pylon_mats.append((f, 1))
    # Structural steel collar rings up the tower
    for z_ring in (8.0, 16.0, 24.0, 32.0, 37.8):
        for f in add_beveled_box(bm_pylon, (0, 0, z_ring), (5.2, 7.2, 0.75), bevel=0.08):
            pylon_mats.append((f, 0))
    # Vertical neon guide strips on front & back faces
    for sx in (-2.48, 2.48):
        for sy in (-3.48, 3.48):
            for f in add_beveled_box(bm_pylon, (sx, sy, 20.0), (0.14, 0.14, 34.0), bevel=0.02):
                pylon_mats.append((f, 2))
    # Rooftop communications crown & aviation warning beacon
    for f in add_cylinder_between(bm_pylon, (0, 0, 38.0), (0, 0, 39.2), 0.32, 0.28, segments=14):
        pylon_mats.append((f, 3))

    m_pylon = bpy.data.meshes.new("pylon_mesh")
    bm_pylon.to_mesh(m_pylon)
    bm_pylon.free()
    for m in (mat_steel, mat_concrete, mat_neon, mat_beacon):
        m_pylon.materials.append(m)
    for idx, poly in enumerate(m_pylon.polygons):
        poly.use_smooth = True
        if idx < len(pylon_mats):
            poly.material_index = pylon_mats[idx][1]
    o_pylon = bpy.data.objects.new("pylon", m_pylon)
    bpy.context.scene.collection.objects.link(o_pylon)

    bpy.ops.export_scene.gltf(filepath=out_path, export_format='GLB', export_yup=True)
    print(f"Exported: {out_path} ({os.path.getsize(out_path)} bytes)")


def main():
    print("=== Generating Realistic World Infrastructure & Hazard Assets ===")
    out_dir = os.path.abspath("assets/models/world")
    os.makedirs(out_dir, exist_ok=True)
    generate_gantry(os.path.join(out_dir, "gantry.glb"))
    generate_tower(os.path.join(out_dir, "tower.glb"))
    generate_barrier(os.path.join(out_dir, "barrier.glb"))
    generate_debris(os.path.join(out_dir, "debris.glb"))
    generate_props(os.path.join(out_dir, "props.glb"))
    print("=== All World Assets Generated Successfully ===")


if __name__ == "__main__":
    main()
