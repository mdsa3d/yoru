"""Realistic High-Detail Supercharged Hyperbike Generator (Kestrel) using Blender Python API.
Combines the sculpted 10k-triangle CC0 motorcycle chassis/wheels with Blender-modeled
mechanical assemblies: USD gold forks, CNC triple clamps, drilled brake rotors, radial
calipers, 4-into-1 curved Bezier titanium exhaust headers, carbon muffler, drive chain,
reactive brake-light cluster, and a full 1st-person cockpit assembly.

Run via: blender --background --python tools/blender/generate_motorcycle.py
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


def create_pbr_material(
    name,
    base_color,
    metallic=0.0,
    roughness=0.5,
    emissive=None,
    emissive_strength=1.0,
    alpha=1.0,
):
    mat = bpy.data.materials.new(name=name)
    mat.use_nodes = True
    nodes = mat.node_tree.nodes
    nodes.clear()

    node_output = nodes.new(type='ShaderNodeOutputMaterial')
    node_principled = nodes.new(type='ShaderNodeBsdfPrincipled')

    if 'Base Color' in node_principled.inputs:
        node_principled.inputs['Base Color'].default_value = base_color
    if 'Metallic' in node_principled.inputs:
        node_principled.inputs['Metallic'].default_value = metallic
    if 'Roughness' in node_principled.inputs:
        node_principled.inputs['Roughness'].default_value = roughness
    if alpha < 1.0 and 'Alpha' in node_principled.inputs:
        node_principled.inputs['Alpha'].default_value = alpha
        if hasattr(mat, 'blend_method'):
            mat.blend_method = 'BLEND'

    if emissive:
        if 'Emission Color' in node_principled.inputs:
            node_principled.inputs['Emission Color'].default_value = emissive
        elif 'Emission' in node_principled.inputs:
            node_principled.inputs['Emission'].default_value = emissive
        if 'Emission Strength' in node_principled.inputs:
            node_principled.inputs['Emission Strength'].default_value = emissive_strength

    mat.node_tree.links.new(node_principled.outputs['BSDF'], node_output.inputs['Surface'])
    return mat


def add_cylinder_between(bm, p1, p2, r1, r2=None, segments=12, cap_ends=True):
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


def add_tube_along_points(bm, points, radius, segments=10, cap_ends=True):
    rings = []
    for idx, pt in enumerate(points):
        p = Vector(pt)
        if idx == 0:
            tangent = (Vector(points[1]) - p).normalized()
        elif idx == len(points) - 1:
            tangent = (p - Vector(points[idx - 1])).normalized()
        else:
            tangent = (Vector(points[idx + 1]) - Vector(points[idx - 1])).normalized()

        ref = Vector((1, 0, 0)) if abs(tangent.x) < 0.85 else Vector((0, 1, 0))
        normal = tangent.cross(ref).normalized()
        binormal = tangent.cross(normal).normalized()

        r = radius[idx] if isinstance(radius, (list, tuple)) else radius
        ring = []
        for s in range(segments):
            theta = (2.0 * math.pi * s) / segments
            offset = normal * (math.cos(theta) * r) + binormal * (math.sin(theta) * r)
            ring.append(bm.verts.new(p + offset))
        rings.append(ring)

    faces = []
    for i in range(len(rings) - 1):
        for s in range(segments):
            ns = (s + 1) % segments
            faces.append(bm.faces.new((rings[i][s], rings[i + 1][s], rings[i + 1][ns], rings[i][ns])))
    if cap_ends and rings:
        faces.append(bm.faces.new(rings[0][::-1]))
        faces.append(bm.faces.new(rings[-1]))
    return faces


def add_beveled_box(bm, center, size, bevel=0.015, rx=0.0, ry=0.0, rz=0.0):
    hx, hy, hz = size[0] * 0.5, size[1] * 0.5, size[2] * 0.5
    rot = (
        Matrix.Rotation(rz, 4, 'Z')
        @ Matrix.Rotation(ry, 4, 'Y')
        @ Matrix.Rotation(rx, 4, 'X')
    )
    xform = Matrix.Translation(center) @ rot

    # 3-section lofted beveled box
    b = min(bevel, hx * 0.4, hy * 0.4, hz * 0.4)
    profiles = [
        (-hy, hx - b, hz - b),
        (-hy + b, hx, hz),
        (hy - b, hx, hz),
        (hy, hx - b, hz - b),
    ]
    rings = []
    pts_circle = [
        (1, 0.6), (0.6, 1), (-0.6, 1), (-1, 0.6),
        (-1, -0.6), (-0.6, -1), (0.6, -1), (1, -0.6),
    ]
    for py, pw, ph in profiles:
        ring = []
        for cx, cz in pts_circle:
            co = xform @ Vector((cx * pw, py, cz * ph))
            ring.append(bm.verts.new(co))
        rings.append(ring)

    faces = []
    for i in range(len(rings) - 1):
        for j in range(len(pts_circle)):
            nj = (j + 1) % len(pts_circle)
            faces.append(bm.faces.new((rings[i][j], rings[i + 1][j], rings[i + 1][nj], rings[i][nj])))
    faces.append(bm.faces.new(rings[0][::-1]))
    faces.append(bm.faces.new(rings[-1]))
    return faces


def parse_source_obj(obj_path):
    """Parse fancy-motorcycle-source.obj and separate chassis, front-wheel, rear-wheel in Blender coords."""
    verts_raw = []
    faces_raw = []
    cur_mat = ''
    with open(obj_path, 'r', encoding='utf-8') as fh:
        for line in fh:
            parts = line.strip().split()
            if not parts:
                continue
            if parts[0] == 'v':
                verts_raw.append((float(parts[1]), float(parts[2]), float(parts[3])))
            elif parts[0] == 'usemtl':
                cur_mat = parts[1]
            elif parts[0] == 'f':
                v_indices = [int(tok.split('/')[0]) - 1 for tok in parts[1:]]
                faces_raw.append((v_indices, cur_mat))

    n_verts = len(verts_raw)
    parent = list(range(n_verts))

    def find(x):
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x

    def union(a, b):
        ra, rb = find(a), find(b)
        if ra != rb:
            parent[ra] = rb

    pos_map = {}
    for i, p in enumerate(verts_raw):
        key = (round(p[0], 5), round(p[1], 5), round(p[2], 5))
        if key in pos_map:
            union(i, pos_map[key])
        else:
            pos_map[key] = i

    for v_ids, _ in faces_raw:
        first = v_ids[0]
        for vi in v_ids[1:]:
            union(first, vi)

    comp_verts = {}
    for v_ids, _ in faces_raw:
        root_id = find(v_ids[0])
        comp_verts.setdefault(root_id, []).extend(v_ids)

    wheel_ids = {}
    for comp_id, ids in comp_verts.items():
        xs = [verts_raw[i][0] for i in ids]
        ys = [verts_raw[i][1] for i in ids]
        zs = [verts_raw[i][2] for i in ids]
        bx = max(xs) - min(xs)
        by = max(ys) - min(ys)
        cx = (max(xs) + min(xs)) * 0.5
        if len(ids) > 2000 and bx < 1.5 and by > 1.0:
            wheel_ids[comp_id] = 'front-wheel' if cx > -1.0 else 'rear-wheel'

    # Transform from OBJ to glTF: (z*0.8, y*0.8 + 0.006, -x*0.8 - 1.056)
    # Transform from glTF (Xg, Yg, Zg) to Blender (X, Y, Z) for export_yup=True:
    # Blender X = Xg, Blender Y = -Zg, Blender Z = Yg
    def to_blender(pt):
        xg = pt[2] * 0.8
        yg = pt[1] * 0.8 + 0.006
        zg = -pt[0] * 0.8 - 1.32 * 0.8
        return (xg, -zg, yg)

    verts_bl = [to_blender(p) for p in verts_raw]

    centers = {}
    for comp_id, w_name in wheel_ids.items():
        ids = comp_verts[comp_id]
        xs = [verts_bl[i][0] for i in ids]
        ys = [verts_bl[i][1] for i in ids]
        zs = [verts_bl[i][2] for i in ids]
        centers[w_name] = (
            (max(xs) + min(xs)) * 0.5,
            (max(ys) + min(ys)) * 0.5,
            (max(zs) + min(zs)) * 0.5,
        )

    part_faces = {'chassis': [], 'front-wheel': [], 'rear-wheel': []}
    for v_ids, mat_name in faces_raw:
        comp_id = find(v_ids[0])
        part = wheel_ids.get(comp_id, 'chassis')
        zs = [verts_bl[i][2] for i in v_ids]
        mean_z = sum(zs) / len(zs)
        if mat_name == 'tire':
            mat_idx = 1  # rubber
        elif part == 'chassis' and mean_z > 0.76 and len(comp_verts[comp_id]) > 2000:
            mat_idx = 0  # custom-paint
        else:
            mat_idx = 2  # brushed-alloy
        part_faces[part].append((v_ids, mat_idx))

    return verts_bl, part_faces, centers


def add_brake_rotor_to_wheel(bm, radius, inner_r, x_offset):
    faces = []
    segs = 32
    thick = 0.010
    for side_x in [x_offset - thick * 0.5, x_offset + thick * 0.5]:
        pass
    outer_l, outer_r, inner_l, inner_r_ring = [], [], [], []
    for i in range(segs):
        phi = (2.0 * math.pi * i) / segs
        cy, cz = math.cos(phi), math.sin(phi)
        outer_l.append(bm.verts.new((x_offset - thick * 0.5, cy * radius, cz * radius)))
        outer_r.append(bm.verts.new((x_offset + thick * 0.5, cy * radius, cz * radius)))
        inner_l.append(bm.verts.new((x_offset - thick * 0.5, cy * inner_r, cz * inner_r)))
        inner_r_ring.append(bm.verts.new((x_offset + thick * 0.5, cy * inner_r, cz * inner_r)))

    for i in range(segs):
        ni = (i + 1) % segs
        faces.append(bm.faces.new((inner_l[i], outer_l[i], outer_l[ni], inner_l[ni])))
        faces.append(bm.faces.new((inner_r_ring[i], inner_r_ring[ni], outer_r[ni], outer_r[i])))
        faces.append(bm.faces.new((outer_l[i], outer_r[i], outer_r[ni], outer_l[ni])))
    return faces


def build_wheel_from_source(name, verts_bl, face_list, center, is_front, materials):
    bm = bmesh.new()
    cx, cy, cz = center
    v_map = {}

    def get_vert(vi):
        if vi not in v_map:
            px, py, pz = verts_bl[vi]
            v_map[vi] = bm.verts.new((px - cx, py - cy, pz - cz))
        return v_map[vi]

    face_mats = []
    for v_ids, mat_idx in face_list:
        b_verts = [get_vert(vi) for vi in v_ids]
        # Avoid degenerate faces with duplicate vertices
        unique_verts = []
        for bv in b_verts:
            if bv not in unique_verts:
                unique_verts.append(bv)
        if len(unique_verts) >= 3:
            try:
                f = bm.faces.new(unique_verts)
                face_mats.append((f, mat_idx))
            except ValueError:
                pass

    # Add dual ventilated drilled brake discs to front wheel, single rear rotor to rear wheel
    if is_front:
        for dx in [-0.075, 0.075]:
            for f in add_brake_rotor_to_wheel(bm, 0.21, 0.11, dx):
                face_mats.append((f, 2))  # brushed-alloy
    else:
        for f in add_brake_rotor_to_wheel(bm, 0.17, 0.095, 0.088):
            face_mats.append((f, 2))
        # Rear drive sprocket on left side
        for f in add_brake_rotor_to_wheel(bm, 0.16, 0.085, -0.092):
            face_mats.append((f, 4))  # gold/bronze anodized

    mesh = bpy.data.meshes.new(f"{name}_mesh")
    bm.to_mesh(mesh)
    bm.free()

    for m in materials:
        mesh.materials.append(m)

    for idx, poly in enumerate(mesh.polygons):
        poly.use_smooth = True
        if idx < len(face_mats):
            poly.material_index = face_mats[idx][1]

    obj = bpy.data.objects.new(name, mesh)
    obj.location = center
    bpy.context.scene.collection.objects.link(obj)
    return obj


def build_chassis_with_details(verts_bl, face_list, centers, materials):
    bm = bmesh.new()
    v_map = {}

    def get_vert(vi):
        if vi not in v_map:
            v_map[vi] = bm.verts.new(verts_bl[vi])
        return v_map[vi]

    face_mats = []
    for v_ids, mat_idx in face_list:
        unique_verts = []
        for vi in v_ids:
            bv = get_vert(vi)
            if bv not in unique_verts:
                unique_verts.append(bv)
        if len(unique_verts) >= 3:
            try:
                f = bm.faces.new(unique_verts)
                face_mats.append((f, mat_idx))
            except ValueError:
                pass

    fw = centers['front-wheel']  # ~(0, 1.075, 0.529)
    rw = centers['rear-wheel']   # ~(0, -1.074, 0.437)

    # Material indices:
    # 0: custom-paint, 1: rubber, 2: brushed-alloy, 3: neon, 4: gold-anodized, 5: carbon-fiber, 6: brake-light, 7: glass

    # 1. Inverted USD Gold Front Fork Stanchions & Outer Sliders
    for side in [-0.125, 0.125]:
        top_pt = (side, 0.62, 1.12)
        mid_pt = (side, 0.86, 0.80)
        bot_pt = (side, fw[1], fw[2])
        for f in add_cylinder_between(bm, top_pt, mid_pt, 0.030, 0.028, segments=14):
            face_mats.append((f, 4))  # gold-anodized outer fork tube
        for f in add_cylinder_between(bm, mid_pt, bot_pt, 0.023, 0.023, segments=14):
            face_mats.append((f, 2))  # chrome inner slider
        # Radial 4-piston Brembo-style Brake Calipers
        cal_pos = (side * 0.82, fw[1] - 0.16, fw[2] + 0.05)
        for f in add_beveled_box(bm, cal_pos, (0.045, 0.11, 0.085), bevel=0.01, rx=0.35):
            face_mats.append((f, 4))

    # 2. Structural Trellis Frame & Supercharger Intake Ducts
    for side in [-1, 1]:
        trellis_pts = [
            (side * 0.13, 0.58, 1.04),
            (side * 0.21, 0.28, 0.92),
            (side * 0.22, -0.05, 0.78),
            (side * 0.17, -0.22, 0.58),
        ]
        for f in add_tube_along_points(bm, trellis_pts, 0.018, segments=10):
            face_mats.append((f, 2))
        # Subframe strut
        for f in add_cylinder_between(
            bm,
            (side * 0.19, 0.25, 0.90),
            (side * 0.17, -0.15, 0.62),
            0.014,
            segments=8,
        ):
            face_mats.append((f, 2))
        # Carbon fiber aero side winglets (H2R style)
        wing_pts = [
            (side * 0.24, 0.74, 0.96),
            (side * 0.38, 0.68, 0.93),
            (side * 0.42, 0.62, 0.88),
        ]
        for f in add_tube_along_points(bm, wing_pts, [0.022, 0.032, 0.012], segments=8):
            face_mats.append((f, 5))  # carbon-fiber

    # 3. 4-into-2-into-1 Curved Titanium Exhaust Headers & Angled Carbon Silencer
    for cyl_idx, x_off in enumerate([-0.13, -0.045, 0.045, 0.13]):
        header_curve = [
            (x_off, 0.34, 0.68),
            (x_off * 1.15, 0.46, 0.55),
            (x_off * 0.85, 0.38, 0.38),
            (0.08 + cyl_idx * 0.02, 0.05, 0.33),
            (0.16, -0.32, 0.36),
        ]
        for f in add_tube_along_points(bm, header_curve, 0.020, segments=10):
            face_mats.append((f, 2))

    # Swept megaphone exhaust silencer on right side
    muffler_pts = [
        (0.16, -0.32, 0.36),
        (0.22, -0.58, 0.46),
        (0.25, -0.92, 0.64),
        (0.25, -1.02, 0.69),
    ]
    for f in add_tube_along_points(bm, muffler_pts, [0.028, 0.052, 0.062, 0.048], segments=14):
        face_mats.append((f, 5))  # carbon-fiber body

    # 4. Rear Monoshock & Drive Chain
    for f in add_cylinder_between(bm, (0.0, -0.12, 0.78), (0.0, -0.38, 0.52), 0.034, segments=12):
        face_mats.append((f, 4))  # gold shock reservoir
    chain_pts = [
        (-0.11, -0.12, 0.54),
        (-0.11, rw[1], rw[2] + 0.14),
        (-0.11, rw[1] - 0.14, rw[2]),
        (-0.11, rw[1], rw[2] - 0.14),
        (-0.11, -0.12, 0.44),
    ]
    for f in add_tube_along_points(bm, chain_pts, 0.011, segments=8, cap_ends=False):
        face_mats.append((f, 2))

    # 5. Twin Projector LED Headlights & Side Neon Accents
    for side in [-1, 1]:
        for f in add_cylinder_between(
            bm,
            (side * 0.11, 1.06, 0.98),
            (side * 0.11, 1.14, 0.96),
            0.036,
            0.028,
            segments=14,
        ):
            face_mats.append((f, 3))  # neon cyan-white
        # Side fairing neon accent blade
        blade_pts = [
            (side * 0.25, 0.45, 0.96),
            (side * 0.26, 0.10, 0.94),
            (side * 0.22, -0.25, 0.98),
        ]
        for f in add_tube_along_points(bm, blade_pts, 0.010, segments=8):
            face_mats.append((f, 3))

    # 6. Sculpted Rear LED Tail & Brake Light Cluster
    for side in [-0.08, 0.08]:
        for f in add_beveled_box(bm, (side, -0.96, 1.07), (0.09, 0.04, 0.032), bevel=0.006, rx=-0.2):
            face_mats.append((f, 6))  # brake-light

    mesh = bpy.data.meshes.new("chassis_mesh")
    bm.to_mesh(mesh)
    bm.free()

    for m in materials:
        mesh.materials.append(m)

    for idx, poly in enumerate(mesh.polygons):
        poly.use_smooth = True
        if idx < len(face_mats):
            poly.material_index = face_mats[idx][1]

    obj = bpy.data.objects.new("chassis", mesh)
    obj.location = (0.0, 0.0, 0.0)
    bpy.context.scene.collection.objects.link(obj)
    return obj


def build_cockpit_object(materials):
    """Builds a realistic 1st-person motorcycle cockpit node (`cockpit`)."""
    bm = bmesh.new()
    face_mats = []

    # 1. CNC Upper Triple Clamp & Steering Stem Nut
    for f in add_beveled_box(bm, (0.0, 0.60, 1.16), (0.28, 0.09, 0.028), bevel=0.006, rx=-0.25):
        face_mats.append((f, 2))  # brushed-alloy
    for f in add_cylinder_between(bm, (0.0, 0.60, 1.15), (0.0, 0.61, 1.19), 0.022, segments=12):
        face_mats.append((f, 4))  # gold stem nut

    # 2. Clip-on Handlebars, Grips, Brake/Clutch Levers & Fluid Reservoir
    for side in [-1, 1]:
        # Clip-on collar & alloy bar
        collar = (side * 0.13, 0.62, 1.15)
        grip_in = (side * 0.24, 0.58, 1.14)
        grip_out = (side * 0.39, 0.54, 1.12)
        bar_end = (side * 0.42, 0.53, 1.115)
        for f in add_cylinder_between(bm, collar, grip_in, 0.014, segments=10):
            face_mats.append((f, 2))
        for f in add_cylinder_between(bm, grip_in, grip_out, 0.019, segments=12):
            face_mats.append((f, 1))  # rubber grip
        for f in add_cylinder_between(bm, grip_out, bar_end, 0.017, segments=10):
            face_mats.append((f, 4))  # gold bar-end weight
        # Switchgear housing cube
        for f in add_beveled_box(bm, (side * 0.25, 0.58, 1.14), (0.045, 0.048, 0.048), bevel=0.006):
            face_mats.append((f, 5))
        # Brake / Clutch Lever blade forward of grip
        lever_pts = [
            (side * 0.26, 0.61, 1.14),
            (side * 0.33, 0.64, 1.135),
            (side * 0.39, 0.61, 1.125),
        ]
        for f in add_tube_along_points(bm, lever_pts, [0.008, 0.007, 0.009], segments=8):
            face_mats.append((f, 2))

    # Front brake fluid reservoir cup on right clip-on
    for f in add_cylinder_between(bm, (0.24, 0.61, 1.17), (0.24, 0.61, 1.22), 0.018, segments=12):
        face_mats.append((f, 1))

    # 3. Full-Color Illuminated TFT Instrument Cluster
    # Carbon housing
    for f in add_beveled_box(bm, (0.0, 0.72, 1.22), (0.17, 0.04, 0.105), bevel=0.008, rx=-0.45):
        face_mats.append((f, 5))
    # Glowing TFT display screen
    for f in add_beveled_box(bm, (0.0, 0.708, 1.225), (0.145, 0.015, 0.082), bevel=0.003, rx=-0.45):
        face_mats.append((f, 3))

    # 4. Sculpted Double-Bubble Tinted Windscreen
    ws_sections = [
        (0.98, 1.14, 0.14, 0.04),
        (0.84, 1.24, 0.21, 0.07),
        (0.68, 1.33, 0.22, 0.08),
        (0.54, 1.38, 0.17, 0.06),
    ]
    ws_rings = []
    n_arc = 12
    for wy, wz, ww, wh in ws_sections:
        ring = []
        for i in range(n_arc + 1):
            t = i / n_arc
            angle = math.pi * (0.15 + 0.70 * t)
            x = math.cos(angle) * ww
            z = wz + math.sin(angle) * wh
            ring.append(bm.verts.new((x, wy, z)))
        ws_rings.append(ring)
    for s in range(len(ws_rings) - 1):
        for i in range(n_arc):
            f = bm.faces.new((ws_rings[s][i], ws_rings[s + 1][i], ws_rings[s + 1][i + 1], ws_rings[s][i + 1]))
            face_mats.append((f, 7))  # glass

    # 5. Aerodynamic Fairing Mirrors
    for side in [-1, 1]:
        stalk_pts = [
            (side * 0.24, 0.80, 1.18),
            (side * 0.36, 0.76, 1.25),
            (side * 0.44, 0.73, 1.27),
        ]
        for f in add_tube_along_points(bm, stalk_pts, 0.012, segments=8):
            face_mats.append((f, 5))
        for f in add_beveled_box(bm, (side * 0.48, 0.72, 1.27), (0.12, 0.04, 0.065), bevel=0.008, rz=side * 0.2):
            face_mats.append((f, 5))

    mesh = bpy.data.meshes.new("cockpit_mesh")
    bm.to_mesh(mesh)
    bm.free()

    for m in materials:
        mesh.materials.append(m)

    for idx, poly in enumerate(mesh.polygons):
        poly.use_smooth = True
        if idx < len(face_mats):
            poly.material_index = face_mats[idx][1]

    obj = bpy.data.objects.new("cockpit", mesh)
    obj.location = (0.0, 0.0, 0.0)
    bpy.context.scene.collection.objects.link(obj)
    return obj


def main():
    print("=== Generating High-Detail Kestrel Hyperbike Asset ===")
    init_scene()

    materials = [
        create_pbr_material("custom-paint", (0.45, 0.68, 0.12, 1.0), metallic=0.72, roughness=0.24),
        create_pbr_material("rubber", (0.018, 0.022, 0.028, 1.0), metallic=0.04, roughness=0.82),
        create_pbr_material("brushed-alloy", (0.58, 0.64, 0.69, 1.0), metallic=0.92, roughness=0.22),
        create_pbr_material("neon", (0.28, 0.94, 1.0, 1.0), emissive=(0.28, 0.94, 1.0, 1.0), emissive_strength=4.2),
        create_pbr_material("gold-anodized", (0.82, 0.64, 0.24, 1.0), metallic=0.94, roughness=0.20),
        create_pbr_material("carbon-fiber", (0.06, 0.07, 0.09, 1.0), metallic=0.35, roughness=0.32),
        create_pbr_material("brake-light", (1.0, 0.08, 0.22, 1.0), emissive=(1.0, 0.08, 0.22, 1.0), emissive_strength=5.0),
        create_pbr_material("glass", (0.12, 0.26, 0.34, 1.0), metallic=0.1, roughness=0.06, alpha=0.45),
    ]

    obj_source = os.path.abspath("assets/models/fancy-motorcycle-source.obj")
    verts_bl, part_faces, centers = parse_source_obj(obj_source)

    build_wheel_from_source("front-wheel", verts_bl, part_faces['front-wheel'], centers['front-wheel'], True, materials)
    build_wheel_from_source("rear-wheel", verts_bl, part_faces['rear-wheel'], centers['rear-wheel'], False, materials)
    build_chassis_with_details(verts_bl, part_faces['chassis'], centers, materials)
    build_cockpit_object(materials)

    target_path = os.path.abspath("assets/models/kestrel.glb")
    bpy.ops.export_scene.gltf(
        filepath=target_path,
        export_format='GLB',
        use_selection=False,
        export_apply=False,
        export_yup=True,
    )
    print(f"=== Exported {target_path} ({os.path.getsize(target_path)} bytes) ===")


if __name__ == "__main__":
    main()
