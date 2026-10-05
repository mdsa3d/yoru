import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHazards,hazardAt,nearbyHazards,surfaceGrip} from '../src/hazards.js';

test('hazards are deterministic and spaced for reaction time',()=>{
 const a=createHazards('akuma'),b=createHazards('akuma');
 assert.deepEqual(a,b);assert.ok(a.length>20);assert.ok(a[0].s>100);
});
test('hazard perception is bounded to the forward window',()=>{
 const hazards=createHazards('solstice'),p={s:150,x:0};
 assert.ok(nearbyHazards(hazards,p,95).every(h=>h.distance>=-4&&h.distance<=95));
});
test('oil and puddles change surface grip only while occupied',()=>{
 const hazards=[{type:'oil',s:50,x:0,width:2,depth:4}];
 assert.equal(hazardAt(hazards,{s:50,x:0}).type,'oil');
 assert.ok(surfaceGrip(hazards,{s:50,x:0},'rain')<surfaceGrip(hazards,{s:0,x:0},'rain'));
});
