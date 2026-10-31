import test from 'node:test';import assert from 'node:assert/strict';
import {selectPolicy} from '../tools/rl/selection.js';
test('model selection preserves the best mean when late training regresses',()=>{
 const theta=new Float32Array([1,2]);const best=selectPolicy(null,theta,90,0);
 theta[0]=9;assert.equal(best.theta[0],1);
 assert.equal(selectPolicy(best,theta,80,10),best);
 assert.equal(selectPolicy(best,theta,90,20),best);
 const improved=selectPolicy(best,theta,91,30);
 assert.equal(improved.generation,30);assert.equal(improved.theta[0],9);
 assert.deepEqual(selectPolicy(JSON.parse(JSON.stringify(improved)),theta,89,40),improved);
 assert.throws(()=>selectPolicy(best,theta,NaN,50),/finite/);
});
