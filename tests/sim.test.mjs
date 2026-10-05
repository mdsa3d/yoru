import test from 'node:test';import assert from 'node:assert/strict';
import {createSim,resetSim,stepSim,SIM_STEP,mulberry32} from '../src/sim.js';
const setup={bike:0,tires:'street',weather:'rain',assist:1,gearing:1,mode:'race',world:'akuma',launch:'street'};
const INPUT={steer:0,throttle:true,brake:false,climb:0,boost:false};
// FNV-1a trace hash over rounded player/rival/traffic state, sampled every 12 steps.
function run(seed,brain='kinematic',seconds=60){
 const sim=createSim({setup,rivalBrain:brain});resetSim(sim,seed);
 let h=0x811c9dc5,maxRivalV=0;
 const mix=v=>{const s=String(Math.round(v*1000));for(let i=0;i<s.length;i++){h^=s.charCodeAt(i);h=Math.imul(h,0x01000193)}};
 const steps=Math.round(seconds/SIM_STEP);
 for(let i=0;i<steps&&!sim.done;i++){
  stepSim(sim,SIM_STEP,INPUT);
  for(const a of sim.rivals)maxRivalV=Math.max(maxRivalV,a.v);
  if(i%12===0){mix(sim.p.s);mix(sim.p.x);mix(sim.p.v);mix(sim.p.health);for(const a of sim.rivals){mix(a.s);mix(a.x);mix(a.v)}for(const c of sim.traffic)mix(c.s)}
 }
 return {h:h>>>0,sim,maxRivalV};
}

test('mulberry32 is seeded, deterministic and bounded',()=>{
 const a=mulberry32(7),b=mulberry32(7),c=mulberry32(8);
 const sa=Array.from({length:100},()=>a()),sb=Array.from({length:100},()=>b());
 assert.deepEqual(sa,sb);
 assert.ok(sa.some((v,i)=>v!==c()));                            // different seed diverges
 for(const v of sa)assert.ok(v>=0&&v<1);
 assert.equal(mulberry32(-1)()>=0,true);                        // negative seeds coerce
});

test('same seed produces an identical 60 s trace hash; different seed diverges',()=>{
 const a=run(42),b=run(42);
 assert.equal(a.h,b.h);
 assert.equal(a.sim.done,b.sim.done);
 const c=run(43);
 assert.notEqual(c.h,a.h,'seeded traffic respawn must change the trace');
});

test('determinism also holds for physics-driven rivals',()=>{
 assert.equal(run(7,'physical',45).h,run(7,'physical',45).h);
});

test('a throttle-only run terminates (complete or wrecked) with finite state',()=>{
 const sim=createSim({setup});resetSim(sim,5);
 let steps=0;const cap=Math.round(400/SIM_STEP);
 while(!sim.done&&steps++<cap)stepSim(sim,SIM_STEP,INPUT);
 assert.ok(sim.done,'race never ended');
 assert.ok(sim.done==='wrecked'||sim.done==='complete');
 for(const k of ['s','x','v','health','time'])assert.ok(Number.isFinite(sim.p[k]),k);
});

test('physics-driven rivals progress, stay on the road and keep bounded speed',()=>{
 const {sim,maxRivalV}=run(11,'physical',45);
 assert.ok(sim.rivals.length===3);
 for(const a of sim.rivals){
  for(const k of ['s','x','v','vx','rpm','gear'])assert.ok(Number.isFinite(a[k]),k);
  assert.ok(a.s>100,`rival made progress (s=${a.s})`);
  assert.ok(Math.abs(a.x)<=8.5,`rival stayed on road (x=${a.x})`);
 }
 assert.ok(maxRivalV>30,'rivals reach racing speed');
 assert.ok(maxRivalV<=90,`rival speed bounded (peak ${maxRivalV})`);
});

test('stepSim is a no-op once the race is done and after idle',()=>{
 const sim=createSim({setup});resetSim(sim,3);
 stepSim(sim,SIM_STEP,INPUT);
 const s0=sim.p.s;
 sim.done='complete';stepSim(sim,SIM_STEP,INPUT);
 assert.equal(sim.p.s,s0);
});
