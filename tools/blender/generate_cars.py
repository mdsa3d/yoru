"""Realistic Highway Traffic & Autonomous Aerial Drone Generator using Blender Python API.
Generates contoured, high-detail automotive and eVTOL models for Yoru:
- assets/models/traffic/sedan.glb (Executive fastback sports sedan with spoked wheels & LED light bars)
- assets/models/traffic/van.glb   (Commercial aerodynamic transit van with ribbed cargo bay & roof HVAC)
- assets/models/traffic/taxi.glb  (Urban executive taxi with contrast cladding & illuminated roof sign)
- assets/models/traffic/drone.glb (Autonomous quad-ducted-fan eVTOL air-traffic craft with 4 rotor nodes)

Run via: blender --background --python tools/blender/generate_cars.py
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


def loft_car_profile(bm, stations):
    """Lofts a realistic automotive body across Y stations.
    Each station is (y, z_bot, z_belt, z_shoulder, z_roof, w_bot, w_belt, w_shoulder, w_roof, roof_mat, side_mat).
    """
    rings = []
    for st in stations:
        y, z_bot, z_belt, z_sh, z_roof, w_bot, w_belt, w_sh, w_roof, _, _ = st
        # Cross-section loop counter-clockwise looking from +Y:
        # 0: bottom-center-right -> 1: rocker-right -> 2: beltline-right -> 3: shoulder-right ->
        # 4: roof-right -> 5: roof-center -> 6: roof-left -> 7: shoulder-left ->
        # 8: beltline-left -> 9: rocker-left -> 10: bottom-center-left
        pts = [
            (w_bot * 0.65, y, z_bot),
            (w_bot,        y, z_bot + 0.04),
            (w_belt,       y, z_belt),
            (w_sh,         y, z_sh),
            (w_roof,       y, z_roof - 0.02),
            (0.0,          y, z_roof),
            (-w_roof,      y, z_roof - 0.02),
            (-w_sh,        y, z_sh),
            (-w_belt,      y, z_belt),
            (-w_bot,       y, z_bot + 0.04),
            (-w_bot * 0.65, y, z_bot),
        ]
        rings.append([bm.verts.new(p) for p in pts])

    face_mats = []
    n_pts = len(rings[0])
    for s in range(len(stations) - 1):
        roof_mat = stations[s][9]
        side_mat = stations[s][10]
        for j in range(n_pts):
            nj = (j + 1) % n_pts
            f = bm.faces.new((rings[s][j], rings[s + 1][j], rings[s + 1][nj], rings[s][nj]))
            # Indices 3..6 are greenhouse/windshield/roof panels; 9..10 are underbody
            if j in (3, 6):
                face_mats.append((f, side_mat))
            elif j in (4, 5):
                face_mats.append((f, roof_mat))
            elif j in (9, 10):
                face_mats.append((f, 2))  # dark trim/underbody
            else:
                face_mats.append((f, 0))  # body paint

    f_front = bm.faces.new(rings[0][::-1])
    f_rear = bm.faces.new(rings[-1])
    face_mats.append((f_front, 2))
    face_mats.append((f_rear, 0))
    return face_mats


def create_car_wheel_node(name, loc, radius, width, mat_rubber, mat_alloy):
    bm = bmesh.new()
    face_mats = []
    segs = 28
    cross = 10
    rim_r = radius * 0.66
    r_center = (radius + rim_r * 0.85) * 0.5
    r_tube = (radius - rim_r * 0.85) * 0.5

    # Tire torus
    rings = []
    for i in range(segs):
        phi = (2.0 * math.pi * i) / segs
        cp, sp = math.cos(phi), math.sin(phi)
        ring = []
        for j in range(cross):
            th = (2.0 * math.pi * j) / cross
            x = math.sin(th) * (width * 0.5)
            rd = r_center + math.cos(th) * r_tube
            ring.append(bm.verts.new((x, cp * rd, sp * rd)))
        rings.append(ring)

    for i in range(segs):
        ni = (i + 1) % segs
        for j in range(cross):
            nj = (j + 1) % cross
            f = bm.faces.new((rings[i][j], rings[ni][j], rings[ni][nj], rings[i][nj]))
            face_mats.append((f, 0))  # rubber

    # Alloy rim barrel & 5 twin-spokes
    for f in add_cylinder_between(bm, (-width * 0.38, 0, 0), (width * 0.38, 0, 0), rim_r * 0.32, segments=20):
        face_mats.append((f, 1))
    for f in add_cylinder_between(bm, (-width * 0.42, 0, 0), (width * 0.42, 0, 0), rim_r * 0.92, segments=24, cap_ends=False):
        face_mats.append((f, 1))
    for s in range(5):
        a = (2.0 * math.pi * s) / 5.0
        for off in (-0.08, 0.08):
            p_in = (0.0, math.cos(a) * (rim_r * 0.25), math.sin(a) * (rim_r * 0.25))
            p_out = (0.0, math.cos(a + off) * (rim_r * 0.90), math.sin(a + off) * (rim_r * 0.90))
            for f in add_cylinder_between(bm, p_in, p_out, 0.016, 0.012, segments=8):
                face_mats.append((f, 1))

    mesh = bpy.data.meshes.new(f"{name}_mesh")
    bm.to_mesh(mesh)
    bm.free()
    mesh.materials.append(mat_rubber)
    mesh.materials.append(mat_alloy)
    for idx, poly in enumerate(mesh.polygons):
        poly.use_smooth = True
        if idx < len(face_mats):
            poly.material_index = face_mats[idx][1]

    obj = bpy.data.objects.new(name, mesh)
    obj.location = loc
    bpy.context.scene.collection.objects.link(obj)
    return obj


def generate_sedan(out_path):
    init_scene()
    materials = [
        create_pbr_mat("CarBody", (0.14, 0.46, 0.68, 1.0), metallic=0.82, roughness=0.22),
        create_pbr_mat("CarGlass", (0.05, 0.09, 0.14, 1.0), metallic=0.15, roughness=0.06),
        create_pbr_mat("CarAlloy", (0.55, 0.60, 0.66, 1.0), metallic=0.90, roughness=0.24),
        create_pbr_mat("NeonFront", (0.75, 0.96, 1.0, 1.0), emissive=(0.75, 0.96, 1.0, 1.0), emissive_strength=4.8),
        create_pbr_mat("brake-light", (1.0, 0.08, 0.18, 1.0), emissive=(1.0, 0.08, 0.18, 1.0), emissive_strength=5.2),
        create_pbr_mat("CarTire", (0.018, 0.020, 0.024, 1.0), metallic=0.04, roughness=0.84),
    ]

    bm = bmesh.new()
    # Car FRONT is -Y, Car REAR is +Y, Car UP is +Z
    # (y, z_bot, z_belt, z_sh, z_roof, w_bot, w_belt, w_sh, w_roof, roof_mat, side_mat)
    stations = [
        (-1.42, 0.18, 0.34, 0.44, 0.46, 0.54, 0.60, 0.56, 0.42, 0, 0),  # Front splitter / bumper nose
        (-1.26, 0.18, 0.38, 0.54, 0.57, 0.62, 0.66, 0.62, 0.52, 0, 0),  # Headlight & grille plane
        (-0.72, 0.19, 0.44, 0.62, 0.65, 0.64, 0.68, 0.64, 0.56, 0, 0),  # Sculpted hood / cowl base
        (-0.28, 0.19, 0.46, 0.64, 0.94, 0.65, 0.68, 0.63, 0.50, 1, 1),  # Windshield header / A-pillar top
        ( 0.25, 0.19, 0.47, 0.65, 0.96, 0.65, 0.68, 0.63, 0.50, 0, 1),  # B-pillar / main cabin roof
        ( 0.76, 0.20, 0.48, 0.66, 0.88, 0.64, 0.67, 0.62, 0.47, 1, 1),  # C-pillar / fastback rear glass
        ( 1.15, 0.21, 0.48, 0.66, 0.68, 0.62, 0.65, 0.60, 0.48, 0, 0),  # Rear decklid
        ( 1.38, 0.23, 0.44, 0.62, 0.65, 0.56, 0.61, 0.56, 0.44, 0, 0),  # Rear bumper & diffuser
    ]
    face_mats = loft_car_profile(bm, stations)

    # Front splitter lip & intake grille
    for f in add_beveled_box(bm, (0.0, -1.41, 0.20), (1.18, 0.12, 0.045), bevel=0.008):
        face_mats.append((f, 2))
    # Side mirrors
    for side in [-1, 1]:
        for f in add_beveled_box(bm, (side * 0.70, -0.36, 0.68), (0.14, 0.11, 0.075), bevel=0.012, rz=side * 0.15):
            face_mats.append((f, 0))
    # Rear performance spoiler & diffuser fins
    for f in add_beveled_box(bm, (0.0, 1.32, 0.73), (1.16, 0.16, 0.035), bevel=0.006, rx=0.12):
        face_mats.append((f, 2))
    for side in [-0.38, 0.38]:
        for f in add_beveled_box(bm, (side, 1.28, 0.68), (0.035, 0.10, 0.09), bevel=0.005):
            face_mats.append((f, 2))

    # Twin Matrix LED Headlights & Full-Width Rear Brake Light Bar
    for side in [-0.44, 0.44]:
        for f in add_beveled_box(bm, (side, -1.36, 0.48), (0.28, 0.06, 0.065), bevel=0.008, rz=side * -0.15):
            face_mats.append((f, 3))
    for f in add_beveled_box(bm, (0.0, 1.38, 0.58), (1.12, 0.05, 0.065), bevel=0.008):
        face_mats.append((f, 4))  # brake-light

    mesh = bpy.data.meshes.new("SedanMesh")
    bm.to_mesh(mesh)
    bm.free()
    for m in materials:
        mesh.materials.append(m)
    for idx, poly in enumerate(mesh.polygons):
        poly.use_smooth = True
        if idx < len(face_mats):
            poly.material_index = face_mats[idx][1]

    body_obj = bpy.data.objects.new("body", mesh)
    bpy.context.scene.collection.objects.link(body_obj)

    for w_name, wx, wy in [
        ("wheel-fl", -0.63, -0.82),
        ("wheel-fr",  0.63, -0.82),
        ("wheel-rl", -0.63,  0.82),
        ("wheel-rr",  0.63,  0.82),
    ]:
        create_car_wheel_node(w_name, (wx, wy, 0.31), 0.31, 0.19, materials[5], materials[2])

    bpy.ops.export_scene.gltf(filepath=out_path, export_format='GLB', export_yup=True)
    print(f"Exported: {out_path} ({os.path.getsize(out_path)} bytes)")


def generate_van(out_path):
    init_scene()
    materials = [
        create_pbr_mat("CarBody", (0.78, 0.44, 0.16, 1.0), metallic=0.35, roughness=0.38),
        create_pbr_mat("CarGlass", (0.04, 0.07, 0.11, 1.0), metallic=0.15, roughness=0.06),
        create_pbr_mat("CarAlloy", (0.22, 0.25, 0.29, 1.0), metallic=0.82, roughness=0.30),
        create_pbr_mat("NeonFront", (0.95, 0.95, 0.86, 1.0), emissive=(0.95, 0.95, 0.86, 1.0), emissive_strength=4.2),
        create_pbr_mat("brake-light", (1.0, 0.10, 0.15, 1.0), emissive=(1.0, 0.10, 0.15, 1.0), emissive_strength=5.0),
        create_pbr_mat("CarTire", (0.018, 0.020, 0.024, 1.0), metallic=0.04, roughness=0.85),
    ]

    bm = bmesh.new()
    stations = [
        (-1.45, 0.22, 0.42, 0.62, 0.65, 0.62, 0.68, 0.64, 0.56, 2, 0),  # Heavy-duty front bumper
        (-1.22, 0.22, 0.48, 0.76, 0.80, 0.66, 0.70, 0.67, 0.60, 0, 0),  # Short sloped van hood
        (-0.72, 0.22, 0.52, 0.82, 1.32, 0.68, 0.71, 0.68, 0.61, 1, 1),  # Panoramic cab windshield
        (-0.15, 0.22, 0.52, 0.84, 1.36, 0.68, 0.71, 0.68, 0.62, 0, 1),  # Cab side windows
        ( 0.65, 0.22, 0.52, 0.84, 1.36, 0.68, 0.71, 0.68, 0.62, 0, 0),  # Enclosed cargo bay
        ( 1.38, 0.23, 0.52, 0.84, 1.34, 0.67, 0.70, 0.67, 0.60, 0, 0),  # Rear double cargo doors
        ( 1.48, 0.25, 0.48, 0.80, 1.28, 0.64, 0.67, 0.64, 0.57, 2, 0),  # Rear step bumper
    ]
    face_mats = loft_car_profile(bm, stations)

    # Rooftop HVAC unit & cargo roof rack rails
    for f in add_beveled_box(bm, (0.0, -0.10, 1.40), (0.76, 0.58, 0.11), bevel=0.015):
        face_mats.append((f, 2))
    for side in [-0.52, 0.52]:
        for f in add_beveled_box(bm, (side, 0.45, 1.39), (0.05, 1.65, 0.05), bevel=0.008):
            face_mats.append((f, 2))
    # Side mirrors
    for side in [-1, 1]:
        for f in add_beveled_box(bm, (side * 0.75, -0.62, 0.92), (0.12, 0.10, 0.18), bevel=0.012):
            face_mats.append((f, 2))

    # Front headlamps & tall vertical rear tail/brake light columns
    for side in [-0.48, 0.48]:
        for f in add_beveled_box(bm, (side, -1.42, 0.56), (0.24, 0.06, 0.12), bevel=0.008):
            face_mats.append((f, 3))
    for side in [-0.58, 0.58]:
        for f in add_beveled_box(bm, (side, 1.46, 0.92), (0.10, 0.05, 0.44), bevel=0.008):
            face_mats.append((f, 4))

    mesh = bpy.data.meshes.new("VanMesh")
    bm.to_mesh(mesh)
    bm.free()
    for m in materials:
        mesh.materials.append(m)
    for idx, poly in enumerate(mesh.polygons):
        poly.use_smooth = True
        if idx < len(face_mats):
            poly.material_index = face_mats[idx][1]

    body_obj = bpy.data.objects.new("body", mesh)
    bpy.context.scene.collection.objects.link(body_obj)

    for w_name, wx, wy in [
        ("wheel-fl", -0.67, -0.82),
        ("wheel-fr",  0.67, -0.82),
        ("wheel-rl", -0.67,  0.88),
        ("wheel-rr",  0.67,  0.88),
    ]:
        create_car_wheel_node(w_name, (wx, wy, 0.34), 0.34, 0.21, materials[5], materials[2])

    bpy.ops.export_scene.gltf(filepath=out_path, export_format='GLB', export_yup=True)
    print(f"Exported: {out_path} ({os.path.getsize(out_path)} bytes)")


def generate_taxi(out_path):
    init_scene()
    materials = [
        create_pbr_mat("CarBody", (0.96, 0.72, 0.06, 1.0), metallic=0.68, roughness=0.25),
        create_pbr_mat("CarGlass", (0.05, 0.09, 0.14, 1.0), metallic=0.15, roughness=0.06),
        create_pbr_mat("CarAlloy", (0.14, 0.16, 0.20, 1.0), metallic=0.82, roughness=0.28),
        create_pbr_mat("TaxiSign", (1.0, 0.86, 0.22, 1.0), emissive=(1.0, 0.86, 0.22, 1.0), emissive_strength=5.8),
        create_pbr_mat("NeonFront", (0.72, 0.95, 1.0, 1.0), emissive=(0.72, 0.95, 1.0, 1.0), emissive_strength=4.8),
        create_pbr_mat("brake-light", (1.0, 0.08, 0.18, 1.0), emissive=(1.0, 0.08, 0.18, 1.0), emissive_strength=5.2),
        create_pbr_mat("CarTire", (0.018, 0.020, 0.024, 1.0), metallic=0.04, roughness=0.84),
    ]

    bm = bmesh.new()
    stations = [
        (-1.40, 0.19, 0.36, 0.48, 0.50, 0.55, 0.61, 0.57, 0.44, 0, 0),
        (-1.22, 0.19, 0.40, 0.56, 0.59, 0.62, 0.66, 0.62, 0.52, 0, 0),
        (-0.68, 0.19, 0.45, 0.63, 0.66, 0.64, 0.68, 0.64, 0.56, 0, 0),
        (-0.24, 0.19, 0.47, 0.65, 0.98, 0.65, 0.68, 0.63, 0.52, 1, 1),
        ( 0.35, 0.19, 0.48, 0.66, 0.99, 0.65, 0.68, 0.63, 0.52, 0, 1),
        ( 0.82, 0.20, 0.48, 0.66, 0.92, 0.64, 0.67, 0.62, 0.49, 1, 1),
        ( 1.18, 0.21, 0.48, 0.65, 0.68, 0.62, 0.65, 0.60, 0.48, 0, 0),
        ( 1.38, 0.23, 0.44, 0.62, 0.64, 0.56, 0.61, 0.56, 0.44, 0, 0),
    ]
    face_mats = loft_car_profile(bm, stations)

    # Aerodynamic Roof TAXI Light Dome & Plinth
    for f in add_beveled_box(bm, (0.0, -0.05, 1.01), (0.46, 0.32, 0.05), bevel=0.008):
        face_mats.append((f, 2))
    for f in add_beveled_box(bm, (0.0, -0.05, 1.07), (0.38, 0.22, 0.095), bevel=0.025):
        face_mats.append((f, 3))  # TaxiSign

    # Contrast side cladding & mirrors
    for side in [-1, 1]:
        for f in add_beveled_box(bm, (side * 0.68, 0.0, 0.36), (0.03, 2.1, 0.11), bevel=0.005):
            face_mats.append((f, 2))
        for f in add_beveled_box(bm, (side * 0.70, -0.32, 0.70), (0.14, 0.10, 0.075), bevel=0.012):
            face_mats.append((f, 2))

    # Headlights & Rear Brake Light Bar
    for side in [-0.44, 0.44]:
        for f in add_beveled_box(bm, (side, -1.36, 0.49), (0.26, 0.06, 0.07), bevel=0.008):
            face_mats.append((f, 4))
    for f in add_beveled_box(bm, (0.0, 1.36, 0.56), (1.12, 0.05, 0.07), bevel=0.008):
        face_mats.append((f, 5))

    mesh = bpy.data.meshes.new("TaxiMesh")
    bm.to_mesh(mesh)
    bm.free()
    for m in materials:
        mesh.materials.append(m)
    for idx, poly in enumerate(mesh.polygons):
        poly.use_smooth = True
        if idx < len(face_mats):
            poly.material_index = face_mats[idx][1]

    body_obj = bpy.data.objects.new("body", mesh)
    bpy.context.scene.collection.objects.link(body_obj)

    for w_name, wx, wy in [
        ("wheel-fl", -0.63, -0.80),
        ("wheel-fr",  0.63, -0.80),
        ("wheel-rl", -0.63,  0.82),
        ("wheel-rr",  0.63,  0.82),
    ]:
        create_car_wheel_node(w_name, (wx, wy, 0.31), 0.31, 0.19, materials[6], materials[2])

    bpy.ops.export_scene.gltf(filepath=out_path, export_format='GLB', export_yup=True)
    print(f"Exported: {out_path} ({os.path.getsize(out_path)} bytes)")


def generate_drone(out_path):
    """Generates a realistic autonomous quad-ducted-fan eVTOL aerial vehicle (`drone.glb`)."""
    init_scene()
    materials = [
        create_pbr_mat("DroneFuselage", (0.18, 0.24, 0.32, 1.0), metallic=0.78, roughness=0.26),
        create_pbr_mat("DroneCanopy", (0.04, 0.10, 0.16, 1.0), metallic=0.25, roughness=0.05),
        create_pbr_mat("DroneCarbon", (0.08, 0.10, 0.13, 1.0), metallic=0.55, roughness=0.32),
        create_pbr_mat("DroneNeon", (0.28, 0.92, 1.0, 1.0), emissive=(0.28, 0.92, 1.0, 1.0), emissive_strength=4.5),
        create_pbr_mat("DroneBeacon", (1.0, 0.16, 0.24, 1.0), emissive=(1.0, 0.16, 0.24, 1.0), emissive_strength=5.2),
    ]

    bm = bmesh.new()
    face_mats = []
    # Streamlined teardrop eVTOL fuselage (-Y front, +Y rear, +Z up)
    stations = [
        (-1.25, 0.32, 0.42, 0.52, 0.55, 0.22, 0.30, 0.26, 0.14, 0, 0),
        (-0.78, 0.26, 0.40, 0.62, 0.78, 0.42, 0.52, 0.48, 0.34, 1, 1),
        (-0.15, 0.24, 0.42, 0.68, 0.88, 0.48, 0.58, 0.54, 0.38, 1, 1),
        ( 0.48, 0.28, 0.45, 0.66, 0.80, 0.42, 0.50, 0.46, 0.32, 0, 0),
        ( 1.05, 0.36, 0.48, 0.62, 0.68, 0.24, 0.30, 0.26, 0.16, 0, 0),
        ( 1.38, 0.44, 0.52, 0.58, 0.62, 0.08, 0.12, 0.10, 0.06, 4, 0),
    ]
    face_mats.extend(loft_car_profile(bm, stations))

    # Tail V-stabilizer fins
    for side in [-1, 1]:
        for f in add_beveled_box(bm, (side * 0.24, 1.18, 0.76), (0.04, 0.38, 0.28), bevel=0.008, ry=side * 0.35):
            face_mats.append((f, 0))
    # Tubular landing skids
    for side in [-0.42, 0.42]:
        for f in add_cylinder_between(bm, (side, -0.65, 0.06), (side, 0.65, 0.06), 0.022, segments=10):
            face_mats.append((f, 2))
        for y_strut in (-0.38, 0.38):
            for f in add_cylinder_between(bm, (side * 0.75, y_strut, 0.28), (side, y_strut, 0.06), 0.018, segments=8):
                face_mats.append((f, 2))

    # 4 Outrigger Arms & Shrouded Ducted Fan Nacelles
    pod_coords = [
        (-0.98, -0.78, 0.48),
        ( 0.98, -0.78, 0.48),
        (-0.98,  0.78, 0.52),
        ( 0.98,  0.78, 0.52),
    ]
    for px, py, pz in pod_coords:
        sx = 0.42 if px > 0 else -0.42
        for f in add_cylinder_between(bm, (sx, py * 0.7, pz + 0.04), (px * 0.78, py, pz), 0.036, 0.028, segments=10):
            face_mats.append((f, 2))
        # Shrouded ducted-fan torus ring + glowing thruster ring
        segs = 28
        for r_ring, z_off, m_idx in [(0.30, 0.0, 2), (0.285, -0.055, 3)]:
            outer_v, inner_v = [], []
            for i in range(segs):
                a = (2.0 * math.pi * i) / segs
                ca, sa = math.cos(a), math.sin(a)
                outer_v.append(bm.verts.new((px + ca * (r_ring + 0.035), py + sa * (r_ring + 0.035), pz + z_off)))
                inner_v.append(bm.verts.new((px + ca * (r_ring - 0.035), py + sa * (r_ring - 0.035), pz + z_off)))
            for i in range(segs):
                ni = (i + 1) % segs
                face_mats.append((bm.faces.new((inner_v[i], outer_v[i], outer_v[ni], inner_v[ni])), m_idx))

    mesh = bpy.data.meshes.new("DroneBodyMesh")
    bm.to_mesh(mesh)
    bm.free()
    for m in materials:
        mesh.materials.append(m)
    for idx, poly in enumerate(mesh.polygons):
        poly.use_smooth = True
        if idx < len(face_mats):
            poly.material_index = face_mats[idx][1]

    body_obj = bpy.data.objects.new("body", mesh)
    bpy.context.scene.collection.objects.link(body_obj)

    # 4 Independent Spinning Multi-Blade Rotor Nodes (`rotor-0..3`)
    for idx, (px, py, pz) in enumerate(pod_coords):
        rbm = bmesh.new()
        r_faces = []
        for f in add_cylinder_between(rbm, (0, 0, -0.04), (0, 0, 0.04), 0.055, 0.035, segments=14):
            r_faces.append((f, 2))
        for b_idx in range(4):
            ba = (2.0 * math.pi * b_idx) / 4.0
            for f in add_beveled_box(rbm, (0, 0, 0), (0.48, 0.055, 0.014), bevel=0.003, rz=ba):
                r_faces.append((f, 2))
        rmesh = bpy.data.meshes.new(f"rotor_{idx}_mesh")
        rbm.to_mesh(rmesh)
        rbm.free()
        for m in materials:
            rmesh.materials.append(m)
        for p_i, poly in enumerate(rmesh.polygons):
            poly.use_smooth = True
            poly.material_index = 2
        robj = bpy.data.objects.new(f"rotor-{idx}", rmesh)
        robj.location = (px, py, pz)
        bpy.context.scene.collection.objects.link(robj)

    bpy.ops.export_scene.gltf(filepath=out_path, export_format='GLB', export_yup=True)
    print(f"Exported: {out_path} ({os.path.getsize(out_path)} bytes)")


def main():
    print("=== Generating Realistic Highway Traffic & Aerial Drone Fleet ===")
    out_dir = os.path.abspath("assets/models/traffic")
    os.makedirs(out_dir, exist_ok=True)
    generate_sedan(os.path.join(out_dir, "sedan.glb"))
    generate_van(os.path.join(out_dir, "van.glb"))
    generate_taxi(os.path.join(out_dir, "taxi.glb"))
    generate_drone(os.path.join(out_dir, "drone.glb"))
    print("=== All Traffic & Drone Vehicles Generated Successfully ===")


if __name__ == "__main__":
    main()
