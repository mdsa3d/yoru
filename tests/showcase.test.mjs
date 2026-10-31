import test from 'node:test';import assert from 'node:assert/strict';import * as T from 'three';
import {Studio} from '../src/studio.js';import {makeRider,animateRider} from '../src/rider.js';import {makeBike,animateBike,disposeModel} from '../src/models.js';import {BIKES} from '../src/physics.js';
test('studio leaves no lights, meshes or shared resources behind after disposal',()=>{
 const scene=new T.Scene(),s=new Studio(scene);s.setVisible(true);assert.equal(s.key.visible,true);s.setVisible(false);assert.equal(s.key.visible,false);
 const counts=new Map();s.root.traverse(o=>{for(const r of [o.geometry,o.material])if(r&&!counts.has(r)){counts.set(r,0);r.addEventListener('dispose',()=>counts.set(r,counts.get(r)+1))}});
 s.dispose();assert.equal(scene.children.length,0);for(const n of counts.values())assert.equal(n,1);
});
test('rider follows lean and braking while both glove anchors remain fixed',()=>{
 const r=makeRider({compact:true}),hands=r.userData.arms.map(a=>a.hand.clone());
 for(let i=0;i<120;i++)animateRider(r,{speed:65,lean:.4,accel:-18,time:i/60,dt:1/60});
 assert.ok(r.userData.upper.rotation.z<0);assert.ok(r.userData.upper.position.x>0);
 r.userData.arms.forEach((a,i)=>assert.deepEqual(a.hand,hands[i]));
 r.traverse(o=>{if(o.isMesh){assert.ok(o.position.toArray().every(Number.isFinite));assert.ok(o.quaternion.toArray().every(Number.isFinite))}});
 disposeModel(r);
});
test('all six fallback bikes keep articulated riders outside static batches',()=>{
 for(const b of BIKES){const m=makeBike(b,b.color);assert.ok(m.children.includes(m.userData.rider));animateBike(m,{speed:40,lean:-.3,dt:1/60});assert.ok(m.userData.rider.userData.upper.rotation.z>0);disposeModel(m)}
});
