export const WORLDS = [
  {id:'akuma',name:'AKUMA / RAIN CITY',short:'AKUMA',tag:'01 / VERTICAL METROPOLIS',description:'Rain-slick expressways. Layered towers. The sky is another street.',kind:'city',skyTop:'#071225',skyBottom:'#364654',fog:'#203847',fogDensity:.0028,sun:'#a6e4ff',sunPower:.8,sunY:.24,ambient:.70,accent:'#63f2eb',secondary:'#ff6592',road:'#343d46',terrain:'#182329',weather:'rain',time:'02:47',temperature:'18°C',sky:{cover:.30,bands:.5,disc:.4,halo:.15,haze:.6,cloudScale:1.8},headlight:{intensity:420,distance:110,angle:.46,penumbra:.55,decay:2},musicRoot:55,grade:{lift:[0,.01,.03],gain:[.98,1,1.06],sat:1.12}},
  {id:'solstice',name:'SOLSTICE / BADLANDS',short:'SOLSTICE',tag:'02 / DESERT MEGASTRUCTURE',description:'Sun-worn concrete, copper cliffs and a ring built for a forgotten god.',kind:'desert',skyTop:'#38566f',skyBottom:'#eac096',fog:'#d2a389',fogDensity:.0015,sun:'#fff0c9',sunPower:3.2,sunY:.17,ambient:1.1,accent:'#76fff0',secondary:'#ffd294',road:'#73736c',terrain:'#a87450',weather:'dry',time:'18:12',temperature:'34°C',sky:{cover:.58,bands:.9,disc:1,halo:.55,haze:.8,cloudScale:1.1},headlight:{intensity:130,distance:95,angle:.42,penumbra:.45,decay:2},musicRoot:48.999,grade:{lift:[.03,.01,0],gain:[1.06,1,.92],sat:1.05}},
  {id:'pelagic',name:'PELAGIC / OCEAN ARRAY',short:'PELAGIC',tag:'03 / OPEN WATER',description:'A suspended causeway across an endless sea. Fly beneath the cloud line.',kind:'ocean',skyTop:'#365b82',skyBottom:'#b7d5df',fog:'#9fbed0',fogDensity:.00135,sun:'#fff9e6',sunPower:2.8,sunY:.48,ambient:1.2,accent:'#8dfff1',secondary:'#ffb172',road:'#62767c',terrain:'#204956',weather:'dry',time:'07:08',temperature:'23°C',sky:{cover:.42,bands:.6,disc:.9,halo:.4,haze:.55,cloudScale:2.4},headlight:{intensity:150,distance:100,angle:.44,penumbra:.5,decay:2},musicRoot:65.406,grade:{lift:[0,.02,.02],gain:[.97,1.02,1.04],sat:.96}},
  {id:'elysium',name:'ELYSIUM / FROZEN REACH',short:'ELYSIUM',tag:'04 / ALPINE FRONTIER',description:'Blue-hour ice, sharp ridgelines and an aurora over the last outpost.',kind:'alpine',skyTop:'#111c3c',skyBottom:'#8fadc6',fog:'#869fac',fogDensity:.0017,sun:'#a5caff',sunPower:1.8,sunY:.12,ambient:1.1,accent:'#79ffdf',secondary:'#ad9eff',road:'#64747e',terrain:'#bfcfd5',weather:'dry',time:'05:31',temperature:'−9°C',sky:{cover:.5,bands:.25,disc:.6,halo:.25,haze:.3,cloudScale:1.5},headlight:{intensity:260,distance:105,angle:.45,penumbra:.6,decay:2},musicRoot:43.654,grade:{lift:[.01,.01,.04],gain:[.95,.99,1.08],sat:.88}}
];
export function getWorld(id){return WORLDS.find(w=>w.id===id)||WORLDS[0]}
export function flightPath(s){return {x:10*Math.sin(s/270),y:27+10*Math.sin(s/185)+4*Math.sin(s/83)}}
export function nextGate(index){const s=180+index*190;return {s,...flightPath(s),radius:7}}
// Solid pylons are shared between rendering and collision checks.
export function pylon(index){return {s:340+index*470,x:index%2?16:-16,y:19,width:5,height:38,depth:7}}
export function random(seed){const x=Math.sin(seed*127.1+311.7)*43758.5453123;return x-Math.floor(x)}

export function skybridge(s,world){if(world!=='akuma')return null;const n=Math.round(s/32),i=((n%72)+72)%72;if(i%6!==0)return null;return {s:n*32,x:-27,y:52,width:18,height:2,depth:4};}

// G4: GLSL smoothstep reference, used by the spot/sky helpers below and their tests.
export function smoothstepJS(a,b,x){const t=Math.min(1,Math.max(0,(x-a)/(b-a)));return t*t*(3-2*t)}
// G4: per-world procedural-sky tuning for the PMREM sky shader (environment.js makeSky). cover = fbm cloud
// threshold (lower = more clouds), bands = horizon gradient-band amplitude, disc/halo = sun disc and wide
// glow strength, haze = horizon haze mix, cloudScale = cloud UV scale. Per-kind defaults; world.sky overrides win.
const SKY_DEFAULTS={city:{cover:.30,bands:.5,disc:.4,halo:.15,haze:.6,cloudScale:1.8},desert:{cover:.58,bands:.9,disc:1,halo:.55,haze:.8,cloudScale:1.1},ocean:{cover:.42,bands:.6,disc:.9,halo:.4,haze:.55,cloudScale:2.4},alpine:{cover:.5,bands:.25,disc:.6,halo:.25,haze:.3,cloudScale:1.5}};
export function skyParams(w){return {...(SKY_DEFAULTS[w.kind]||SKY_DEFAULTS.ocean),...(w.sky||{})}}
// G6: per-world physical headlight settings (three.js punctual spotlight: decay 2 = inverse square, smooth
// cosine penumbra). Per-kind defaults; world.headlight overrides win. Akuma keeps the legacy 420 intensity.
const HEADLIGHT_DEFAULTS={city:{intensity:420,distance:110,angle:.46,penumbra:.55,decay:2},desert:{intensity:130,distance:95,angle:.42,penumbra:.45,decay:2},ocean:{intensity:150,distance:100,angle:.44,penumbra:.5,decay:2},alpine:{intensity:260,distance:105,angle:.45,penumbra:.6,decay:2}};
export function headlightParams(w){return {...(HEADLIGHT_DEFAULTS[w.kind]||HEADLIGHT_DEFAULTS.desert),...(w.headlight||{})}}
// G6: JS reference of three.js SpotLight attenuation — distance term (inverse-square decay with the r155+
// punctual cutoff window) times the cosine smoothstep penumbra term. Pure, for tests and tuning tools.
export function spotAttenuation(d,theta,hp){if(d<=0||hp.distance>0&&d>=hp.distance)return 0;const dist=Math.pow(Math.max(d,1e-4),-hp.decay)*(hp.distance>0?Math.pow(Math.max(0,1-Math.pow(d/hp.distance,4)),2):1);return dist*smoothstepJS(Math.cos(hp.angle),Math.cos(hp.angle*(1-hp.penumbra)),Math.cos(theta))}

// G2: sun-follow shadow-frustum re-fit (the UPLIFT-PLAN G2 alternative to the CSM addon — CSM was evaluated
// and rejected: CSM.setupMaterial clobbers material.onBeforeCompile, which conflicts with the ialpha/psize
// attribute patches in world.js, and its per-cascade lights bypass setShadowQuality's adaptive map sizing).
// Fits the sun's orthographic shadow camera to the camera frustum slice [near,range] in light space, so the
// 2048² map covers the road the player is actually looking at instead of a fixed ±28 m box. Pure vector
// math on plain arrays (no three import), unit-tested in Node.
export function fitSunShadow({pos,forward,fov,aspect,near=2,range=110,lightDir,pad=6}){
 const dot=(a,b)=>a[0]*b[0]+a[1]*b[1]+a[2]*b[2],cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]],norm=v=>{const l=Math.hypot(v[0],v[1],v[2])||1;return[v[0]/l,v[1]/l,v[2]/l]};
 const f=norm(forward),za=norm([-lightDir[0],-lightDir[1],-lightDir[2]]);
 const right=norm(cross(f,[0,1,0])),cup=cross(right,f);
 let xa=cross([0,1,0],za);xa=Math.hypot(...xa)>1e-6?norm(xa):[1,0,0];const ya=cross(za,xa);
 let lx0=1/0,ly0=1/0,lz0=1/0,lx1=-1/0,ly1=-1/0,lz1=-1/0;const tan=Math.tan(fov*Math.PI/360);
 for(const d of[near,range]){const hh=tan*d,hw=hh*aspect;for(const sx of[-1,1])for(const sy of[-1,1]){
  const p=[pos[0]+f[0]*d+right[0]*sx*hw+cup[0]*sy*hh,pos[1]+f[1]*d+right[1]*sx*hw+cup[1]*sy*hh,pos[2]+f[2]*d+right[2]*sx*hw+cup[2]*sy*hh];
  const lx=dot(p,xa),ly=dot(p,ya),lz=dot(p,za);if(lx<lx0)lx0=lx;if(lx>lx1)lx1=lx;if(ly<ly0)ly0=ly;if(ly>ly1)ly1=ly;if(lz<lz0)lz0=lz;if(lz>lz1)lz1=lz}}
 lx0-=pad;lx1+=pad;ly0-=pad;ly1+=pad;const cx=(lx0+lx1)/2,cy=(ly0+ly1)/2,depth=lz1-lz0;
 const target=[xa[0]*cx+ya[0]*cy+za[0]*lz0,xa[1]*cx+ya[1]*cy+za[1]*lz0,xa[2]*cx+ya[2]*cy+za[2]*lz0];
 const L=norm(lightDir),D=depth+1,position=[target[0]-L[0]*D,target[1]-L[1]*D,target[2]-L[2]*D];
 return {left:lx0,right:lx1,bottom:ly0,top:ly1,near:1,far:depth+1,target,position};
}
