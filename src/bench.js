// ?bench=1 per-feature cost harness (3.19.0; repeats + median/spread in 3.19.1). Loaded dynamically
// from main.js only in bench mode. Cycles feature configurations in the standard race-start scene
// (fixed camera mode, free-ride so the run can't end mid-measurement) and exposes the results as
// window.__bench plus a downloaded yoru-bench.json.
//
// HONESTY NOTE: the numbers are rAF-to-rAF deltas of the real game loop. On a real GPU in a normal
// browser window they measure real rendering cost. Under headless SwiftShader (containers/CI) they
// measure SOFTWARE rendering and are NOT hardware evidence — smoke-only there, same caveat as
// VALIDATION.md and previews/gfx-shots.cjs.
import {estimateHz} from './quality.js';
import {TUNNEL} from './tunnel.js';

// name -> isolated feature delta vs baseline. Baseline = all gfx* flags off, MSAA 4, solid style.
// 'tunnels' DRIVES through the first tunnel zone (3.19.1): the 3.19.0 harness parked the bike inside
// the tunnel (input released, v=0) — the only static-camera config — and on a ProMotion display the
// measured window collapsed to ~27 fps average despite a 13 ms p50 (macOS demotes the refresh of
// static content), which read as a bogus 70 ms p99. Teleporting to 60 m before the mouth at v=50 with
// the throttle held keeps the cadence alive and measures entry + interior, like real gameplay.
const CONFIGS=[
 ['baseline',{}],
 ['fxaa',{samples:0}],
 ['gtao',{flags:{gfxGtao:'on'}}],
 ['ssr',{flags:{gfxSsr:'on'}}],
 ['shadows',{flags:{gfxShadow:'on'}}],
 ['tunnels',{flags:{gfxTunnels:'on'},s:TUNNEL.offset-60,v:50}],
 ['dither',{style:'dither'}],
];
// Pure run aggregation (Node-tested): each config is measured `reps` times; the reported p50/p95/p99
// come from the MEDIAN-BY-p50 run (a real run, so p95>=p50 and p99>=p95 always hold), and
// p50Min/p50Max expose the spread so single-run noise is visible instead of hidden.
export function summariseRuns(runs){
 const s=[...runs].sort((a,b)=>a.p50-b.p50);
 const m=s[Math.floor(s.length/2)]||{frames:0,p50:0,p95:0,p99:0};
 return {runs:s.map(r=>({frames:r.frames,p50:r.p50,p95:r.p95,p99:r.p99})),frames:m.frames,p50:m.p50,p95:m.p95,p99:m.p99,p50Min:s.length?s[0].p50:0,p50Max:s.length?s[s.length-1].p50:0};
}
export async function runBench(game,{measureMs=4000,warmupMs=1200,reps=3}={}){
 const g=game,w=g.world;window.__benchRunning=true; // perfAt block skips adapt() while this runs
 const gl=w.renderer.getContext();let renderer='unknown';
 try{const ext=gl.getExtension('WEBGL_debug_renderer_info');renderer=ext?String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)):String(gl.getParameter(gl.RENDERER))}catch{}
 // NOTE: `quality` is captured at the END (3.19.1): it reads the live displayHz estimate, which is
 // still the boot default at construction time — the 3.19.0 JSON snapshot reported a stale hz.
 const result={environment:'rAF-to-rAF frame deltas of the live game loop. Real-GPU numbers only in a normal browser; headless SwiftShader = SOFTWARE rendering, NOT hardware evidence.',userAgent:navigator.userAgent,renderer,dpr:devicePixelRatio,resolution:[innerWidth,innerHeight],refreshHz:null,quality:null,measureMs,warmupMs,reps,configs:{}};
 const saved={quality:g.setup.quality,mode:g.setup.mode,style:g.setup.style,gfxShadow:g.setup.gfxShadow,gfxGtao:g.setup.gfxGtao,gfxDetail:g.setup.gfxDetail,gfxSsr:g.setup.gfxSsr,gfxTunnels:g.setup.gfxTunnels,samples:w.samples};
 try{
  g.setup.mode='free';g.setup.quality='high'; // effects on; per-feature flags isolate the cost. Manual 'high' => adapt() never sheds mid-measurement.
  g.start();g.setInput('w',true);
  const raf=()=>new Promise(r=>requestAnimationFrame(r));
  const wait=async ms=>{const t0=performance.now();while(performance.now()-t0<ms)await raf()};
  const measure=async()=>{const d=[];const t0=performance.now();let last=t0;while(last-t0<measureMs){await raf();const now=performance.now();d.push(now-last);last=now}d.sort((a,b)=>a-b);const q=f=>+(d[Math.floor(d.length*f)]||0).toFixed(2);return {frames:d.length,p50:q(.5),p95:q(.95),p99:q(.99)}};
  for(const [name,cfg] of CONFIGS){
   Object.assign(g.setup,{gfxShadow:'off',gfxGtao:'off',gfxDetail:'off',gfxSsr:'off',gfxTunnels:'off'},cfg.flags||{});
   g.setup.style=cfg.style||'solid';w.applyGraphicsFlags(g.setup);w.setSamples(cfg.samples??4);
   if(cfg.s!=null){g.state.s=cfg.s;g.state.v=cfg.v??0}
   g.setInput('w',true);
   await wait(warmupMs); // once per config: absorbs flag-toggle churn and lazy compiles
   const runs=[];
   for(let r=0;r<reps;r++){
    if(cfg.s!=null&&r>0){g.state.s=cfg.s;g.state.v=cfg.v??0;await wait(300)} // re-teleport: every rep starts at the same approach point
    runs.push(await measure());
   }
   const agg=summariseRuns(runs);
   result.configs[name]={flags:Object.keys(cfg.flags||{}).length?cfg.flags:null,samples:cfg.samples??4,style:g.setup.style,...agg};
   if(name==='baseline')result.refreshHz=estimateHz({p50:agg.p50,p95:agg.p95},0)||null;
   console.log('bench',name,JSON.stringify(agg));
  }
 }finally{
  Object.assign(g.setup,{quality:saved.quality,mode:saved.mode,style:saved.style,gfxShadow:saved.gfxShadow,gfxGtao:saved.gfxGtao,gfxDetail:saved.gfxDetail,gfxSsr:saved.gfxSsr,gfxTunnels:saved.gfxTunnels});
  w.applyGraphicsFlags(g.setup);w.setSamples(saved.samples);g.setInput('w',false);
  window.__benchRunning=false;result.quality=g.quality;window.__bench=result;window.__benchDone=true;
 }
 try{const blob=new Blob([JSON.stringify(result,null,2)],{type:'application/json'}),a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='yoru-bench-'+Date.now()+'.json';document.body.append(a);a.click();a.remove()}catch(e){console.warn('bench download failed (headless?)',e)}
 return result;
}
