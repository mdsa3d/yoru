// OpenAI-ES (antithetic evolution strategies, Salimans et al. 2017) for the B5 trainer.
// Chosen over PPO because the reward path runs through impact()/scraping — discontinuous,
// non-differentiable events — and a hand-rolled PPO (backprop, GAE, clipping) in dependency-
// free JS is far easier to get subtly wrong than a black-box gradient estimate. ES needs only
// forward passes, parallelises rollout-for-rollout across worker_threads, tolerates the tier
// wrapper's action noise/delay as part of the dynamics, and is deterministic given a seed.
// Pure module: no I/O, no sim imports beyond the shared PRNG, so it unit-tests in milliseconds.
import {mulberry32} from '../../src/sim.js';
// Centered ranks in [-0.5, 0.5]: fitnesses are replaced by their rank position, which makes
// the update invariant to monotone fitness transforms (OpenAI-ES fitness shaping).
export function centeredRanks(fitnesses){
 const n=fitnesses.length,order=Array.from({length:n},(_,i)=>i).sort((a,b)=>fitnesses[a]-fitnesses[b]);
 const shaped=new Float64Array(n);
 for(let r=0;r<n;r++)shaped[order[r]]=n>1?r/(n-1)-.5:0;
 return shaped;
}
export function createES({dim,pop=16,sigma=.02,lr=.01,seed=1,weightDecay=0,theta0=null}={}){
 if(!(dim>0))throw new Error('es: dim must be positive');
 if(pop<2||pop%2)throw new Error('es: pop must be a positive even number (antithetic pairs)');
 if(!(sigma>0&&lr>0))throw new Error('es: sigma/lr must be positive');
 const es={dim,pop,sigma,lr,weightDecay,gen:0,theta:theta0?Float64Array.from(theta0):new Float64Array(dim),
  m:new Float64Array(dim),v:new Float64Array(dim),rng:mulberry32(seed),spare:null,eps:[]};
 if(es.theta.length!==dim)throw new Error('es: theta0 length mismatch');
 return es;
}
function gaussian(es){
 if(es.spare!==null){const s=es.spare;es.spare=null;return s}
 let u=0;while(u===0)u=es.rng();
 const r=Math.sqrt(-2*Math.log(u)),t=2*Math.PI*es.rng();
 es.spare=r*Math.sin(t);return r*Math.cos(t);
}
// ask() materialises one candidate per population slot. Even/odd slots are antithetic pairs
// sharing eps[slot>>1]; the returned theta copy is what a worker should evaluate.
export function ask(es){
 const pairs=es.pop/2;
 es.eps=Array.from({length:pairs},()=>Float64Array.from({length:es.dim},()=>gaussian(es)));
 const out=new Array(es.pop);
 for(let i=0;i<es.pop;i++){
  const sign=i%2===0?1:-1,eps=es.eps[i>>1],theta=new Float32Array(es.dim);
  for(let j=0;j<es.dim;j++)theta[j]=es.theta[j]+sign*es.sigma*eps[j];
  out[i]={theta,sign,pair:i>>1};
 }
 return out;
}
// tell() consumes one fitness per asked candidate (same order) and Adam-ascends the
// rank-shaped, antithetic gradient estimate: g = Σ shaped_i * sign_i * eps_i / (pop * sigma).
export function tell(es,fitnesses){
 if(!Array.isArray(fitnesses)||fitnesses.length!==es.pop)throw new Error('es: tell needs '+es.pop+' fitnesses');
 for(const f of fitnesses)if(!Number.isFinite(f))throw new Error('es: non-finite fitness');
 const shaped=centeredRanks(fitnesses),g=new Float64Array(es.dim);
 for(let i=0;i<es.pop;i++){
  const c=shaped[i]*(i%2===0?1:-1),eps=es.eps[i>>1];
  for(let j=0;j<es.dim;j++)g[j]+=c*eps[j];
 }
 const scale=1/(es.pop*es.sigma);
 es.gen++;
 const b1=.9,b2=.999,epsA=1e-8;let gradNorm=0;
 for(let j=0;j<es.dim;j++){
  const gj=g[j]*scale-es.weightDecay*es.theta[j];
  gradNorm+=gj*gj;
  es.m[j]=b1*es.m[j]+(1-b1)*gj;
  es.v[j]=b2*es.v[j]+(1-b2)*gj*gj;
  es.theta[j]+=es.lr*(es.m[j]/(1-Math.pow(b1,es.gen)))/(Math.sqrt(es.v[j]/(1-Math.pow(b2,es.gen)))+epsA);
 }
 es.eps=[];
 return {gen:es.gen,gradNorm:Math.sqrt(gradNorm)};
}
// Checkpoint round-trip (JSON-safe); resume restores theta and Adam moments exactly.
export function esSnapshot(es){return {gen:es.gen,theta:[...es.theta],m:[...es.m],v:[...es.v]}}
export function esRestore(es,snap){
 if(!snap||!Array.isArray(snap.theta)||snap.theta.length!==es.dim)throw new Error('es: bad snapshot');
 es.theta.set(snap.theta);if(Array.isArray(snap.m))es.m.set(snap.m);if(Array.isArray(snap.v))es.v.set(snap.v);es.gen=snap.gen|0;
 return es;
}
