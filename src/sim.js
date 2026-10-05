// DOM-free deterministic race-simulation core (UPLIFT-PLAN B2). main.js drives this with
// presentation hooks; headless tools/tests drive it directly. No DOM, no network, no
// Math.random — traffic respawns draw from a seeded PRNG and the step is fixed at 1/120.
import {BIKES,createState,stepVehicle,impact} from './physics.js';
import {nextGate,pylon,skybridge} from './world-data.js';
import {PERSONALITIES,Director,controlRival,driveRival,driveNet,avoidHazards,surveyRivals,reactToPlayer,rosterFor,rivalTarget} from './rivals.js';
import {makeTierPolicy} from './tiers.js';
import {createHazards,surfaceGrip} from './hazards.js';
export const SIM_STEP=1/120;
export function mulberry32(seed){let a=seed>>>0;return ()=>{a|=0;a=a+0x6D2B79F5|0;let t=Math.imul(a^a>>>15,1|a);t=t+Math.imul(t^t>>>7,61|t)^t;return ((t^t>>>14)>>>0)/4294967296}}
// hooks: message(text,duration) and collision(relative,text,kind,stop) fire after impact() accepts.
// hooks.rivalInput(a,i,expertInput) is an optional headless-only seam on the physical path
// (tools/gen-dataset.mjs): it sees the pursuit expert's action before it is applied and may
// return a replacement input (DAgger-style noise injection); labels stay the expert action.
export function createSim({setup,paceScale=1,rivalBrain='kinematic',net=null,skillRating=0,tier=null,hooks={}}={}){
 return {setup,paceScale,rivalBrain,net,skillRating,tier,hooks:{message(){},collision(){},...hooks},seed:0,rng:mulberry32(1),rosterSeed:0,p:createState(),rivals:[],traffic:[],drones:[],hazards:[],field:{},director:new Director(),hitCooldown:0,nearMisses:0,gatesPassed:0,gatesMisses:0,gateIndex:0,done:null,policies:null};
}
// Menu state: no actors, fresh player.
export function idleSim(sim){sim.p=createState();sim.rivals=[];sim.traffic=[];sim.drones=[];sim.hazards=[];sim.done=null;return sim}
export function resetSim(sim,seed=1){
 const setup=sim.setup,air=setup.launch==='flight';
 sim.seed=seed;sim.rng=mulberry32(seed);sim.director.reset();sim.field={};sim.hitCooldown=0;sim.nearMisses=0;sim.gatesPassed=0;sim.gatesMissed=0;sim.gateIndex=0;sim.done=null;
 const p=sim.p=createState();if(air){p.flight=true;p.flightUsed=true;p.y=24;p.altTarget=24}
 const roster=rosterFor(3,sim.rosterSeed);sim.rosterSeed=(sim.rosterSeed+1)%PERSONALITIES.length;
 sim.rivals=Array.from({length:3},(_,i)=>{
  const base={s:8+i*7,x:[-5,-2.5,2.5,5,0][i],y:air?24+i*.6:0,v:0,target:rivalTarget(air,i)*sim.paceScale,stun:0,attack:0,flight:air,pi:roster[i]};
  return sim.rivalBrain==='physical'||sim.rivalBrain==='net'?{...createState(),...base,altTarget:air?24+i*.6:0}:base;
 });
 // Net rivals get one tier-wrapped policy each, seeded per race so a (seed) replays exactly.
 sim.policies=sim.rivalBrain==='net'&&sim.net?sim.rivals.map((_,i)=>makeTierPolicy(sim.net,{tier:sim.tier||'adaptive',rating:sim.skillRating,seed:seed*3+i+1,dt:SIM_STEP})):null;
 sim.traffic=Array.from({length:14},(_,i)=>({s:100+i*60,x:[-6.6,-2.2,2.2,6.6][i%4],y:0,v:15+(i%4)*3,passed:false}));
 sim.drones=Array.from({length:12},(_,i)=>({s:150+i*95,x:[-22,-10,10,22][i%4],y:14+(i%5)*9,v:21+i%4*4,passed:false}));
 sim.hazards=createHazards(setup.world);
 return sim;
}
// One fixed step of race rules. controls is the player-shaped {steer,throttle,brake,climb,boost};
// remote is a consumed Laya decision or null. Countdown, audio, hit-stop and rendering stay outside.
export function stepSim(sim,dt,controls={},remote=null){
 if(sim.done)return;
 const {setup,p,hooks}=sim,bike=BIKES[setup.bike],director=sim.director;
 const field=sim.field=surveyRivals(sim.rivals,p,dt,sim.field);
 if(field.duel>=0)field.duelName=PERSONALITIES[sim.rivals[field.duel].pi??field.duel%PERSONALITIES.length].name;
 director.update(p,dt,remote,bike.vmax,field);if(director.notice){hooks.message(director.notice,1.8);director.notice=''}
 p.surfaceGrip=surfaceGrip(sim.hazards,p,setup.weather);
 const previousS=p.s;stepVehicle(p,controls,bike,setup,dt);sim.hitCooldown=Math.max(0,sim.hitCooldown-dt);
 for(const i of field.order){
  const a=sim.rivals[i],obstacles=a.flight?sim.drones:sim.traffic;
  if(sim.policies?.[i])driveNet(a,i,p,obstacles,sim.rivals,director,bike,setup,dt,field,sim.policies[i],hooks.rivalInput||null);
  else if(sim.rivalBrain==='physical'||sim.rivalBrain==='net')driveRival(a,i,p,obstacles,director,bike,setup,dt,field,hooks.rivalInput||null);else controlRival(a,i,p,obstacles,director,dt,field);
  if(!a.flight)avoidHazards(a,sim.hazards,p,director);
  if(Math.abs(a.s-p.s)<2.1&&Math.abs(a.x-p.x)<.9&&Math.abs(a.y-p.y)<1.3&&impact(p,p.v-a.v))hooks.collision(p.v-a.v,'CONTACT / HOLD YOUR LINE','rival');
  // Strike authority lives in the survey field, not the roster: only the current striker
  // (nearest non-stunned rival) may strike, a shared 3.5 s lockout applies after any
  // strike, and during a duel only the duellist strikes (spec .spec-ai-depth.md §B.4).
  if(Math.abs(a.s-p.s)<2&&Math.abs(a.x-p.x)<2.2&&Math.abs(a.y-p.y)<1.5&&a.attack===0&&a.stun===0&&director.encounter!=='recover'&&i===field.striker&&field.strikeLock<=0&&(director.encounter!=='duel'||i===director.duel)){a.attack=5;field.strikeLock=3.5;p.health=Math.max(0,p.health-3);hooks.message('RIVAL STRIKE / Q OR E TO COUNTER',1)}
 }
 for(const h of sim.hazards){
  const distance=h.s-p.s;
  if(Math.abs(distance)<h.depth*.5+1.3&&Math.abs(h.x-p.x)<h.width*.5){
   if(h.type==='debris'||h.type==='closure'){if(impact(p,Math.max(18,p.v*.7)))hooks.collision(Math.max(18,p.v*.7),h.type==='closure'?'LANE CLOSURE / FIND AN OPEN LINE':'DEBRIS IMPACT / CHANGE LANE',h.type==='closure'?'structure':'debris')}
   else if(p.v>12&&p.time%0.35<.02)hooks.message(h.type==='oil'?'OIL / GRIP REDUCED':'PUDDLE / HOLD YOUR LINE',.8);
  }
  if(!h.passed&&distance<0){h.passed=true;if(distance>-8&&Math.abs(h.x-p.x)<h.width*.5+1.5)sim.nearMisses++}
 }
 for(const car of [...sim.traffic,...sim.drones]){
  const before=car.s-previousS;reactToPlayer(car,p,director,dt);car.s+=car.v*dt;const after=car.s-p.s,vertical=Math.abs(car.y-p.y);
  if(Math.abs(after)<2.6&&Math.abs(car.x-p.x)<1.45&&vertical<1.4&&impact(p,p.v-car.v))hooks.collision(p.v-car.v,'IMPACT / INTEGRITY LOST','traffic');
  if(!car.passed&&before>0&&after<=0){car.passed=true;const gap=Math.hypot(car.x-p.x,car.y-p.y);if(gap>1.6&&gap<3.1){sim.nearMisses++;hooks.message('CLOSE CALL +1',1)}}
  if(after<-80){car.s=p.s+900+sim.rng()*120;car.passed=false}
 }
 // Gate crossing is swept in longitudinal space; height and lateral position matter.
 while(p.s>=nextGate(sim.gateIndex).s){const gate=nextGate(sim.gateIndex);if(p.flight||p.landing){if(Math.hypot(p.x-gate.x,p.y-gate.y)<gate.radius-1){sim.gatesPassed++;p.energy=Math.min(100,p.energy+12);hooks.message('AIR GATE / CHARGE +12',1.2)}else{sim.gatesMissed++;if(Math.abs(Math.hypot(p.x-gate.x,p.y-gate.y)-gate.radius)<1){if(impact(p,p.v*.6))hooks.collision(p.v*.6,'GATE CONTACT / STAY INSIDE THE RING','structure',.05)}else hooks.message('GATE MISSED / ADJUST ALTITUDE',1)}}sim.gateIndex++}
 if(p.y>0.5){const n=Math.max(0,Math.floor((p.s-340)/470));for(const index of [n,n+1]){const o=pylon(index);if(Math.abs(p.s-o.s)<o.depth*.5+1.2&&Math.abs(p.x-o.x)<o.width*.5+.55&&p.y<o.height&&impact(p,Math.max(20,p.v)))hooks.collision(Math.max(20,p.v),'PYLON IMPACT / CLIMB OR EVADE','structure')}}
 const bridge=skybridge(p.s,setup.world);if(bridge&&Math.abs(p.s-bridge.s)<3.2&&Math.abs(p.x-bridge.x)<9.5&&Math.abs(p.y+1-bridge.y)<2&&impact(p,p.v))hooks.collision(p.v,'SKYBRIDGE IMPACT / CHANGE ALTITUDE','structure');
 if(p.health<=0)sim.done='wrecked';else if(setup.mode==='race'&&p.s>=4000)sim.done='complete';
}
