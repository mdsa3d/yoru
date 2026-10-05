// Difficulty tiers for the rival policy net (UPLIFT-PLAN B6). Pure logic, no DOM, no imports.
// One net serves all tiers; a tier adds action noise, a reaction-delay buffer and a
// top-speed cap. 'adaptive' resolves to a concrete tier from SkillTracker.rating ([-1,1],
// see rivals.js SkillTracker). All randomness comes from a seeded PRNG, so a (tier, seed,
// dt) triple replays deterministically.
export const TIERS={
 rookie:{noise:.16,delay:.30,cap:.82},
 pro:{noise:.07,delay:.13,cap:.92},
 elite:{noise:.02,delay:.045,cap:1},
};
export const TIER_NAMES=[...Object.keys(TIERS),'adaptive'];
const clamp=(x,a,b)=>x<a?a:x>b?b:x;
export function mulberry32(seed){
 let a=seed>>>0;
 return()=>{a|=0;a=a+0x6D2B79F5|0;let t=Math.imul(a^a>>>15,1|a);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296};
}
// rating in [-1,1] -> tier name; thirds of the range.
export function tierForRating(rating){
 const r=clamp(Number.isFinite(rating)?rating:0,-1,1);
 return r<-1/3?'rookie':r>1/3?'elite':'pro';
}
export function resolveTier(name,rating=0){
 if(name==='adaptive')return tierForRating(rating);
 if(!TIERS[name])throw new Error('tiers: unknown tier '+name);
 return name;
}
export class TierController {
 constructor({tier='pro',rating=0,seed=1,dt=1/60}={}){
  if(!(dt>0))throw new Error('tiers: dt must be positive');
  this.tier=resolveTier(tier,rating);this.spec=TIERS[this.tier];this.dt=dt;
  this.rand=mulberry32(seed);
  this.spare=null;                              // Box-Muller cached half
  this.delaySlots=Math.max(0,Math.round(this.spec.delay/dt));
  this.ring=new Float32Array((this.delaySlots+1)*3);  // zero-filled: a rival idles for its delay window
  this.head=0;
 }
 gaussian(){
  if(this.spare!==null){const s=this.spare;this.spare=null;return s}
  let u=0;while(u===0)u=this.rand();
  const r=Math.sqrt(-2*Math.log(u)),t=2*Math.PI*this.rand();
  this.spare=r*Math.sin(t);return r*Math.cos(t);
 }
 // raw: [steer,throttle,brake] straight from the policy; returns delayed + noised + clamped action.
 shape(raw,out){
  if(!raw||raw.length<3)throw new Error('tiers: action must be [steer,throttle,brake]');
  const slots=this.delaySlots+1,w=this.head%slots,r=(this.head+1)%slots; // r is delaySlots behind w
  const R=this.ring;
  R[w*3]=raw[0];R[w*3+1]=raw[1];R[w*3+2]=raw[2];this.head++;
  const n=this.spec.noise;
  out=out||new Float32Array(3);
  out[0]=clamp(R[r*3]+n*this.gaussian(),-1,1);          // steer
  out[1]=clamp(R[r*3+1]+n*this.gaussian(),0,1);         // throttle
  out[2]=clamp(R[r*3+2]+n*this.gaussian(),0,1);         // brake
  return out;
 }
 // Top-speed cap: tier fraction of the bike/world vmax. Never raises a speed.
 limitSpeed(v,vmax){return Math.min(v,this.spec.cap*vmax)}
}
// Convenience wrapper for wiring (main.js): policy(obs)->action under a tier.
export function makeTierPolicy(net,opts){
 const c=new TierController(opts),obs=net.input,out=new Float32Array(3),raw=new Float32Array(net.output);
 if(net.output!==3)throw new Error('tiers: policy net must output 3 (steer,throttle,brake)');
 // driveNet dispatches the obs builder (v1 40-float vs canonical v2) on this width, so
 // neon-rash-mlp@1 placeholder weights and @2 trained weights both get the right vector.
 const policy=(input,dst)=>{
  if(input.length!==obs)throw new Error('tiers: obs length '+obs+' expected');
  let r=net.forward(input,raw)||raw;               // accept policies that return their array instead of filling raw
  if(r[0]!==r[0]||r[1]!==r[1]||r[2]!==r[2]){raw[0]=0;raw[1]=0;raw[2]=1;r=raw} // NaN guard: coast to a brake
  return c.shape(r,dst||out);
 };
 policy.width=obs;
 return policy;
}
