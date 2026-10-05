// Hand-rolled Float32Array MLP forward pass (UPLIFT-PLAN B7). No deps, no bundler.
// Weights load from a JSON spec (see tools/ai-train/README.md):
// {format:'neon-rash-mlp@1'|'neon-rash-mlp@2',input,output,layers:[{units,activation,W,b},...]}
// W is row-major with W[i*units+j] mapping input i to output j (x @ W), b is per-unit bias.
// Activations: 'tanh' | 'relu' | 'sigmoid' | 'identity'. Default shape 40->128->128->3.
// Format tags: the serialisation is identical; @1 implies the v1 40-float obs schema,
// @2 (3.20.0) the v2 50-float schema (src/obs.js). Both stay loadable — the obs builder
// is dispatched on the spec's input width at drive time, so @1 assets keep working.
const ACT={
 tanh:x=>Math.tanh(x),
 relu:x=>x>0?x:0,
 sigmoid:x=>1/(1+Math.exp(-x)),
 identity:x=>x,
};
export const MLP_FORMATS=['neon-rash-mlp@1','neon-rash-mlp@2'];
export class MLP {
 constructor(spec){
  if(!spec||!MLP_FORMATS.includes(spec.format))throw new Error('mlp: bad or missing format tag');
  const layers=spec.layers;
  if(!Array.isArray(layers)||!layers.length)throw new Error('mlp: layers must be a non-empty array');
  this.layers=[];let width=spec.input|0;
  if(!(width>0))throw new Error('mlp: input width must be positive');
  for(const L of layers){
   const units=L.units|0;
   if(!(units>0))throw new Error('mlp: layer units must be positive');
   if(!ACT[L.activation])throw new Error('mlp: unknown activation '+L.activation);
   if(!Array.isArray(L.W)||L.W.length!==width*units)throw new Error('mlp: W length '+width*units+' expected');
   if(!Array.isArray(L.b)||L.b.length!==units)throw new Error('mlp: b length '+units+' expected');
   const W=new Float32Array(L.W),b=new Float32Array(L.b);
   for(let k=0;k<W.length;k++)if(!Number.isFinite(W[k]))throw new Error('mlp: non-finite weight');
   for(let k=0;k<b.length;k++)if(!Number.isFinite(b[k]))throw new Error('mlp: non-finite bias');
   this.layers.push({width,units,act:ACT[L.activation],W,b});
   width=units;
  }
  if((spec.output|0)!==width)throw new Error('mlp: output width mismatch');
  this.input=spec.input|0;this.output=width;
  // Two scratch buffers, ping-ponged per layer; no per-call allocation.
  this.a=new Float32Array(Math.max(this.input,...this.layers.map(l=>l.units)));
  this.s=new Float32Array(this.a.length);
 }
 forward(input,out){
  if(input.length!==this.input)throw new Error('mlp: input length '+this.input+' expected');
  let src=this.a,dst=this.s;
  src.set(input);
  for(const {width,units,act,W,b} of this.layers){
   for(let j=0;j<units;j++){
    let sum=b[j];                                  // f64 accumulation over f32 operands
    for(let i=0;i<width;i++)sum+=src[i]*W[i*units+j];
    dst[j]=act(sum);
   }
   const t=src;src=dst;dst=t;
  }
  out=out||new Float32Array(this.output);
  for(let j=0;j<this.output;j++)out[j]=src[j];
  return out;
 }
}
export function loadMLP(json){return new MLP(typeof json==='string'?JSON.parse(json):json)}
