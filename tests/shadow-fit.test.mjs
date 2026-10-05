import test from 'node:test';import assert from 'node:assert/strict';
import {fitSunShadow} from '../src/world-data.js';

// Re-derive the light-space basis exactly as world-data.js does, to verify the returned box actually
// contains the camera frustum slice it was fit to.
function basis(lightDir){const norm=v=>{const l=Math.hypot(...v)||1;return v.map(c=>c/l)};const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];const L=norm(lightDir),za=[-L[0],-L[1],-L[2]];let xa=cross([0,1,0],za);xa=Math.hypot(...xa)>1e-6?norm(xa):[1,0,0];return{xa,ya:cross(za,xa),za}}
const dot=(a,b)=>a[0]*b[0]+a[1]*b[1]+a[2]*b[2];
function corners({pos,forward,fov,aspect,near=2,range=110}){const norm=v=>{const l=Math.hypot(...v)||1;return v.map(c=>c/l)};const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];const f=norm(forward),r=norm(cross(f,[0,1,0])),u=cross(r,f),tan=Math.tan(fov*Math.PI/360),out=[];for(const d of[near,range]){const hh=tan*d,hw=hh*aspect;for(const sx of[-1,1])for(const sy of[-1,1])out.push([pos[0]+f[0]*d+r[0]*sx*hw+u[0]*sy*hh,pos[1]+f[1]*d+r[1]*sx*hw+u[1]*sy*hh,pos[2]+f[2]*d+r[2]*sx*hw+u[2]*sy*hh])}return out}

const AKUMA_SUN=[50,-(35+.24*50),-30]; // legacy akuma sun offset direction (world.js setWorld)
const CAM={pos:[3,4.2,7],forward:[.05,-.08,-1],fov:62,aspect:1.6,range:110,lightDir:AKUMA_SUN};

test('fit is deterministic and well-formed',()=>{
 const a=fitSunShadow(CAM);assert.deepEqual(a,fitSunShadow(CAM));
 assert.ok(a.left<a.right&&a.bottom<a.top&&a.near>0&&a.far>a.near);
 assert.ok(a.position.every(Number.isFinite)&&a.target.every(Number.isFinite));
 assert.notDeepEqual(a.position,a.target);
});
test('the fitted box contains every corner of the camera frustum slice in light space',()=>{
 const fit=fitSunShadow(CAM),{xa,ya,za}=basis(AKUMA_SUN),pz=dot(fit.position,za);
 for(const c of corners(CAM)){const lx=dot(c,xa),ly=dot(c,ya),lz=dot(c,za);
  assert.ok(lx>=fit.left-1e-9&&lx<=fit.right+1e-9,`lx ${lx}`);
  assert.ok(ly>=fit.bottom-1e-9&&ly<=fit.top+1e-9,`ly ${ly}`);
  const depth=pz-lz;assert.ok(depth>=fit.near-1e-9&&depth<=fit.far+1e-9,`depth ${depth}`)}
});
test('shadow range grows the box and pushes the target further along the view',()=>{
 const a=fitSunShadow({...CAM,range:60}),b=fitSunShadow({...CAM,range:180});
 assert.ok(b.right-b.left>=a.right-a.left-1e-9);assert.ok(b.far>=a.far);
 const ahead=(t,c)=>dot([t[0]-c.pos[0],t[1]-c.pos[1],t[2]-c.pos[2]],CAM.forward);
 assert.ok(ahead(a.target,CAM)>0&&ahead(b.target,CAM)>ahead(a.target,CAM));
});
test('degenerate-ish cameras stay finite (look down, level horizon, behind)',()=>{
 for(const forward of [[0,-1,0],[0,0,-1],[0,.3,1]]){const f=fitSunShadow({...CAM,forward});assert.ok(Number.isFinite(f.left+f.right+f.top+f.bottom+f.near+f.far));assert.ok(f.right-f.left>0&&f.top-f.bottom>0)}
});
