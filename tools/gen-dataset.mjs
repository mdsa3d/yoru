// Heuristic-expert dataset generator (UPLIFT-PLAN B4, 3.17.0; DAgger rounds added 3.20.0).
// THERE IS NO HUMAN TELEMETRY: every frame here is a heuristic-expert (driveRival's
// pure-pursuit mapping) action recorded from the headless deterministic sim, labelled
// 'heuristic-expert, not human'.
//
// Modes:
//  * Expert round (no --policy): the pursuit expert drives all three rivals. DAgger-style
//    noise bursts perturb the *executed* action while the recorded label stays the expert
//    action at the visited state — this widens the state distribution so the BC net learns
//    recoveries, not just the expert's own attractor.
//  * DAgger round (--policy weights.json): the LEARNER (that policy net, through the exact
//    shipped rivalBrain:'net' path — driveNet + per-rival makeTierPolicy) drives, tiers
//    cycling rookie/pro/elite per race so the visited-state distribution matches
//    deployment. The recorded label is still the pursuit expert's action at the state the
//    learner visited (via driveNet's hook seam). Aggregate the output with earlier rounds
//    (train_bc.py accepts repeated --data) — that aggregation IS the DAgger algorithm.
//
// Coverage: all 4 worlds x all 6 bikes x --seeds race seeds; every --flight-th race uses a
// flight launch (default 8; 0 disables) so the flight branch is represented too.
// Single-threaded by measurement, not principle: the full default sweep is ~1M sim steps
// (~5 s at the bench:sim physical rate), so worker_threads would add complexity, not speed.
//
// Run (container): podman run --rm -v "$PWD":/app -w /app node:20 node tools/gen-dataset.mjs
// Options: --out telemetry/heuristic-expert.jsonl --seeds 4 --rate 10 --max-time 150
//          --policy assets/ai/rival-policy-bc.json --flight 8
import {createWriteStream} from 'node:fs';
import {mkdirSync,readFileSync,existsSync} from 'node:fs';
import {dirname} from 'node:path';
import {BIKES,clamp} from '../src/physics.js';
import {WORLDS} from '../src/world-data.js';
import {createSim,resetSim,stepSim,SIM_STEP,mulberry32} from '../src/sim.js';
import {buildObs,OBS_WIDTH} from '../src/obs.js';
import {loadMLP} from '../src/mlp.js';

const args=Object.fromEntries(process.argv.slice(2).map((a,i,all)=>a.startsWith('--')?[a.slice(2),all[i+1]&&!all[i+1].startsWith('--')?all[i+1]:true]:null).filter(Boolean));
const OUT=String(args.out??'telemetry/heuristic-expert.jsonl');
const SEEDS=Number(args.seeds??4),RATE=Number(args.rate??10),MAX_TIME=Number(args['max-time']??150);
const FLIGHT=Number(args.flight??8);                    // every FLIGHT-th race launches in flight; 0 = street only
const EVERY=Math.max(1,Math.round((1/SIM_STEP)/RATE));
const PROVENANCE='heuristic-expert, not human';
const POLICY=args.policy?String(args.policy):null;      // DAgger mode when present
let learnerNet=null;
if(POLICY){
 if(!existsSync(new URL('../'+POLICY,import.meta.url)))throw new Error('--policy '+POLICY+' not found');
 learnerNet=loadMLP(readFileSync(new URL('../'+POLICY,import.meta.url),'utf8'));
 if(learnerNet.input!==OBS_WIDTH)throw new Error('--policy input width '+learnerNet.input+' != obs v2 width '+OBS_WIDTH+' (DAgger rounds need a v2 policy)');
}

// Expert-round DAgger noise: per-step burst-start probability and burst shape. Duty ~11%.
const NOISE_START=.003,NOISE_STEER=.4;
function makeHook(sim,seed,write){
 const count={frames:0};
 const bursts=[{until:-1,steer:0,throttle:null,brake:false},{until:-1,steer:0,throttle:null,brake:false},{until:-1,steer:0,throttle:null,brake:false}];
 const rand=[0,1,2].map(i=>mulberry32(seed*131+i*17+7));
 let step=0;
 // Net mode passes (a,i,expert,executed,obs) from driveNet; physical mode (a,i,expert).
 const hook=(a,i,expert,executed=null,obs=null)=>{
  const t=step*SIM_STEP,r=rand[i],b=bursts[i];
  if(step%EVERY===0){
   if(!obs)obs=buildObs(a,[sim.p,...sim.rivals.filter((_,k)=>k!==i)].slice(0,3));
   write({t:Math.round(t*1000)/1000,world:sim.setup.world,bike:BIKES[sim.setup.bike].id,seed,
    obs:Array.from(obs,v=>Math.round(v*1e4)/1e4),
    input:{steer:Math.round(expert.steer*1e4)/1e4,throttle:expert.throttle?1:0,brake:expert.brake?1:0},
    tactic:a.tactic||'race',expert:PROVENANCE});
   count.frames++;
  }
  if(learnerNet)return null;                             // DAgger round: the learner acts, we only label
  // Noise injection decides what is EXECUTED; the label above is always the expert action.
  if(t>=b.until&&r()<NOISE_START){b.until=t+.15+r()*.35;b.steer=(r()*2-1)*NOISE_STEER;b.throttle=r()<.5?!expert.throttle:null;b.brake=r()<.3}
  if(t<b.until)return {steer:clamp(expert.steer+b.steer,-1,1),throttle:b.throttle??expert.throttle,brake:b.brake};
  return null;                                               // null: execute the expert action unchanged
 };
 return {hook,count,tick:()=>step++};
}

// Auto-driver for the player slot (p.x is ROAD-RELATIVE; walls at ±8.4): holds the road
// centre, dodges traffic/hazards to the open side, brakes when closing fast on a car.
// The dataset is about the RIVALS' policy; the player only has to keep the race going.
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

const TIERS=['rookie','pro','elite'];                   // DAgger rounds cycle the shipped tiers
const outPath=new URL('../'+OUT,import.meta.url);
mkdirSync(dirname(outPath.pathname),{recursive:true});
const stream=createWriteStream(outPath);
let races=0,frames=0,wrecks=0,completed=0;const t0=performance.now();
for(const world of WORLDS)for(let bike=0;bike<BIKES.length;bike++)for(let seed=1;seed<=SEEDS;seed++){
 const card=races,flight=FLIGHT>0&&card%FLIGHT===FLIGHT-1;
 const setup={bike,tires:'street',weather:world.weather,assist:1,gearing:1,mode:'race',world:world.id,launch:flight?'flight':'street'};
 const sim=createSim({setup,rivalBrain:learnerNet?'net':'physical',net:learnerNet,tier:learnerNet?TIERS[card%TIERS.length]:null});
 resetSim(sim,seed*1000+bike*100+WORLDS.indexOf(world));
 const {hook,count,tick}=makeHook(sim,sim.seed,line=>stream.write(JSON.stringify(line)+'\n'));
 sim.hooks.rivalInput=hook;
 let steps=0;const cap=Math.round(MAX_TIME/SIM_STEP);
 while(!sim.done&&steps++<cap){stepSim(sim,SIM_STEP,playerInput(sim,BIKES[bike]));tick()}
 races++;frames+=count.frames;if(sim.done==='wrecked')wrecks++;else if(sim.done==='complete')completed++;
}
await new Promise(r=>stream.end(r));
const el=(performance.now()-t0)/1000;
console.log(`${PROVENANCE}${learnerNet?` · DAgger round rolling out ${POLICY} (tiers cycle rookie/pro/elite)`:' · expert round (DAgger noise bursts)'}`);
console.log(`${races} races (${completed} complete, ${wrecks} wrecked, ${races-completed-wrecks} time-capped) -> ${frames} frames in ${el.toFixed(1)} s`);
console.log(`wrote ${outPath.pathname}`);
