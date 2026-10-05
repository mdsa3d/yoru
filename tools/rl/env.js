// Episode environment for the B5 trainer: evaluates a rival policy inside the ACTUAL JS
// headless sim (src/sim.js — no Python port, so no sim drift). The trained agent is rival 0,
// driven through the exact shipped path: sim rivalBrain='net' -> driveNet() -> a per-rival
// makeTierPolicy() wrapper (action noise, reaction delay, clamps) with planRival()'s
// Director-guardrailed speed limit hard-enforced after the net. The policy therefore cannot
// learn to cheat the guardrails — they are applied during training exactly as in play.
// The player is driven by a deterministic heuristic racer (or, with selfPlay, by a frozen
// copy of the policy). Everything is seeded; an (spec, seed, config) triple replays exactly.
import {createSim,resetSim,stepSim,SIM_STEP} from '../../src/sim.js';
import {makeTierPolicy} from '../../src/tiers.js';
import {buildObs,OBS_WIDTH} from '../../src/obs.js';
import {MLP} from '../../src/mlp.js';
import {clamp,curvature} from '../../src/physics.js';
import {stepReward,emptyEvent} from './reward.js';
export const DEFAULT_SETUP={bike:0,tires:'street',weather:'rain',assist:1,gearing:1,mode:'race',world:'akuma',launch:'street'};
// Deterministic heuristic racer for the player slot: centre-line pursuit with curvature
// feed-forward, lifts/brakes for traffic and steers around debris/closures. Not the agent.
export function playerInput(p,sim){
 const car=sim.traffic.find(c=>c.s>p.s&&c.s-p.s<14+p.v*.5&&Math.abs(c.x-p.x)<1.7&&Math.abs(c.y-p.y)<2.5);
 const hazard=sim.hazards.find(h=>h.s>p.s&&h.s-p.s<34&&(h.type==='debris'||h.type==='closure')&&Math.abs(h.x-p.x)<h.width*.5+1);
 let lane=0;
 if(hazard)lane=hazard.x>=0?-4.4:4.4;
 else if(car)lane=clamp(car.x>=0?car.x-3.4:car.x+3.4,-6.6,6.6);
 const steer=clamp((lane-p.x)*.18-p.vx*.14+curvature(p.s+26)*p.v*p.v*.012,-1,1);
 const climb=p.flight?clamp((24-p.y)*.2,-1,1):0;
 return {steer,throttle:!car&&!hazard,brake:!!car&&car.s-p.s<8+p.v*.25,climb,boost:false};
}
// Self-play: the player is driven by a frozen policy over the shared obs vector.
export function selfPlayInput(net,p,rivals,scratch){
 const raw=net.forward(buildObs(p,rivals.slice(0,3),scratch.obs),scratch.raw);
 return {steer:clamp(raw[0],-1,1),throttle:raw[1]>.5,brake:raw[2]>.5,climb:p.flight?clamp((24-p.y)*.2,-1,1):0,boost:false};
}
// One episode: returns {fitness, metrics}. spec is a neon-rash-mlp@1 object (or null for the
// heuristic baseline, which runs rivalBrain='physical' with the same instrumentation).
export function runEpisode({spec=null,seed=1,setup=DEFAULT_SETUP,tier='pro',maxSeconds=45,selfPlay=null}={}){
 const net=spec?new MLP(spec):null;
 const spNet=selfPlay?new MLP(selfPlay):null;
 const spScratch=spNet?{obs:new Array(OBS_WIDTH),raw:new Float32Array(spNet.output)}:null;
 const sim=createSim({setup,rivalBrain:net?'net':'physical',net:net||{input:OBS_WIDTH,output:3,forward(){return new Float32Array(3)}}});
 sim.rosterSeed=seed;                    // vary the personality roster per episode seed
 resetSim(sim,seed);
 if(net)sim.policies=sim.rivals.map((_,i)=>makeTierPolicy(net,{tier,seed:seed*7+i+1,dt:SIM_STEP}));
 const maxSteps=Math.round(maxSeconds/SIM_STEP);
 const m={steps:0,contacts:0,strikes:0,collisions:0,offRoadSteps:0,healthLost:0,rivalMaxV:0,rivalS:0,playerS:0,done:null};
 let fitness=0,prev=null,prevContact=false,prevStrike=false,collisionArmed=true;
 for(let i=0;i<maxSteps&&!sim.done;i++){
  const a=sim.rivals[0];
  prev={s:a.s,health:a.health};
  const controls=spNet?selfPlayInput(spNet,sim.p,sim.rivals,spScratch):playerInput(sim.p,sim);
  stepSim(sim,SIM_STEP,controls);
  const evt=emptyEvent();
  evt.ds=a.s-prev.s;
  evt.dHealth=Math.max(0,prev.health-a.health);
  evt.offRoad=!a.flight&&!a.landing&&Math.abs(a.x)>6.8;
  const contact=Math.abs(a.s-sim.p.s)<2.1&&Math.abs(a.x-sim.p.x)<.9&&Math.abs((a.y||0)-sim.p.y)<1.3;
  evt.contact=contact&&!prevContact;prevContact=contact;
  const strike=(a.attack||0)>0;
  evt.strike=strike&&!prevStrike;prevStrike=strike;
  let hit=false;
  for(const c of (a.flight?sim.drones:sim.traffic)){
   if(Math.abs(c.s-a.s)<2.6&&Math.abs(c.x-a.x)<1.45&&Math.abs((c.y||0)-(a.y||0))<1.4){hit=true;break}
  }
  evt.collision=hit&&collisionArmed;collisionArmed=!hit;   // rising edge only
  evt.encounter=sim.director.encounter;
  const r=stepReward(evt);fitness+=r;
  m.steps++;m.contacts+=evt.contact?1:0;m.strikes+=evt.strike?1:0;m.collisions+=evt.collision?1:0;
  m.offRoadSteps+=evt.offRoad?1:0;m.healthLost+=evt.dHealth;m.rivalMaxV=Math.max(m.rivalMaxV,a.v);
 }
 const a=sim.rivals[0];
 m.rivalS=a.s;m.playerS=sim.p.s;m.done=sim.done;
 return {fitness,metrics:m};
}
// Mean fitness + averaged metrics over a list of seeds. opts.tiers (array) evaluates every
// (tier, seed) pair and averages — the multi-tier objective: the shipped gate is one net
// passing ALL tiers, so refining against a single tier overfits that tier's noise/delay
// (measured 3.20.0: pro-only refinement failed rookie, rookie-only refinement drained pace
// everywhere). opts.tier (single) stays the default and is unchanged.
export function evaluate(spec,seeds,opts={}){
 const tiers=Array.isArray(opts.tiers)&&opts.tiers.length?opts.tiers:[opts.tier||'pro'];
 let sum=0;const acc={};
 const keys=['contacts','strikes','collisions','offRoadSteps','healthLost','rivalMaxV','rivalS','playerS','steps'];
 for(const k of keys)acc[k]=0;
 let finished=0,beatPlayer=0,n=0;
 for(const tier of tiers)for(const seed of seeds){
  const {fitness,metrics:m}=runEpisode({...opts,tiers:undefined,tier,spec,seed});
  sum+=fitness;for(const k of keys)acc[k]+=m[k];;n++;
  if(m.done==='complete')finished++;
  if(m.rivalS>m.playerS)beatPlayer++;
 }
 const metrics={};
 for(const k of keys)metrics[k]=acc[k]/n;
 metrics.finished=finished/n;metrics.beatPlayer=beatPlayer/n;
 metrics.offRoadFrac=metrics.steps>0?metrics.offRoadSteps/metrics.steps:0;
 return {fitness:sum/n,metrics};
}
