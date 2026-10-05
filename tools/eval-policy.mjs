// Policy evaluation harness (UPLIFT-PLAN C / B4 gate, 3.17.0).
// N seeded headless races per tier compare the BC policy net against the physical
// heuristic (driveRival). The SAME (world, bike, seed) race card is run under both
// brains; the player is an identical scripted auto-driver in both, so differences are
// attributable to the rival brain.
//
// ACCEPTANCE BANDS — written before the first eval run (2026-10-03, task brief 3.17.0).
// The net is "measurably not worse" than the heuristic iff ALL bands hold in EVERY tier:
//   B1  mean player finish-place delta          <= +0.20 places   (finishers only)
//   B2  rival-contact rate delta                <= +0.50 contacts/race
//   B3  player off-road time delta              <= +1.0  s/race
//   B4  mean race-time delta                    <= +4 %           (finishers only)
//   B5  wreck-rate delta                        <= +3  percentage points
//   B6  lead-rival competitiveness: mean best-rival distance at race end within
//       -5 % of the heuristic's (a crawling net must not "win" by being absent)
// Only if all bands pass may main.js point setup.rivalBrain='net' at the BC weights.
//
// Run: node tools/eval-policy.mjs [--policy assets/ai/rival-policy-bc.json] [--races 200]
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {BIKES,clamp} from '../src/physics.js';
import {WORLDS} from '../src/world-data.js';
import {createSim,resetSim,stepSim,SIM_STEP} from '../src/sim.js';
import {loadMLP} from '../src/mlp.js';

const BANDS={place:.20,contacts:.50,offroad:1.0,raceTimePct:4,wreckRatePP:3,rivalDistPct:-5};
const args=Object.fromEntries(process.argv.slice(2).map((a,i,all)=>a.startsWith('--')?[a.slice(2),all[i+1]&&!all[i+1].startsWith('--')?all[i+1]:true]:null).filter(Boolean));
const POLICY=String(args.policy??'assets/ai/rival-policy-bc.json');
const N=Number(args.races??200);
const MAX_TIME=Number(args['max-time']??150);
const net=loadMLP(readFileSync(new URL('../'+POLICY,import.meta.url),'utf8'));

// Same scripted auto-driver as tools/gen-dataset.mjs (kept copy: tools stay self-contained).
function playerInput(sim,bike){
 const p=sim.p;
 let lane=0,threat=null,threatD=55;
 for(const c of sim.traffic){const d=c.s-p.s;if(d>2&&d<threatD&&Math.abs(c.x-p.x)<2.8){threat=c;threatD=d}}
 for(const h of sim.hazards){const d=h.s-p.s;if(d>2&&d<threatD&&Math.abs(h.x-p.x)<h.width*.5+1.6){threat=h;threatD=d}}
 if(threat)lane=clamp(threat.x>0?threat.x-4.2:threat.x+4.2,-6.4,6.4);
 const cruise=bike.vmax*.72;
 const closing=threat&&threat.v!=null&&threatD<26&&p.v>threat.v+8;
 return {steer:clamp((lane-p.x)*.28-p.vx*.14,-1,1),throttle:!closing&&p.v<cruise,brake:!!closing,climb:0,boost:false};
}

function race(brain,tier,card){
 const world=WORLDS[card%WORLDS.length],bike=card%BIKES.length;
 const setup={bike,tires:'street',weather:world.weather,assist:1,gearing:1,mode:'race',world:world.id,launch:'street'};
 let contacts=0,offroad=0;
 const sim=createSim({setup,rivalBrain:brain,net:brain==='net'?net:null,tier,hooks:{collision:(r,t,kind)=>{if(kind==='rival')contacts++}}});
 resetSim(sim,7000+card);
 const bikeSpec=BIKES[bike];
 let steps=0;const cap=Math.round(MAX_TIME/SIM_STEP);
 let bestRivalS=0,leadFinish=null;
 while(!sim.done&&steps++<cap){
  stepSim(sim,SIM_STEP,playerInput(sim,bikeSpec));
  if(sim.p.y<.5&&Math.abs(sim.p.x)>7.2)offroad+=SIM_STEP;
  for(const a of sim.rivals){if(a.s>bestRivalS)bestRivalS=a.s;if(leadFinish===null&&a.s>=4000)leadFinish=sim.p.time}
 }
 const p=sim.p;
 return {outcome:sim.done??'timeout',place:sim.done==='complete'?1+sim.rivals.filter(a=>a.s>p.s).length:null,
  time:sim.done==='complete'?p.time:null,contacts,offroad,bestRivalS,leadFinish};
}

function summarize(rows){
 const fin=rows.filter(r=>r.outcome==='complete');
 const places=[0,0,0,0];for(const r of fin)places[r.place-1]++;
 const mean=(xs,d=0)=>xs.length?xs.reduce((a,b)=>a+b,0)/xs.length:d;
 return {races:rows.length,completed:fin.length,wrecked:rows.filter(r=>r.outcome==='wrecked').length,
  timeout:rows.filter(r=>r.outcome==='timeout').length,places,
  meanPlace:mean(fin.map(r=>r.place)),meanTime:mean(fin.map(r=>r.time)),
  contactsPerRace:mean(rows.map(r=>r.contacts)),offroadPerRace:mean(rows.map(r=>r.offroad)),
  meanBestRivalS:mean(rows.map(r=>r.bestRivalS)),meanLeadFinish:mean(rows.filter(r=>r.leadFinish!==null).map(r=>r.leadFinish))};
}

console.log(`eval-policy: ${N} races/tier/brain requested · policy ${POLICY} · step ${(SIM_STEP*1e3).toFixed(2)} ms`);
console.log('acceptance bands (declared before this run):',JSON.stringify(BANDS));
const report={policy:POLICY,requested:N,bands:BANDS,tiers:{}};
let allPass=true;
for(const tier of ['rookie','pro','elite']){
 const cards=Array.from({length:N},(_,c)=>c);
 const heur=cards.map(c=>race('physical',tier,c)),bc=cards.map(c=>race('net',tier,c));
 const H=summarize(heur),B=summarize(bc);
 const dPlace=B.meanPlace-H.meanPlace,dContacts=B.contactsPerRace-H.contactsPerRace,
  dOffroad=B.offroadPerRace-H.offroadPerRace,
  dTimePct=H.meanTime?(B.meanTime-H.meanTime)/H.meanTime*100:0,
  dWreckPP=(B.wrecked-H.wrecked)/N*100,
  dRivalPct=H.meanBestRivalS?(B.meanBestRivalS-H.meanBestRivalS)/H.meanBestRivalS*100:0;
 const checks={B1_place:dPlace<=BANDS.place,B2_contacts:dContacts<=BANDS.contacts,
  B3_offroad:dOffroad<=BANDS.offroad,B4_raceTime:dTimePct<=BANDS.raceTimePct,
  B5_wreckRate:dWreckPP<=BANDS.wreckRatePP,B6_rivalCompetitive:dRivalPct>=BANDS.rivalDistPct};
 const pass=Object.values(checks).every(Boolean);allPass=allPass&&pass;
 report.tiers[tier]={heuristic:H,net:B,delta:{place:dPlace,contacts:dContacts,offroad:dOffroad,raceTimePct:dTimePct,wreckRatePP:dWreckPP,rivalDistPct:dRivalPct},checks,pass};
 console.log(`\n[${tier}] heuristic: place ${H.meanPlace.toFixed(2)} (${H.places.join('/')}${H.wrecked?' W'+H.wrecked:''}) · contacts ${H.contactsPerRace.toFixed(2)}/race · off-road ${H.offroadPerRace.toFixed(2)} s · time ${H.meanTime.toFixed(1)} s · lead-rival ${H.meanBestRivalS.toFixed(0)} m`);
 console.log(`[${tier}] net:       place ${B.meanPlace.toFixed(2)} (${B.places.join('/')}${B.wrecked?' W'+B.wrecked:''}) · contacts ${B.contactsPerRace.toFixed(2)}/race · off-road ${B.offroadPerRace.toFixed(2)} s · time ${B.meanTime.toFixed(1)} s · lead-rival ${B.meanBestRivalS.toFixed(0)} m`);
 console.log(`[${tier}] delta: place ${dPlace>=0?'+':''}${dPlace.toFixed(3)} · contacts ${dContacts>=0?'+':''}${dContacts.toFixed(3)} · off-road ${dOffroad>=0?'+':''}${dOffroad.toFixed(3)} s · time ${dTimePct>=0?'+':''}${dTimePct.toFixed(2)}% · wreck ${dWreckPP>=0?'+':''}${dWreckPP.toFixed(1)}pp · rival-dist ${dRivalPct.toFixed(2)}%  -> ${pass?'PASS':'FAIL'} ${JSON.stringify(checks)}`);
}
mkdirSync(new URL('../telemetry',import.meta.url),{recursive:true});
writeFileSync(new URL('../telemetry/eval-results.json',import.meta.url),JSON.stringify(report,null,1));
console.log(`\nVERDICT: net is ${allPass?'NOT WORSE than the heuristic under the pre-declared bands':'measurably WORSE than the heuristic'} — full report telemetry/eval-results.json`);
process.exitCode=allPass?0:1;
