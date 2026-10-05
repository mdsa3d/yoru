import {test} from 'node:test';
import assert from 'node:assert/strict';
import {BIKES,createState,stepVehicle,toggleFlight} from '../src/physics.js';
import {nextGate,pylon,WORLDS} from '../src/world-data.js';
const setup={weather:'dry',tires:'street',gearing:1,assist:1};
function run(p,seconds,input={},bike=BIKES[0],dt=1/120){for(let i=0;i<seconds/dt;i++)stepVehicle(p,{steer:0,climb:0,throttle:false,brake:false,...input},bike,setup,dt);return p}
test('all six bikes take off and stabilize near 24m',()=>{for(const bike of BIKES){const p=createState();toggleFlight(p);run(p,12,{},bike);assert.ok(Math.abs(p.y-24)<.1,bike.name);assert.ok(Math.abs(p.vy)<.1);assert.ok(p.lift>0);for(const v of Object.values(p))if(typeof v==='number')assert.ok(Number.isFinite(v))}});
test('altitude inputs climb and descend with bounded ceiling/floor',()=>{const p=createState();toggleFlight(p);run(p,25,{climb:1});assert.ok(p.y>90&&p.y<96);run(p,30,{climb:-1});assert.ok(p.y>3.9&&p.y<4.1)});
test('auto landing from outside the road recenters and returns to wheels',()=>{const p=createState();p.flight=true;p.y=70;p.altTarget=70;p.x=28;p.v=60;toggleFlight(p);run(p,35);assert.equal(p.landing,false);assert.equal(p.flight,false);assert.equal(p.y,0);assert.ok(Math.abs(p.x)<8.4);assert.ok(p.health>0)});
test('boost gives greater speed and consumes bounded energy',()=>{const a=createState(),b=createState();toggleFlight(a);toggleFlight(b);run(a,3,{throttle:true,boost:true});run(b,3,{throttle:true});assert.ok(a.v>b.v*1.15);assert.ok(a.energy<b.energy);run(a,20,{throttle:true,boost:true});assert.ok(a.energy>=0&&a.energy<=100)});
test('flight remains timestep stable',()=>{const a=createState(),b=createState();toggleFlight(a);toggleFlight(b);run(a,8,{throttle:true,steer:.2,climb:.1},BIKES[0],1/120);run(b,8,{throttle:true,steer:.2,climb:.1},BIKES[0],1/60);assert.ok(Math.abs(a.y-b.y)<.2);assert.ok(Math.abs(a.s-b.s)<1);assert.ok(Math.abs(a.x-b.x)<.2)});
test('all flight gates fit the flyable volume and pylons have finite geometry',()=>{assert.equal(WORLDS.length,4);for(let i=0;i<100;i++){const g=nextGate(i);assert.ok(Math.abs(g.x)+g.radius<34);assert.ok(g.y-g.radius>4);assert.ok(g.y+g.radius<95);assert.ok(pylon(i).width>0)}});
