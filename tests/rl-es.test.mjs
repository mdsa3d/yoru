// Unit tests for the OpenAI-ES core and theta<->spec packing (tools/rl/es.js, params.js).
import test from 'node:test';import assert from 'node:assert/strict';
import {createES,ask,tell,centeredRanks,esSnapshot,esRestore} from '../tools/rl/es.js';
import {initTheta,thetaToSpec,specToTheta,layerDims,countParams,shapeOfSpec} from '../tools/rl/params.js';
import {MLP} from '../src/mlp.js';

test('centeredRanks maps ascending fitness to [-0.5, 0.5]',()=>{
 const r=centeredRanks([10,-3,5,0]);
 const want=[.5,-.5,1/6,-1/6];
 for(let i=0;i<4;i++)assert.ok(Math.abs(r[i]-want[i])<1e-12,`rank ${i}: ${r[i]} vs ${want[i]}`);
 assert.ok(Math.abs(centeredRanks([1,1,1,1]).reduce((a,b)=>a+b,0))<1e-12);   // ties still partition ranks
});

test('ask() produces antithetic pairs around theta',()=>{
 const es=createES({dim:6,pop:4,sigma:.1,seed:3});
 const c=ask(es);
 assert.equal(c.length,4);
 for(let j=0;j<6;j++){
  assert.ok(Math.abs((c[0].theta[j]+c[1].theta[j])/2-es.theta[j])<1e-6,'pair mirrors the mean');
  assert.notEqual(c[0].theta[j],c[2].theta[j]);
 }
});

test('ES is deterministic given a seed and diverges across seeds',()=>{
 const run=seed=>{
  const es=createES({dim:8,pop:6,sigma:.05,lr:.02,seed});
  const seq=[];
  for(let g=0;g<3;g++){const c=ask(es);seq.push([...c[0].theta]);tell(es,c.map(x=>-(x.theta[0]**2)))}
  return {seq,theta:[...es.theta]};
 };
 assert.deepEqual(run(11),run(11));
 assert.notDeepEqual(run(11).theta,run(12).theta);
});

test('ES ascends a sphere function toward the optimum',()=>{
 const dim=20,target=Array.from({length:dim},(_,i)=>(i%5)*.4-.8);
 const f=t=>-t.reduce((a,x,i)=>a+(x-target[i])**2,0);
 const es=createES({dim,pop:16,sigma:.02,lr:.05,seed:5});
 const c0=ask(es);const before=f(Array.from(c0[0].theta).map((x,j)=>(x+c0[1].theta[j])/2));
 for(let g=0;g<300;g++){const c=ask(es);tell(es,c.map(x=>f(x.theta)))}
 const after=f(es.theta);
 assert.ok(after>before,`fitness improved (${before} -> ${after})`);
 assert.ok(after>-0.05,`near optimum (f=${after})`);
});

test('non-finite fitness and wrong-length tell are rejected',()=>{
 const es=createES({dim:4,pop:4,seed:1});ask(es);
 assert.throws(()=>tell(es,[1,NaN,2,3]));
 assert.throws(()=>tell(es,[1,2]));
});

test('snapshot/restore round-trips optimizer state',()=>{
 const es=createES({dim:6,pop:4,seed:2});
 const c=ask(es);tell(es,c.map(x=>x.theta[0]));
 const snap=JSON.parse(JSON.stringify(esSnapshot(es)));
 const es2=createES({dim:6,pop:4,seed:99});
 esRestore(es2,snap);
 assert.deepEqual([...es2.theta],[...es.theta]);
 assert.equal(es2.gen,es.gen);
});

test('params: dims/count, deterministic init, theta<->spec round-trip feeds src/mlp.js',()=>{
 const dims=layerDims(40,[8,6],3);
 assert.deepEqual(dims,[40,8,6,3]);
 assert.equal(countParams(dims),40*8+8+8*6+6+6*3+3);
 const a=initTheta({input:40,hidden:[8,6],output:3,seed:4});
 assert.deepEqual([...a],[...initTheta({input:40,hidden:[8,6],output:3,seed:4})]);
 const spec=thetaToSpec(a,{input:40,hidden:[8,6],output:3});
 assert.equal(spec.format,'neon-rash-mlp@1');
 assert.deepEqual(shapeOfSpec(spec),{input:40,hidden:[8,6],output:3});
 assert.deepEqual([...specToTheta(spec)],[...a]);
 const net=new MLP(spec);                                   // the real browser runner accepts it
 const out=net.forward(new Array(40).fill(.1));
 assert.equal(out.length,3);
 for(const v of out)assert.ok(Number.isFinite(v));
});

test('params: mismatched theta length and bad format are rejected',()=>{
 assert.throws(()=>thetaToSpec(new Float32Array(5),{input:40,hidden:[8],output:3}));
 assert.throws(()=>specToTheta({format:'nope'}));
});
