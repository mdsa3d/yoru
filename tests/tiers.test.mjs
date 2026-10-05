import test from 'node:test';import assert from 'node:assert/strict';
import {TIERS,TIER_NAMES,TierController,tierForRating,resolveTier,makeTierPolicy,mulberry32} from '../src/tiers.js';
import {loadMLP} from '../src/mlp.js';
import {readFileSync} from 'node:fs';

test('tier table: noise and delay fall, cap rises, rookie -> elite',()=>{
 assert.deepEqual(TIER_NAMES,['rookie','pro','elite','adaptive']);
 assert.ok(TIERS.rookie.noise>TIERS.pro.noise&&TIERS.pro.noise>TIERS.elite.noise);
 assert.ok(TIERS.rookie.delay>TIERS.pro.delay&&TIERS.pro.delay>TIERS.elite.delay);
 assert.ok(TIERS.rookie.cap<TIERS.pro.cap&&TIERS.pro.cap<TIERS.elite.cap&&TIERS.elite.cap===1);
 for(const t of Object.values(TIERS)){assert.ok(t.noise>=0&&t.delay>=0&&t.cap>0&&t.cap<=1)}
});
test('SkillTracker.rating [-1,1] maps to tiers in thirds; adaptive resolves',()=>{
 assert.equal(tierForRating(-1),'rookie');assert.equal(tierForRating(-.34),'rookie');
 assert.equal(tierForRating(-.33),'pro');assert.equal(tierForRating(0),'pro');assert.equal(tierForRating(.33),'pro');
 assert.equal(tierForRating(.34),'elite');assert.equal(tierForRating(1),'elite');
 assert.equal(tierForRating(NaN),'pro');assert.equal(tierForRating(99),'elite');
 assert.equal(resolveTier('adaptive',-0.9),'rookie');assert.equal(resolveTier('adaptive',0.9),'elite');
 assert.equal(resolveTier('elite',-1),'elite');                       // explicit tier ignores rating
 assert.throws(()=>resolveTier('godmode'),/unknown tier/);
 assert.equal(new TierController({tier:'adaptive',rating:0.9}).tier,'elite');
});
test('seeded PRNG and controllers are deterministic; seeds differ',()=>{
 const a=mulberry32(42),b=mulberry32(42),c=mulberry32(43);
 const seqA=[a(),a(),a()],seqB=[b(),b(),b()],seqC=[c(),c(),c()];
 assert.deepEqual(seqA,seqB);assert.notDeepEqual(seqA,seqC);
 for(const v of seqA)assert.ok(v>=0&&v<1);
 const run=seed=>{const t=new TierController({tier:'pro',seed});const out=[];for(let i=0;i<50;i++)out.push(...t.shape([.5,.5,.5]));return out};
 assert.deepEqual(run(7),run(7));assert.notDeepEqual(run(7),run(8));
});
test('policy never exceeds tier caps: shaped actions stay in range under adversarial raw output',()=>{
 for(const tier of ['rookie','pro','elite']){
  const c=new TierController({tier,seed:99,dt:1/60});
  const extremes=[[1e9,1e9,1e9],[-1e9,-1e9,-1e9],[Infinity,Infinity,Infinity],[-Infinity,-Infinity,-Infinity],[1,1,1],[-1,0,0],[.3,-.7,1.4]];
  for(let step=0;step<200;step++){
   const raw=extremes[step%extremes.length],out=c.shape(raw);
   assert.ok(out[0]>=-1&&out[0]<=1,`${tier} steer ${out[0]}`);
   assert.ok(out[1]>=0&&out[1]<=1,`${tier} throttle ${out[1]}`);
   assert.ok(out[2]>=0&&out[2]<=1,`${tier} brake ${out[2]}`);
   assert.ok(Number.isFinite(out[0])&&Number.isFinite(out[1])&&Number.isFinite(out[2]));
  }
  const vmax=90;
  assert.equal(c.limitSpeed(vmax*2,vmax),TIERS[tier].cap*vmax);       // capped
  assert.equal(c.limitSpeed(vmax*.5,vmax),vmax*.5);                   // never raised
  assert.ok(c.limitSpeed(vmax,vmax)<=vmax);
 }
});
test('reaction delay buffer: output trails input by ~delay seconds',()=>{
 const dt=1/60,c=new TierController({tier:'rookie',seed:1,dt});       // delay .30 s -> 18 slots
 const steps=Math.round(TIERS.rookie.delay/dt);
 let out;
 for(let i=0;i<steps;i++)out=c.shape([1,0,0]);                        // zeros (idle) during the delay window
 assert.ok(Math.abs(out[0])<.5,'steer still near the zero-filled buffer');
 for(let i=0;i<5;i++)out=c.shape([1,0,0]);
 assert.ok(out[0]>.5,'steer follows once the delay has elapsed');
 const e=new TierController({tier:'elite',seed:1,dt});                // elite delay 45 ms -> ~3 slots
 for(let i=0;i<6;i++)out=e.shape([1,0,0]);
 assert.ok(out[0]>.5,'elite reacts within 6 steps');
});
test('noise magnitude orders rookie > pro > elite around a constant action',()=>{
 const spread=(tier,seed)=>{const c=new TierController({tier,seed,dt:1/60});
  const xs=[];for(let i=0;i<400;i++)xs.push(c.shape([0,.5,0])[0]);
  const m=xs.reduce((a,b)=>a+b)/xs.length;return Math.sqrt(xs.reduce((a,b)=>a+(b-m)**2,0)/xs.length)};
 // same seed, but per-tier noise scales the same gaussian stream
 assert.ok(spread('rookie',5)>spread('pro',5)&&spread('pro',5)>spread('elite',5));
});
test('makeTierPolicy wraps a net: bounded output, NaN guard, obs width checked',()=>{
 const spec=JSON.parse(readFileSync(new URL('../assets/ai/rival-policy-synthetic.json',import.meta.url)));
 const net=loadMLP(spec);
 const policy=makeTierPolicy(net,{tier:'pro',seed:3});
 const obs=new Float32Array(40).fill(.1),out=policy(obs);
 assert.equal(out.length,3);
 assert.ok(out[0]>=-1&&out[0]<=1&&out[1]>=0&&out[1]<=1&&out[2]>=0&&out[2]<=1);
 assert.throws(()=>policy(new Float32Array(3)),/obs length/);
 const badNet={input:2,output:3,forward(){return Float32Array.from([NaN,NaN,NaN])}};
 const guarded=makeTierPolicy(badNet,{tier:'elite',seed:1,dt:1/10})(new Float32Array(2)); // dt .1 -> 0 delay slots
 assert.ok(Math.abs(guarded[0])<.15&&Math.abs(guarded[1])<.15&&guarded[2]>.85, // coast-to-brake fallback (elite noise .02 on top)
  `guarded ${[...guarded]}`);assert.ok([...guarded].every(Number.isFinite));
 assert.throws(()=>makeTierPolicy({input:40,output:2,forward(){}}),/output 3/);
});
