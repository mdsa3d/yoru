// G5: procedural detail-map generators — pure typed-array math, no DOM and no three.js import, so the
// generators are byte-deterministic and unit-testable in Node. environment.js wraps the returned arrays
// in THREE.DataTexture (mipmapped, RepeatWrapping). No external texture assets are used (no licensing,
// no ASSETS.md entry needed); KTX2 compression is skipped — the Basis transcoder ships as external
// WASM binaries, and generated DataTextures compress fine on the wire as they are created at runtime.
// All fields are tileable by construction: the value-noise lattice wraps at an integer cell period.

// Integer-lattice hash (mulberry-style), exact across platforms — no Math.sin precision dependence.
function hash2i(x,y,seed){let h=(Math.imul(x,374761393)+Math.imul(y,668265263)+Math.imul(seed,1442695041))|0;h=Math.imul(h^(h>>>13),1274126177);h^=h>>>16;return (h>>>0)/4294967296}
const smooth=t=>t*t*(3-2*t);
// Periodic value noise: x,y in lattice cells, wraps at `period` cells (integer ≥1).
export function valueNoise(x,y,period,seed){
 const ix=Math.floor(x),iy=Math.floor(y),fx=x-ix,fy=y-iy;
 const x0=((ix%period)+period)%period,x1=(x0+1)%period,y0=((iy%period)+period)%period,y1=(y0+1)%period;
 const a=hash2i(x0,y0,seed),b=hash2i(x1,y0,seed),c=hash2i(x0,y1,seed),d=hash2i(x1,y1,seed);
 const u=smooth(fx),v=smooth(fy);return a+(b-a)*u+(c-a)*v+(a-b-c+d)*u*v;
}
// Tileable fbm over [0,period)². Lacunarity is fixed at 2 so every octave keeps an integer wrap period.
export function fbm(x,y,{period=8,octaves=4,seed=1,gain=.5}={}){let amp=1,sum=0,norm=0,f=1;for(let o=0;o<octaves;o++){sum+=amp*valueNoise(x*f,y*f,Math.max(1,period*f|0),seed+o*101);norm+=amp;amp*=gain;f*=2}return sum/norm}
// Float32 heightfield, size×size, values in [0,1], tileable.
export function heightField(size,{period=12,octaves=4,seed=11}={}){const h=new Float32Array(size*size);for(let y=0;y<size;y++)for(let x=0;x<size;x++)h[y*size+x]=fbm(x/size*period,y/size*period,{period,octaves,seed});return h}
// Tangent-space normal map (RGBA bytes, wraps at edges) derived from a heightfield by central differences.
export function normalFromHeight(h,size,strength=2){const out=new Uint8Array(size*size*4);const at=(x,y)=>h[((y+size)%size)*size+((x+size)%size)];for(let y=0;y<size;y++)for(let x=0;x<size;x++){const dx=(at(x+1,y)-at(x-1,y))*strength,dy=(at(x,y+1)-at(x,y-1))*strength,l=Math.hypot(dx,dy,1),i=(y*size+x)*4;out[i]=Math.round((-dx/l*.5+.5)*255);out[i+1]=Math.round((dy/l*.5+.5)*255);out[i+2]=Math.round((1/l*.5+.5)*255);out[i+3]=255}return out}
// Roughness multiplier map (RGBA bytes, value replicated so the .g channel three.js samples is correct).
// Values centre on `base` (1 ⇒ the material's per-frame roughness uniform, e.g. the wet/dry swap, is preserved).
export function roughnessFromHeight(h,size,{base=1,amp=.3}={}){const out=new Uint8Array(size*size*4);for(let i=0;i<size*size;i++){const v=Math.max(0,Math.min(255,Math.round((base+(h[i]-.5)*2*amp)*255)));out[i*4]=out[i*4+1]=out[i*4+2]=v;out[i*4+3]=255}return out}
