"""Realistic Articulated Motorcycle Pilot / Human Rider Generator using Blender Python API.
Builds a high-detail anatomical motorcycle racer with sculpted MotoGP aerodynamic helmet,
iridium visor, leather racing suit with dorsal aero hump, segmented spine protector,
molded chest/shoulder armor, muscular limbs with accordion stretch ribs, gauntlets, and boots.

Exports named articulated component nodes (`torso`, `head`, `upper-arm`, `forearm`, `thigh`,
`shin`, `elbow-pad`, `knee-pad`, `gauntlet`, `boot`) for real-time IK/posture animation in
`src/rider.js`, plus a full posed `pilot` assembly.

Run via: blender --background --python tools/blender/generate_human.py
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


def loft_z_sections(bm, sections, n_pts=20, offset=(0.0, 0.0, 0.0), rx=0.0, cap_ends=True):
    """Lofts smooth anatomical cross-sections defined as (z, y_center, rx_width, ry_depth)."""
    rot = Matrix.Rotation(rx, 4, 'X')
    trans = Matrix.Translation(offset) @ rot
    rings = []
    for z_val, y_off, rw, rd in sections:
        ring = []
        for i in range(n_pts):
            theta = (2.0 * math.pi * i) / n_pts
            cos_t, sin_t = math.cos(theta), math.sin(theta)
            # Subtle anatomical squaring on chest/back
            r_mod = 1.0 + 0.06 * math.cos(2.0 * theta)
            x = cos_t * rw * r_mod
            y = y_off + sin_t * rd * r_mod
            co = trans @ Vector((x, y, z_val))
            ring.append(bm.verts.new(co))
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


def build_torso_mesh(materials):
    """Builds the articulated upper torso mesh in local `upper` coordinates.
    In Blender: +Y is forward (-Z in Three.js), +Z is up (+Y in Three.js).
    """
    bm = bmesh.new()
    face_mats = []
    # Materials: 0: suit-fabric, 1: armor-plating, 2: visor-glow, 3: neon-accent, 4: leather-trim

    # 1. Main Anatomical Torso (pelvis -> waist -> ribcage -> broad shoulders -> neck collar)
    # Forward lean of ~0.38 rad built into the spine curve
    torso_sections = [
        (0.00,  0.00, 0.16, 0.12),   # Pelvis / waist base
        (0.10,  0.03, 0.15, 0.115),  # Lower abdomen
        (0.22,  0.08, 0.18, 0.135),  # Mid ribcage
        (0.35,  0.13, 0.21, 0.150),  # Upper chest / pectorals
        (0.45,  0.17, 0.22, 0.135),  # Shoulder girdle
        (0.52,  0.20, 0.11, 0.095),  # Neck collar ring
    ]
    for f in loft_z_sections(bm, torso_sections, n_pts=24):
        face_mats.append((f, 0))  # suit-fabric

    # 2. Molded Chest Protector Panels (Front +Y side)
    chest_sections = [
        (0.16, 0.16, 0.12, 0.035),
        (0.28, 0.20, 0.16, 0.045),
        (0.40, 0.24, 0.15, 0.040),
        (0.46, 0.25, 0.10, 0.025),
    ]
    for f in loft_z_sections(bm, chest_sections, n_pts=16):
        face_mats.append((f, 1))  # armor-plating

    # 3. MotoGP Aerodynamic Speed Hump & Segmented Dorsal Spine Protector (Back -Y side)
    hump_sections = [
        (0.14, -0.05, 0.07, 0.03),
        (0.26, -0.04, 0.10, 0.055),
        (0.38,  0.00, 0.11, 0.065),
        (0.47,  0.06, 0.08, 0.040),
    ]
    for f in loft_z_sections(bm, hump_sections, n_pts=16):
        face_mats.append((f, 1))

    # Segmented vertebrae armor ribs + dual neon telemetry strips on back
    for i in range(6):
        t = i / 5.0
        sz = 0.12 + t * 0.33
        sy = -0.09 + t * 0.11
        seg_sec = [
            (sz - 0.022, sy, 0.075, 0.022),
            (sz,         sy - 0.01, 0.085, 0.028),
            (sz + 0.022, sy, 0.070, 0.020),
        ]
        for f in loft_z_sections(bm, seg_sec, n_pts=12):
            face_mats.append((f, 1))

    for side in [-0.115, 0.115]:
        strip_sec = [
            (0.14, -0.05, 0.012, 0.012),
            (0.30,  0.00, 0.014, 0.014),
            (0.45,  0.06, 0.012, 0.012),
        ]
        for f in loft_z_sections(bm, strip_sec, n_pts=8, offset=(side, 0, 0)):
            face_mats.append((f, 3))  # neon-accent

    # 4. Sculpted Titanium/TPU Shoulder Pauldrons
    for side in [-1, 1]:
        sh_sec = [
            (0.38, 0.16, 0.065, 0.075),
            (0.45, 0.17, 0.085, 0.095),
            (0.50, 0.17, 0.060, 0.070),
        ]
        for f in loft_z_sections(bm, sh_sec, n_pts=16, offset=(side * 0.20, 0, 0)):
            face_mats.append((f, 1))

    mesh = bpy.data.meshes.new("torso_mesh")
    bm.to_mesh(mesh)
    bm.free()
    for m in materials:
        mesh.materials.append(m)
    for idx, poly in enumerate(mesh.polygons):
        poly.use_smooth = True
        if idx < len(face_mats):
            poly.material_index = face_mats[idx][1]
    return mesh


def build_helmet_mesh(materials):
    """Builds a sculpted aerodynamic full-face MotoGP helmet centered at origin.
    In Blender: +Y is forward (-Z in Three.js), +Z is up (+Y in Three.js).
    """
    bm = bmesh.new()
    face_mats = []

    # 1. Outer Carbon/Composite Aerodynamic Shell
    shell_sections = [
        (-0.14,  0.02, 0.11, 0.13),  # Neck curtain / base ring
        (-0.08,  0.04, 0.14, 0.17),  # Jawline / chin bar level
        (-0.01,  0.02, 0.155, 0.185), # Cheek / visor lower edge
        ( 0.06,  0.00, 0.158, 0.190), # Brow / temple level
        ( 0.13, -0.02, 0.140, 0.175), # Crown / top aero vents
        ( 0.18, -0.04, 0.085, 0.110), # Top dome
    ]
    for f in loft_z_sections(bm, shell_sections, n_pts=28):
        face_mats.append((f, 1))  # armor-plating

    # 2. Rear Aerodynamic Diffuser Spoiler Fin
    spoiler_sections = [
        (0.02, -0.17, 0.09, 0.04),
        (0.07, -0.21, 0.11, 0.055),
        (0.12, -0.19, 0.09, 0.04),
    ]
    for f in loft_z_sections(bm, spoiler_sections, n_pts=14):
        face_mats.append((f, 1))

    # 3. Curved Flush Iridium/HUD Visor Shield (+Y front hemisphere)
    visor_rings = []
    n_arc = 16
    z_levels = [(-0.035, 0.156, 0.186), (0.015, 0.162, 0.195), (0.065, 0.156, 0.188)]
    for zv, rw, rd in z_levels:
        ring = []
        for i in range(n_arc + 1):
            # Front arc from -58 deg to +58 deg around +Y
            angle = math.radians(-58.0 + 116.0 * (i / n_arc))
            x = math.sin(angle) * rw
            y = math.cos(angle) * rd + 0.015
            ring.append(bm.verts.new((x, y, zv)))
        visor_rings.append(ring)

    for s in range(len(visor_rings) - 1):
        for i in range(n_arc):
            f = bm.faces.new((visor_rings[s][i], visor_rings[s + 1][i], visor_rings[s + 1][i + 1], visor_rings[s][i + 1]))
            face_mats.append((f, 2))  # visor-glow

    # 4. Glowing HUD Visor Trim & Chin Bar Intake Vent
    brow_sec = [
        (0.068, 0.185, 0.09, 0.015),
        (0.082, 0.180, 0.08, 0.015),
    ]
    for f in loft_z_sections(bm, brow_sec, n_pts=12):
        face_mats.append((f, 3))  # neon-accent

    chin_sec = [
        (-0.10, 0.175, 0.055, 0.025),
        (-0.06, 0.185, 0.065, 0.025),
    ]
    for f in loft_z_sections(bm, chin_sec, n_pts=12):
        face_mats.append((f, 4))  # leather-trim

    mesh = bpy.data.meshes.new("head_mesh")
    bm.to_mesh(mesh)
    bm.free()
    for m in materials:
        mesh.materials.append(m)
    for idx, poly in enumerate(mesh.polygons):
        poly.use_smooth = True
        if idx < len(face_mats):
            poly.material_index = face_mats[idx][1]
    return mesh


def build_unit_limb_mesh(name, profiles, materials):
    """Builds a sculpted anatomical limb of unit length (Z from -0.5 to +0.5 in Blender,
    which becomes Y from -0.5 to +0.5 in Three.js for `placeLimb()`).
    `profiles` is a list of (z_norm, rx_radius, ry_radius, mat_idx).
    """
    bm = bmesh.new()
    face_mats = []
    n_pts = 18
    rings = []
    for z_val, rx_r, ry_r, _ in profiles:
        ring = []
        for i in range(n_pts):
            theta = (2.0 * math.pi * i) / n_pts
            ring.append(bm.verts.new((math.cos(theta) * rx_r, math.sin(theta) * ry_r, z_val)))
        rings.append(ring)

    for s in range(len(profiles) - 1):
        mat_idx = profiles[s][3]
        for i in range(n_pts):
            ni = (i + 1) % n_pts
            f = bm.faces.new((rings[s][i], rings[s + 1][i], rings[s + 1][ni], rings[s][ni]))
            face_mats.append((f, mat_idx))
    faces_cap1 = bm.faces.new(rings[0][::-1])
    faces_cap2 = bm.faces.new(rings[-1])
    face_mats.append((faces_cap1, profiles[0][3]))
    face_mats.append((faces_cap2, profiles[-1][3]))

    mesh = bpy.data.meshes.new(f"{name}_mesh")
    bm.to_mesh(mesh)
    bm.free()
    for m in materials:
        mesh.materials.append(m)
    for idx, poly in enumerate(mesh.polygons):
        poly.use_smooth = True
        if idx < len(face_mats):
            poly.material_index = face_mats[idx][1]
    return mesh


def build_pad_or_extremity_mesh(name, sections, materials, mat_idx=1):
    bm = bmesh.new()
    face_mats = []
    for f in loft_z_sections(bm, sections, n_pts=16):
        face_mats.append((f, mat_idx))
    mesh = bpy.data.meshes.new(f"{name}_mesh")
    bm.to_mesh(mesh)
    bm.free()
    for m in materials:
        mesh.materials.append(m)
    for idx, poly in enumerate(mesh.polygons):
        poly.use_smooth = True
        if idx < len(face_mats):
            poly.material_index = face_mats[idx][1]
    return mesh


def generate_pilot(out_path):
    init_scene()
    materials = [
        create_pbr_mat("suit-fabric", (0.12, 0.16, 0.21, 1.0), metallic=0.08, roughness=0.78),
        create_pbr_mat("armor-plating", (0.24, 0.29, 0.34, 1.0), metallic=0.48, roughness=0.32),
        create_pbr_mat("visor-glow", (0.12, 0.82, 1.0, 1.0), emissive=(0.12, 0.82, 1.0, 1.0), emissive_strength=3.2),
        create_pbr_mat("neon-accent", (0.47, 0.90, 0.95, 1.0), emissive=(0.47, 0.90, 0.95, 1.0), emissive_strength=2.5),
        create_pbr_mat("leather-trim", (0.05, 0.07, 0.10, 1.0), metallic=0.05, roughness=0.68),
    ]

    # 1. Torso node
    torso_mesh = build_torso_mesh(materials)
    torso_obj = bpy.data.objects.new("torso", torso_mesh)
    torso_obj.location = (0.0, -0.30, 1.36)
    bpy.context.scene.collection.objects.link(torso_obj)

    # 2. Helmet / Head node
    head_mesh = build_helmet_mesh(materials)
    head_obj = bpy.data.objects.new("head", head_mesh)
    head_obj.location = (0.0, 0.06, 2.05)
    bpy.context.scene.collection.objects.link(head_obj)

    # 3. Sculpted Unit-Length Limb Meshes (Z from -0.5 to +0.5 in Blender -> Y from -0.5 to +0.5 in Three.js)
    upper_arm_mesh = build_unit_limb_mesh(
        "upper-arm",
        [
            (-0.50, 0.068, 0.068, 0),
            (-0.25, 0.078, 0.082, 0),  # Bicep/tricep contour
            ( 0.05, 0.082, 0.086, 1),  # Upper arm leather/armor band
            ( 0.30, 0.076, 0.078, 0),
            ( 0.50, 0.066, 0.066, 0),
        ],
        materials,
    )
    forearm_mesh = build_unit_limb_mesh(
        "forearm",
        [
            (-0.50, 0.052, 0.052, 1),  # Gauntlet cuff
            (-0.15, 0.062, 0.066, 1),  # Forearm guard
            ( 0.20, 0.070, 0.074, 0),  # Forearm muscle belly
            ( 0.50, 0.064, 0.064, 0),
        ],
        materials,
    )
    thigh_mesh = build_unit_limb_mesh(
        "thigh",
        [
            (-0.50, 0.088, 0.092, 0),  # Knee end with accordion ribs
            (-0.25, 0.105, 0.115, 1),  # Thigh armor plate
            ( 0.10, 0.118, 0.128, 0),  # Quadriceps / hamstring contour
            ( 0.50, 0.112, 0.118, 0),  # Hip joint
        ],
        materials,
    )
    shin_mesh = build_unit_limb_mesh(
        "shin",
        [
            (-0.50, 0.068, 0.072, 1),  # Boot upper collar
            (-0.10, 0.082, 0.088, 1),  # Armored shin guard
            ( 0.25, 0.092, 0.098, 0),  # Calf muscle
            ( 0.50, 0.085, 0.085, 0),  # Knee joint
        ],
        materials,
    )

    elbow_pad_mesh = build_pad_or_extremity_mesh(
        "elbow-pad",
        [(-0.07, 0.0, 0.055, 0.06), (0.0, -0.01, 0.075, 0.082), (0.07, 0.0, 0.055, 0.06)],
        materials,
        mat_idx=1,
    )
    knee_pad_mesh = build_pad_or_extremity_mesh(
        "knee-pad",
        [(-0.09, 0.0, 0.075, 0.065), (0.0, 0.01, 0.098, 0.088), (0.09, 0.0, 0.075, 0.065)],
        materials,
        mat_idx=1,
    )
    gauntlet_mesh = build_pad_or_extremity_mesh(
        "gauntlet",
        [(-0.05, -0.02, 0.058, 0.048), (0.0, 0.0, 0.068, 0.075), (0.05, 0.02, 0.052, 0.055)],
        materials,
        mat_idx=4,
    )
    boot_mesh = build_pad_or_extremity_mesh(
        "boot",
        [
            (-0.06,  0.04, 0.072, 0.145),  # Sole
            (-0.01,  0.03, 0.076, 0.140),  # Instep & toe slider
            ( 0.05, -0.02, 0.068, 0.095),  # Ankle support collar
        ],
        materials,
        mat_idx=4,
    )

    for name, m, loc in [
        ("upper-arm", upper_arm_mesh, (-0.25, 0.18, 1.55)),
        ("forearm", forearm_mesh, (-0.34, 0.42, 1.38)),
        ("thigh", thigh_mesh, (-0.22, -0.15, 1.15)),
        ("shin", shin_mesh, (-0.30, -0.20, 0.78)),
        ("elbow-pad", elbow_pad_mesh, (-0.34, 0.38, 1.47)),
        ("knee-pad", knee_pad_mesh, (-0.35, 0.0, 0.97)),
        ("gauntlet", gauntlet_mesh, (-0.40, 0.60, 1.28)),
        ("boot", boot_mesh, (-0.29, -0.29, 0.58)),
    ]:
        obj = bpy.data.objects.new(name, m)
        obj.location = loc
        bpy.context.scene.collection.objects.link(obj)

    bpy.ops.export_scene.gltf(filepath=out_path, export_format='GLB', export_yup=True)
    print(f"Exported: {out_path} ({os.path.getsize(out_path)} bytes)")


def main():
    print("=== Generating Realistic Articulated Motorcycle Pilot ===")
    out_dir = os.path.abspath("assets/models/rider")
    os.makedirs(out_dir, exist_ok=True)
    generate_pilot(os.path.join(out_dir, "pilot.glb"))
    print("=== Pilot Asset Generated Successfully ===")


if __name__ == "__main__":
    main()
