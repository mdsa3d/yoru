// Reward for the B5 rival-policy RL trainer — one documented pure function (UPLIFT-PLAN B5:
// reward = progress − collision − off-road − unfair-contact). No imports, no state: the env
// (env.js) measures per-step events from the sim and this function scores them, so the reward
// definition can be unit-tested without running the sim.
//
// Event fields (all per one fixed 1/120 s step, for the trained rival):
//   ds        metres of forward progress this step (can be 0 while stunned/stationary)
//   dHealth   health points the rival lost this step (>= 0; in the sim core rival health is
//             only drained by wall scraping, so this doubles as a hard off-road signal)
//   collision true on the rising edge of an overlap with a traffic car or drone, measured
//             with the sim's own player-collision predicate (|ds|<2.6, |dx|<1.45, |dy|<1.4).
//             The sim core never resolves rival-traffic crashes physically, so this is a
//             reward-only measurement — documented here so nobody mistakes it for physics.
//   offRoad   true while grounded and |x| > 6.8 (the road half-width planRival clamps lanes to)
//   contact   true on the rising edge of body contact with the player, using stepSim's own
//             contact predicate (|ds|<2.1, |dx|<0.9, |dy|<1.3)
//   strike    true on the rising edge of the rival-strike trigger (a.attack 0 -> >0)
//   encounter the Director's current encounter ('recover'|'balanced'|'pressure'|'duel')
//
// Terms:
//   + w.progress * ds                        forward progress, metres
//   - w.healthLoss * dHealth                 any self-inflicted integrity loss
//   - w.collision    if collision            traffic/drone overlap event
//   - w.offRoad      if offRoad              per-step off-road surface penalty
//   - w.contact      if contact              rubbing the player is never free
//   - w.unfairContact if strike, or if contact while encounter==='recover'
//                                            hitting a rival/player the Director has ordered
//                                            to back off, or using the strike move, is unfair
//
// Weight calibration note (measured, first 14-min run): with progress .02 and offRoad .02,
// imperfect driving scored *worse* than standing still (wall-grinding ≈ -2.7/s vs 0 parked),
// and ES collapsed onto the degenerate "don't move" optimum within 10 generations. The
// weights below keep the ordering drive-fast > drive-dirty > parked: ≈ +2.2/s clean racing,
// ≈ +0.9/s while grinding a wall, 0 stationary — so the gradient always points at moving,
// and cleaning up lines is a secondary refinement. Collisions (-3) and unfair contact (-3)
// stay clearly visible against a ~+90 clean-episode return.
export const REWARD_WEIGHTS={progress:.04,healthLoss:.05,collision:3,offRoad:.005,contact:1,unfairContact:3};
export function emptyEvent(){return {ds:0,dHealth:0,collision:false,offRoad:false,contact:false,strike:false,encounter:'balanced'}}
export function stepReward(evt,w=REWARD_WEIGHTS){
 let r=w.progress*(evt.ds||0)-w.healthLoss*(evt.dHealth||0);
 if(evt.collision)r-=w.collision;
 if(evt.offRoad)r-=w.offRoad;
 if(evt.contact)r-=w.contact;
 if(evt.strike||(evt.contact&&evt.encounter==='recover'))r-=w.unfairContact;
 return r;
}
