import {describe,it} from 'node:test';
import assert from 'node:assert/strict';
import {useImportedTraffic} from '../src/world.js';

describe('traffic asset selection',()=>{
 it('selects imported cars for every third index deterministically',()=>{
  const indices=[0,1,2,3,4,5,6,7,8,9,10,11,12,13];
  const imported=indices.filter(useImportedTraffic);
  assert.deepEqual(imported,[0,3,6,9,12]);
 });
 it('never selects imported for indices not divisible by three',()=>{
  for(let i=0;i<30;i++)assert.equal(useImportedTraffic(i),i%3===0);
 });
});
