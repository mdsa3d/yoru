// Fixed-step simulation with bounded catch-up and reusable render snapshots.
export class FrameClock {
 constructor(step=1/120,maxSteps=8){this.step=step;this.maxSteps=maxSteps;this.accumulator=0;this.dropped=0}
 reset(){this.accumulator=0}
 advance(dt,simulate,scale=1){
  this.accumulator+=Math.max(0,Math.min(dt,.25))*scale;let steps=0;
  while(this.accumulator>=this.step&&steps<this.maxSteps){simulate(this.step);this.accumulator-=this.step;steps++}
  if(this.accumulator>=this.step){const discard=Math.floor(this.accumulator/this.step)*this.step;this.dropped+=discard;this.accumulator-=discard}
  return this.accumulator/this.step;
 }
}
const fields=['s','x','y','v','vx','vy','lean','pitch','rpm'];
export function interpolate(previous,current,alpha,out){Object.assign(out,current);for(const k of fields)if(Number.isFinite(previous[k])&&Number.isFinite(current[k]))out[k]=previous[k]+(current[k]-previous[k])*alpha;return out}
export class FrameStats {
 constructor(){this.samples=new Float32Array(240);this.cursor=0;this.count=0;this.slow=0}
 add(ms){if(ms<=0||ms>1000)return;this.samples[this.cursor++%240]=ms;this.count=Math.min(240,this.count+1)}
 summary(){const a=Array.from(this.samples.subarray(0,this.count)).sort((a,b)=>a-b);return {frames:a.length,p50:a[Math.floor(a.length*.5)]||0,p95:a[Math.floor(a.length*.95)]||0,p99:a[Math.floor(a.length*.99)]||0}}
}
