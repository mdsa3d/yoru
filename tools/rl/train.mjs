// B5 RL trainer (UPLIFT-PLAN): OpenAI-ES against the actual JS headless sim, parallelised
// over worker_threads. Dependency-free Node. Deterministic given --seed.
//
//   node tools/rl/train.mjs [options]
//     --generations N     ES generations (default 60)
//     --pop N             population, even (default 16 = 8 antithetic pairs)
//     --episodes N        episode seeds per candidate per generation (default 2)
//     --sigma F           perturbation scale (default 0.02)
//     --lr F              Adam learning rate (default 0.01)
//     --hidden a b        hidden layer widths (default 128 128; e.g. --hidden 64 64)
//     --tier NAME         training tier: rookie|pro|elite|all (default pro; noise+delay
//                         apply exactly as in play via makeTierPolicy). 'all' (3.20.0)
//                         evaluates every candidate at ALL THREE tiers and averages —
//                         the shipped gate is one net passing every tier, so single-tier
//                         refinement overfits that tier's noise/delay.
//     --seed N            master seed (default 1). Training episode seeds derive from it;
//                         held-out eval seeds come from a disjoint range.
//     --max-seconds F     episode cap in sim seconds (default 45)
//     --workers N         worker_threads (default: cpus-1, capped by pop/2)
//     --init PATH         warm start from a neon-rash-mlp@1 JSON (e.g.
//                         assets/ai/rival-policy-bc.json). Optional: a missing file warns
//                         and falls back to seeded random init.
//     --self-play         drive the player with a frozen copy of the policy, refreshed
//                         every --self-play-refresh generations (default 25)
//     --resume PATH       resume from out/checkpoint.json
//     --minutes F         wall-clock budget; stops after the current generation (default none)
//     --eval-episodes N   held-out seeds for the final eval (default 12)
//     --out DIR           output directory (default tools/rl/out)
//
// Outputs (tools/rl/out/ — NEVER assets/ai; promotion is a human decision):
//   rival-policy-rl.json   neon-rash-mlp@1 weights of the final ES mean, with meta
//   checkpoint.json        latest resumable state (theta + Adam moments + config + curve)
//   curve.jsonl            one JSON line per generation (the true learning curve)
//   eval.json              held-out evaluation of the trained mean vs the heuristic baseline
import {Worker} from 'node:worker_threads';
import {cpus} from 'node:os';
import {existsSync,readFileSync,writeFileSync,appendFileSync,mkdirSync} from 'node:fs';
import {join} from 'node:path';
import {performance} from 'node:perf_hooks';
import {createES,ask,tell,esSnapshot,esRestore} from './es.js';
import {initTheta,thetaToSpec,specToTheta,loadSpec,saveSpec,layerDims,countParams,shapeOfSpec} from './params.js';
import {evaluate,DEFAULT_SETUP} from './env.js';
import {REWARD_WEIGHTS} from './reward.js';
import {OBS_WIDTH} from '../../src/obs.js';
function parseArgs(argv){
 const o={generations:60,pop:16,episodes:2,sigma:.02,lr:.01,hidden:[128,128],tier:'pro',seed:1,maxSeconds:45,
  workers:0,init:null,selfPlay:false,selfPlayRefresh:25,resume:null,minutes:0,evalEpisodes:12,out:new URL('./out/',import.meta.url).pathname};
 for(let i=2;i<argv.length;i++){
  const a=argv[i];
  if(a==='--self-play')o.selfPlay=true;
  else if(a==='--hidden'){o.hidden=[];while(argv[i+1]&&!argv[i+1].startsWith('--'))o.hidden.push(Number(argv[++i]))}
  else{
   const k=a.replace(/^--/,'').replace(/-([a-z])/g,(_,c)=>c.toUpperCase()),v=argv[++i];
   if(['init','tier','resume','out'].includes(k))o[k]=v;else o[k]=Number(v);
  }
 }
 if(!o.hidden.length)o.hidden=[128,128];
 return o;
}
// Training episode seeds: deterministic in (masterSeed, generation, episodeSlot).
// Held-out seeds live at HELD_OUT_BASE + i — a disjoint range, never trained on.
const HELD_OUT_BASE=77000000;
const episodeSeed=(master,gen,slot)=>master*100003+gen*64+slot;
async function main(){
 const cfg=parseArgs(process.argv);
 mkdirSync(cfg.out,{recursive:true});
 const dims=layerDims(OBS_WIDTH,cfg.hidden,3),dim=countParams(dims);
 let theta0,initLabel='seeded random init';
 if(cfg.resume){
  const ck=JSON.parse(readFileSync(cfg.resume,'utf8'));theta0=Float64Array.from(ck.theta);initLabel='resumed '+cfg.resume+' @ gen '+ck.gen;
 }else if(cfg.init){
  if(existsSync(cfg.init)){
   const spec=loadSpec(cfg.init),shape=shapeOfSpec(spec);
   if(shape.input!==OBS_WIDTH)throw new Error('init input '+shape.input+' != obs width '+OBS_WIDTH+' (v1 40-wide policies need retraining on the v2 schema)');
   if(JSON.stringify(shape.hidden)!==JSON.stringify(cfg.hidden))throw new Error('init hidden '+shape.hidden+' != --hidden '+cfg.hidden);
   theta0=specToTheta(spec);initLabel='warm start '+cfg.init;
  }else{console.warn(`warn: --init ${cfg.init} not found; falling back to seeded random init`)}
 }
 theta0=theta0||initTheta({input:OBS_WIDTH,hidden:cfg.hidden,output:3,seed:cfg.seed});
 const es=createES({dim,pop:cfg.pop,sigma:cfg.sigma,lr:cfg.lr,seed:cfg.seed,theta0});
 let curve=[];
 if(cfg.resume){
  const ck=JSON.parse(readFileSync(cfg.resume,'utf8'));esRestore(es,ck);curve=ck.curve||[];
 }
 const tiers=cfg.tier==='all'?['rookie','pro','elite']:[cfg.tier];
 for(const t of tiers)if(!['rookie','pro','elite'].includes(t))throw new Error('unknown tier '+t);
 const nWorkers=cfg.workers||Math.max(1,Math.min(cpus().length-1,cfg.pop));
 const workers=Array.from({length:nWorkers},()=>new Worker(new URL('./worker.mjs',import.meta.url),
  {workerData:{setup:DEFAULT_SETUP,tiers,maxSeconds:cfg.maxSeconds,hidden:cfg.hidden}}));
 console.log(`rl train: openai-es dim=${dim} pop=${cfg.pop} episodes=${cfg.episodes} sigma=${cfg.sigma} lr=${cfg.lr} tiers=${tiers.join('+')} workers=${nWorkers}`);
 console.log(`init: ${initLabel}${cfg.selfPlay?`; self-play refresh every ${cfg.selfPlayRefresh} gens`:''}`);
 const curvePath=join(cfg.out,'curve.jsonl');
 if(!cfg.resume)writeFileSync(curvePath,'');
 let frozenSelfPlay=null,best=-Infinity,stepsTotal=0;
 const t0=performance.now();
 const runBatch=(cands,seeds,selfPlay)=>new Promise((resolve,reject)=>{
  const per=Math.ceil(cands.length/nWorkers),results=new Array(cands.length);
  let pending=0,failed=false;
  for(let w=0;w<nWorkers;w++){
   const slice=cands.slice(w*per,(w+1)*per).map(c=>({theta:c.theta.buffer.slice(0)}));
   if(!slice.length)continue;
   pending++;
   const onErr=e=>{if(!failed){failed=true;reject(e)}};
   const onMsg=msg=>{
    workers[w].off('message',onMsg);workers[w].off('error',onErr);
    msg.results.forEach((r,k)=>results[w*per+k]=r);
    if(--pending===0&&!failed)resolve(results);
   };
   workers[w].on('message',onMsg);
   workers[w].once('error',onErr);
   workers[w].postMessage({job:es.gen,candidates:slice,seeds,selfPlay:selfPlay?selfPlay.buffer.slice(0):null});
  }
  if(!pending)resolve(results);
 });
 for(let g=es.gen;g<cfg.generations;g++){
  if(cfg.selfPlay&&g%cfg.selfPlayRefresh===0)frozenSelfPlay=Float32Array.from(es.theta);
  const cands=ask(es);
  const seeds=Array.from({length:cfg.episodes},(_,e)=>episodeSeed(cfg.seed,g,e));
  const results=await runBatch(cands,seeds,frozenSelfPlay);
  const fits=results.map(r=>r.fitness);
  const {gradNorm}=tell(es,fits);
  const mean=fits.reduce((a,b)=>a+b,0)/fits.length,hi=Math.max(...fits);
  best=Math.max(best,hi);
  const m=results[fits.indexOf(hi)].metrics;
  stepsTotal+=results.reduce((a,r)=>a+r.metrics.steps,0);
  const row={gen:g,mean,best:hi,gradNorm,rivalS:m.rivalS,playerS:m.playerS,beatPlayer:m.beatPlayer,
   contacts:m.contacts,collisions:m.collisions,strikes:m.strikes,offRoadFrac:m.offRoadFrac};
  curve.push(row);
  appendFileSync(curvePath,JSON.stringify(row)+'\n');
  console.log(`gen ${String(g).padStart(3)} | fit ${mean.toFixed(2).padStart(8)} (best ${hi.toFixed(2)}) | rival s ${m.rivalS.toFixed(0)} vs player ${m.playerS.toFixed(0)} | win ${(m.beatPlayer*100).toFixed(0)}% | contact ${m.contacts.toFixed(1)} coll ${m.collisions.toFixed(1)} offroad ${(m.offRoadFrac*100).toFixed(1)}%`);
  if((g+1)%10===0||g===cfg.generations-1){
   writeFileSync(join(cfg.out,'checkpoint.json'),JSON.stringify({...esSnapshot(es),config:cfg,curve}));
  }
  if(cfg.minutes&&(performance.now()-t0)/60000>=cfg.minutes){console.log(`time budget ${cfg.minutes} min reached at gen ${g}`);break}
 }
 const elapsed=(performance.now()-t0)/1000;
 const stepsPerSec=Math.round(stepsTotal/elapsed);
 // Held-out evaluation: trained mean vs heuristic baseline on seeds never trained on.
 const heldOut=Array.from({length:cfg.evalEpisodes},(_,i)=>HELD_OUT_BASE+i);
 const trainedSpec=thetaToSpec(Float32Array.from(es.theta),{input:OBS_WIDTH,hidden:cfg.hidden,output:3});
 const trained=evaluate(trainedSpec,heldOut,{setup:DEFAULT_SETUP,tiers,maxSeconds:cfg.maxSeconds});
 const baseline=evaluate(null,heldOut,{setup:DEFAULT_SETUP,tiers,maxSeconds:cfg.maxSeconds});
 const perTier=tiers.length>1?Object.fromEntries(tiers.map(t=>[t,{
  trained:evaluate(trainedSpec,heldOut,{setup:DEFAULT_SETUP,tier:t,maxSeconds:cfg.maxSeconds}).fitness,
  baseline:evaluate(null,heldOut,{setup:DEFAULT_SETUP,tier:t,maxSeconds:cfg.maxSeconds}).fitness}])):undefined;
 const evalReport={heldOutSeeds:heldOut,tiers,trained:{fitness:trained.fitness,metrics:trained.metrics},
  baseline:{fitness:baseline.fitness,metrics:baseline.metrics},perTier,
  stepsPerSec,elapsedSeconds:Math.round(elapsed),generations:es.gen};
 writeFileSync(join(cfg.out,'eval.json'),JSON.stringify(evalReport,null,1));
 trainedSpec.meta={label:'RL (OpenAI-ES) rival policy — see tools/rl/README.md; exported to tools/rl/out only, NOT promoted to assets/ai',
  algorithm:'openai-es',rewardWeights:REWARD_WEIGHTS,
  trained:{generations:es.gen,seed:cfg.seed,tier:cfg.tier,episodes:cfg.episodes,pop:cfg.pop,sigma:cfg.sigma,lr:cfg.lr,stepsPerSec},
  heldOut:{fitness:trained.fitness,beatPlayer:trained.metrics.beatPlayer,rivalS:trained.metrics.rivalS},
  baseline:{fitness:baseline.fitness,beatPlayer:baseline.metrics.beatPlayer,rivalS:baseline.metrics.rivalS}};
 saveSpec(join(cfg.out,'rival-policy-rl.json'),trainedSpec);
 writeFileSync(join(cfg.out,'checkpoint.json'),JSON.stringify({...esSnapshot(es),config:cfg,curve}));
 console.log(`done: ${es.gen} gens in ${Math.round(elapsed)} s · ${stepsPerSec.toLocaleString('en-US')} sim steps/s`);
 console.log(`held-out (${cfg.evalEpisodes} seeds): trained fit ${trained.fitness.toFixed(2)} win ${(trained.metrics.beatPlayer*100).toFixed(0)}% s=${trained.metrics.rivalS.toFixed(0)} | baseline fit ${baseline.fitness.toFixed(2)} win ${(baseline.metrics.beatPlayer*100).toFixed(0)}% s=${baseline.metrics.rivalS.toFixed(0)}`);
 for(const w of workers)w.terminate();
}
main().catch(e=>{console.error(e);process.exit(1)});
