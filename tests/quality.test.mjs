import test from 'node:test';import assert from 'node:assert/strict';
import {RUNGS,MAX_RUNG,QualityLadder,manualSettings,estimateHz,probeTier,rungForTier} from '../src/quality.js';

// Simulated frame-time windows: each entry is one FrameStats.summary() window fed to update().
const win=(p50,p95,p99=p95)=>({p50,p95,p99});
const feed=(l,windows)=>windows.map(w=>l.update(w)); // returns per-window changed flags

test('ladder order sheds expensive features first and resolution scale last',()=>{
 assert.deepEqual(RUNGS.map(r=>r.label),['MINIMUM','SCALED','NO-MSAA','NO-DITHER','NO-DETAIL','MID-SHADOW','HIGH','MAX']);
 // Walking DOWN from MAX: the first thing lost is GTAO, then shadow res/refit, then detail,
 // then dither, then MSAA, and only the final two rungs touch render scale.
 assert.equal(RUNGS[MAX_RUNG].gtao,true);assert.equal(RUNGS[MAX_RUNG-1].gtao,false);
 assert.equal(RUNGS[5].shadow,1024);assert.equal(RUNGS[5].refit,false);assert.equal(RUNGS[6].shadow,2048);
 assert.equal(RUNGS[4].detail,false);assert.equal(RUNGS[3].dither,false);
 assert.equal(RUNGS[2].samples,0);assert.equal(RUNGS[3].samples,4);
 assert.ok(RUNGS[2].scale===1&&RUNGS[1].scale<1); // MSAA is shed at full scale, resolution is last
 assert.equal(RUNGS[0].effects,false); // the floor bypasses the composer, matching the old autoEffects cliff
 // SSR appears nowhere in the ladder — it can never be auto-enabled.
 assert.ok(RUNGS.every(r=>!('ssr' in r)));
});

test('weak GPU converges monotonically to the floor without thrashing',()=>{
 const l=new QualityLadder({hz:60}); // budget 16.67 ms; slow above 20.8 ms
 const rungs=[l.rung];
 for(let i=0;i<80;i++){l.update(win(30,34,40));rungs.push(l.rung)}
 assert.equal(l.rung,0);
 for(let i=1;i<rungs.length;i++){assert.ok(rungs[i]<=rungs[i-1],'never climbs under load');assert.ok(rungs[i-1]-rungs[i]<=1,'one rung per decision')}
 // once at the floor it stays put, no oscillation
 for(let i=0;i<20;i++){assert.equal(l.update(win(40,50,60)),false);assert.equal(l.rung,0)}
});

test('strong GPU at 60 Hz vsync climbs to MAX one rung at a time and stays',()=>{
 const l=new QualityLadder({rung:rungForTier('medium'),hz:60});
 for(let i=0;i<60;i++)l.update(win(16.7,16.9,17.2)); // vsync-locked: p50 ~= budget
 assert.equal(l.rung,MAX_RUNG);
 for(let i=0;i<20;i++)assert.equal(l.update(win(16.7,16.9,17.2)),false); // stable at the top
});

test('isolated spikes are tolerated; only sustained slowness demotes',()=>{
 const l=new QualityLadder({hz:60});
 // steady healthy frames with one huge spike window (p99 95 ms) in the middle
 const changes=feed(l,[win(16.7,16.9),win(16.7,16.9),win(30,45,95),win(16.7,16.9),win(16.7,16.9)]);
 assert.ok(!changes.some(Boolean));assert.equal(l.rung,MAX_RUNG);
 // two consecutive slow windows demote exactly one rung
 const l2=new QualityLadder({hz:60});
 assert.equal(l2.update(win(30,34,40)),false);
 assert.equal(l2.update(win(30,34,40)),true);assert.equal(l2.rung,MAX_RUNG-1);
});

test('recovery requires sustained headroom and climbs one rung at a time',()=>{
 const l=new QualityLadder({rung:2,hz:60,fastWindows:3,cooldownWindows:2});
 assert.equal(l.update(win(10,11,12)),false);assert.equal(l.update(win(10,11,12)),false);
 assert.equal(l.update(win(10,11,12)),true);assert.equal(l.rung,3); // 3rd consecutive headroom window
 l.update(win(10,11,12));l.update(win(10,11,12)); // cooldown: headroom is ignored while it runs
 assert.equal(l.update(win(10,11,12)),false);assert.equal(l.update(win(10,11,12)),false);
 assert.equal(l.update(win(10,11,12)),true);assert.equal(l.rung,4); // fresh 3-window streak
 // a mid-recovery slow window cancels the headroom streak without demoting
 const l3=new QualityLadder({rung:2,hz:60,fastWindows:3,cooldownWindows:0});
 l3.update(win(10,11,12));l3.update(win(10,11,12));l3.update(win(30,34,40));
 assert.equal(l3.rung,2);l3.update(win(10,11,12));l3.update(win(10,11,12));
 assert.equal(l3.rung,2,'streak restarted, still no promotion');assert.equal(l3.update(win(10,11,12)),true);
});

test('120 Hz budget: missed vsyncs demote, a pinned 120 Hz cadence counts as headroom',()=>{
 const l=new QualityLadder({rung:4,hz:120}); // budget 8.33 ms
 l.update(win(16.7,16.7,16.7));assert.equal(l.rung,4);
 l.update(win(16.7,16.7,16.7));assert.equal(l.rung,3,'half the refresh rate is slow'); // dropping to 60 fps on a 120 Hz panel
 for(let i=0;i<40;i++)l.update(win(8.3,8.4,8.6)); // back to pinned 120 Hz
 assert.equal(l.rung,MAX_RUNG,'recovers all the way on vsync-locked headroom');
 // 144 Hz for good measure
 const l4=new QualityLadder({rung:MAX_RUNG,hz:144});assert.ok(Math.abs(l4.budget-1000/144)<.01);
 l4.update(win(13.9,13.9,13.9));l4.update(win(13.9,13.9,13.9));assert.equal(l4.rung,MAX_RUNG-1);
});

test('manual quality presets bypass the ladder and match the historical behaviour',()=>{
 const hi=manualSettings('high'),lo=manualSettings('low');
 assert.equal(hi.scale,1);assert.equal(hi.samples,4);assert.equal(hi.shadow,2048);assert.equal(hi.effects,true);assert.ok(!('ssr' in hi));
 assert.equal(lo.scale,.85);assert.equal(lo.samples,0);assert.equal(lo.shadow,512);assert.equal(lo.effects,false);
 assert.equal(manualSettings('auto'),null);
 // ladder state is irrelevant to the manual presets (world.adapt picks preset OR ladder, never both)
 assert.deepEqual(manualSettings('high'),manualSettings('high'));
});

test('estimateHz accepts stable vsync cadences and rejects unstable/slow ones',()=>{
 assert.equal(estimateHz(win(16.7,16.9)),60);
 assert.equal(estimateHz(win(8.3,8.4)),120);
 assert.equal(estimateHz(win(6.94,7.0)),144);
 assert.equal(estimateHz(win(25,30),60),60,'a stable 40 fps is not a display rate');
 assert.equal(estimateHz(win(16.7,40),120),120,'unstable cadence keeps the previous estimate');
 assert.equal(estimateHz(win(0,0),90),90);
});

test('probeTier: known discrete/Apple Silicon start full, unknown mid-high, integrated/mobile low',()=>{
 assert.equal(probeTier({renderer:'ANGLE (NVIDIA GeForce RTX 5070 Ti)'}),'high');
 assert.equal(probeTier({renderer:'Apple M4 Pro'}),'high');
 assert.equal(probeTier({renderer:'AMD Radeon RX 7900 XTX'}),'high');
 assert.equal(probeTier({renderer:'ANGLE (Intel UHD Graphics 620)'}),'low');
 assert.equal(probeTier({renderer:'Mali-G710 MC10'}),'low');
 assert.equal(probeTier({renderer:'WebKit WebGL'}),'medium'); // masked/unknown string
 assert.equal(probeTier({}),'medium'); // no renderer info at all
 assert.equal(probeTier({renderer:'SwiftShader'}),'low'); // software rasteriser
 assert.equal(probeTier({renderer:'Apple M4 Pro',coarse:true}),'medium'); // touch-first downgrades one step
 assert.equal(probeTier({renderer:'ANGLE (NVIDIA GeForce RTX 5070 Ti)',maxTextureSize:4096}),'medium');
 assert.equal(rungForTier('high'),MAX_RUNG);assert.equal(rungForTier('medium'),5);assert.equal(rungForTier('low'),2);
 assert.ok(rungForTier('medium')<MAX_RUNG,'unknown GPUs never start at MAX');
});

test('budget follows the measured refresh and reset() reseeds the start rung',()=>{
 const l=new QualityLadder({rung:2,hz:60});assert.ok(Math.abs(l.budget-16.67)<.01);
 l.setBudget(120);assert.ok(Math.abs(l.budget-8.33)<.01);l.setBudget(0);assert.ok(Math.abs(l.budget-8.33)<.01,'zero hz ignored');
 l.update(win(30,34,40));l.reset(6);assert.equal(l.rung,6);assert.equal(l.slowN,0);
 assert.equal(l.settings,RUNGS[6]);
});

test('estimateHz tolerates hitch-inflated live windows and uses the measured rate (3.19.1)',()=>{
 // The exact M4 Pro bench window that exposed the mismatch: a 102 Hz ProMotion cadence.
 assert.equal(estimateHz(win(9.8,12.8),60),102,'measured 102 Hz is used, not forced to 60');
 // A live 240-frame game window always contains a few hitches (GC/HUD/lazy compiles): p95 mildly
 // above 1.35*p50 must still accept, or the budget stays stuck at 60 Hz on fast panels.
 assert.equal(estimateHz(win(9.8,15.4),60),102,'hitch-inflated p95 still accepts');
 assert.equal(estimateHz(win(11.1,15.5),60),90);
 // Genuinely unstable windows (p95 ~ 2x p50, e.g. severe throttling) still keep the previous estimate.
 assert.equal(estimateHz(win(9.8,22),60),60,'wildly unstable cadence rejected');
 assert.equal(estimateHz(win(9.8,22),102),102);
 // Slower than ~54 Hz is a frame rate, not a display rate — unchanged contract.
 assert.equal(estimateHz(win(25,27),60),60);
});

test('ladder budget follows a measured ProMotion cadence end to end (3.19.1)',()=>{
 const l=new QualityLadder({hz:60});
 // 60 Hz budget mis-reads a 102 Hz panel: 9.8 ms p50/p95 looks like headroom at 60 Hz.
 assert.ok(Math.abs(l.budget-16.67)<.01);
 l.setBudget(estimateHz(win(9.8,12.8),l.hz));
 assert.ok(Math.abs(l.budget-1000/102)<.01,'budget derives from the measured 102 Hz, not 60');
 // ...and at that budget a sustained 13 ms p95 (tunnels config on the M4 Pro) is correctly slow.
 l.update(win(13,16.6,70.1));l.update(win(13,16.6,70.1));
 assert.equal(l.rung,MAX_RUNG-1,'sustained 1.6x-budget frames demote on the measured cadence');
});
