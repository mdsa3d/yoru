import {describe,it} from 'node:test';
import assert from 'node:assert/strict';
import {WORLDS,getWorld} from '../src/world-data.js';
import {ditherPalette,bayer8} from '../src/world.js';
// Render-side wiring (composer pass order, FXAA enablement, uniforms) needs a WebGL context and stays
// untested in Node per CLAUDE.md's visual/render exception; only the pure palette/Bayer helpers are covered here.
describe('dither palette (UPLIFT-PLAN A3)',()=>{
 it('builds 8 rgb triplets in [0,1] from world-data colours for every world',()=>{
  assert.equal(WORLDS.length,4);
  for(const w of WORLDS){const p=ditherPalette(w);assert.equal(p.length,8);for(const rgb of p){assert.equal(rgb.length,3);for(const c of rgb){assert.ok(c>=0&&c<=1);assert.ok(Number.isFinite(c))}}}
 });
 it('parses hex exactly (akuma accent #63f2eb)',()=>{
  const p=ditherPalette(getWorld('akuma'));
  assert.deepEqual(p[4],[0x63/255,0xf2/255,0xeb/255]);
 });
 it('uses the world-data field order sky/skyBottom/fog/sun/accent/secondary/road/terrain',()=>{
  const w=getWorld('solstice');
  const hex=h=>{const n=parseInt(h.slice(1),16);return [((n>>16)&255)/255,((n>>8)&255)/255,(n&255)/255]};
  assert.deepEqual(ditherPalette(w),[w.skyTop,w.skyBottom,w.fog,w.sun,w.accent,w.secondary,w.road,w.terrain].map(hex));
 });
});
describe('bayer8 ordered threshold',()=>{
 it('produces 64 distinct multiples of 1/64 in [0,1) over the 8x8 tile',()=>{
  const seen=new Set();
  for(let y=0;y<8;y++)for(let x=0;x<8;x++){const v=bayer8(x,y);assert.ok(v>=0&&v<1);assert.ok(Math.abs(v*64-Math.round(v*64))<1e-9);seen.add(Math.round(v*64))}
  assert.equal(seen.size,64);
 });
 it('matches the classic Bayer 8x8 first row',()=>{
  assert.deepEqual([...Array(8)].map((_,x)=>bayer8(x,0)),[0,32,8,40,2,34,10,42].map(v=>v/64));
 });
 it('is stateless and deterministic',()=>{
  for(let i=0;i<3;i++)assert.equal(bayer8(5,3),bayer8(5,3));
 });
});
