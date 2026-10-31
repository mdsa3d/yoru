// Seeded, continuous scenery heightfield in world coordinates. The road stays authoritative.
import {road} from './physics.js';
const mix=(a,b,t)=>a+(b-a)*t,clamp=x=>Math.max(0,Math.min(1,x));
const smooth=x=>{const t=clamp(x);return t*t*(3-2*t)};
function hash(x,z,seed){let n=Math.imul(x,374761393)^Math.imul(z,668265263)^seed;n=Math.imul(n^(n>>>13),1274126177);return ((n^(n>>>16))>>>0)/4294967295}
function noise(x,z,seed){const ix=Math.floor(x),iz=Math.floor(z),u=smooth(x-ix),v=smooth(z-iz);return mix(mix(hash(ix,iz,seed),hash(ix+1,iz,seed),u),mix(hash(ix,iz+1,seed),hash(ix+1,iz+1,seed),u),v)}
export function terrainHeight(x,s,kind='desert'){
 const seed=kind==='alpine'?731:419,berth=Math.abs(x-road(s));
 const shoulder=smooth((berth-24)/95);if(!shoulder)return -10;
 let n=0,a=.56,f=.0032;for(let i=0;i<5;i++){n+=noise(x*f,s*f,seed+i*101)*a;a*=.5;f*=2.08}
 const ridge=1-Math.abs(noise(x*.005,s*.0028,seed+67)*2-1);
 let h=22+n*125+ridge*ridge*65;
 if(kind==='desert'){const t=h/17;h=(Math.floor(t)+smooth((t%1-.32)/.55))*17;h+=noise(x*.045,s*.03,seed+9)*3}
 else h=24+n*185+ridge*ridge*150;
 return -10+shoulder*h;
}
export function terrainSample(x,s,kind='desert'){
 const h=terrainHeight(x,s,kind),dx=(terrainHeight(x+2,s,kind)-terrainHeight(x-2,s,kind))/4,dz=(terrainHeight(x,s+2,kind)-terrainHeight(x,s-2,kind))/4;
 const steep=clamp(Math.hypot(dx,dz)/2),variation=.87+noise(x*.065,s*.065,227)*.13;
 const rock=kind==='alpine'?[.24,.30,.34]:[.38,.20,.115],sand=kind==='alpine'?[.55,.62,.66]:[.69,.43,.25];
 const snow=kind==='alpine'?smooth((h-120)/55)*(1-steep*.8):0;
 const length=Math.hypot(dx,1,dz);return {height:h,normal:[-dx/length,1/length,dz/length],color:sand.map((c,i)=>mix(mix(c,rock[i],steep),[.88,.94,.96][i],snow)*variation)};
}

export function terrainTint(x,s,kind='desert'){return terrainSample(x,s,kind).color}
