import test from 'node:test';import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {loadMLP} from '../src/mlp.js';
import {buildObs,buildObsV1,buildObsFor,OBS_WIDTH,OBS_V1_WIDTH,OBS_TACTICS,OBS_SCALE} from '../src/obs.js';
import {createTelemetry} from '../src/telemetry.js';
import {createSim,resetSim,stepSim,SIM_STEP} from '../src/sim.js';
import {BIKES,createState} from '../src/physics.js';
import {Director,driveNet,PERSONALITIES} from '../src/rivals.js';
const setup={bike:0,tires:'street',weather:'rain',assist:1,gearing:1,mode:'race',world:'akuma',launch:'street'};
const INPUT={steer:0,throttle:true,brake:false,climb:0,boost:false};
const net=loadMLP(readFileSync(new URL('../assets/ai/rival-policy-synthetic.json',import.meta.url),'utf8'));
function run(brain,seed,seconds,extra={}){
 const sim=createSim({setup,rivalBrain:brain,...extra});resetSim(sim,seed);
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

test('shipped synthetic policy loads as a legacy 40->3 neon-rash-mlp@1 MLP and labels itself untrained',()=>{
 assert.equal(net.input,OBS_V1_WIDTH);assert.equal(net.output,3);
 const raw=JSON.parse(readFileSync(new URL('../assets/ai/rival-policy-synthetic.json',import.meta.url),'utf8'));
 assert.equal(raw.format,'neon-rash-mlp@1');
 assert.equal(raw.meta.trained,false);
 assert.match(raw.meta.label,/UNTRAINED/i);
});

test('buildObsV1 is the frozen legacy 40-float vector',()=>{
 const p={...createState(),s:120,x:-2,v:40},rivals=[{s:130,x:1,y:0,v:38,vx:0,stun:0,attack:0,flight:false,target:50}];
 const obs=buildObsV1(p,rivals);
 assert.equal(obs.length,OBS_V1_WIDTH);
 assert.equal(obs[0],120);assert.equal(obs[13],10,'opponent ds');assert.equal(obs[14],3,'opponent dx');
 assert.ok(obs.slice(13+9).every(v=>v===0),'empty opponent slots are zeros');
});

test('buildObs (v2) emits 50 finite normalised channels: v1 layout + plan block',()=>{
 const p={...createState(),s:120,x:-2,v:40,lane:3,speedLimit:50,stun:0,tactic:'overtake'},
  rivals=[{s:130,x:1,y:0,v:38,vx:0,stun:0,attack:0,flight:false,target:50}];
 const obs=buildObs(p,rivals);
 assert.equal(obs.length,OBS_WIDTH);
 for(const [k,v] of obs.entries())assert.ok(Number.isFinite(v),`channel ${k}`);
 assert.equal(obs[0],.12,'s / 1000');assert.equal(obs[13],.1,'opponent ds / 100');assert.equal(obs[14],.3,'opponent dx / 10');
 assert.ok(obs.slice(13+9,40).every(v=>v===0),'empty opponent slots are zeros');
 assert.equal(obs[40],.5,'laneErr / 10');
 assert.equal(obs[41],.2,'headroom / 50');
 assert.equal(obs[42],0,'stun');
 OBS_TACTICS.forEach((t,k)=>assert.equal(obs[43+k],t==='overtake'?1:0,'tactic one-hot'));
 // channels 0-39 are the v1 vector under the fixed v2 normalisation
 assert.deepEqual(obs.slice(0,40),buildObsV1(p,rivals).map((v,k)=>v/OBS_SCALE[k]));
});

test('buildObs v2 plan block: stun halves the effective limit; missing lane/targets are safe',()=>{
 const stunned=buildObs({...createState(),s:0,x:1,v:30,lane:2,speedLimit:60,stun:1.2,tactic:'yield'},[]);
 assert.ok(Math.abs(stunned[41]-(60*.55-30)/50)<1e-9,'stunned limit is 55% of speedLimit');
 assert.equal(stunned[42],1.2/5);
 const bare=buildObs({s:0,x:1,v:10},[]);                 // no lane/speedLimit/target/tactic
 assert.equal(bare[40],0,'lane falls back to x');
 assert.equal(bare[41],-.2,'no limit info: headroom is (0 - v)/50');
 assert.ok(bare.slice(43,50).every(v=>v===0),'no tactic: one-hot is all zeros');
});

test('buildObsFor dispatches on the policy input width',()=>{
 const p={...createState(),s:5,x:1,v:20,lane:4,speedLimit:50,tactic:'race'};
 assert.equal(buildObsFor(OBS_V1_WIDTH,p,[]).length,OBS_V1_WIDTH);
 assert.equal(buildObsFor(OBS_WIDTH,p,[]).length,OBS_WIDTH);
 assert.equal(buildObsFor(999,p,[]).length,OBS_WIDTH,'unknown widths get the canonical v2 vector');
});

test('telemetry and the net consume the same obs vector (one shared builder)',()=>{
 const t=createTelemetry();t.enabled=true;t.begin({world:'akuma',bike:'kestrel',seed:3});
 const p={...createState(),s:5,v:12},rivals=[{s:9,x:2,y:0,v:11,vx:0,stun:0,attack:0,flight:false,target:50}];
 t.sample(0,{obs:buildObs(p,rivals),input:{steer:0,throttle:true,brake:false},tactic:'race'});
 const line=JSON.parse(t.toJSONL().split('\n')[0]);
 assert.ok(Array.isArray(line.obs),'obs serialises as a JSON array, not an object');
 assert.equal(line.obs.length,OBS_WIDTH);
 assert.ok(line.obs.every(Number.isFinite));
 // The shipped placeholder is width-40 (@1): it consumes the v1 slice of the same builder family.
 const out=net.forward(buildObsV1(p,rivals));
 assert.equal(out.length,3);for(const v of out)assert.ok(Number.isFinite(v));
});

test('net mode builds one seeded tier policy per rival on reset',()=>{
 const sim=createSim({setup,rivalBrain:'net',net,skillRating:.5});resetSim(sim,9);
 assert.equal(sim.policies.length,3);
 for(const a of sim.rivals)assert.ok('rpm' in a&&'gear' in a,'net rivals use the physical state');
});

test('net rivals stay finite, on-road and deterministic; caps hold (placeholder crawls)',()=>{
 const a=run('net',7,45,{net}),b=run('net',7,45,{net});
 assert.equal(a.h,b.h,'same seed replays exactly');
 for(const r of a.sim.rivals){
  for(const k of ['s','x','v','vx','rpm','gear'])assert.ok(Number.isFinite(r[k]),k);
  assert.ok(r.s>=0&&Math.abs(r.x)<=8.5,`rival in bounds (s=${r.s}, x=${r.x})`);
 }
 // The shipped weights are untrained: rivals may crawl. Pace is asserted via the
 // pinned-throttle driveNet test below, not here — no driving-skill claims for a placeholder.
 assert.ok(a.maxRivalV<=68*1.07+3,`tier/director caps hold (peak ${a.maxRivalV})`);
});

test('net mode without a loaded net falls back to the physical heuristic',()=>{
 const sim=createSim({setup,rivalBrain:'net',net:null});resetSim(sim,4);
 assert.equal(sim.policies,null);
 for(let i=0;i<Math.round(20/SIM_STEP)&&!sim.done;i++)stepSim(sim,SIM_STEP,INPUT);
 for(const a of sim.rivals){assert.ok(Number.isFinite(a.s));assert.ok(a.s>50,'heuristic fallback still drives rivals')}
});

test('driveNet falls back to pursuit when the policy throws or returns garbage',()=>{
 const bike=BIKES[0],s2={tires:'street',weather:'rain',assist:1,gearing:1};
 for(const bad of [()=>{throw new Error('boom')},()=>new Float32Array([NaN,1,0]),()=>null]){
  const a={...createState(),s:0,x:0,v:5,target:50,stun:0,attack:0,pi:0},p={s:5000,x:0,y:0,v:60,vx:0,time:0,health:100},d=new Director();
  for(let i=0;i<5*120;i++){p.time+=1/120;driveNet(a,0,p,[],[a],d,bike,s2,1/120,null,bad)}
  for(const k of ['s','x','v'])assert.ok(Number.isFinite(a[k]),k);
  assert.ok(a.s>100,'pursuit fallback makes progress');
 }
});

test('driveNet hook sees the expert label and the net action (DAgger seam); width dispatch works',()=>{
 const bike=BIKES[0],s2={tires:'street',weather:'rain',assist:1,gearing:1};
 const a={...createState(),s:0,x:0,v:5,target:50,stun:0,attack:0,pi:0},p={s:5000,x:0,y:0,v:60,vx:0,time:0,health:100},d=new Director();
 const seen=[];
 const policy=()=>new Float32Array([0.25,1,0]);                // untracked width: canonical v2
 driveNet(a,0,p,[],[a],d,bike,s2,1/120,null,policy,(ra,ri,expert,executed,obs)=>{seen.push({expert,executed,obs});return null});
 assert.equal(seen.length,1);
 assert.ok(Math.abs(seen[0].executed.steer-0.25)<1e-6,'hook sees the net action');
 assert.ok(Number.isFinite(seen[0].expert.steer),'hook sees the pursuit expert label');
 assert.equal(seen[0].obs.length,OBS_WIDTH,'widthless policy gets the canonical v2 obs');
 const p40=()=>new Float32Array([0,1,0]);p40.width=OBS_V1_WIDTH;
 driveNet(a,0,p,[],[a],d,bike,s2,1/120,null,p40,(ra,ri,expert,executed,obs)=>{seen.push({obs});return null});
 assert.equal(seen[1].obs.length,OBS_V1_WIDTH,'@1-width policy gets the frozen v1 obs');
 // Replacement: a hook-returned input is what gets executed (guardrails still apply after)
 const a2={...createState(),s:0,x:0,v:5,target:50,stun:0,attack:0,pi:0};
 driveNet(a2,0,p,[],[a2],d,bike,s2,1/120,null,policy,()=>({steer:-.5,throttle:false,brake:true}));
 assert.ok(a2.v<5,'hook replacement input (brake) was executed');
});

test('Director speed limit stays authoritative over a pinned-throttle net',()=>{
 const bike=BIKES[0],s2={tires:'street',weather:'rain',assist:1,gearing:1};
 const a={...createState(),s:0,x:0,v:45,target:50,stun:0,attack:0,pi:0},p={s:5000,x:0,y:0,v:60,vx:0,time:0,health:100},d=new Director();
 const pinned=()=>new Float32Array([0,1,0]);                    // always full throttle
 let peak=0;for(let i=0;i<20*120;i++){p.time+=1/120;driveNet(a,0,p,[],[a],d,bike,s2,1/120,null,pinned);peak=Math.max(peak,a.v)}
 const limit=50*PERSONALITIES[0].pace;
 assert.ok(peak<=limit+2.5,`peak ${peak} vs limit ${limit}`);
 assert.ok(peak>limit-6,'net throttle actually propels the rival (wiring reaches stepVehicle)');
});
