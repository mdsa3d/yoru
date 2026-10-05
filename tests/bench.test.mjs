import test from 'node:test';import assert from 'node:assert/strict';
import {summariseRuns} from '../src/bench.js';
// runBench itself is browser-only (rAF/WebGL); the run aggregation is pure and tested here.

const run=(frames,p50,p95,p99)=>({frames,p50,p95,p99});

test('summariseRuns reports the median-by-p50 run and the spread',()=>{
 const a=run(400,9.8,12.8,13.6),b=run(390,10.4,13.1,14.2),c=run(410,9.5,12.5,13.4);
 const r=summariseRuns([a,b,c]);
 assert.equal(r.p50,9.8,'median-of-p50');
 assert.equal(r.p95,12.8);assert.equal(r.p99,13.6);assert.equal(r.frames,400); // all from the same real run
 assert.equal(r.p50Min,9.5);assert.equal(r.p50Max,10.4,'spread exposes single-run noise');
 assert.equal(r.runs.length,3);
});

test('summariseRuns picks the middle of an even run count (upper median)',()=>{
 const r=summariseRuns([run(100,8,9,10),run(100,9,10,11),run(100,10,11,12),run(100,20,21,22)]);
 assert.equal(r.p50,10);assert.equal(r.p50Min,8);assert.equal(r.p50Max,20);
});

test('summariseRuns output preserves the percentile ordering invariant',()=>{
 // bench-smoke.cjs asserts p95>=p50 and p99>=p95 on the reported numbers; taking all three
 // percentiles from one real median run (rather than per-key medians) guarantees that.
 const r=summariseRuns([run(50,9,20,21),run(60,10,11,30),run(55,11,12,13)]);
 assert.ok(r.p95>=r.p50&&r.p99>=r.p95);
});

test('summariseRuns is order-independent and handles a single run',()=>{
 const a=run(400,9.8,12.8,13.6),b=run(390,10.4,13.1,14.2),c=run(410,9.5,12.5,13.4);
 assert.deepEqual(summariseRuns([c,a,b]),summariseRuns([a,b,c]));
 const one=summariseRuns([a]);
 assert.equal(one.p50,9.8);assert.equal(one.p50Min,9.8);assert.equal(one.p50Max,9.8);
});
