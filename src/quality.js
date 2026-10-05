// Adaptive quality ladder (3.19.0). Pure and DOM-free: no three.js, no document/window reads —
// Node-testable like timing.js. world.js owns applying a rung to the renderer; this module only
// decides WHICH rung, when to move, and what the initial probe hint is.
//
// Design contract:
// - Shedding order is expensive-first, resolution-last: GTAO -> shadow res/refit -> detail maps
//   -> dither/other -> MSAA -> render scale. SSR is never part of the ladder (experimental,
//   default off, quality==='high' only) and is never auto-enabled.
// - The frame budget is derived from the measured display refresh (rAF cadence), not a hardcoded
//   23/17 ms: a 120/144 Hz panel gets a proportionally tighter budget than 60 Hz.
// - Decisions use p95 (plus a p99 hard-spike term), not p50: one bad window must not shed quality.
// - Hysteresis + cooldown: demotion needs sustained slowness, promotion needs sustained headroom,
//   every move is exactly one rung, and a cooldown window follows each move. No thrashing.

// Rungs ordered lowest (index 0) to highest (MAX). Each rung is a plain settings object;
// world.js maps it onto renderer/composer state. `dither` only suppresses the optional
// user-selected retro-dither pass while degraded — the setup.style choice itself is untouched.
export const RUNGS=[
 {label:'MINIMUM',scale:.6,samples:0,effects:false,gtao:false,detail:false,dither:false,refit:false,shadow:512},
 {label:'SCALED',scale:.85,samples:0,effects:true,gtao:false,detail:false,dither:false,refit:false,shadow:512},
 {label:'NO-MSAA',scale:1,samples:0,effects:true,gtao:false,detail:false,dither:false,refit:false,shadow:1024},
 {label:'NO-DITHER',scale:1,samples:4,effects:true,gtao:false,detail:false,dither:false,refit:false,shadow:1024},
 {label:'NO-DETAIL',scale:1,samples:4,effects:true,gtao:false,detail:false,dither:true,refit:false,shadow:1024},
 {label:'MID-SHADOW',scale:1,samples:4,effects:true,gtao:false,detail:true,dither:true,refit:false,shadow:1024},
 {label:'HIGH',scale:1,samples:4,effects:true,gtao:false,detail:true,dither:true,refit:true,shadow:2048},
 {label:'MAX',scale:1,samples:4,effects:true,gtao:true,detail:true,dither:true,refit:true,shadow:2048},
];
export const MAX_RUNG=RUNGS.length-1;

// Manual quality presets, resolved here so the "manual overrides are honoured exactly" rule is
// unit-testable without a DOM. 'high' = top rung semantics (SSR stays flag-gated in world.js);
// 'low' = the historical Performance preset (scale .85, no MSAA, 512 shadows, composer bypassed).
export function manualSettings(quality){
 if(quality==='high')return {...RUNGS[MAX_RUNG],label:'HIGH'};
 if(quality==='low')return {label:'LOW',scale:.85,samples:0,effects:false,gtao:false,detail:false,dither:false,refit:false,shadow:512};
 return null; // 'auto' — the ladder decides
}

// Estimate the display refresh from a FrameStats.summary() window. rAF deltas are vsync-quantised,
// so a stable cadence at >= ~54 Hz is accepted as the display rate; anything slower or unstable
// keeps the previous estimate (default 60). 3.19.1: the stability gate is deliberately tolerant
// (p95 <= 1.6*p50 + 4 ms) — a live 240-frame window always contains a few hitches (GC, HUD writes,
// lazy shader compiles) and ProMotion/VRR panels vary their cadence, so the old strict p95<=1.35*p50
// gate never accepted on real hardware and the budget stayed stuck at 60 Hz while the panel ran at
// 102 (measured on an M4 Pro: baseline p50 9.8 / p95 12.8 with quality.hz pinned at 60). The
// MEASURED rate is returned unsnapped (90-125 Hz stays e.g. 102, it is not forced to 60/120) so the
// ladder budget tracks the true cadence. Pure; no DOM.
export function estimateHz({p50,p95},prev=60){
 if(!(p50>0)||!(p95>0))return prev;
 if(p50>18.5)return prev; // slower than ~54 Hz is a struggling frame rate, not a display rate
 if(p95>p50*1.6+4)return prev; // genuinely unstable window: keep the previous estimate
 return Math.min(240,Math.max(55,Math.round(1000/p50)));
}

// Initial tier probe from renderer info. THIS IS A HEURISTIC HINT ONLY: it string-matches the
// WEBGL_debug_renderer_info renderer (which browsers may mask, localise or withhold) and guesses
// device class from coarse signals. It never has to be right — it only picks the starting rung,
// and the measured ladder above corrects any mistake within seconds of real frame data.
export function probeTier({renderer='',maxTextureSize=0,dpr=1,memory=0,cores=0,coarse=false}={}){
 const r=String(renderer||'').toLowerCase();
 let tier;
 if(/swiftshader|llvmpipe|softpipe|software|basic render/.test(r))tier='low'; // CPU rasterisers
 else if(/apple\s*m\d|apple gpu|geforce\s*(rtx|gtx)|radeon\s*(rx|pro)|nvidia|amd(?!.*apu)/.test(r))tier='high'; // known discrete / Apple Silicon
 else if(/intel|iris|uhd|hd graphics|mali|adreno|powervr|videocore|apple a\d/.test(r))tier='low'; // integrated / mobile
 else tier='medium'; // unknown or masked renderer string
 // Coarse downgrades, one step each — small texture limit, little RAM, few cores, touch-first device.
 const down=t=>t==='high'?'medium':'low';
 if(maxTextureSize&&maxTextureSize<8192)tier=down(tier);
 if(memory&&memory<=4)tier=down(tier);
 if(cores&&cores<=4)tier=down(tier);
 if(coarse)tier=down(tier);
 if(dpr>2.5&&tier==='high')tier='medium'; // very dense panel on an unproven GPU: start mid-high
 return tier;
}
// Where the probe starts the ladder: known discrete/Apple Silicon -> full; unknown -> mid-high
// (never MAX on an unproven GPU); integrated/mobile/software -> well down the ladder.
export const START_RUNG={high:MAX_RUNG,medium:5,low:2};
export function rungForTier(tier){return START_RUNG[tier]??START_RUNG.medium}

// The ladder controller. One instance per World; main.js feeds it a FrameStats.summary() window
// every ~2 s. All thresholds are multiples of the refresh-derived budget so 60/120/144 Hz displays
// behave identically in frame-count terms.
export class QualityLadder{
 constructor({rung=MAX_RUNG,hz=60,slowWindows=2,fastWindows=3,cooldownWindows=2}={}){
  this.slowWindows=slowWindows;this.fastWindows=fastWindows;this.cooldownWindows=cooldownWindows;
  this.setBudget(hz);this.reset(rung);
 }
 setBudget(hz){if(hz>0){this.hz=hz;this.budget=1000/hz}} // ms per frame at the measured refresh
 reset(rung=MAX_RUNG){this.rung=Math.max(0,Math.min(MAX_RUNG,rung));this.slowN=0;this.fastN=0;this.cool=0}
 get settings(){return RUNGS[this.rung]}
 // One decision window. report = {p50,p95,p99} ms. Returns true iff the rung changed.
 // Rules:
 // - slow: p95 > 1.25*budget (at 60 Hz: >20.8 ms) or a hard spike p99 > 2.2*budget.
 // - headroom: when the cadence is vsync-locked to the budget (p50 ~= budget) frames essentially
 //   never miss a vsync (p95 <= 1.12*budget); otherwise p95 <= 0.82*budget. This makes recovery
 //   reachable on vsync-pinned strong GPUs, whose deltas can never fall below the interval.
 // - demotion after `slowWindows` consecutive slow windows; promotion after `fastWindows`
 //   consecutive headroom windows; exactly one rung per decision, then a cooldown.
 update(report){
  const p50=report.p50||0,p95=report.p95||p50,p99=report.p99||p95;
  if(this.cool>0){this.cool--;this.slowN=0;this.fastN=0;return false}
  const locked=p50>0&&Math.abs(p50-this.budget)<=this.budget*.14;
  const slow=p95>this.budget*1.25||p99>this.budget*2.2;
  const fast=!slow&&(locked?p95<=this.budget*1.12:p95<=this.budget*.82);
  if(slow){this.fastN=0;this.slowN++;
   if(this.slowN>=this.slowWindows&&this.rung>0){this.rung--;this.slowN=0;this.cool=this.cooldownWindows;return true}
  }else if(fast){this.slowN=0;this.fastN++;
   if(this.fastN>=this.fastWindows&&this.rung<MAX_RUNG){this.rung++;this.fastN=0;this.cool=this.cooldownWindows;return true}
  }else{this.slowN=0;this.fastN=0}
  return false;
 }
}
