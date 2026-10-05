// Parameter packing for the B5 trainer: flat Float32Array theta <-> neon-rash-mlp@1 spec
// (the JSON format src/mlp.js loads). Packing order is per layer, W then b, layers in order;
// W is row-major W[i*units+j] exactly as mlp.js expects (x @ W + b). Pure logic + fs helpers.
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {dirname} from 'node:path';
import {mulberry32} from '../../src/sim.js';
import {OBS_WIDTH,OBS_V1_WIDTH} from '../../src/obs.js';
import {MLP_FORMATS} from '../../src/mlp.js';
export function layerDims(input=OBS_WIDTH,hidden=[128,128],output=3){
 if(!(input>0&&output>0))throw new Error('params: input/output widths must be positive');
 if(!Array.isArray(hidden)||!hidden.length||hidden.some(h=>!(h>0)))throw new Error('params: hidden must be non-empty positive widths');
 return [input,...hidden.map(h=>h|0),output];
}
export function countParams(dims){let n=0;for(let l=1;l<dims.length;l++)n+=dims[l-1]*dims[l]+dims[l];return n}
// Seeded Xavier-uniform init; hidden tanh, output identity (range clamps live in tiers.js).
// The output bias defaults to [0,1,-1] (steer neutral, throttle on, brake off): a zero-bias
// random init thresholds to "coast" almost everywhere (driveNet fires throttle only above
// 0.5), which leaves ES on a flat zero-fitness plateau — starting from a moving agent gives
// the gradient estimate something to work with. Warm starts override this entirely.
export function initTheta({input=OBS_WIDTH,hidden=[128,128],output=3,seed=1,outBias=[0,1,-1]}={}){
 const dims=layerDims(input,hidden,output),theta=new Float32Array(countParams(dims)),rng=mulberry32(seed);
 let o=0;
 for(let l=1;l<dims.length;l++){
  const limit=Math.sqrt(6/(dims[l-1]+dims[l])),n=dims[l-1]*dims[l];
  for(let k=0;k<n;k++)theta[o++]=(rng()*2-1)*limit;
  for(let k=0;k<dims[l];k++)theta[o++]=(l===dims.length-1&&outBias[k]!=null)?outBias[k]:0;
 }
 return theta;
}
// The format tag follows the obs schema the width implies: v1 width 40 -> @1, else @2.
export function thetaToSpec(theta,{input=OBS_WIDTH,hidden=[128,128],output=3,format=null,meta}={}){
 const dims=layerDims(input,hidden,output);
 if(theta.length!==countParams(dims))throw new Error('params: theta length '+theta.length+', expected '+countParams(dims));
 const layers=[];let o=0;
 for(let l=1;l<dims.length;l++){
  const width=dims[l-1],units=dims[l],n=width*units;
  const W=Array.from(theta.slice(o,o+n),Math.fround);o+=n;
  const b=Array.from(theta.slice(o,o+units),Math.fround);o+=units;
  layers.push({units,activation:l<dims.length-1?'tanh':'identity',W,b});
 }
 const spec={format:format||(dims[0]===OBS_V1_WIDTH?'neon-rash-mlp@1':'neon-rash-mlp@2'),input:dims[0],output:dims[dims.length-1],layers};
 if(meta)spec.meta=meta;
 return spec;
}
export function specToTheta(spec){
 if(!spec||!MLP_FORMATS.includes(spec.format))throw new Error('params: bad or missing format tag');
 const dims=[spec.input|0,...spec.layers.map(l=>l.units|0)],theta=new Float32Array(countParams(dims));
 let o=0;
 for(const L of spec.layers){
  for(const v of L.W)theta[o++]=v;
  for(const v of L.b)theta[o++]=v;
 }
 return theta;
}
export function shapeOfSpec(spec){return {input:spec.input|0,hidden:spec.layers.slice(0,-1).map(l=>l.units|0),output:spec.output|0}}
export function loadSpec(path){
 const spec=JSON.parse(readFileSync(path,'utf8'));
 if(!spec||!MLP_FORMATS.includes(spec.format))throw new Error('params: '+path+' is not neon-rash-mlp@1/@2');
 return spec;
}
export function saveSpec(path,spec){
 mkdirSync(dirname(path),{recursive:true});
 writeFileSync(path,JSON.stringify(spec));
 return path;
}
