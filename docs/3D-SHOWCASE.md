# Yoru 3D showcase & realistic simulation slice

The garage presents the selected bike on a dedicated stage, using a baked
RoomEnvironment reflection map and two lights that are disabled during racing.
Desktop controls occupy the left side, leaving the motorcycle on the right.

All six motorcycles (`kestrel`, `redline`, `ronin`, `ghost`, `outlaw`, `cafe`)
are now built in Blender (`tools/blender/generate_motorcycle.py` and
`tools/blender/generate_challengers.py`) with sculpted or multi-station lofted
fairings, fuel tanks, spoked/machined wheels, drilled brake rotors, model-specific
engines (L-Twin, Inline-4, 45° finned V-Twin), curved 3D tubular exhaust headers,
reactive `brake-light` nodes, and 1st-person `cockpit` assemblies.

All bikes share an articulated rider loaded from `assets/models/rider/pilot.glb`
(`tools/blender/generate_human.py`) whose sculpted torso, helmet, arms, and legs
respond to lean, speed tuck, knee turn-out, horizon-leveling head counter-roll,
and braking while keeping hands anchored on the handlebar grips.

Highway traffic (`sedan.glb`, `van.glb`, `taxi.glb`), autonomous aerial eVTOL
drones (`drone.glb`), road hazards (`barrier.glb`, `debris.glb` with 3 debris
variants), and world infrastructure (`gantry.glb`, `tower.glb`, `props.glb` with
`streetlamp` and `pylon`) are all generated from Blender and animated at runtime
(spinning wheels/rotors, reactive brake lights, and default physical rival
simulation via `driveRival` + `stepVehicle`).

Desert and alpine scenery sample a seeded absolute-coordinate height field.
Nine pooled terrain chunks regenerate only when their world chunk changes.
Neighboring chunks sample identical heights, colors and normals at their shared
edge. The road corridor stays clear. Desert has softened terraces; alpine adds
higher ridges and snow by elevation.

Validation: `npm test` (165 tests), `tests/browser-horizon-smoke.cjs` and
`tests/browser-slice-smoke.cjs`. Preview images are in
`previews/slice-showroom.png` and `previews/slice-solstice.png`.
