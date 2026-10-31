import test from 'node:test';import assert from 'node:assert/strict';
import {terrainHeight,terrainSample} from '../src/terrain.js';import {road} from '../src/physics.js';
test('terrain preserves the road corridor at every streamed coordinate',()=>{
 for(const kind of ['desert','alpine'])for(let s=-1200;s<12000;s+=113)for(const offset of [-24,0,24])assert.equal(terrainHeight(road(s)+offset,s,kind),-10);
});
test('terrain heights, normals and colors agree at neighboring chunk seams',()=>{
 for(const kind of ['desert','alpine'])for(let index=-3;index<12;index++)for(const x of [-700,-260,0,180,600]){
  const a=terrainSample(x,index*240-(-120),kind),b=terrainSample(x,(index+1)*240-120,kind);
  assert.deepEqual(a,b);assert.ok(Math.abs(Math.hypot(...a.normal)-1)<1e-12);
  assert.ok(a.color.every(c=>Number.isFinite(c)&&c>=0&&c<=1));
 }
});
test('seeded terrain is repeatable, varied and continuous across negative coordinates',()=>{
 const a=terrainSample(380,771,'desert');assert.deepEqual(a,terrainSample(380,771,'desert'));
 assert.notDeepEqual(a,terrainSample(380,771,'alpine'));
 for(const s of [-960,-240,0,240,960])assert.ok(Math.abs(terrainHeight(500,s-.001)-terrainHeight(500,s+.001))<.1);
});
