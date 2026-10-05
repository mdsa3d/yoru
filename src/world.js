import * as T from 'three';
import {EffectComposer} from 'three/addons/postprocessing/EffectComposer.js';
import {RenderPass} from 'three/addons/postprocessing/RenderPass.js';
import {UnrealBloomPass} from 'three/addons/postprocessing/UnrealBloomPass.js';
import {OutputPass} from 'three/addons/postprocessing/OutputPass.js';
import {ShaderPass} from 'three/addons/postprocessing/ShaderPass.js';
import {FXAAPass} from 'three/addons/postprocessing/FXAAPass.js';
import {GTAOPass} from 'three/addons/postprocessing/GTAOPass.js';
import {SSRPass} from 'three/addons/postprocessing/SSRPass.js';
import {RoomEnvironment} from 'three/addons/environments/RoomEnvironment.js';
import {makeBike,animateBike,disposeModel,makeImportedCar,makeImportedHazard,box,ball,rod,batch,neon,black,metal,rubber} from './models.js';
import {Environment} from './environment.js';
import {MenuBackdrop} from './menu-backdrop.js';
import {getWorld,random,headlightParams,fitSunShadow} from './world-data.js';
import {TUNNEL,tunnelEnclosure,tunnelSections} from './tunnel.js';
import {road,slope} from './physics.js';
import {laneX} from './hazards.js';
import {QualityLadder,RUNGS,MAX_RUNG,manualSettings} from './quality.js';

// Per-world colour grade + hit/boost chromatic aberration, applied after OutputPass in display space.
// Stateless (no private render target) so adapt()'s setSamples() disposal stays safe. Module-scope data only — Node-import safe.
// Per-world colour grade + hit/boost chromatic aberration + optional retro dither (UPLIFT-PLAN A3),
// all in ONE display-space pass after OutputPass. 3.19.1: the dither used to be a separate terminal
// ShaderPass; that added a full-res hop through the 4×MSAA HalfFloat composer target (a blitFramebuffer
// resolve per hop — measured +4.3 ms p50 on an M4 Pro at DPR 2 for a trivial shader). Merged here as a
// uniform-gated branch (uDither): zero extra passes, zero extra resolves, and the setSamples()
// render-target disposal contract stays safe. Stateless; module-scope data only — Node-import safe.
const GRADE_SHADER={uniforms:{tDiffuse:{value:null},uLift:{value:new T.Vector3()},uGamma:{value:new T.Vector3(1,1,1)},uGain:{value:new T.Vector3(1,1,1)},uSat:{value:1},uTint:{value:new T.Vector3(1,1,1)},uAberration:{value:.0012},uDither:{value:0},uDitherAmt:{value:.3},uPalette:{value:Array.from({length:8},()=>new T.Vector3())}},vertexShader:`varying vec2 vUv;void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`,fragmentShader:`
varying vec2 vUv;uniform sampler2D tDiffuse;uniform vec3 uLift,uGamma,uGain,uTint;uniform float uSat,uAberration,uDither,uDitherAmt;uniform vec3 uPalette[8];
float bayer2(vec2 a){a=floor(a);return fract(a.x/2.+a.y*a.y*.75);}
void main(){vec2 off=(vUv-.5)*uAberration;vec3 c;c.r=texture2D(tDiffuse,vUv-off).r;c.g=texture2D(tDiffuse,vUv).g;c.b=texture2D(tDiffuse,vUv+off).b;
c=pow(max(c+uLift,vec3(0.)),1./uGamma)*uGain*uTint;
float l=dot(c,vec3(.2126,.7152,.0722));c=mix(vec3(l),c,uSat);
if(uDither>.5){c+=vec3((bayer2(gl_FragCoord.xy*.25)*.0625+bayer2(gl_FragCoord.xy*.5)*.25+bayer2(gl_FragCoord.xy)-.5)*uDitherAmt);
vec3 best=uPalette[0];vec3 dq=c-best;float bd=dot(dq,dq);
for(int i=1;i<8;i++){dq=c-uPalette[i];float dd=dot(dq,dq);if(dd<bd){bd=dd;best=uPalette[i];}}
c=best;}
gl_FragColor=vec4(c,1.);}`};
// Pure helpers (exported for Node tests): palette from a world-data.js entry, and the JS reference of the GLSL Bayer 8×8 above.
export function ditherPalette(w){return [w.skyTop,w.skyBottom,w.fog,w.sun,w.accent,w.secondary,w.road,w.terrain].map(h=>{const n=parseInt(h.slice(1),16);return [((n>>16)&255)/255,((n>>8)&255)/255,(n&255)/255]})}
export function bayer8(x,y){const b2=(ax,ay)=>{const v=Math.floor(ax)/2+Math.floor(ay)*Math.floor(ay)*.75;return v-Math.floor(v)};return b2(x*.25,y*.25)*.0625+b2(x*.5,y*.5)*.25+b2(x,y)}
// Tunnel interior light level (pure, Node-tested). The tunnel PointLight stays in the scene and
// VISIBLE at all times — intensity 0 when unused. Toggling .visible (like add/remove) changes the
// light count, and three.js collects lights via traverseVisible while numPointLights is part of the
// program cache key: one visible-toggle recompiles EVERY lit material in the scene (the tunnel
// entry/exit hitch class, ~70 ms p99 measured on an M4 Pro). A constant-count intensity-0 light
// costs one dead light slot and never recompiles.
export function tunnelLightLevel(enc,effects){return effects?Math.max(0,Math.min(1,enc)):0}
export function useImportedTraffic(i){return i%3===0}
// G2: legacy fixed sun-shadow box (restored whenever the sun-follow re-fit toggles off).
const SUN_BOX={left:-28,right:28,top:26,bottom:-26,near:1,far:170};
function makeCar(i){
 const g=new T.Group(),sedan=i%2===1,bh=sedan?.34:.64,bl=sedan?4.8:3.6,hz=bl/2,cy=.35+bh+.28,paint=new T.MeshPhysicalMaterial({color:[0x758d98,0x873b39,0xc3bfb1,0x263448][i%4],metalness:.05,roughness:.42,clearcoat:1,clearcoatRoughness:.06});
 box(g,1.88,bh,bl,0,.35+bh/2,0,paint);const cabin=box(g,1.60,.56,2,0,cy,.05,new T.MeshPhysicalMaterial({color:0x0a1a24,metalness:0,roughness:.05,clearcoat:1,clearcoatRoughness:.03}));
 box(g,1.59,.10,1.75,0,cy+.33,.12,paint);box(g,1.85,.15,.60,0,.35+bh+.03,-(hz-.34),paint);box(g,1.85,.13,.50,0,.35+bh-.01,hz-.3,paint);
 for(const side of [-1,1]){
  for(const z of [-.9,.92])box(g,.06,.64,.065,side*.81,cy-.01,z,metal);
  box(g,.22,.12,.2,side*1.03,cy-.08,-.63,paint);box(g,.035,.04,.22,side*.95,.35+bh+.06,.3,metal);
  box(g,.66,.045,.045,side*.48,.8,hz+.02,neon('#f45148',4));box(g,.62,.065,.045,side*.48,.75,-hz-.02,neon('#e9f5fb',2.2));
  for(const z of [-1.35,1.35]){const w=new T.Mesh(new T.CylinderGeometry(.35,.35,.23,20),rubber);w.rotation.z=Math.PI/2;w.position.set(side*.90,.35,z);g.add(w);const rim=new T.Mesh(new T.CylinderGeometry(.22,.22,.245,12),metal);rim.rotation.z=Math.PI/2;rim.position.copy(w.position);g.add(rim)}
 }
 box(g,.6,.17,.03,0,.54,hz+.03,metal);box(g,1.3,.14,.04,0,.45,-hz-.03,black);batch(g);g.traverse(o=>{if(o.isMesh){o.castShadow=true;o.receiveShadow=true}});return g;
}
function makeDrone(i){const g=makeCar(i);box(g,.5,.12,.9,0,.15,0,black);for(const side of [-1,1])for(const z of [-1.25,1.25]){const m=new T.Mesh(new T.TorusGeometry(.35,.07,8,24),metal);m.rotation.x=Math.PI/2;m.position.set(side*1.2,.4,z);g.add(m);const light=new T.Mesh(new T.TorusGeometry(.28,.025,6,24),neon('#71eaff',3));light.rotation.x=Math.PI/2;light.position.copy(m.position);light.position.y-=.08;g.add(light);rod(g,[side*.94,.55,z],[side*1.2,.42,z],.035,metal)}return g}
const debrisShape=h=>Math.floor(random(parseInt(h.id.split('-')[1]))*3);
// Closure hazards keep child lamps/barriers and stay individual meshes; oil/puddle/debris render as InstancedMesh pools.
function makeHazard(h,shadowTex){
 const g=new T.Group();
 const mat=new T.MeshStandardMaterial({color:0xff7b55,roughness:.5,metalness:0,emissive:0xff7b55,emissiveIntensity:2.4});
 const m=new T.Mesh(new T.BoxGeometry(h.width,.65,h.depth),mat);m.position.y=.35;g.add(m);
 for(const x of [-h.width*.34,h.width*.34]){const lamp=new T.Mesh(new T.SphereGeometry(.09,8,8),neon('#ff526d',4.2));lamp.position.set(x,.75,0);g.add(lamp)}
 const barrier=makeImportedHazard('barrier');if(barrier){barrier.scale.setScalar(3.5);barrier.position.set(-h.width*.25,.325,h.depth*.12);g.add(barrier)}
 const fence=makeImportedHazard('fence');if(fence){fence.scale.setScalar(2.2);fence.position.set(h.width*.15,.325,-h.depth*.12);g.add(fence)}
 g.traverse(o=>{if(o.isMesh){o.castShadow=true;o.receiveShadow=true}});return g;
}
function makeHazardPool(h,key,tex,cap){
 let geo,mat,y,sx=h.width,sz=h.depth;
 if(key==='oil'||key==='puddle'){geo=new T.PlaneGeometry(1,1);geo.rotateX(-Math.PI/2);y=.035;mat=new T.MeshPhysicalMaterial({color:key==='oil'?0x141b2b:0x4e9bad,roughness:.04,metalness:0,clearcoat:1,clearcoatRoughness:.02,transparent:true,opacity:key==='oil'?.78:.5,depthWrite:false,polygonOffset:true,polygonOffsetFactor:-2,map:key==='oil'?tex.oil:tex.puddle,alphaMap:tex.shadow});
 }else{mat=new T.MeshStandardMaterial({color:0x6f6a5e,roughness:.68,metalness:0,flatShading:true});
  if(key==='debris1'){geo=new T.ConeGeometry(.3,.5,5);y=.25;sx=h.width/.8;sz=h.depth/1.1}else if(key==='debris2'){geo=new T.SphereGeometry(.32,10,8);geo.scale(1,.45,1);y=.16;sx=h.width/.8;sz=h.depth/1.1}else{geo=new T.BoxGeometry(1,.65,1);y=.325}}
 const mesh=new T.InstancedMesh(geo,mat,cap);mesh.count=0;mesh.frustumCulled=false;mesh.castShadow=true;mesh.receiveShadow=true;return {mesh,y,sx,sz};
}
export class World{
 constructor(canvas,bike,setup){
  this.scene=new T.Scene();this.camera=new T.PerspectiveCamera(54,innerWidth/innerHeight,.1,2400);
  this.renderer=new T.WebGLRenderer({canvas,antialias:false,powerPreference:'high-performance'});this.maxRatio=Math.min(devicePixelRatio,1.75);this.renderer.setPixelRatio(this.maxRatio);this.renderer.setSize(innerWidth,innerHeight);this.renderer.toneMapping=T.NeutralToneMapping;this.renderer.toneMappingExposure=1.05;
  this.renderer.shadowMap.enabled=true;this.renderer.shadowMap.type=T.PCFSoftShadowMap;this.scene.add(this.camera);
  this.pmrem=new T.PMREMGenerator(this.renderer);this.envTarget=null;
  this.hemi=new T.HemisphereLight(0xc8e0ef,0x39404a,1.5);this.scene.add(this.hemi);
  this.sun=new T.DirectionalLight(0xfff2de,3);this.sun.castShadow=true;this.sun.shadow.mapSize.set(2048,2048);Object.assign(this.sun.shadow.camera,{left:-28,right:28,top:26,bottom:-26,near:1,far:170});this.sun.shadow.bias=-.00012;this.sun.shadow.normalBias=.018;this.scene.add(this.sun);this.scene.add(this.sun.target);
  this.rim=new T.DirectionalLight(0x83caff,1);this.rim.position.set(10,8,12);this.scene.add(this.rim);
  const target=new T.WebGLRenderTarget(innerWidth,innerHeight,{type:T.HalfFloatType,samples:4});this.composer=new EffectComposer(this.renderer,target);this.composer.addPass(new RenderPass(this.scene,this.camera));this.bloom=new UnrealBloomPass(new T.Vector2(innerWidth,innerHeight),.42,.62,.75);this.composer.addPass(this.bloom);this.composer.addPass(new OutputPass());this.grade=new ShaderPass(GRADE_SHADER);this.composer.addPass(this.grade);
  // G1: FXAA on the display-space image (after OutputPass+grade) but only when MSAA is off; A3: dither always last so bloom/CA/grade are already applied.
  this.fxaa=new FXAAPass();this.fxaa.enabled=false;this.composer.addPass(this.fxaa); // dither is merged into GRADE_SHADER (3.19.1) — no terminal dither pass anymore
  // G3: GTAO at half resolution (setSize wrapper halves every composer-driven resize), inserted right after
  // RenderPass so bloom/grade/FXAA/dither operate on the occluded image. Owns private render targets like
  // bloom, so the setSamples() disposal contract on the two composer targets is untouched. Gated per frame.
  this.gtao=new GTAOPass(this.scene,this.camera,innerWidth,innerHeight);const gtaoSize=this.gtao.setSize.bind(this.gtao);this.gtao.setSize=(w,h)=>gtaoSize(w/2,h/2);this.composer.insertPass(this.gtao,1);
  this.ssr=null; // G7: built lazily on first enable (experimental, quality==='high' only) so the default path pays nothing.
  this.composer.setPixelRatio(this.maxRatio);this.composer.setSize(innerWidth,innerHeight);this.samples=4;
  this.applyGraphicsFlags(setup);this.fitDir=new T.Vector3();this.refitOn=false;
  this.player=makeBike(bike,setup.paint);this.scene.add(this.player);this.conversion=setup.launch==='flight'?1:0;
  this.headlight=new T.SpotLight(0xd3f1ff,90,90,.44,.55,2);this.headlight.castShadow=true;this.headlight.shadow.camera.near=.5;this.headlight.shadow.camera.far=60;this.headlight.shadow.bias=-.0006;this.headlight.shadow.normalBias=.02;this.scene.add(this.headlight);this.scene.add(this.headlight.target);
  const shc=document.createElement('canvas');shc.width=4;shc.height=64;const shx=shc.getContext('2d'),shg=shx.createLinearGradient(0,0,0,64);shg.addColorStop(0,'#ffffff');shg.addColorStop(.45,'#bfbfbf');shg.addColorStop(1,'#000000');shx.fillStyle=shg;shx.fillRect(0,0,4,64);const shaftTex=new T.CanvasTexture(shc);
  this.lightShaft=new T.Mesh(new T.ConeGeometry(2.2,14,16,1,true),new T.MeshBasicMaterial({color:0xd3f1ff,transparent:true,opacity:.05,depthWrite:false,blending:T.AdditiveBlending,side:T.FrontSide,alphaMap:shaftTex}));this.lightShaft.rotation.x=Math.PI/2-.055;this.lightShaft.position.z=-7;this.headlight.add(this.lightShaft);
  this.fill=new T.PointLight(0xbee7fa,26,16,2);this.scene.add(this.fill);
  const sc=document.createElement('canvas');sc.width=sc.height=128;const cx=sc.getContext('2d'),gradient=cx.createRadialGradient(64,64,0,64,64,64);gradient.addColorStop(0,'#000000b0');gradient.addColorStop(.35,'#00000075');gradient.addColorStop(1,'#00000000');cx.fillStyle=gradient;cx.fillRect(0,0,128,128);this.shadowTex=new T.CanvasTexture(sc);
  const htex=kind=>{const c=document.createElement('canvas');c.width=c.height=128;const x=c.getContext('2d');if(kind==='oil'){for(let i=0;i<34;i++){x.strokeStyle=`hsla(${200+(i*11)%120},75%,55%,${.5-i*.013})`;x.lineWidth=2.5;x.beginPath();x.arc(64+Math.sin(i*.7)*9,64+Math.cos(i*.9)*9,5+i*1.8,i*.55,i*.55+4.4);x.stroke()}}else{x.strokeStyle='#dcf0fa';for(let i=1;i<9;i++){x.globalAlpha=.7-i*.075;x.lineWidth=2;x.beginPath();x.arc(64,64,i*7.2,0,Math.PI*2);x.stroke()}x.globalAlpha=1}const t=new T.CanvasTexture(c);t.colorSpace=T.SRGBColorSpace;return t};
  this.oilTex=htex('oil');this.puddleTex=htex('puddle');this.contactShadow=new T.Mesh(new T.PlaneGeometry(2.8,4.9),new T.MeshBasicMaterial({map:this.shadowTex,transparent:true,depthWrite:false,polygonOffset:true,polygonOffsetFactor:-2}));this.contactShadow.rotation.x=-Math.PI/2;this.contactShadow.position.y=.025;this.scene.add(this.contactShadow);
  this.shadowAlpha=new T.InstancedBufferAttribute(new Float32Array(48),1);const shGeo=new T.PlaneGeometry(1,1);shGeo.rotateX(-Math.PI/2);shGeo.setAttribute('ialpha',this.shadowAlpha);this.shadowMesh=new T.InstancedMesh(shGeo,new T.MeshBasicMaterial({map:this.shadowTex,transparent:true,depthWrite:false,polygonOffset:true,polygonOffsetFactor:-2}),48);this.shadowMesh.material.onBeforeCompile=sh=>{sh.vertexShader=sh.vertexShader.replace('void main() {','attribute float ialpha;varying float vIAlpha;\nvoid main() {').replace('#include <begin_vertex>','#include <begin_vertex>\n\tvIAlpha=ialpha;');sh.fragmentShader=sh.fragmentShader.replace('void main() {','varying float vIAlpha;\nvoid main() {').replace('#include <color_fragment>','#include <color_fragment>\n\tdiffuseColor.a*=vIAlpha;')};this.shadowMesh.count=0;this.shadowMesh.frustumCulled=false;this.scene.add(this.shadowMesh);this.hazS=new T.Vector3();
  // Tunnels (placement logic in tunnel.js, visual-only — no physics/collision impact): one instanced
  // arch-section mesh + one instanced emissive strip-light mesh, packed per frame for the zones near s.
  const archGeo=new T.CylinderGeometry(TUNNEL.radius,TUNNEL.radius,TUNNEL.step,20,1,true,Math.PI/2,Math.PI);archGeo.rotateX(Math.PI/2);
  this.tunnelArch=new T.InstancedMesh(archGeo,new T.MeshStandardMaterial({color:0x555555,roughness:.92,metalness:.06,side:T.DoubleSide}),TUNNEL.pool);this.tunnelArch.count=0;this.tunnelArch.frustumCulled=false;this.scene.add(this.tunnelArch);
  this.tunnelStrip=new T.InstancedMesh(new T.BoxGeometry(.5,.1,TUNNEL.step),new T.MeshStandardMaterial({color:0x0a0a0a,emissive:0xffffff,emissiveIntensity:3}),TUNNEL.pool*3);this.tunnelStrip.count=0;this.tunnelStrip.frustumCulled=false;this.scene.add(this.tunnelStrip);
  // 3.19.1: visible stays TRUE forever (intensity 0 until enclosed) — see tunnelLightLevel.
  this.tunnelLight=new T.PointLight(0xfff1dd,0,70,2);this.scene.add(this.tunnelLight);
  this.rivals=[];this.traffic=[];this.drones=[];this.hazards=[];this.hazardData=[];this.hazardPools={};this.cameraMode=0;this.hitFlash=0;this.boostFlash=0;this.boostWas=false;this.cockpitView=false;this.pointer={x:0,y:0};this.pointerEase={x:0,y:0};this.smoothPos=new T.Vector3();this.setWorld(setup.world);
  this.rainCount=setup.quality==='low'?550:650;this.particles();this.bike=bike;this.smokeAcc=0;this.boostAcc=0;this.skids=[];this.skidS=0;this.skidRivalS=[];
  // Canvas textures are built here (constructor scope), never at module scope: traffic-assets.test.mjs imports this file in Node.
  const dotTexture=size=>{const c=document.createElement('canvas');c.width=c.height=size;const x=c.getContext('2d'),g=x.createRadialGradient(size/2,size/2,0,size/2,size/2,size/2);g.addColorStop(0,'#ffffff');g.addColorStop(.35,'#ffffffa8');g.addColorStop(1,'#ffffff00');x.fillStyle=g;x.fillRect(0,0,size,size);return new T.CanvasTexture(c)};
  const points=(cap,map,{blending=T.NormalBlending,color=0xffffff,size=.3,colors=false}={})=>{const g=new T.BufferGeometry();g.setAttribute('position',new T.BufferAttribute(new Float32Array(cap*3),3));g.setAttribute('psize',new T.BufferAttribute(new Float32Array(cap),1));g.setAttribute('palpha',new T.BufferAttribute(new Float32Array(cap),1));if(colors)g.setAttribute('color',new T.BufferAttribute(new Float32Array(cap*3),3));const m=new T.PointsMaterial({size,map,transparent:true,depthWrite:false,blending,color,vertexColors:colors});m.onBeforeCompile=sh=>{sh.vertexShader=sh.vertexShader.replace('uniform float size;','attribute float psize;attribute float palpha;varying float vAlpha;uniform float size;').replace('gl_PointSize = size;','gl_PointSize = size*psize;vAlpha=palpha;');sh.fragmentShader=sh.fragmentShader.replace('uniform float opacity;','uniform float opacity;\nvarying float vAlpha;').replace('#include <color_fragment>','#include <color_fragment>\n\tdiffuseColor.a*=vAlpha;')};const pts=new T.Points(g,m);pts.frustumCulled=false;pts.visible=false;this.scene.add(pts);return pts};
  const dot=dotTexture(32),soft=dotTexture(64);
  this.sparkPoints=points(96,dot,{blending:T.AdditiveBlending,size:.07,colors:true});this.sparks=[];for(let i=0;i<96;i++)this.sparks.push({life:0,vx:0,vy:0,vz:0,grav:12,r:1,g:.7,b:.4});
  this.smokePoints=points(128,soft,{size:1});this.smoke=[];for(let i=0;i<128;i++)this.smoke.push({life:0,max:1,vx:0,vy:0,vz:0});
  this.boostPoints=points(64,dot,{blending:T.AdditiveBlending,color:0x9ff4ff,size:1});this.boost=[];for(let i=0;i<64;i++)this.boost.push({life:0,max:1,vx:0,vy:0,vz:0});
  this.splashPoints=points(48,soft,{color:0xb8d6e4,size:1});this.splashes=[];for(let i=0;i<48;i++)this.splashes.push({life:0,max:1});
  this.speedLines=new T.InstancedMesh(new T.PlaneGeometry(.02,3.5),new T.MeshBasicMaterial({color:0xdff2ff,transparent:true,opacity:0,depthWrite:false}),12);this.speedLines.frustumCulled=false;this.speedLines.visible=false;{const e=new T.Euler(),m=new T.Matrix4();for(let i=0;i<12;i++){const a=i/12*Math.PI*2;e.set(0,0,a-Math.PI/2);m.makeRotationFromEuler(e);m.setPosition(Math.cos(a)*4.6,Math.sin(a)*3,-6);this.speedLines.setMatrixAt(i,m)}this.camera.add(this.speedLines)}
  this.skidAlpha=new T.InstancedBufferAttribute(new Float32Array(160),1);const skidGeo=new T.PlaneGeometry(.22,1.4);skidGeo.setAttribute('ialpha',this.skidAlpha);this.skidMesh=new T.InstancedMesh(skidGeo,new T.MeshBasicMaterial({color:0x0a0d10,transparent:true,opacity:.5,depthWrite:false,polygonOffset:true,polygonOffsetFactor:-3}),160);this.skidMesh.material.onBeforeCompile=sh=>{sh.vertexShader=sh.vertexShader.replace('void main() {','attribute float ialpha;varying float vIAlpha;\nvoid main() {').replace('#include <begin_vertex>','#include <begin_vertex>\n\tvIAlpha=ialpha;');sh.fragmentShader=sh.fragmentShader.replace('void main() {','varying float vIAlpha;\nvoid main() {').replace('#include <color_fragment>','#include <color_fragment>\n\tdiffuseColor.a*=vIAlpha;')};this.skidMesh.count=0;this.skidMesh.frustumCulled=false;this.scene.add(this.skidMesh);this.skidM4=new T.Matrix4();this.skidQ=new T.Quaternion();this.skidE=new T.Euler(0,0,0,'YXZ');this.skidV=new T.Vector3();this.skidOne=new T.Vector3(1,1,1);
  // Adaptive quality (3.19.0): the ladder (src/quality.js, pure) decides the rung; this.tier is the
  // currently applied rung/preset read by render() gating. probeRung is set by main.js's GPU probe.
  this.renderScale=1;this.ladder=new QualityLadder();this.tier=RUNGS[MAX_RUNG];this.probeRung=MAX_RUNG;this.renderer.info.autoReset=false;
  this.resize=()=>{this.camera.aspect=innerWidth/innerHeight;this.camera.updateProjectionMatrix();this.renderer.setSize(innerWidth,innerHeight);this.composer.setSize(innerWidth,innerHeight)};addEventListener('resize',this.resize);
 }
 // Graphics feature flags from the Garage (gfx* setup keys, validated in main.js). All heavy features
 // are additionally gated per frame by quality==='high'||tier.effects (SSR strictly quality==='high'),
 // so adapt() degradation disables them; each flag alone turns its feature fully off.
 applyGraphicsFlags(setup={}){const g=k=>setup['gfx'+k]??(k==='Ssr'?'off':'on');this.flags={shadow:g('Shadow'),gtao:g('Gtao'),detail:g('Detail'),ssr:g('Ssr'),tunnels:g('Tunnels')}}
 setSamples(n){if(this.samples===n)return;this.samples=n;for(const rt of [this.composer.renderTarget1,this.composer.renderTarget2]){rt.samples=n;rt.dispose()}this.fxaa.enabled=n===0}
 setShadowQuality(size){if(this.shadowSize===size)return;this.shadowSize=size;for(const l of [this.sun,this.headlight]){l.shadow.mapSize.setScalar(l===this.sun?size:size/2);l.shadow.map?.dispose();l.shadow.map=null}}
 // Initial GPU-probe hint (main.js): sets the ladder's start rung. Hint only — adapt() corrects it
 // from measured frame times. Only meaningful for quality==='auto'; manual presets ignore it.
 setInitialRung(rung){this.probeRung=rung;this.ladder.reset(rung);this.tier=this.ladder.settings}
 resetQuality(quality){this.ladder.reset(this.probeRung);this.applyTier(quality==='auto'?this.ladder.settings:manualSettings(quality),quality)}
 // Apply one rung/preset to renderer state. setSamples() keeps its dispose-and-rebuild contract on
 // the two composer render targets (guarded by the samples-equality early out); pixel-ratio changes
 // go through resize() as before.
 applyTier(t,quality){
  this.tier=t;const scale=t.scale,cap=quality==='low'?1.15:1.75,ratio=Math.min(devicePixelRatio,cap)*scale;
  if(Math.abs(scale-this.renderScale)>.001){this.renderScale=scale;this.renderer.setPixelRatio(ratio);this.composer.setPixelRatio(ratio);this.resize()}
  this.setSamples(t.samples);this.setShadowQuality(t.shadow);
 }
 // One decision window. report is FrameStats.summary() ({p50,p95,p99}); hz is the measured rAF
 // display cadence (0 = unknown, ladder keeps its previous budget). Manual quality applies the
 // fixed historical presets and never consults the ladder; auto never touches SSR.
 adapt(report,quality,hz=0){
  if(quality==='auto'){if(hz>0)this.ladder.setBudget(hz);if(this.ladder.update(report))this.applyTier(this.ladder.settings,'auto')}
  else this.applyTier(manualSettings(quality),quality);
 }
 // HUD label for the #performance line: current rung under auto, the manual preset name otherwise.
 qualityText(quality){return quality==='auto'?this.tier.label+' '+this.ladder.rung+'/'+MAX_RUNG:this.tier.label}
 setWorld(id){if(this.environment)this.environment.dispose();this.environment=new Environment(this.scene,id);this.world=getWorld(id);this.scene.background=new T.Color(this.world.skyBottom);this.scene.fog=new T.FogExp2(this.world.fog,this.world.fogDensity);this.sun.color.set(this.world.sun);this.sun.intensity=this.world.sunPower;this.hemi.intensity=this.world.ambient;this.hemi.color.set(this.world.skyBottom);this.hemi.groundColor.set(this.world.terrain);this.rim.color.set(this.world.accent);this.rim.intensity=this.world.kind==='city'?.45:.22;this.renderer.toneMappingExposure=this.world.kind==='city'?1.0:1.15;this.scene.environmentIntensity=this.world.kind==='city'?.9:1.0;
  // G6: per-world physical headlight (inverse-square decay + smooth cosine penumbra, world-data.js headlightParams).
  const hl=headlightParams(this.world);this.headlight.intensity=hl.intensity;this.headlight.distance=hl.distance;this.headlight.angle=hl.angle;this.headlight.penumbra=hl.penumbra;this.headlight.decay=hl.decay;
  this.sunDir=[50,-(35+this.world.sunY*50),-30];this.tunnelArch.material.color.set(this.world.terrain);this.tunnelStrip.material.emissive.set(this.world.accent);
  const grade=this.world.grade;this.grade.uniforms.uLift.value.set(...grade.lift);this.grade.uniforms.uGain.value.set(...grade.gain);this.grade.uniforms.uSat.value=grade.sat;ditherPalette(this.world).forEach((rgb,i)=>this.grade.uniforms.uPalette.value[i].set(...rgb));
  const skyScene=new T.Scene();const sky=this.environment.sky;skyScene.add(sky);const env=this.pmrem.fromScene(skyScene);skyScene.remove(sky);this.environment.root.add(sky);if(this.envTarget){this.envTarget.texture.dispose();this.envTarget.dispose()}this.envTarget=env;this.scene.environment=this.envTarget.texture;
  this.initialized=false;this.backdrop?.setWorld(this.world);this.warmup()}
 // Precompile every shader program reachable in the current scene (3.19.1): lazy first-use compilation
 // is the classic tunnel-entry / first-visibility hitch. With the light count held constant (see
 // tunnelLightLevel) one compile covers every program variant the frame loop can hit; new actors call
 // this again from setActors. GPU-only side effect — not Node-testable (CLAUDE.md visual/render exception).
 warmup(){try{this.renderer.compile(this.scene,this.camera)}catch{}}
 setBike(bike,color){this.bike=bike;this.scene.remove(this.player);disposeModel(this.player);this.player=makeBike(bike,color);this.scene.add(this.player)}
 setActors(rivals,traffic,bikes,drones=[],hazards=[]){for(const m of [...this.rivals,...this.traffic,...this.drones,...this.hazards]){if(m){this.scene.remove(m);disposeModel(m)}}for(const k in this.hazardPools){const p=this.hazardPools[k];this.scene.remove(p.mesh);p.mesh.dispose();p.mesh.geometry.dispose();p.mesh.material.dispose()}this.hazardPools={};this.hazardData=hazards;this.rivals=rivals.map((a,i)=>{const m=makeBike(bikes[(i+1)%bikes.length],bikes[(i+1)%bikes.length].color);this.scene.add(m);return m});this.traffic=traffic.map((a,i)=>{let m=useImportedTraffic(i)?makeImportedCar(i):makeCar(i);if(!m){m=makeCar(i);m.userData.importedFallback=true}this.scene.add(m);return m});this.drones=drones.map((a,i)=>{const m=makeDrone(i+1);this.scene.add(m);return m});
  const counts={};for(const h of hazards)if(h.type!=='closure'){const k=h.type==='debris'?'debris'+debrisShape(h):h.type;counts[k]=(counts[k]||0)+1}
  const tex={shadow:this.shadowTex,oil:this.oilTex,puddle:this.puddleTex};
  this.hazards=hazards.map(h=>{if(h.type==='closure'){const m=makeHazard(h,this.shadowTex);this.scene.add(m);return m}const k=h.type==='debris'?'debris'+debrisShape(h):h.type;if(!this.hazardPools[k]){this.hazardPools[k]=makeHazardPool(h,k,tex,counts[k]);this.scene.add(this.hazardPools[k].mesh)}return null});this.warmup()}
 particles(){const count=this.rainCount||550,positions=new Float32Array(count*6);for(let i=0;i<count;i++){const x=(Math.random()-.5)*100,y=Math.random()*45,z=(Math.random()-.5)*100;positions.set([x,y,z,x+.1,y-1.1,z],i*6)}this.rainGeometry=new T.BufferGeometry();this.rainGeometry.setAttribute('position',new T.BufferAttribute(positions,3));this.rain=new T.LineSegments(this.rainGeometry,new T.LineBasicMaterial({color:0xb8d6e4,transparent:true,opacity:.24,depthWrite:false}));this.scene.add(this.rain);}
 burst(x,y=0,z=0,{count=18,speed=1,color=0xffb967,life=[.3,.8],gravity=12}={}){let n=0;const at=this.sparkPoints.geometry.attributes,c=new T.Color(color).multiplyScalar(1.25);for(let i=0;i<96&&n<count;i++){const k=this.sparks[i];if(k.life>0)continue;n++;k.life=life[0]+Math.random()*(life[1]-life[0]);k.grav=gravity;k.r=c.r;k.g=c.g;k.b=c.b;k.vx=(Math.random()-.5)*8*speed;k.vy=Math.random()*5*speed;k.vz=(Math.random()-.5)*9*speed;at.position.setXYZ(i,x,y+.7,z);at.color.setXYZ(i,c.r,c.g,c.b);at.psize.setX(i,1);at.palpha.setX(i,1)}this.sparkPoints.visible=true}
 render(p,rivals,traffic,mode,dt,clock,setup,drones=[]){
  const effects=setup.quality==='high'||(setup.quality==='auto'&&this.tier.effects);this.renderer.info.reset();this.renderer.shadowMap.enabled=true;this.setShadowQuality(effects?(setup.quality==='auto'?this.tier.shadow:2048):512);
  // G3/G7/G5 gating: every heavy pass is enabled only while effects are on and its Garage flag is on;
  // under quality==='auto' the ladder rung (this.tier) caps each feature individually, so adapt()
  // degrades gracefully without touching the composer chain. SSR stays lazy and strictly manual.
  this.gtao.enabled=effects&&this.flags.gtao==='on'&&(setup.quality!=='auto'||this.tier.gtao);
  this.grade.uniforms.uDither.value=setup.style==='dither'&&(setup.quality!=='auto'||this.tier.dither)?1:0;
  if(this.flags.ssr==='on'&&setup.quality==='high'&&!this.ssr){this.ssr=new SSRPass({renderer:this.renderer,scene:this.scene,camera:this.camera,width:innerWidth,height:innerHeight});this.ssr.resolutionScale=.5;this.composer.insertPass(this.ssr,1)}
  if(this.ssr)this.ssr.enabled=setup.quality==='high'&&this.flags.ssr==='on';
  this.environment.setDetailMaps(effects&&this.flags.detail==='on'&&(setup.quality!=='auto'||this.tier.detail));
  const menu=mode==='menu',s=menu?650:p.s,rx=road(s),air=menu?setup.launch==='flight':p.flight||p.landing;
  if(menu&&!this.backdrop){this.backdrop=new MenuBackdrop(this.scene,this.camera);this.backdrop.setWorld(this.world);this.backdrop.quality=setup.quality}
  if(this.backdrop){this.backdrop.quality=setup.quality;if(menu){this.backdrop.update(dt,clock,effects);this.backdrop.setVisible(true)}else this.backdrop.setVisible(false)}
  this.environment.fx=effects;this.environment.update(s,clock,setup.quality==='auto'&&!this.tier.effects?{...setup,quality:'low'}:setup,air);this.conversion+=(Number(air)-this.conversion)*(1-Math.exp(-dt*4));
  const y=menu?(air?1.8:0):p.y||0;const x=menu?1.3:p.x;
  this.player.scale.setScalar(menu?(innerWidth<650?1:1.22):1);
  this.contactShadow.position.set(x,.03,0);this.contactShadow.scale.setScalar((menu?1.22:1)+y*.06);this.contactShadow.material.opacity=1/(1+y*.09);
  this.player.position.set(x,y+(air?Math.sin(clock*2)*.025:.015),0);this.player.rotation.set(menu?-.015:p.pitch,menu?-.58:-Math.atan(slope(s))-p.vx*.020,menu?-.03:p.lean);
  const cockpit=!menu&&this.cameraMode===1&&!!this.player.userData.cockpit?.length;
  if(cockpit!==this.cockpitView||this.player!==this.cockpitBike){this.cockpitView=cockpit;this.cockpitBike=this.player;this.player.traverse(o=>{if(o.isMesh)o.visible=!cockpit||!!o.userData.cockpit})}
  this.player.visible=(p.invulnerable<=0||Math.floor(clock*12)%2===0)&&(menu||this.cameraMode!==1||cockpit);
  animateBike(this.player,{speed:p.v,flight:this.conversion,boost:p.boosting,time:clock,dt});
  const place=(a,m)=>{const z=s-a.s;m.visible=z>-(setup.quality==='low'?230:420)&&z<45;m.position.set(road(a.s)-rx+a.x,a.y||0,z);m.rotation.y=-Math.atan(slope(a.s))};
  const sl=Math.hypot(50,30),sdx=50/sl,sdz=-30/sl;let shadowN=0;
  const shadow=(a,m,w,d)=>{const ay=a.y||0;if(!m.visible||ay>=6||shadowN>=48)return;const sc=1+ay*.06;this.skidQ.identity();this.skidV.set(m.position.x+sdx*ay*.35,.022,m.position.z+sdz*ay*.35);this.skidM4.compose(this.skidV,this.skidQ,this.hazS.set(w*sc,1,d*sc));this.shadowMesh.setMatrixAt(shadowN,this.skidM4);this.shadowAlpha.setX(shadowN,1/(1+ay*.09));shadowN++};
  const wet=setup.weather==='rain',onRoad=!menu&&!p.flight&&!p.landing,slipping=p.slip>.12||p.accel<-8||p.surfaceGrip<.9;
  rivals.forEach((a,i)=>{const m=this.rivals[i];if(!m)return;place(a,m);m.rotation.z=a.lean||0;if(m.visible)animateBike(m,{speed:a.v,flight:(a.y||0)>1?1:0,time:clock,dt});shadow(a,m,2.4,4.4);if(!menu&&(a.y||0)<.2&&Math.abs(a.vx||0)>3.4&&Math.abs(a.s-(this.skidRivalS[i]??-9))>.9){this.skidRivalS[i]=a.s;this.skids.push({s:a.s,x:a.x,rot:-Math.atan(slope(a.s)),alpha:wet?.15:.3});if(this.skids.length>160)this.skids.shift()}});traffic.forEach((a,i)=>{if(this.traffic[i]){place(a,this.traffic[i]);shadow(a,this.traffic[i],2.9,5.4)}});drones.forEach((a,i)=>{if(this.drones[i]){place(a,this.drones[i]);shadow(a,this.drones[i],2.9,5.4)}});this.shadowMesh.count=shadowN;if(shadowN){this.shadowMesh.instanceMatrix.needsUpdate=true;this.shadowAlpha.needsUpdate=true}
  {const hc={};this.hazardData.forEach((h,i)=>{const z=s-h.s,vis=z>-(setup.quality==='low'?180:320)&&z<120,m=this.hazards[i];if(m){m.visible=vis;if(vis)m.position.set(road(h.s)-rx+h.x,0,z);return}if(!vis)return;const k=h.type==='debris'?'debris'+debrisShape(h):h.type,pool=this.hazardPools[k],n=hc[k]||0;hc[k]=n+1;this.skidQ.identity();this.skidV.set(road(h.s)-rx+h.x,pool.y,z);this.skidM4.compose(this.skidV,this.skidQ,this.hazS.set(pool.sx,1,pool.sz));pool.mesh.setMatrixAt(n,this.skidM4)});for(const k in this.hazardPools){const pool=this.hazardPools[k];pool.mesh.count=hc[k]||0;if(pool.mesh.count)pool.mesh.instanceMatrix.needsUpdate=true}}
  let targetPos,targetLook;
  if(menu){const small=innerWidth<650;targetPos=new T.Vector3(small?7.5:7.8,small?3.2:2.8,7.1);targetLook=new T.Vector3(small?.7:-2.25,air?2:1.5,-1);this.camera.fov=small?57:48;
   this.pointerEase.x+=(this.pointer.x-this.pointerEase.x)*(1-Math.exp(-dt*4));this.pointerEase.y+=(this.pointer.y-this.pointerEase.y)*(1-Math.exp(-dt*4));
   const driftX=Math.sin(clock*.14)*.4+Math.sin(clock*.05+2.1)*.18,driftY=Math.sin(clock*.11+1.3)*.12;
   targetPos.x+=this.pointerEase.x*.6+driftX;targetPos.y+=-this.pointerEase.y*.25+driftY;targetPos.z+=this.pointerEase.x*.15}
  else if(this.cameraMode===1){targetPos=new T.Vector3(x,y+1.92,-.18);targetLook=new T.Vector3(x+p.vx*.2,y+1.7+p.vy*.12,-35);this.camera.fov=79+Math.min(p.v/12,8)}
  else if(this.cameraMode===2){targetPos=new T.Vector3(x+5,y+2.4,8);targetLook=new T.Vector3(x,y+.9,-3);this.camera.fov=57}
  else{targetPos=new T.Vector3(x*.96,y+3.25+(air?.8:0),6.7+p.v*.012);targetLook=new T.Vector3(x+p.vx*.2,y+1.2+p.vy*.08,-15);this.camera.fov=58+Math.min(p.v/9,9)+(p.boosting?5:0)}
  if(!this.initialized){this.smoothPos.copy(targetPos);this.look=targetLook.clone();this.initialized=true}else{this.smoothPos.lerp(targetPos,1-Math.exp(-dt*6));this.look.lerp(targetLook,1-Math.exp(-dt*7))}
  this.camera.position.copy(this.smoothPos);this.camera.lookAt(this.look);if(!menu)this.camera.rotation.z=p.lean*(air?.11:.045);this.camera.updateProjectionMatrix();
  const streaks=!menu&&p.v>this.bike.vmax*.55;this.speedLines.visible=streaks;if(streaks)this.speedLines.material.opacity=Math.min(.30,(p.v/this.bike.vmax-.55)*.9);
  // G2: sun-follow shadow re-fit (high/effects only) fits the sun ortho box to the camera frustum slice
  // [2,110] m in light space — shadows cover the road ahead, not just a fixed box around the player.
  const refit=effects&&this.flags.shadow==='on'&&(setup.quality!=='auto'||this.tier.refit);
  if(refit!==this.refitOn){this.refitOn=refit;if(!refit){Object.assign(this.sun.shadow.camera,SUN_BOX);this.sun.shadow.camera.updateProjectionMatrix()}}
  if(refit){this.camera.getWorldDirection(this.fitDir);const fit=fitSunShadow({pos:[this.camera.position.x,this.camera.position.y,this.camera.position.z],forward:[this.fitDir.x,this.fitDir.y,this.fitDir.z],fov:this.camera.fov,aspect:this.camera.aspect,range:110,lightDir:this.sunDir});this.sun.position.set(...fit.position);this.sun.target.position.set(...fit.target);Object.assign(this.sun.shadow.camera,{left:fit.left,right:fit.right,top:fit.top,bottom:fit.bottom,near:fit.near,far:fit.far});this.sun.shadow.camera.updateProjectionMatrix()}
  else this.sun.position.set(x-50,y+35+this.world.sunY*50,30),this.sun.target.position.set(x,y,0);
  // Tunnel ambient/probe handling: enclosure lerps hemi/sun/environment down inside a zone (a dedicated
  // LightProbe is unnecessary — scaling the baked PMREM environmentIntensity is the same irradiance
  // signal), and one shadowless PointLight follows the player as cheap interior lighting.
  const enc=!menu&&this.flags.tunnels==='on'?tunnelEnclosure(p.s):0;
  this.hemi.intensity=this.world.ambient*(1-.72*enc);this.sun.intensity=this.world.sunPower*(1-.85*enc);this.scene.environmentIntensity=(this.world.kind==='city'?.9:1)*(1-.6*enc);
  this.tunnelLight.intensity=180*tunnelLightLevel(enc,effects);this.tunnelLight.position.set(x,10,-6);
  this.fill.position.set(x-2,y+4,3);this.headlight.position.set(x,y+1.2,-1.2);this.headlight.target.position.set(x,y-.4,-30);this.lightShaft.material.opacity=.05*(setup.weather==='rain'?1:.4);
  this.rain.visible=setup.weather==='rain'&&effects;this.rain.position.set(x,y,0);this.splashPoints.position.set(x,y,0);if(this.rain.visible){const a=this.rainGeometry.attributes.position.array,len=1.1+Math.min(2.2,p.v*.012);for(let i=0;i<a.length;i+=6){a[i+1]-=dt*24;a[i+4]-=dt*24;a[i]+=p.vx*dt*.4;a[i+3]+=p.vx*dt*.4;a[i+2]+=p.v*dt*.55;a[i+5]+=p.v*dt*.55;if(a[i+1]<-3){a[i+1]=42;a[i+4]=42-len;const j=this.splashes.findIndex(k=>k.life<=0);if(j>=0){const k=this.splashes[j];k.max=k.life=.15+Math.random()*.1;this.splashPoints.geometry.attributes.position.setXYZ(j,a[i],.02,a[i+2])}}if(a[i+2]>45){a[i+2]=-55;a[i+5]=-55}}this.rainGeometry.attributes.position.needsUpdate=true}
  {const at=this.sparkPoints.geometry.attributes,pa=at.position.array,ca=at.color.array;let live=0;for(let i=0;i<96;i++){const k=this.sparks[i];if(k.life<=0)continue;k.life-=dt;if(k.life<=0){pa[i*3+1]=-1e4;ca[i*3]=ca[i*3+1]=ca[i*3+2]=0;continue}k.vy-=dt*k.grav;pa[i*3]+=k.vx*dt;pa[i*3+1]+=k.vy*dt;pa[i*3+2]+=k.vz*dt;const f=Math.min(1,k.life*2.5);ca[i*3]=k.r*f;ca[i*3+1]=k.g*f;ca[i*3+2]=k.b*f;live++}if(live||this.sparkPoints.visible){at.position.needsUpdate=true;at.color.needsUpdate=true;this.sparkPoints.visible=live>0}}
  if(effects&&onRoad&&slipping){this.smokeAcc+=dt*Math.min(60,12+p.slip*260);const at=this.smokePoints.geometry.attributes;while(this.smokeAcc>=1){this.smokeAcc--;const i=this.smoke.findIndex(k=>k.life<=0);if(i<0)break;const k=this.smoke[i];k.max=k.life=.9+Math.random()*.7;k.vx=(Math.random()-.5)*1;k.vy=.35+Math.random()*.55;k.vz=2.5+p.v*.06;at.position.setXYZ(i,p.x+Math.sin(p.lean)*.25,.06,1.02)}}
  this.smokePoints.material.color.set(wet?0x8fa6b0:0xb9c3c9);
  {const at=this.smokePoints.geometry.attributes,pa=at.position.array,sa=at.psize.array,aa=at.palpha.array;let live=0;for(let i=0;i<128;i++){const k=this.smoke[i];if(k.life<=0)continue;k.life-=dt;if(k.life<=0){pa[i*3+1]=-1e4;aa[i]=0;continue}const d=1-dt*1.4;k.vx*=d;k.vy*=d;k.vz*=d;pa[i*3]+=k.vx*dt;pa[i*3+1]+=k.vy*dt;pa[i*3+2]+=k.vz*dt;sa[i]=.3+(k.max-k.life)*1.6;aa[i]=.3*Math.max(0,k.life/k.max);live++}if(live||this.smokePoints.visible){at.position.needsUpdate=true;at.psize.needsUpdate=true;at.palpha.needsUpdate=true;this.smokePoints.visible=live>0}}
  if(!menu&&this.conversion>.6&&p.boosting){this.boostAcc+=dt*90;const at=this.boostPoints.geometry.attributes;while(this.boostAcc>=1){this.boostAcc--;const i=this.boost.findIndex(k=>k.life<=0);if(i<0)break;const k=this.boost[i];k.max=k.life=.35+Math.random()*.25;k.vx=(Math.random()-.5)*.3;k.vy=(Math.random()-.5)*.3;k.vz=6+p.v*.03;at.position.setXYZ(i,p.x-Math.sin(p.lean)*.2,y+.4,1.1)}}
  {const at=this.boostPoints.geometry.attributes,pa=at.position.array,sa=at.psize.array,aa=at.palpha.array;let live=0;for(let i=0;i<64;i++){const k=this.boost[i];if(k.life<=0)continue;k.life-=dt;if(k.life<=0){pa[i*3+1]=-1e4;aa[i]=0;continue}pa[i*3]+=k.vx*dt;pa[i*3+1]+=k.vy*dt;pa[i*3+2]+=k.vz*dt;sa[i]=.18*Math.max(0,k.life/k.max);aa[i]=.8*Math.max(0,k.life/k.max);live++}if(live||this.boostPoints.visible){at.position.needsUpdate=true;at.psize.needsUpdate=true;at.palpha.needsUpdate=true;this.boostPoints.visible=live>0}}
  {const at=this.splashPoints.geometry.attributes,pa=at.position.array,sa=at.psize.array,aa=at.palpha.array;let live=0;for(let i=0;i<48;i++){const k=this.splashes[i];if(k.life<=0)continue;k.life-=dt;if(k.life<=0){pa[i*3+1]=-1e4;aa[i]=0;continue}const t=1-k.life/k.max;sa[i]=.06+.08*t;aa[i]=.35*k.life/k.max;live++}if(live||this.splashPoints.visible){at.position.needsUpdate=true;at.psize.needsUpdate=true;at.palpha.needsUpdate=true;this.splashPoints.visible=live>0}}
  if(onRoad&&slipping&&p.s-this.skidS>.9){this.skidS=p.s;this.skids.push({s:p.s,x:p.x,rot:-Math.atan(slope(p.s))-p.vx*.020,alpha:Math.min(.55,p.slip*2.6+(p.accel<-8?.3:0))*(wet?.5:1)});if(this.skids.length>160)this.skids.shift()}
  {const decay=(wet?.12:.06)*dt;for(let i=this.skids.length-1;i>=0;i--){const k=this.skids[i];k.alpha-=decay;if(k.alpha<=0||s-k.s>400)this.skids.splice(i,1)}
  const n=Math.min(this.skids.length,160);for(let i=0;i<n;i++){const k=this.skids[i];this.skidE.set(-Math.PI/2,k.rot,0);this.skidQ.setFromEuler(this.skidE);this.skidV.set(road(k.s)-rx+k.x,.02,s-k.s);this.skidM4.compose(this.skidV,this.skidQ,this.skidOne);this.skidMesh.setMatrixAt(i,this.skidM4);this.skidAlpha.setX(i,Math.min(1,k.alpha/.55))}
  this.skidMesh.count=n;if(n){this.skidMesh.instanceMatrix.needsUpdate=true;this.skidAlpha.needsUpdate=true}}
  {let tn=0;if(this.flags.tunnels==='on')for(const at of tunnelSections(s,setup.quality==='low'?260:520)){if(tn>=TUNNEL.pool)break;const px=road(at)-rx,pz=s-at,yaw=-Math.atan(slope(at));
   this.skidE.set(0,yaw,0);this.skidQ.setFromEuler(this.skidE);this.skidV.set(px,0,pz);this.skidM4.compose(this.skidV,this.skidQ,this.skidOne);this.tunnelArch.setMatrixAt(tn,this.skidM4);
   for(let k=0;k<3;k++){const phi=(k-1)*1.05,c=Math.cos(phi),sn=Math.sin(phi);this.skidE.set(0,yaw,-phi);this.skidQ.setFromEuler(this.skidE);this.skidV.set(px+sn*TUNNEL.radius*Math.cos(yaw),c*TUNNEL.radius,pz-sn*TUNNEL.radius*Math.sin(yaw));this.skidM4.compose(this.skidV,this.skidQ,this.skidOne);this.tunnelStrip.setMatrixAt(tn*3+k,this.skidM4)}tn++}
  this.tunnelArch.count=tn;this.tunnelStrip.count=tn*3;if(tn){this.tunnelArch.instanceMatrix.needsUpdate=true;this.tunnelStrip.instanceMatrix.needsUpdate=true}}
  {const gu=this.grade.uniforms;this.hitFlash=Math.max(0,this.hitFlash-dt/.35);const boosting=!menu&&p.boosting;if(boosting&&!this.boostWas)this.boostFlash=1;this.boostWas=!!boosting;this.boostFlash=Math.max(0,this.boostFlash-dt/.4);gu.uSat.value=this.world.grade.sat+(1.3-this.world.grade.sat)*this.boostFlash;gu.uTint.value.set(1+.08*this.boostFlash,1,1-.1*this.boostFlash);gu.uAberration.value=.0012+this.hitFlash*.006+(p.health<25?.0015:0)}
  if(effects)this.composer.render();else this.renderer.render(this.scene,this.camera);
 }
}
