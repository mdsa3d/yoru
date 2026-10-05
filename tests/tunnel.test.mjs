import test from 'node:test';import assert from 'node:assert/strict';
import {TUNNEL,tunnelZone,tunnelAt,tunnelEnclosure,tunnelSections} from '../src/tunnel.js';
import {pylon} from '../src/world-data.js';

test('tunnel zones are deterministic, fixed-length and grid-aligned',()=>{
 for(const i of [0,1,2,17,80]){const z=tunnelZone(i);assert.deepEqual(z,tunnelZone(i));assert.equal(z.end-z.start,TUNNEL.len);assert.equal(z.start%TUNNEL.step,0);assert.equal(z.start,TUNNEL.offset+i*TUNNEL.period)}
});
test('tunnel zones never overlap each other or solid pylons',()=>{
 for(let i=0;i<80;i++){const a=tunnelZone(i),b=tunnelZone(i+1);assert.ok(a.end<=b.start);
  // Pylons (world-data.js) are solid collision geometry at |x| in [13.5,18.5]; the 13 m arch radius can never reach them.
  for(let k=0;k<80;k++){const p=pylon(k);if(p.s>=a.start&&p.s<=a.end)assert.ok(Math.abs(p.x)-p.width/2>TUNNEL.radius)}
 }
});
test('tunnelAt brackets zones and excludes the end boundary',()=>{
 const z=tunnelZone(2);assert.equal(tunnelAt(z.start-1),null);assert.deepEqual(tunnelAt(z.start),z);assert.deepEqual(tunnelAt((z.start+z.end)/2),z);assert.equal(tunnelAt(z.end),null);assert.equal(tunnelAt(-100),null);
});
test('enclosure is 0 outside, 1 at centre, smooth at both mouths',()=>{
 const z=tunnelZone(1);assert.equal(tunnelEnclosure(z.start-200),0);assert.equal(tunnelEnclosure((z.start+z.end)/2),1);
 let prev=0;for(let s=z.start;s<=z.start+TUNNEL.ramp;s+=2){const e=tunnelEnclosure(s);assert.ok(e>=prev-1e-12&&e>=0&&e<=1);prev=e}
 for(let s=z.start-50;s<z.end+50;s+=3){const e=tunnelEnclosure(s);assert.ok(e>=0&&e<=1)}
 for(const d of [5,17,33])assert.ok(Math.abs(tunnelEnclosure(z.start+d)-tunnelEnclosure(z.end-d))<1e-12);
});
test('sections cover the window∩zones on the 24 m grid, capped at the pool',()=>{
 const secs=tunnelSections(600,500,48);assert.ok(secs.length>0&&secs.length<=TUNNEL.pool);
 for(const at of secs){assert.equal(at%TUNNEL.step,0);assert.ok(at>600-48&&at<600+500);assert.notEqual(tunnelAt(at),null)}
 for(let i=1;i<secs.length;i++)assert.ok(secs[i]-secs[i-1]>=TUNNEL.step);
 // no grid point inside a zone inside the window is missing
 const i=Math.floor((600-TUNNEL.offset)/TUNNEL.period);for(const k of [i,i+1]){const z=tunnelZone(k);for(let at=z.start;at<z.end;at+=TUNNEL.step)if(at>552&&at<1100&&secs.length<TUNNEL.pool)assert.ok(secs.includes(at))}
 // a position whose window misses every zone yields nothing
 assert.deepEqual(tunnelSections(0),[]);assert.deepEqual(tunnelSections(100,200,48),[]);
});
