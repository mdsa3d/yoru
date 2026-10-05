// Shared observation vector (UPLIFT-PLAN B3/B8). ONE canonical builder feeds both the
// telemetry recorder (?telemetry=1 JSONL — the schema tools/ai-train assumes) and the
// rival policy net (src/mlp.js input width), so trainer and net can never drift apart.
// Pure, no imports.
//
// Schema v2 (3.20.0, OBS_WIDTH=50): the v1 40-float layout (13 ego + 3 opponent slots x 9
// relative channels, empty slots zero-filled) is kept verbatim in channels 0-39, and a
// 10-float PLAN BLOCK is appended so the recorded state actually determines the heuristic
// expert's action. Diagnosis (3.19.0/3.20.0): pursuitInput() in rivals.js is exactly
//   steer    = clamp((lane - x) * .3 - vx * .15)
//   throttle = v <  limit - .3      brake = v > limit + 1.5
//   limit    = (speedLimit || target) * (stun > 0 ? .55 : 1)
// so the action depends on lane, speedLimit/target and stun — none of which were in the
// v1 vector (BC held-out MSE plateaued ~0.36 because that mapping is unobservable from
// v1). Tactic and road curvature do NOT enter the mapping (tactic acts upstream through
// lane/speedLimit; x is road-relative), but the tactic id is included as a one-hot so the
// net can represent the tactical context the plan block summarises.
// Plan block (channels 40-49):
//   40 laneErr   ((lane ?? x) - x) / 10                target lane offset, m
//   41 headroom  (limit - v) / 50  (limit as above)    speed margin to the plan cap, m/s
//   42 stun      remaining stun time / 5, s
//   43-49        tactic one-hot over OBS_TACTICS
//
// v2 channels are NORMALISED (fixed per-channel divisors below, O(1) ranges): the v1 raw
// units (s up to 4000, rpm ~13k) saturate the tanh hidden layers and stall BC training
// (measured 3.20.0: holdout MSE stuck ~0.25 with raw units despite a deterministic
// obs->label mapping, vs ~0.36 for v1 where the mapping is unobservable). v1 stays raw —
// it is frozen for the legacy placeholder weights.
//
// neon-rash-mlp@1 nets are width-40 v1 and keep working: driveNet dispatches on the loaded
// net's input width via buildObsFor(). neon-rash-mlp@2 = same JSON serialisation, v2 obs.
export const OBS_WIDTH=50,OBS_EGO=13,OBS_PER=9,OBS_SLOTS=3,OBS_PLAN=10;
export const OBS_V1_WIDTH=40;
// Canonical tactic order for the one-hot; rivals.js re-exports this as TACTICS (no drift).
export const OBS_TACTICS=['race','overtake','defend','yield','slipstream','block','bait'];

// v1 layout, frozen: the exact pre-3.20.0 40-float vector. Only used for legacy
// neon-rash-mlp@1 width-40 weights (e.g. the synthetic placeholder asset).
export function buildObsV1(ego,others=[],out){
 out=out||new Array(OBS_V1_WIDTH);
 out[0]=ego.s||0;out[1]=ego.x||0;out[2]=ego.y||0;out[3]=ego.v||0;out[4]=ego.vx||0;out[5]=ego.vy||0;
 out[6]=ego.gear||0;out[7]=ego.rpm||0;out[8]=ego.lean||0;out[9]=ego.health??0;out[10]=ego.energy??0;
 out[11]=ego.surfaceGrip??1;out[12]=ego.flight?1:0;
 for(let k=0;k<OBS_SLOTS;k++){
  const o=others[k]||null,b=OBS_EGO+k*OBS_PER;
  out[b]=o?o.s-ego.s:0;out[b+1]=o?o.x-ego.x:0;out[b+2]=o?(o.y||0)-(ego.y||0):0;out[b+3]=o?o.v-ego.v:0;
  out[b+4]=o?.vx||0;out[b+5]=o?.stun||0;out[b+6]=o?.attack||0;out[b+7]=o?.flight?1:0;out[b+8]=o?.target||0;
 }
 return out;
}
// Fixed v2 normalisation divisors, one per channel (channels not listed are already O(1)).
export const OBS_SCALE=[1000,10,50,100,10,10,8,12000,1,100,100,1,1, 100,10,10,50,10,5,5,1,100, 100,10,10,50,10,5,5,1,100, 100,10,10,50,10,5,5,1,100, 10,50,5,1,1,1,1,1,1,1];
// Canonical v2 builder: v1 layout (normalised) channels 0-39 + plan block 40-49.
export function buildObs(ego,others=[],out){
 out=buildObsV1(ego,others,out&&out.length>=OBS_WIDTH?out:new Array(OBS_WIDTH));
 const stun=ego.stun||0,limit=(ego.speedLimit||ego.target||0)*(stun>0?.55:1);
 out[40]=(ego.lane??ego.x??0)-(ego.x||0);
 out[41]=limit-(ego.v||0);
 out[42]=stun;
 for(let k=0;k<OBS_TACTICS.length;k++)out[43+k]=ego.tactic===OBS_TACTICS[k]?1:0;
 for(let k=0;k<OBS_WIDTH;k++)out[k]/=OBS_SCALE[k];
 return out;
}
// Dispatch by the loaded net's input width so @1 (40) and @2 (50) policies both run.
export function buildObsFor(width,ego,others,out){
 return width===OBS_V1_WIDTH?buildObsV1(ego,others,out):buildObs(ego,others,out);
}
