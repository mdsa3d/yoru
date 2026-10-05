// Rollout worker for the B5 trainer. The main thread (train.mjs) sends a batch of candidate
// weight vectors plus the episode seeds for the generation; each worker rebuilds the MLP spec
// and evaluates it in the real JS sim (env.js). Common random numbers: every candidate in a
// generation sees the same seed list, which shrinks the ES gradient variance.
// Protocol: workerData = {setup, tiers, maxSeconds, hidden}
//   in : {job, candidates:[{theta: ArrayBuffer}], seeds: [int], selfPlay: ArrayBuffer|null}
//   out: {job, results: [{fitness, metrics}]}
import {workerData,parentPort} from 'node:worker_threads';
import {thetaToSpec,layerDims,countParams} from './params.js';
import {evaluate} from './env.js';
import {OBS_WIDTH} from '../../src/obs.js';
const shape={input:OBS_WIDTH,hidden:workerData.hidden,output:3};
const nParams=countParams(layerDims(shape.input,shape.hidden,shape.output));
parentPort.on('message',msg=>{
 const selfPlay=msg.selfPlay?thetaToSpec(new Float32Array(msg.selfPlay),shape):null;
 const results=msg.candidates.map(c=>{
  const theta=new Float32Array(c.theta);
  if(theta.length!==nParams)throw new Error('worker: theta size mismatch');
  const spec=thetaToSpec(theta,shape);
  return evaluate(spec,msg.seeds,{setup:workerData.setup,tiers:workerData.tiers,maxSeconds:workerData.maxSeconds,selfPlay});
 });
 parentPort.postMessage({job:msg.job,results});
});
