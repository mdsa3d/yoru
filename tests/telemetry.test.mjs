import test from 'node:test';import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createTelemetry} from '../src/telemetry.js';
import {TACTICS} from '../src/rivals.js';
import {OBS_WIDTH} from '../src/obs.js';
const frame=i=>({obs:{s:i,v:30},input:{steer:0,throttle:true,brake:false},tactic:{encounter:'balanced',director:'race',rivals:['race']}});

test('telemetry is off by default and records nothing until enabled',()=>{
 const t=createTelemetry();
 t.begin({world:'akuma',bike:'nightblade',seed:1});
 assert.equal(t.recording,false);
 assert.equal(t.sample(0,frame(0)),false);
 t.sample(1,frame(1));
 assert.equal(t.count,0);assert.equal(t.toJSONL(),'');
});

test('enabled recorder samples at most once per 1/30 s and tags world/bike/seed',()=>{
 const t=createTelemetry();t.enabled=true;
 t.begin({world:'akuma',bike:'nightblade',seed:9});
 assert.equal(t.recording,true);
 let taken=0;for(let i=0;i<1200;i++)if(t.sample(i/120,frame(i)))taken++;   // 10 s at 120 Hz
 assert.ok(taken>=295&&taken<=305,`~300 samples at 30 Hz, got ${taken}`);
 assert.equal(t.count,taken);
 const line=JSON.parse(t.toJSONL().split('\n')[0]);
 for(const k of ['t','obs','input','tactic','world','bike','seed'])assert.ok(k in line,k);
 assert.equal(line.world,'akuma');assert.equal(line.bike,'nightblade');assert.equal(line.seed,9);
});

// Schema contract with tools/ai-train/train_bc.py parse_line() (settled 3.17.0):
// tactic is ONE string id; rich context moves to the optional tacticDetail object.
test('object tactics are canonicalised to a string id plus optional tacticDetail',()=>{
 const t=createTelemetry();t.enabled=true;t.begin({world:'akuma',bike:'nightblade',seed:1});
 t.sample(0,{obs:[0],input:{steer:0,throttle:1,brake:0},tactic:{encounter:'pressure',director:'block',rivals:['block','race','race']}});
 t.sample(1/30,{obs:[0],input:{steer:0,throttle:1,brake:0},tactic:'overtake'});   // string passes through
 t.sample(2/30,{obs:[0],input:{steer:0,throttle:1,brake:0}});                     // missing tactic defaults
 const lines=t.toJSONL().trim().split('\n').map(l=>JSON.parse(l));
 assert.equal(lines[0].tactic,'block');assert.deepEqual(lines[0].tacticDetail,{encounter:'pressure',director:'block',rivals:['block','race','race']});
 assert.equal(lines[1].tactic,'overtake');assert.ok(!('tacticDetail' in lines[1]),'string tactic emits no detail field');
 assert.equal(lines[2].tactic,'race');
 for(const l of lines)assert.ok(TACTICS.includes(l.tactic),`tactic '${l.tactic}' is a trainer-valid id`);
});

// Round-trip: the committed fixture is produced by tools/ai-train/gen_fixture.mjs through
// createTelemetry, and must satisfy every parse_line() invariant (the literal JSONL ->
// parse_line run happens in the ai-train container via roundtrip_check.py; here we mirror
// its checks so `npm test` alone guards the contract).
test('committed telemetry fixture round-trips through the trainer schema rules',()=>{
 const lines=readFileSync(new URL('./fixtures/telemetry-roundtrip.jsonl',import.meta.url),'utf8').trim().split('\n');
 assert.ok(lines.length>=20,'fixture has enough rows');
 for(const [n,l] of lines.entries()){
  const rec=JSON.parse(l);
  assert.ok(Array.isArray(rec.obs)&&rec.obs.length===OBS_WIDTH&&rec.obs.every(Number.isFinite),`line ${n}: obs (v2 ${OBS_WIDTH}-float schema)`);
  const inp=rec.input;assert.ok(inp&&inp.steer>=-1&&inp.steer<=1&&inp.throttle>=0&&inp.throttle<=1&&inp.brake>=0&&inp.brake<=1,`line ${n}: input ranges`);
  assert.ok(TACTICS.includes(rec.tactic),`line ${n}: tactic string id`);
  if('tacticDetail' in rec)assert.equal(typeof rec.tacticDetail,'object',`line ${n}: tacticDetail is an object`);
  assert.equal(typeof rec.world,'string');assert.equal(typeof rec.bike,'string');assert.ok(Number.isInteger(rec.seed));
 }
});

test('ring buffer wraps at capacity and stays chronological',()=>{
 const t=createTelemetry({capacity:5,rate:30});t.enabled=true;t.begin({world:'w',bike:'b',seed:2});
 for(let i=0;i<12;i++)t.sample(i/30,frame(i));
 assert.equal(t.count,5);
 const ts=t.records().map(r=>r.obs.s);
 assert.deepEqual(ts,[7,8,9,10,11]);
 const lines=t.toJSONL().trim().split('\n');
 assert.equal(lines.length,5);
 assert.deepEqual(lines.map(l=>JSON.parse(l).obs.s),ts);
});

test('end() stops recording; begin() resets the buffer; download() is browser-only',()=>{
 const t=createTelemetry();t.enabled=true;t.begin({seed:1});
 t.sample(0,frame(0));t.end();
 assert.equal(t.sample(1/30,frame(1)),false);assert.equal(t.count,1);
 t.begin({seed:2});assert.equal(t.count,0);
 t.sample(0,frame(0));
 assert.equal(t.download(),false,'no DOM in Node: download refuses instead of crashing');
});
