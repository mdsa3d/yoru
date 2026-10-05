import test from 'node:test';import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {MLP,loadMLP} from '../src/mlp.js';

const TOL=1e-5;
const fixture=JSON.parse(readFileSync(new URL('./fixtures/mlp-reference.json',import.meta.url)));

test('mlp forward matches the Python reference vectors within 1e-5',()=>{
 const net=loadMLP(fixture.weights);
 assert.equal(net.input,5);assert.equal(net.output,3);
 for(const v of fixture.vectors){
  const out=net.forward(Float32Array.from(v.in));
  assert.equal(out.length,3);
  for(let j=0;j<3;j++)assert.ok(Math.abs(out[j]-v.out[j])<TOL,`|${out[j]} - ${v.out[j]}| >= ${TOL}`);
 }
});
test('shipped synthetic weights (assets/ai) match their Python reference vectors',()=>{
 const asset=JSON.parse(readFileSync(new URL('./fixtures/mlp-asset-vectors.json',import.meta.url)));
 const net=loadMLP(JSON.parse(readFileSync(new URL('../'+asset.weightsPath,import.meta.url))));
 assert.equal(net.input,40);assert.equal(net.output,3);          // default 40->128->128->3
 for(const v of asset.vectors){
  const out=net.forward(Float32Array.from(v.in));
  for(let j=0;j<3;j++)assert.ok(Math.abs(out[j]-v.out[j])<TOL,`|${out[j]} - ${v.out[j]}| >= ${TOL}`);
 }
});
test('forward is allocation-free beyond scratch buffers and re-runnable',()=>{
 const net=loadMLP(fixture.weights),x=Float32Array.from(fixture.vectors[0].in);
 const a=net.forward(x),b=net.forward(x);                          // same scratch ping-pong
 assert.notEqual(a,b);assert.deepEqual([...a],[...b]);
 const out=new Float32Array(3);assert.equal(net.forward(x,out),out);
});
test('loadMLP rejects malformed specs',()=>{
 assert.throws(()=>loadMLP({}),/format/);
 assert.throws(()=>loadMLP({format:'neon-rash-mlp@1',input:5,output:3,layers:[]}),/non-empty/);
 assert.throws(()=>loadMLP({format:'neon-rash-mlp@1',input:5,output:3,layers:[{units:4,activation:'tanh',W:[0,0,0],b:[0,0,0,0]}]}),/W length/);
 assert.throws(()=>loadMLP({format:'neon-rash-mlp@1',input:5,output:3,layers:[{units:3,activation:'nope',W:Array(15).fill(0),b:[0,0,0]}]}),/activation/);
 assert.throws(()=>loadMLP({format:'neon-rash-mlp@1',input:5,output:3,layers:[{units:3,activation:'tanh',W:Array(15).fill(0),b:[0,0,NaN]}]}),/non-finite/);
 assert.throws(()=>loadMLP({format:'neon-rash-mlp@1',input:5,output:2,layers:[{units:3,activation:'tanh',W:Array(15).fill(0),b:[0,0,0]}]}),/output width/);
 const net=loadMLP(fixture.weights);
 assert.throws(()=>net.forward(new Float32Array(4)),/input length/);
});
test('configurable shapes: a 2->3->2 relu net computes by hand',()=>{
 const net=new MLP({format:'neon-rash-mlp@1',input:2,output:2,layers:[
  {units:3,activation:'relu',W:[1,0,-1, 0,1,-1],b:[0,0,0]},
  {units:2,activation:'identity',W:[1,1, 1,1, 1,1],b:[1,-1]},
 ]});
 const out=net.forward(Float32Array.from([2,.5]));
 assert.ok(Math.abs(out[0]-3.5)<1e-6&&Math.abs(out[1]-1.5)<1e-6);
});
