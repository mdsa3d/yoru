// Unit tests for the B5 reward definition (tools/rl/reward.js) — pure, no sim.
import test from 'node:test';import assert from 'node:assert/strict';
import {stepReward,emptyEvent,REWARD_WEIGHTS} from '../tools/rl/reward.js';

test('empty event scores exactly zero',()=>{
 assert.equal(stepReward(emptyEvent()),0);
});

test('progress term is positive and linear in distance',()=>{
 const a=stepReward({...emptyEvent(),ds:1}),b=stepReward({...emptyEvent(),ds:2});
 assert.ok(a>0);assert.equal(b,2*a);
});

test('collision, off-road and health loss are all strictly negative',()=>{
 assert.ok(stepReward({...emptyEvent(),collision:true})<0);
 assert.ok(stepReward({...emptyEvent(),offRoad:true})<0);
 assert.ok(stepReward({...emptyEvent(),dHealth:5})<0);
});

test('contact during recover costs more than contact in open racing',()=>{
 const fair=stepReward({...emptyEvent(),contact:true,encounter:'pressure'});
 const unfair=stepReward({...emptyEvent(),contact:true,encounter:'recover'});
 assert.ok(fair<0);
 assert.ok(unfair<fair);
 assert.equal(fair-unfair,REWARD_WEIGHTS.unfairContact);
});

test('a strike is penalised as unfair even without contact',()=>{
 const s=stepReward({...emptyEvent(),strike:true});
 assert.equal(s,-REWARD_WEIGHTS.unfairContact);
});

test('reward decomposes as progress - collision - offroad - contact (documented shape)',()=>{
 const evt={ds:3,dHealth:2,collision:true,offRoad:true,contact:true,strike:false,encounter:'recover'};
 const w=REWARD_WEIGHTS;
 assert.equal(stepReward(evt),w.progress*3-w.healthLoss*2-w.collision-w.offRoad-w.contact-w.unfairContact);
});

test('custom weights are honoured',()=>{
 const w={progress:1,healthLoss:1,collision:1,offRoad:1,contact:1,unfairContact:1};
 assert.equal(stepReward({...emptyEvent(),ds:5,collision:true},w),4);
});

test('reward is pure: same input, same output, no argument mutation',()=>{
 const evt={ds:1,dHealth:1,collision:true,offRoad:true,contact:true,strike:true,encounter:'recover'};
 const before=JSON.stringify(evt);
 assert.equal(stepReward(evt),stepReward(evt));
 assert.equal(JSON.stringify(evt),before);
});
