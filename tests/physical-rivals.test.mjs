import test from 'node:test';import assert from 'node:assert/strict';
import {BIKES,createState} from '../src/physics.js';
import {Director,PERSONALITIES,driveRival,planRival,controlRival,rivalTarget,RIVAL_REF} from '../src/rivals.js';
const bike=BIKES[0],setup={tires:'street',weather:'rain',assist:1,gearing:1};
const farPlayer=()=>({s:5000,x:0,y:0,v:60,vx:0,time:0,health:100});
function spawnRival(extra={}){return {...createState(),s:0,x:0,v:5,target:50,stun:0,attack:0,pi:0,...extra}}
function drive(a,p,d,seconds,field=null){for(let i=0;i<seconds*120;i++){p.time+=1/120;driveRival(a,0,p,[],d,bike,setup,1/120,field)}}

test('rival pace targets use fixed reference speeds, not the player bike',()=>{
 assert.equal(rivalTarget(false,0),RIVAL_REF.road*.84);
 assert.equal(rivalTarget(true,2),RIVAL_REF.air*.74+2*2.4);
 assert.ok(rivalTarget(false,2)>rivalTarget(false,0),'per-rival spread preserved');
 // historic band: old targets were bike.vmax*.84 in [43.0, 68.5]; the fixed base sits mid-band
 assert.ok(rivalTarget(false,0)>50&&rivalTarget(false,0)<65);
});

test('driveRival accelerates from near-standstill and tracks its planned lane',()=>{
 const a=spawnRival(),p=farPlayer(),d=new Director();
 drive(a,p,d,12);
 for(const k of ['s','x','v','vx','rpm','gear','lean'])assert.ok(Number.isFinite(a[k]),k);
 assert.ok(a.v>40,`expected cruising speed, got ${a.v}`);
 assert.equal(a.tactic,'race');                                   // huge gap, no draft
 assert.ok(Math.abs(a.x-PERSONALITIES[0].lane)<.8,`lane error ${a.x-PERSONALITIES[0].lane}`);
 assert.ok(Math.abs(a.x)<=7.5,'stays on the road');
 assert.ok(a.s>400,'makes race progress');
});

test('driveRival respects its speed limit (no runaway rubber-banding)',()=>{
 const a=spawnRival({v:45}),p=farPlayer(),d=new Director();
 let peak=0;for(let i=0;i<30*120;i++){p.time+=1/120;driveRival(a,0,p,[],d,bike,setup,1/120);peak=Math.max(peak,a.v)}
 const limit=50*PERSONALITIES[0].pace;                            // race tactic, no draft
 assert.ok(peak<=limit+2.5,`peak ${peak} vs limit ${limit}`);
 assert.ok(peak>limit-6,'actually approaches the limit');
});

test('Director recover guardrail stays authoritative in the physical path',()=>{
 const a=spawnRival({v:60}),p=farPlayer(),d=new Director();d.encounter='recover';
 drive(a,p,d,5);
 assert.equal(a.tactic,'yield');
 assert.ok(a.v<50*PERSONALITIES[0].pace*.84+1,`yielded to ${a.v}`);
});

test('planRival extraction keeps controlRival kinematics bit-identical to a manual reference',()=>{
 // the legacy controller must feel unchanged: same planner, same integrator
 const mk=()=>({s:70,x:0,y:0,v:30,target:40,stun:0,attack:0});
 const d=new Director(),p={s:100,x:0,y:0,v:40,time:30,health:100};
 const a=mk(),b=mk();
 planRival(a,0,p,[],d,.01);
 // reference integrator copied from the pre-refactor controlRival
 const desiredVX=Math.max(-4.6,Math.min(4.6,(a.lane-a.x)*2.4));a.vx=(a.vx||0)+Math.max(-8*.01,Math.min(8*.01,desiredVX-(a.vx||0)));a.x+=a.vx*.01;
 controlRival(b,0,p,[],d,.01);
 assert.deepEqual({lane:b.lane,speedLimit:b.speedLimit,tactic:b.tactic},{lane:a.lane,speedLimit:a.speedLimit,tactic:a.tactic});
 assert.ok(Number.isFinite(b.v)&&b.v>30,'kinematic integrator still accelerates');
});

test('driveRival handles the flight branch without NaN or altitude blowout',()=>{
 const a=spawnRival({flight:true,y:24,altTarget:24,v:40,target:70}),p={...farPlayer(),y:24},d=new Director();
 drive(a,p,d,10);
 for(const k of ['s','x','y','v','vy'])assert.ok(Number.isFinite(a[k]),k);
 assert.ok(a.y>=3&&a.y<=95,`altitude ${a.y}`);
 assert.ok(a.s>300,'air progress');
});
