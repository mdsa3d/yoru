// Env tests for the B5 trainer: short seeded rollouts against the real JS sim (tools/rl/env.js).
import test from 'node:test';import assert from 'node:assert/strict';
import {runEpisode,evaluate,playerInput,DEFAULT_SETUP} from '../tools/rl/env.js';
import {initTheta,thetaToSpec} from '../tools/rl/params.js';
import {BIKES} from '../src/physics.js';
import {RIVAL_REF} from '../src/rivals.js';
const SHORT={maxSeconds:6};
const spec=thetaToSpec(initTheta({input:40,hidden:[16,16],output:3,seed:9}),{input:40,hidden:[16,16],output:3});
// Pinned full throttle, zero steer: probes guardrail authority over a maximally greedy policy.
const greedy=(()=>{const s=thetaToSpec(initTheta({input:40,hidden:[16,16],output:3,seed:9}),{input:40,hidden:[16,16],output:3});
 for(const L of s.layers)L.W=L.W.map(()=>0);
 s.layers[2].b=[0,10,-10];return s})();

test('episode is deterministic: same (spec, seed) replays exactly, seeds diverge',()=>{
 const a=runEpisode({spec,seed:7,...SHORT}),b=runEpisode({spec,seed:7,...SHORT});
 assert.equal(a.fitness,b.fitness);
 assert.deepEqual(a.metrics,b.metrics);
 // Seed diversity flows through the roster (env sets sim.rosterSeed=seed) and traffic/tier
 // noise; over a longer horizon that changes rival pace targets, so fitness must diverge.
 const c=runEpisode({spec:greedy,seed:7,maxSeconds:12}),d=runEpisode({spec:greedy,seed:8,maxSeconds:12});
 assert.notEqual(c.fitness,d.fitness);
});

test('metrics are finite and the trained rival makes progress',()=>{
 const {fitness,metrics:m}=runEpisode({spec,seed:3,...SHORT});
 assert.ok(Number.isFinite(fitness));
 for(const k of ['contacts','strikes','collisions','offRoadSteps','healthLost','rivalMaxV','rivalS','playerS','steps'])assert.ok(Number.isFinite(m[k]),k);
 assert.ok(m.steps>600,'ran the capped episode');
 assert.ok(m.rivalS>50,'rival moved forward');
 assert.ok(m.playerS>50,'heuristic player moved forward');
});

test('guardrails hold in training as in play: pinned-throttle policy stays speed-limited',()=>{
 const {metrics:m}=runEpisode({spec:greedy,seed:5,maxSeconds:10});
 const vmax=BIKES[DEFAULT_SETUP.bike].vmax;
 // driveNet hard-enforces planRival's speed limit after the net: a pinned-throttle policy
 // must peak well below the bike's vmax (targets sit near RIVAL_REF.road*0.84*pace).
 assert.ok(m.rivalMaxV>20,'rival reached racing speed');
 assert.ok(m.rivalMaxV<RIVAL_REF.road,'guardrail capped a pinned-throttle policy at '+m.rivalMaxV+' (vmax '+vmax+')');
});

test('heuristic baseline (spec=null) runs and reports the same metric shape',()=>{
 const {fitness,metrics:m}=runEpisode({spec:null,seed:5,...SHORT});
 assert.ok(Number.isFinite(fitness));
 assert.ok(m.rivalS>100,'physical heuristic rival progresses');
});

test('evaluate averages over seeds and reports race outcomes',()=>{
 const seeds=[21,22,23];
 const r=evaluate(spec,seeds,SHORT);
 assert.ok(Number.isFinite(r.fitness));
 assert.ok(r.metrics.beatPlayer>=0&&r.metrics.beatPlayer<=1);
 assert.ok(r.metrics.offRoadFrac>=0&&r.metrics.offRoadFrac<=1);
 const r2=evaluate(spec,seeds,SHORT);
 assert.equal(r.fitness,r2.fitness,'evaluation is deterministic');
});

test('evaluate with tiers:[...] averages exactly over (tier, seed) pairs (multi-tier objective)',()=>{
 const seeds=[31];
 const rookie=evaluate(spec,seeds,{...SHORT,tier:'rookie'});
 const elite=evaluate(spec,seeds,{...SHORT,tier:'elite'});
 const both=evaluate(spec,seeds,{...SHORT,tiers:['rookie','elite']});
 assert.equal(both.fitness,(rookie.fitness+elite.fitness)/2,'mean over tiers');
 assert.equal(both.metrics.steps,(rookie.metrics.steps+elite.metrics.steps)/2);
 const again=evaluate(spec,seeds,{...SHORT,tiers:['rookie','elite']});
 assert.equal(again.fitness,both.fitness,'multi-tier evaluation is deterministic');
});

test('playerInput is pure-shaped and bounded',()=>{
 const sim={traffic:[],hazards:[]};
 const inp=playerInput({s:100,x:3,v:40,vx:1,flight:false},sim);
 assert.ok(inp.steer>=-1&&inp.steer<=1);
 assert.equal(typeof inp.throttle,'boolean');
 assert.equal(typeof inp.brake,'boolean');
});
