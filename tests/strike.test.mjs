import test from 'node:test';import assert from 'node:assert/strict';
import {createSim,resetSim,stepSim,SIM_STEP} from '../src/sim.js';
const setup={bike:0,tires:'street',weather:'rain',assist:1,gearing:1,mode:'race',world:'akuma',launch:'street'};
const IDLE={steer:0,throttle:false,brake:false,climb:0,boost:false};
const STRIKE='RIVAL STRIKE / Q OR E TO COUNTER';
// Rig with hazards/traffic/drones removed so only the strike rule can damage the player.
// Rivals are pinned next to the player at dx=1.5: inside the strike box (|dx|<2.2) but
// outside the contact box (|dx|<.9), so impact() never fires and health only moves -3/strike.
function rig(){
 const messages=[];
 const sim=createSim({setup,hooks:{message:t=>messages.push(t)}});
 resetSim(sim,1);sim.hazards=[];sim.traffic=[];sim.drones=[];
 return {sim,messages,strikes:()=>messages.filter(m=>m===STRIKE).length};
}
// spots: [rivalIndex, s, x][]. Player pinned at s=1000,x=0; unpinned rivals parked far behind.
function pin(sim,spots){
 const p=sim.p;
 p.s=1000;p.x=0;p.y=0;p.vy=0;p.v=30;p.vx=0;p.health=100;p.invulnerable=0;
 for(let i=0;i<3;i++){const a=sim.rivals[i];a.s=960;a.x=-6;a.y=0;a.v=30;a.vx=0}
 for(const [i,s,x] of spots){const a=sim.rivals[i];a.s=s;a.x=x}
}
function run(sim,seconds,spots){const steps=Math.round(seconds/SIM_STEP);for(let k=0;k<steps;k++){pin(sim,spots);stepSim(sim,SIM_STEP,IDLE)}}

test('the strike keys on the survey striker (nearest non-stunned rival), not roster index 0',()=>{
 const {sim,strikes}=rig();
 run(sim,.5,[[0,990,-6],[1,995,-6],[2,1000,1.5]]);           // rival 2 nearest; rival 0 in range of nothing
 assert.equal(strikes(),1,'nearest rival struck exactly once');
 assert.ok(sim.rivals[2].attack>0,'rival 2 (the striker) owns the attack');
 assert.equal(sim.rivals[0].attack,0);assert.equal(sim.rivals[1].attack,0);
});

test('a shared 3.5 s strike lockout bars an immediate second strike from a different rival',()=>{
 const {sim,strikes}=rig();
 run(sim,.5,[[0,990,-6],[1,995,-6],[2,1000,1.5]]);
 assert.equal(strikes(),1,'first strike fired');
 run(sim,2.5,[[0,1000,1.5],[1,995,-6],[2,990,-6]]);          // rival 0 now nearest, but lock still active
 assert.equal(strikes(),1,'no second strike inside the 3.5 s lockout');
 run(sim,2,[[0,1000,1.5],[1,995,-6],[2,990,-6]]);            // lock expired by t=3.5 s
 assert.equal(strikes(),2,'striker may strike again after the lockout');
 assert.ok(sim.rivals[0].attack>0,'second strike came from rival 0');
});

test('during a duel only the duellist may strike',()=>{
 const {sim,strikes}=rig();
 sim.field.close=[7,0,0];                                     // sustained proximity: rival 0 becomes duellist
 run(sim,8,[[0,1005,1.5],[1,990,-6],[2,980,-6]]);            // prerun: cleanTime>5, dwell>6 -> duel
 assert.equal(sim.director.encounter,'duel');
 assert.equal(sim.director.duel,0);
 run(sim,1,[[0,1005,1.5],[1,1000,1.5],[2,990,-6]]);          // rival 1 nearest (striker) but not duellist
 assert.equal(strikes(),0,'non-duellist striker is barred during duel');
 run(sim,1,[[0,1000,1.5],[1,990,-6],[2,980,-6]]);            // duellist nearest: strike allowed
 assert.equal(strikes(),1);
 assert.ok(sim.rivals[0].attack>0,'duellist owns the strike');
});
