"""Realistic Challenger / Rival Motorcycle Fleet Generator using Blender Python API.
Generates distinct, high-detail 3D motorcycle models for all 5 challenger bikes:
- redline.glb (Ducati 916-inspired Italian Supersport: twin-eye shark nose, trellis frame, under-seat dual exhausts)
- ronin.glb   (Suzuki Hayabusa-inspired Hypersport Streamliner: bulbous aero nose, tail hump, dual side cannons)
- ghost.glb   (Yamaha YZF-R1-inspired Crossplane Supersport: central ram-air intake, LED DRL slashes, aero winglets)
- outlaw.glb  (Harley-Davidson Fat Boy-inspired Muscle Cruiser: raked forks, machined disc wheels, finned V-Twin, shotgun pipes)
- cafe.glb    (Honda CB750-inspired Classic Cafe Racer: bullet fairing, horizontal tank, wasp-tail seat, 4-into-1 headers)

Run via: blender --background --python tools/blender/generate_challengers.py
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


def create_pbr_mat(
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

    out_node = nodes.new(type='ShaderNodeOutputMaterial')
    bsdf_node = nodes.new(type='ShaderNodeBsdfPrincipled')

    if 'Base Color' in bsdf_node.inputs:
        bsdf_node.inputs['Base Color'].default_value = base_color
    if 'Metallic' in bsdf_node.inputs:
        bsdf_node.inputs['Metallic'].default_value = metallic
    if 'Roughness' in bsdf_node.inputs:
        bsdf_node.inputs['Roughness'].default_value = roughness
    if alpha < 1.0 and 'Alpha' in bsdf_node.inputs:
        bsdf_node.inputs['Alpha'].default_value = alpha

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


def add_lofted_shell(bm, sections, n_pts=20, pinch_bottom=0.25, arch_top=0.18, cap_ends=True):
    """Lofts a smooth contoured aerodynamic shell across (y, z, half_w, half_h) stations."""
    rings = []
    for y_pos, z_pos, hw, hh in sections:
        ring = []
        for i in range(n_pts):
            theta = (2.0 * math.pi * i) / n_pts
            cos_t = math.cos(theta)
            sin_t = math.sin(theta)
            # Shape modifier: wider shoulder above midline, tucked belly below
            width_mod = 1.0 + (0.12 * sin_t if sin_t > 0 else pinch_bottom * sin_t)
            x = cos_t * hw * width_mod
            z = z_pos + sin_t * hh + (arch_top * hh * (cos_t ** 2) if sin_t > 0 else 0.0)
            ring.append(bm.verts.new((x, y_pos, z)))
        rings.append(ring)

    faces = []
    for s in range(len(rings) - 1):
        for i in range(n_pts):
            ni = (i + 1) % n_pts
            faces.append(bm.faces.new((rings[s][i], rings[s + 1][i], rings[s + 1][ni], rings[s][ni])))
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
    b = min(bevel, hx * 0.4, hy * 0.4, hz * 0.4)
    profiles = [
        (-hy, hx - b, hz - b),
        (-hy + b, hx, hz),
        (hy - b, hx, hz),
        (hy, hx - b, hz - b),
    ]
    pts_circle = [
        (1, 0.6), (0.6, 1), (-0.6, 1), (-1, 0.6),
        (-1, -0.6), (-0.6, -1), (0.6, -1), (1, -0.6),
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


def create_wheel_obj(name, loc, radius, width, rim_radius, spokes, is_front, style, materials):
    bm = bmesh.new()
    face_mats = []
    segments_ring = 36
    segments_cross = 14

    # 1. Contoured Sport/Cruiser Tire Profile
    r_center = (radius + rim_radius * 0.82) * 0.5
    r_tube = (radius - rim_radius * 0.82) * 0.5
    tire_rings = []
    for i in range(segments_ring):
        phi = (2.0 * math.pi * i) / segments_ring
        cos_p, sin_p = math.cos(phi), math.sin(phi)
        ring = []
        for j in range(segments_cross):
            theta = (2.0 * math.pi * j) / segments_cross
            x = math.sin(theta) * (width * 0.5)
            r_dist = r_center + math.cos(theta) * r_tube * (1.0 + 0.08 * math.cos(theta * 2))
            ring.append(bm.verts.new((x, cos_p * r_dist, sin_p * r_dist)))
        tire_rings.append(ring)

    for i in range(segments_ring):
        ni = (i + 1) % segments_ring
        for j in range(segments_cross):
            nj = (j + 1) % segments_cross
            f = bm.faces.new((tire_rings[i][j], tire_rings[ni][j], tire_rings[ni][nj], tire_rings[i][nj]))
            face_mats.append((f, 1))  # rubber

    # 2. Stepped Rim Barrel & Lip
    rim_profiles = [
        (-width * 0.42, rim_radius * 1.01),
        (-width * 0.36, rim_radius * 0.92),
        (-width * 0.16, rim_radius * 0.82),
        (width * 0.16, rim_radius * 0.82),
        (width * 0.36, rim_radius * 0.92),
        (width * 0.42, rim_radius * 1.01),
    ]
    rim_rings = []
    for px, pr in rim_profiles:
        ring = []
        for i in range(segments_ring):
            phi = (2.0 * math.pi * i) / segments_ring
            ring.append(bm.verts.new((px, math.cos(phi) * pr, math.sin(phi) * pr)))
        rim_rings.append(ring)

    for p in range(len(rim_profiles) - 1):
        for i in range(segments_ring):
            ni = (i + 1) % segments_ring
            f = bm.faces.new((rim_rings[p][i], rim_rings[p + 1][i], rim_rings[p + 1][ni], rim_rings[p][ni]))
            face_mats.append((f, 2))  # brushed-alloy

    # 3. Wheel Hub & Spokes (or Machined Solid Disc for Outlaw Cruiser)
    hub_r = rim_radius * 0.28
    hub_w = width * 0.52
    for f in add_cylinder_between(bm, (-hub_w * 0.5, 0, 0), (hub_w * 0.5, 0, 0), hub_r, segments=24):
        face_mats.append((f, 2))

    if style == 'outlaw':
        # Fat Boy signature machined solid Lakester alloy disc wheel with perimeter bullet holes
        for f in add_cylinder_between(bm, (-width * 0.12, 0, 0), (width * 0.12, 0, 0), rim_radius * 0.83, segments=32):
            face_mats.append((f, 2))
    else:
        spoke_outer = rim_radius * 0.84
        for s in range(spokes):
            base_a = (2.0 * math.pi * s) / spokes
            for branch in (-0.09, 0.09):
                p_in = (0.0, math.cos(base_a) * (hub_r * 0.85), math.sin(base_a) * (hub_r * 0.85))
                p_out = (0.0, math.cos(base_a + branch) * spoke_outer, math.sin(base_a + branch) * spoke_outer)
                for f in add_cylinder_between(bm, p_in, p_out, 0.015, 0.011, segments=8):
                    face_mats.append((f, 2))

    # 4. Drilled Stainless Brake Discs & Rear Sprocket
    disc_offsets = [-width * 0.44, width * 0.44] if is_front else [width * 0.44]
    disc_r = rim_radius * 0.72 if is_front else rim_radius * 0.62
    for dx in disc_offsets:
        for f in add_cylinder_between(bm, (dx - 0.006, 0, 0), (dx + 0.006, 0, 0), disc_r, segments=28):
            face_mats.append((f, 2))
    if not is_front:
        # Gold rear sprocket on left side
        for f in add_cylinder_between(bm, (-width * 0.45 - 0.006, 0, 0), (-width * 0.45 + 0.006, 0, 0), rim_radius * 0.58, segments=24):
            face_mats.append((f, 4))

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
    obj.location = loc
    bpy.context.scene.collection.objects.link(obj)
    return obj


def build_challenger_chassis(style, fy, ry, materials):
    bm = bmesh.new()
    face_mats = []
    # Materials:
    # 0: custom-paint, 1: rubber, 2: brushed-alloy, 3: neon, 4: gold-anodized, 5: carbon-fiber, 6: brake-light, 7: glass

    if style == 'redline':
        # Ducati 916-inspired Italian Supersport
        # 1. Sculpted Aerodynamic Upper & Side Fairing + Fuel Tank Monocoque
        body_sections = [
            (1.22, 0.94, 0.07, 0.05),   # Sharp shark-nose tip
            (1.04, 1.02, 0.21, 0.14),   # Twin-headlight cowl
            (0.76, 1.09, 0.26, 0.22),   # Fairing widest shoulder
            (0.45, 1.15, 0.24, 0.21),   # Sculpted fuel tank hump
            (0.12, 1.04, 0.19, 0.16),   # Narrow waist / knee grip recess
            (-0.18, 0.94, 0.16, 0.10),  # Rider seat pan
        ]
        for f in add_lofted_shell(bm, body_sections, n_pts=22, pinch_bottom=0.35):
            face_mats.append((f, 0))

        # Lower belly pan fairing
        belly_sections = [
            (0.88, 0.62, 0.12, 0.10),
            (0.55, 0.56, 0.22, 0.16),
            (0.10, 0.54, 0.21, 0.15),
            (-0.25, 0.58, 0.15, 0.10),
        ]
        for f in add_lofted_shell(bm, belly_sections, n_pts=18, pinch_bottom=0.4):
            face_mats.append((f, 0))

        # Sculpted monoposto tail cowl
        tail_sections = [
            (-0.22, 0.96, 0.17, 0.09),
            (-0.48, 1.04, 0.21, 0.13),
            (-0.78, 1.08, 0.17, 0.11),
            (-1.02, 1.09, 0.09, 0.06),
        ]
        for f in add_lofted_shell(bm, tail_sections, n_pts=20, pinch_bottom=0.3):
            face_mats.append((f, 0))

        # Contoured racing seat pad
        seat_sections = [
            (0.08, 0.98, 0.15, 0.04),
            (-0.14, 0.95, 0.17, 0.05),
            (-0.34, 0.99, 0.16, 0.05),
        ]
        for f in add_lofted_shell(bm, seat_sections, n_pts=16):
            face_mats.append((f, 1))

        # Exposed Ducati-style Bronze Tubular Trellis Frame
        for side in [-1, 1]:
            top_rail = [(side * 0.12, 0.64, 1.06), (side * 0.21, 0.25, 0.94), (side * 0.18, -0.15, 0.78)]
            bot_rail = [(side * 0.12, 0.58, 0.92), (side * 0.21, 0.20, 0.74), (side * 0.18, -0.15, 0.60)]
            for f in add_tube_along_points(bm, top_rail, 0.016, segments=10):
                face_mats.append((f, 4))
            for f in add_tube_along_points(bm, bot_rail, 0.015, segments=10):
                face_mats.append((f, 4))
            for p_a, p_b in zip(top_rail, bot_rail):
                for f in add_cylinder_between(bm, p_a, p_b, 0.012, segments=8):
                    face_mats.append((f, 4))

        # Dual Under-Seat Carbon/Titanium Silencers (916 signature)
        for side in [-0.075, 0.075]:
            pipe_pts = [
                (side, -0.15, 0.52),
                (side * 1.3, -0.45, 0.76),
                (side, -0.75, 0.97),
                (side, -1.04, 1.00),
            ]
            for f in add_tube_along_points(bm, pipe_pts, [0.024, 0.032, 0.044, 0.038], segments=14):
                face_mats.append((f, 5))

        # Twin slanted Italian poly-ellipsoidal headlights
        for side in [-0.095, 0.095]:
            for f in add_beveled_box(bm, (side, 1.13, 1.00), (0.085, 0.06, 0.042), bevel=0.008, rx=0.25, rz=side * -0.18):
                face_mats.append((f, 3))

    elif style == 'ronin':
        # Suzuki Hayabusa-inspired Hypersport Streamliner
        # Wide, wind-tunnel bulbous nose, long flowing tank, iconic high rounded rear aero hump
        body_sections = [
            (1.26, 0.90, 0.09, 0.07),   # Rounded bullet nose cone
            (1.02, 1.00, 0.26, 0.20),   # Wide bulbous aero fairing
            (0.70, 1.08, 0.30, 0.26),   # Full wind-tunnel side cowling
            (0.35, 1.16, 0.27, 0.24),   # Deep sculpted fuel tank
            (0.02, 1.02, 0.22, 0.18),   # Rider cockpit recess
            (-0.26, 0.93, 0.20, 0.14),  # Low slung saddle base
            (-0.56, 1.11, 0.23, 0.20),  # Signature Hayabusa aerodynamic rear hump
            (-0.88, 1.05, 0.18, 0.14),  # Swept tail section
            (-1.12, 0.98, 0.08, 0.06),  # Droop tail tip
        ]
        for f in add_lofted_shell(bm, body_sections, n_pts=24, pinch_bottom=0.2, arch_top=0.24):
            face_mats.append((f, 0))

        # Full lower aero belly fairing enclosing engine
        belly_sections = [
            (0.96, 0.58, 0.18, 0.14),
            (0.55, 0.52, 0.27, 0.20),
            (0.05, 0.50, 0.26, 0.19),
            (-0.35, 0.54, 0.18, 0.14),
        ]
        for f in add_lofted_shell(bm, belly_sections, n_pts=20, pinch_bottom=0.3):
            face_mats.append((f, 0))

        # Saddle pad
        seat_sections = [
            (0.05, 0.97, 0.17, 0.04),
            (-0.18, 0.92, 0.19, 0.05),
            (-0.36, 0.96, 0.18, 0.05),
        ]
        for f in add_lofted_shell(bm, seat_sections, n_pts=16):
            face_mats.append((f, 1))

        # Twin massive swept-back titanium exhaust cannons (left & right)
        for side in [-1, 1]:
            cannon_pts = [
                (side * 0.14, 0.10, 0.42),
                (side * 0.22, -0.35, 0.46),
                (side * 0.26, -0.78, 0.56),
                (side * 0.25, -1.08, 0.62),
            ]
            for f in add_tube_along_points(bm, cannon_pts, [0.028, 0.052, 0.068, 0.050], segments=16):
                face_mats.append((f, 2))
            # Gold anodized heat shield accent
            for f in add_cylinder_between(bm, (side * 0.24, -0.50, 0.50), (side * 0.26, -0.88, 0.58), 0.070, 0.064, segments=14):
                face_mats.append((f, 4))

        # Stacked Central Cyclops Headlight + Twin Ram-Air Intakes
        for f in add_beveled_box(bm, (0.0, 1.21, 0.98), (0.14, 0.08, 0.13), bevel=0.015, rx=0.35):
            face_mats.append((f, 3))
        for side in [-0.14, 0.14]:
            for f in add_beveled_box(bm, (side, 1.15, 0.93), (0.05, 0.07, 0.07), bevel=0.008):
                face_mats.append((f, 5))

    elif style == 'ghost':
        # Yamaha YZF-R1-inspired Crossplane Supersport
        # Sharp angular M1 race nose, recessed LED DRL slashes, MotoGP winglets, gill-vented tank, R-series tail
        body_sections = [
            (1.20, 0.95, 0.08, 0.06),   # M1 central ram-air nose
            (0.98, 1.04, 0.23, 0.16),   # Angular front cowl
            (0.68, 1.10, 0.25, 0.21),   # Fairing shoulders
            (0.38, 1.16, 0.25, 0.20),   # Gill-vented fuel tank
            (0.08, 1.03, 0.18, 0.14),   # Narrow crossplane waist
            (-0.22, 0.95, 0.16, 0.09),  # Seat base
            (-0.55, 1.04, 0.19, 0.11),  # Open-air arch R1 tail cowl
            (-0.88, 1.09, 0.14, 0.08),  # Sharp tail fin
            (-1.08, 1.11, 0.05, 0.04),  # Tail tip
        ]
        for f in add_lofted_shell(bm, body_sections, n_pts=20, pinch_bottom=0.38, arch_top=0.14):
            face_mats.append((f, 0))

        # Deltabox Aluminum Twin-Spar Frame & Belly Pan
        for side in [-1, 1]:
            spar_pts = [
                (side * 0.13, 0.65, 1.04),
                (side * 0.22, 0.28, 0.88),
                (side * 0.20, -0.16, 0.64),
            ]
            for f in add_tube_along_points(bm, spar_pts, [0.028, 0.042, 0.032], segments=10):
                face_mats.append((f, 5))  # matte carbon/black Deltabox
            # MotoGP Aero Side Winglets
            wing_loop = [
                (side * 0.23, 0.86, 0.98),
                (side * 0.37, 0.80, 0.95),
                (side * 0.36, 0.72, 0.89),
                (side * 0.24, 0.74, 0.90),
            ]
            for f in add_tube_along_points(bm, wing_loop, 0.014, segments=8):
                face_mats.append((f, 5))

        # Seat pad
        seat_sections = [
            (0.06, 0.98, 0.15, 0.04),
            (-0.18, 0.95, 0.17, 0.05),
            (-0.35, 0.98, 0.15, 0.04),
        ]
        for f in add_lofted_shell(bm, seat_sections, n_pts=16):
            face_mats.append((f, 1))

        # Crossplane 4-into-1 Titanium Underbelly Collector & High-Mount Akrapovic-style Canister
        for x_off in [-0.11, -0.04, 0.04, 0.11]:
            hdr = [(x_off, 0.35, 0.66), (x_off, 0.44, 0.50), (0.04, 0.12, 0.35), (0.15, -0.25, 0.38)]
            for f in add_tube_along_points(bm, hdr, 0.018, segments=8):
                face_mats.append((f, 2))
        up_pipe = [(0.15, -0.25, 0.38), (0.21, -0.55, 0.52), (0.22, -0.82, 0.68)]
        for f in add_tube_along_points(bm, up_pipe, [0.026, 0.048, 0.044], segments=12):
            face_mats.append((f, 4))  # titanium gold/bronze

        # Twin Slash LED DRL Brows + Under-Slung Projector Eyes
        for side in [-1, 1]:
            drl_pts = [(side * 0.05, 1.18, 1.01), (side * 0.17, 1.10, 1.04)]
            for f in add_tube_along_points(bm, drl_pts, 0.014, segments=8):
                face_mats.append((f, 3))
            for f in add_cylinder_between(bm, (side * 0.12, 1.10, 0.94), (side * 0.12, 1.16, 0.93), 0.028, segments=12):
                face_mats.append((f, 3))

    elif style == 'outlaw':
        # Harley-Davidson Fat Boy-inspired V-Twin Muscle Cruiser
        # 1. Sculpted Teardrop Fuel Tank with Central Chrome Console
        tank_sections = [
            (0.68, 1.06, 0.12, 0.09),
            (0.50, 1.12, 0.25, 0.16),
            (0.26, 1.08, 0.22, 0.14),
            (0.04, 0.96, 0.13, 0.09),
        ]
        for f in add_lofted_shell(bm, tank_sections, n_pts=20, pinch_bottom=0.45, arch_top=0.2):
            face_mats.append((f, 0))
        # Chrome tank console strip
        for f in add_beveled_box(bm, (0.0, 0.38, 1.22), (0.07, 0.48, 0.04), bevel=0.008, rx=0.18):
            face_mats.append((f, 2))

        # 2. Deep Sculpted Leather Cruiser Bucket Saddle
        seat_sections = [
            (0.05, 0.88, 0.14, 0.05),
            (-0.18, 0.78, 0.22, 0.07),
            (-0.40, 0.84, 0.20, 0.08),
            (-0.55, 0.90, 0.15, 0.05),
        ]
        for f in add_lofted_shell(bm, seat_sections, n_pts=18):
            face_mats.append((f, 1))

        # 3. Swept Valanced Rear Cruiser Fender wrapping the fat rear tire
        fender_sections = [
            (-0.55, 0.86, 0.17, 0.08),
            (-0.82, 0.88, 0.18, 0.12),
            (-1.12, 0.80, 0.18, 0.14),
            (-1.32, 0.62, 0.17, 0.10),
        ]
        for f in add_lofted_shell(bm, fender_sections, n_pts=18, pinch_bottom=0.5):
            face_mats.append((f, 0))

        # 4. Detailed 45-Degree Air-Cooled Finned V-Twin Engine + Chrome Air Cleaner
        # Crankcase
        for f in add_cylinder_between(bm, (-0.16, 0.18, 0.50), (0.18, 0.18, 0.50), 0.15, segments=18):
            face_mats.append((f, 2))
        # Front & Rear V-Twin Cylinders with cooling fins
        for cyl_angle, cyl_y in [(0.38, 0.30), (-0.38, 0.06)]:
            p_base = (0.0, 0.18, 0.54)
            p_head = (0.0, 0.18 + math.sin(cyl_angle) * 0.34, 0.54 + math.cos(cyl_angle) * 0.34)
            for f in add_cylinder_between(bm, p_base, p_head, 0.10, 0.11, segments=16):
                face_mats.append((f, 5))
            # Chrome rocker box cover
            p_rocker = (0.0, p_head[1] + math.sin(cyl_angle) * 0.05, p_head[2] + math.cos(cyl_angle) * 0.05)
            for f in add_cylinder_between(bm, p_head, p_rocker, 0.115, segments=16):
                face_mats.append((f, 2))
            # Chrome pushrod tubes on right side
            for pr_off in [-0.03, 0.03]:
                for f in add_cylinder_between(
                    bm,
                    (0.12, 0.18 + pr_off, 0.54),
                    (0.12, p_head[1] + pr_off, p_head[2]),
                    0.012,
                    segments=8,
                ):
                    face_mats.append((f, 2))
        # Round chrome air cleaner on right side
        for f in add_cylinder_between(bm, (0.14, 0.18, 0.68), (0.21, 0.18, 0.68), 0.11, segments=20):
            face_mats.append((f, 2))

        # 5. Dual Staggered Chrome Shotgun Exhaust Pipes
        pipe1 = [(0.12, 0.32, 0.72), (0.23, 0.25, 0.52), (0.23, -0.35, 0.48), (0.23, -1.05, 0.48)]
        pipe2 = [(0.12, 0.04, 0.72), (0.23, -0.05, 0.62), (0.23, -0.55, 0.60), (0.23, -0.92, 0.60)]
        for f in add_tube_along_points(bm, pipe1, [0.026, 0.034, 0.044, 0.044], segments=14):
            face_mats.append((f, 2))
        for f in add_tube_along_points(bm, pipe2, [0.026, 0.034, 0.044, 0.044], segments=14):
            face_mats.append((f, 2))

        # 6. Massive Chrome Headlight Nacelle & Round Lamp
        for f in add_cylinder_between(bm, (0.0, 0.78, 1.12), (0.0, 0.98, 1.12), 0.11, 0.125, segments=20):
            face_mats.append((f, 2))
        for f in add_cylinder_between(bm, (0.0, 0.98, 1.12), (0.0, 1.02, 1.12), 0.11, segments=20):
            face_mats.append((f, 3))

    else:
        # cafe: Honda CB750-inspired Classic Four-Cylinder Cafe Racer
        # 1. Retro Bullet Bikini Nose Fairing + Round Glass Headlamp
        nose_sections = [
            (1.16, 1.06, 0.11, 0.11),
            (1.02, 1.09, 0.18, 0.17),
            (0.82, 1.12, 0.20, 0.18),
            (0.68, 1.10, 0.16, 0.14),
        ]
        for f in add_lofted_shell(bm, nose_sections, n_pts=20, pinch_bottom=0.2):
            face_mats.append((f, 0))
        # Chrome headlight bezel & glowing round lamp
        for f in add_cylinder_between(bm, (0.0, 1.14, 1.06), (0.0, 1.19, 1.06), 0.095, segments=22):
            face_mats.append((f, 2))
        for f in add_cylinder_between(bm, (0.0, 1.19, 1.06), (0.0, 1.21, 1.06), 0.082, segments=22):
            face_mats.append((f, 3))

        # 2. Classic Horizontal-Bone-Line Fuel Tank with Rubber Knee Grips
        tank_sections = [
            (0.64, 1.04, 0.12, 0.10),
            (0.48, 1.09, 0.21, 0.14),
            (0.22, 1.08, 0.19, 0.13),
            (0.02, 1.01, 0.14, 0.09),
        ]
        for f in add_lofted_shell(bm, tank_sections, n_pts=20, pinch_bottom=0.45):
            face_mats.append((f, 0))
        for side in [-0.185, 0.185]:
            for f in add_beveled_box(bm, (side, 0.24, 1.05), (0.025, 0.26, 0.11), bevel=0.005):
                face_mats.append((f, 1))  # rubber knee pad

        # 3. Tuck-and-Roll Ribbed Leather Seat + Fiberglass Wasp-Tail Cafe Hump
        for rib in range(6):
            ry_pos = -0.04 - rib * 0.065
            for f in add_beveled_box(bm, (0.0, ry_pos, 0.96), (0.26, 0.058, 0.065), bevel=0.012):
                face_mats.append((f, 1))
        hump_sections = [
            (-0.42, 0.98, 0.15, 0.09),
            (-0.60, 1.05, 0.17, 0.13),
            (-0.78, 1.03, 0.14, 0.10),
            (-0.92, 0.98, 0.07, 0.05),
        ]
        for f in add_lofted_shell(bm, hump_sections, n_pts=18, pinch_bottom=0.4):
            face_mats.append((f, 0))

        # 4. Exposed Air-Cooled Inline-4 Finned Engine Block & 4-into-1 Curved Chrome Headers
        for f in add_beveled_box(bm, (0.0, 0.22, 0.64), (0.34, 0.28, 0.28), bevel=0.02, rx=0.15):
            face_mats.append((f, 2))
        # Individual 4-into-1 curved chrome header pipes
        for x_off in [-0.135, -0.045, 0.045, 0.135]:
            hdr_pts = [
                (x_off, 0.36, 0.68),
                (x_off * 1.1, 0.50, 0.56),
                (x_off * 0.8, 0.42, 0.38),
                (0.08, 0.08, 0.35),
                (0.17, -0.25, 0.38),
            ]
            for f in add_tube_along_points(bm, hdr_pts, 0.019, segments=10):
                face_mats.append((f, 2))
        mega_pts = [(0.17, -0.25, 0.38), (0.20, -0.58, 0.44), (0.21, -0.92, 0.52)]
        for f in add_tube_along_points(bm, mega_pts, [0.026, 0.046, 0.052], segments=14):
            face_mats.append((f, 2))

        # Dual Rear Coil-Over Shock Absorbers
        for side in [-0.15, 0.15]:
            for f in add_cylinder_between(bm, (side, -0.52, 0.92), (side, -0.88, 0.48), 0.026, segments=10):
                face_mats.append((f, 4))

    # Common to all 5 challengers:
    # A. Front Forks, Triple Clamps, Front Fender & Radial Brake Calipers
    fork_top_y = 0.64 if style != 'outlaw' else 0.68
    fork_top_z = 1.08 if style != 'outlaw' else 1.14
    for side in [-0.13, 0.13]:
        p_top = (side, fork_top_y, fork_top_z)
        p_mid = (side, (fork_top_y + fy) * 0.5, (fork_top_z + 0.529) * 0.5)
        p_bot = (side, fy, 0.529)
        outer_mat = 2 if style in ('outlaw', 'cafe') else 4  # chrome or gold USD
        for f in add_cylinder_between(bm, p_top, p_mid, 0.029, 0.027, segments=12):
            face_mats.append((f, outer_mat))
        for f in add_cylinder_between(bm, p_mid, p_bot, 0.022, 0.022, segments=12):
            face_mats.append((f, 2))
        # Brake caliper
        for f in add_beveled_box(bm, (side * 0.85, fy - 0.15, 0.57), (0.042, 0.10, 0.08), bevel=0.008, rx=0.35):
            face_mats.append((f, 4))

    # Sculpted Front Tire Fender
    fender_pts = [
        (0.0, fy + 0.18, 0.88),
        (0.0, fy + 0.02, 0.94),
        (0.0, fy - 0.18, 0.86),
        (0.0, fy - 0.28, 0.72),
    ]
    for f in add_tube_along_points(bm, fender_pts, [0.075, 0.095, 0.095, 0.080], segments=12):
        face_mats.append((f, 0))

    # B. Rear Swingarm & Drive Chain
    swing_sides = [-0.16] if style == 'redline' else [-0.16, 0.16]
    for side in swing_sides:
        sw_pts = [(side, -0.14, 0.58), (side, (ry - 0.14) * 0.5, 0.50), (side, ry, 0.437)]
        for f in add_tube_along_points(bm, sw_pts, [0.036, 0.042, 0.028], segments=10):
            face_mats.append((f, 2))

    # C. Rear Brake Light Cluster
    tail_y = -1.28 if style == 'outlaw' else (-0.92 if style == 'cafe' else -1.05)
    tail_z = 0.74 if style == 'outlaw' else (0.96 if style == 'cafe' else 1.04)
    for f in add_beveled_box(bm, (0.0, tail_y, tail_z), (0.16, 0.04, 0.042), bevel=0.006):
        face_mats.append((f, 6))  # brake-light

    mesh = bpy.data.meshes.new(f"{style}_chassis_mesh")
    bm.to_mesh(mesh)
    bm.free()

    for m in materials:
        mesh.materials.append(m)

    for idx, poly in enumerate(mesh.polygons):
        poly.use_smooth = True
        if idx < len(face_mats):
            poly.material_index = face_mats[idx][1]

    obj = bpy.data.objects.new("chassis", mesh)
    bpy.context.scene.collection.objects.link(obj)
    return obj


def build_challenger_cockpit(style, materials):
    """Builds a realistic 1st-person cockpit node (`cockpit`) tailored to each bike style."""
    bm = bmesh.new()
    face_mats = []

    is_cruiser = style == 'outlaw'
    is_cafe = style == 'cafe'
    bar_z = 1.32 if is_cruiser else (1.13 if is_cafe else 1.15)
    bar_y = 0.45 if is_cruiser else 0.58

    # Triple clamp
    for f in add_beveled_box(bm, (0.0, 0.62, 1.13), (0.27, 0.08, 0.026), bevel=0.005):
        face_mats.append((f, 2))

    for side in [-1, 1]:
        p_center = (side * 0.11, 0.62, 1.13)
        p_wrist = (side * 0.25, bar_y, bar_z)
        p_grip = (side * 0.40, bar_y - 0.05, bar_z - 0.02)
        for f in add_cylinder_between(bm, p_center, p_wrist, 0.014, segments=10):
            face_mats.append((f, 2))
        for f in add_cylinder_between(bm, p_wrist, p_grip, 0.019, segments=12):
            face_mats.append((f, 1))
        # Brake/Clutch lever
        lever_pts = [
            (side * 0.26, bar_y + 0.03, bar_z),
            (side * 0.34, bar_y + 0.05, bar_z - 0.01),
            (side * 0.39, bar_y + 0.02, bar_z - 0.015),
        ]
        for f in add_tube_along_points(bm, lever_pts, 0.007, segments=8):
            face_mats.append((f, 2))
        # Mirrors
        m_pos = (side * 0.44, bar_y - 0.04, bar_z + 0.08)
        for f in add_cylinder_between(bm, p_grip, m_pos, 0.008, segments=8):
            face_mats.append((f, 2))
        for f in add_beveled_box(bm, m_pos, (0.10, 0.035, 0.06), bevel=0.008):
            face_mats.append((f, 5))

    # Instrument cluster (twin round analog dials for cafe, TFT dash for sport/hyper)
    if is_cafe or is_cruiser:
        for side in [-0.055, 0.055]:
            for f in add_cylinder_between(bm, (side, 0.70, 1.16), (side, 0.68, 1.20), 0.042, segments=16):
                face_mats.append((f, 2))
            for f in add_cylinder_between(bm, (side, 0.68, 1.20), (side, 0.675, 1.205), 0.036, segments=16):
                face_mats.append((f, 3))
    else:
        for f in add_beveled_box(bm, (0.0, 0.72, 1.20), (0.16, 0.035, 0.095), bevel=0.006, rx=-0.45):
            face_mats.append((f, 5))
        for f in add_beveled_box(bm, (0.0, 0.708, 1.205), (0.135, 0.012, 0.075), bevel=0.003, rx=-0.45):
            face_mats.append((f, 3))

    # Tinted Windscreen (for sport/hyper/cafe)
    if not is_cruiser:
        ws_sections = [
            (0.96, 1.12, 0.13, 0.04),
            (0.80, 1.23, 0.20, 0.07),
            (0.62, 1.32, 0.18, 0.07),
        ]
        ws_rings = []
        n_arc = 10
        for wy, wz, ww, wh in ws_sections:
            ring = []
            for i in range(n_arc + 1):
                angle = math.pi * (0.15 + 0.70 * (i / n_arc))
                ring.append(bm.verts.new((math.cos(angle) * ww, wy, wz + math.sin(angle) * wh)))
            ws_rings.append(ring)
        for s in range(len(ws_rings) - 1):
            for i in range(n_arc):
                f = bm.faces.new((ws_rings[s][i], ws_rings[s + 1][i], ws_rings[s + 1][i + 1], ws_rings[s][i + 1]))
                face_mats.append((f, 7))

    mesh = bpy.data.meshes.new(f"{style}_cockpit_mesh")
    bm.to_mesh(mesh)
    bm.free()

    for m in materials:
        mesh.materials.append(m)

    for idx, poly in enumerate(mesh.polygons):
        poly.use_smooth = True
        if idx < len(face_mats):
            poly.material_index = face_mats[idx][1]

    obj = bpy.data.objects.new("cockpit", mesh)
    bpy.context.scene.collection.objects.link(obj)
    return obj


def generate_bike(style, color, spokes, out_path):
    init_scene()
    materials = [
        create_pbr_mat("custom-paint", color, metallic=0.72, roughness=0.24),
        create_pbr_mat("rubber", (0.018, 0.022, 0.028, 1.0), metallic=0.04, roughness=0.82),
        create_pbr_mat("brushed-alloy", (0.62, 0.67, 0.72, 1.0), metallic=0.92, roughness=0.22),
        create_pbr_mat("neon", (0.30, 0.95, 1.0, 1.0), emissive=(0.30, 0.95, 1.0, 1.0), emissive_strength=4.2),
        create_pbr_mat("gold-anodized", (0.82, 0.64, 0.24, 1.0), metallic=0.92, roughness=0.22),
        create_pbr_mat("carbon-fiber", (0.06, 0.07, 0.09, 1.0), metallic=0.35, roughness=0.32),
        create_pbr_mat("brake-light", (1.0, 0.08, 0.22, 1.0), emissive=(1.0, 0.08, 0.22, 1.0), emissive_strength=5.0),
        create_pbr_mat("glass", (0.12, 0.26, 0.34, 1.0), metallic=0.1, roughness=0.06, alpha=0.45),
    ]

    fy = 1.22 if style == 'outlaw' else (1.12 if style == 'ronin' else 1.075)
    ry = -1.16 if style == 'outlaw' else -1.074
    create_wheel_obj("front-wheel", (0.0, fy, 0.529), 0.523, 0.17, 0.34, spokes, True, style, materials)
    create_wheel_obj("rear-wheel", (0.0, ry, 0.437), 0.437, 0.24 if style == 'outlaw' else 0.22, 0.28, spokes, False, style, materials)
    build_challenger_chassis(style, fy, ry, materials)
    build_challenger_cockpit(style, materials)

    bpy.ops.export_scene.gltf(filepath=out_path, export_format='GLB', export_yup=True)
    print(f"Exported: {out_path} ({os.path.getsize(out_path)} bytes)")


def main():
    print("=== Generating Realistic Challenger Bikes Fleet ===")
    out_dir = os.path.abspath("assets/models/bikes")
    os.makedirs(out_dir, exist_ok=True)
    specs = [
        ('redline', (1.00, 0.22, 0.36, 1.0), 5),
        ('ronin',   (0.89, 0.66, 0.30, 1.0), 3),
        ('ghost',   (0.46, 0.53, 1.00, 1.0), 5),
        ('outlaw',  (0.85, 0.90, 0.92, 1.0), 0),
        ('cafe',    (0.21, 0.90, 0.86, 1.0), 8),
    ]
    for style, col, spokes in specs:
        generate_bike(style, col, spokes, os.path.join(out_dir, f"{style}.glb"))
    print("=== All 5 Challenger Bikes Generated Successfully ===")


if __name__ == "__main__":
    main()
