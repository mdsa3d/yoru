import test from 'node:test';import assert from 'node:assert/strict';
import {valueNoise,fbm,heightField,normalFromHeight,roughnessFromHeight} from '../src/materials.js';

test('generators are byte-deterministic per seed and diverge across seeds',()=>{
 const a=heightField(64,{seed:11}),b=heightField(64,{seed:11}),c=heightField(64,{seed:12});
 assert.deepEqual([...a],[...b]);assert.notDeepEqual([...a],[...c]);
 assert.deepEqual([...normalFromHeight(a,64)],[...normalFromHeight(b,64)]);
 assert.deepEqual([...roughnessFromHeight(a,64)],[...roughnessFromHeight(b,64)]);
});
test('heightfield stays in [0,1] and value noise is lattice-periodic',()=>{
 const h=heightField(128);for(const v of h){assert.ok(v>=0&&v<=1)}
 for(const [x,y] of [[2.3,4.7],[0,0],[7.99,3.14]])assert.ok(Math.abs(fbm(x,y,{period:8})-fbm(x+8,y,{period:8}))<1e-9&&Math.abs(fbm(x,y,{period:8})-fbm(x,y+8,{period:8}))<1e-9);
 assert.equal(valueNoise(0,0,8,1),valueNoise(8,0,8,1));
});
test('normal map encodes unit-ish up-facing normals, flat field is perfectly flat',()=>{
 const size=64,flat=new Float32Array(size*size).fill(.5),n=normalFromHeight(flat,size);
 assert.equal(n.length,size*size*4);
 for(let i=0;i<size*size;i++){assert.equal(n[i*4],128);assert.equal(n[i*4+1],128);assert.equal(n[i*4+2],255);assert.equal(n[i*4+3],255)}
 const h=heightField(size),m=normalFromHeight(h,size,2.4);
 for(let i=0;i<size*size;i++){assert.ok(m[i*4+2]>=128);const x=m[i*4]/255*2-1,y=m[i*4+1]/255*2-1,z=m[i*4+2]/255*2-1;assert.ok(Math.hypot(x,y,z)>.95&&Math.hypot(x,y,z)<1.05)}
});
test('roughness map replicates channels and respects base±amp bounds',()=>{
 const size=64,h=heightField(size),r=roughnessFromHeight(h,size,{base:1,amp:.3});
 assert.equal(r.length,size*size*4);
 for(let i=0;i<size*size;i++){const v=r[i*4];assert.equal(r[i*4+1],v);assert.equal(r[i*4+2],v);assert.ok(v>=Math.round(.7*255)-1&&v<=255);assert.equal(r[i*4+3],255)}
 // flat mid-height field → exactly base
 const f=roughnessFromHeight(new Float32Array(16).fill(.5),4,{base:.8,amp:.3});assert.equal(f[0],Math.round(.8*255));
});
