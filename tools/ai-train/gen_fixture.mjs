// Regenerates tests/fixtures/telemetry-roundtrip.jsonl through the real recorder
// (src/telemetry.js) with the frame shape main.js produces (object tactic) plus
// string-tactic frames like tools/gen-dataset.mjs emits. Run after any schema change:
//   node tools/ai-train/gen_fixture.mjs
// then prove the trainer accepts it (in the ai-train container):
//   python tools/ai-train/roundtrip_check.py tests/fixtures/telemetry-roundtrip.jsonl
import {writeFileSync} from 'node:fs';
import {createTelemetry} from '../../src/telemetry.js';
import {buildObs} from '../../src/obs.js';
import {createState} from '../../src/physics.js';

const t=createTelemetry();t.enabled=true;t.begin({world:'akuma',bike:'nightblade',seed:42});
const rivals=[{s:12,x:-2,y:0,v:20,vx:0,stun:0,attack:0,flight:false,target:57}];
for(let i=0;i<30;i++){
 const p={...createState(),s:i*2,v:18+i*.5,x:Math.sin(i/5)*3};
 const tactic=i%3===0?{encounter:'balanced',director:'race',rivals:['race','overtake','defend']}
  :i%3===1?{encounter:'pressure',director:'block',rivals:['block','race','race']}
  :'slipstream';
 t.sample(i/30,{obs:buildObs(p,rivals),input:{steer:Math.sin(i/7)*.5,throttle:i%4!==0,brake:i%4===0},tactic});
}
t.end();
writeFileSync(new URL('../../tests/fixtures/telemetry-roundtrip.jsonl',import.meta.url),t.toJSONL());
console.log(`wrote ${t.count} frames to tests/fixtures/telemetry-roundtrip.jsonl`);
