import * as T from 'three';

// 2D simplex noise from webgl-noise (Ashima Arts / Stefan Gustavson), MIT license.
// Inlined here as is standard for GLSL; see ASSETS.md for attribution.
const SNOISE_GLSL = `
vec3 mod289(vec3 x){return x-floor(x*(1.0/289.0))*289.0;}
vec2 mod289(vec2 x){return x-floor(x*(1.0/289.0))*289.0;}
vec3 permute(vec3 x){return mod289(((x*34.0)+1.0)*x);}
float snoise(vec2 v){
 const vec4 C=vec4(0.211324865405187,0.366025403784439,-0.577350269189626,0.024390243902439);
 vec2 i=floor(v+dot(v,C.yy));
 vec2 x0=v-i+dot(i,C.xx);
 vec2 i1=(x0.x>x0.y)?vec2(1.0,0.0):vec2(0.0,1.0);
 vec4 x12=x0.xyxy+C.xxzz;x12.xy-=i1;
 i=mod289(i);
 vec3 p=permute(permute(i.y+vec3(0.0,i1.y,1.0))+i.x+vec3(0.0,i1.x,1.0));
 vec3 m=max(0.5-vec3(dot(x0,x0),dot(x12.xy,x12.xy),dot(x12.zw,x12.zw)),0.0);
 m=m*m;m=m*m;
 vec3 x=2.0*fract(p*C.www)-1.0;
 vec3 h=abs(x)-0.5;
 vec3 ox=floor(x+0.5);
 vec3 a0=x-ox;
 m*=1.79284291400159-0.85373472095314*(a0*a0+h*h);
 vec3 g;g.x=a0.x*x0.x+h.x*x0.y;g.yz=a0.yz*x12.xz+h.yz*x12.yw;
 return 130.0*dot(m,g);
}
`;

const GRADIENT_VERTEX = `
varying vec2 vUv;
void main(){
 vUv=uv;
 gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);
}
`;

const GRADIENT_FRAGMENT = `
uniform float uTime;
uniform vec3 uSkyTop;
uniform vec3 uAccent;
uniform vec3 uSecondary;
uniform vec3 uFog;
uniform float uNoiseOctaves;
varying vec2 vUv;
${SNOISE_GLSL}
void main(){
 vec2 uv=vUv;
 float warp=0.0;
 if(uNoiseOctaves>0.0){
  vec2 q=vec2(snoise(uv*2.0+uTime*0.08),snoise(uv*2.0+vec2(5.2,1.3)+uTime*0.08));
  vec2 r=uv*3.0+q*0.7+vec2(uTime*0.03,uTime*0.02);
  warp=snoise(r)*0.5+0.5;
  if(uNoiseOctaves>1.0){
   r=uv*6.0+q*1.0+vec2(uTime*0.05,uTime*0.03);
   warp+=(snoise(r)*0.5+0.5)*0.5;
   warp/=1.5;
  }
 }
 vec3 col=mix(uSecondary,uAccent,smoothstep(0.0,0.55,uv.y));
 col=mix(col,uSkyTop,smoothstep(0.55,1.0,uv.y));
 col=mix(col,uAccent,warp*0.22);
 col=mix(uFog,col,smoothstep(0.0,0.12,uv.y));
 gl_FragColor=vec4(col,1.0);
}
`;

const GRID_FRAGMENT = `
uniform float uTime;
uniform vec3 uAccent;
uniform float uShowGrid;
varying vec2 vUv;
void main(){
 if(uShowGrid<0.5) discard;
 vec2 uv=vUv;
 float perspective=mix(1.0,12.0,uv.y);
 float scroll=uTime*0.12;
 float h=1.0-smoothstep(0.0,0.035,fract(uv.y*22.0*perspective+scroll));
 float v=1.0-smoothstep(0.0,0.012,fract(uv.x*36.0));
 float line=max(h,v);
 gl_FragColor=vec4(uAccent,line*0.28);
}
`;

const PARTICLE_VERTEX = `
attribute float seed;
attribute float size;
uniform float uTime;
uniform float uShowParticles;
varying float vAlpha;
void main(){
 if(uShowParticles<0.5){gl_Position=vec4(0.0);gl_PointSize=0.0;vAlpha=0.0;return;}
 vec3 pos=position;
 float speed=0.25+seed*0.35;
 pos.y=mod(pos.y+uTime*speed,14.0);
 pos.x+=sin(uTime*(0.4+seed*0.6)+seed*6.28318)*(0.6+seed*1.6);
 pos.z+=cos(uTime*(0.25+seed*0.35)+seed*4.71238)*(0.4+seed*1.2);
 vec4 mvPosition=modelViewMatrix*vec4(pos,1.0);
 gl_Position=projectionMatrix*mvPosition;
 gl_PointSize=size*(300.0/-mvPosition.z);
 vAlpha=uShowParticles;
}
`;

const PARTICLE_FRAGMENT = `
uniform vec3 uParticleColor;
varying float vAlpha;
void main(){
 vec2 coord=gl_PointCoord-vec2(0.5);
 float dist=length(coord);
 float alpha=1.0-smoothstep(0.0,0.5,dist);
 gl_FragColor=vec4(uParticleColor,alpha*vAlpha*0.55);
}
`;

export class MenuBackdrop{
 constructor(scene,camera){
  this.scene=scene;
  this.camera=camera;
  this.camera.add(this.root=new T.Group());
  this.root.position.set(0,0,-50);

  const planeGeo=new T.PlaneGeometry(2,2);
  this.gradientMaterial=new T.ShaderMaterial({
   vertexShader:GRADIENT_VERTEX,
   fragmentShader:GRADIENT_FRAGMENT,
   uniforms:{
    uTime:{value:0},
    uSkyTop:{value:new T.Color(0x071225)},
    uAccent:{value:new T.Color(0x63f2eb)},
    uSecondary:{value:new T.Color(0xff6592)},
    uFog:{value:new T.Color(0x203847)},
    uNoiseOctaves:{value:2}
   }
  });
  this.gradientPlane=new T.Mesh(planeGeo,this.gradientMaterial);
  this.gradientPlane.position.z=-0.1;
  this.root.add(this.gradientPlane);

  this.gridMaterial=new T.ShaderMaterial({
   vertexShader:GRADIENT_VERTEX,
   fragmentShader:GRID_FRAGMENT,
   transparent:true,
   depthWrite:false,
   uniforms:{
    uTime:{value:0},
    uAccent:{value:new T.Color(0x63f2eb)},
    uShowGrid:{value:1}
   }
  });
  this.gridPlane=new T.Mesh(planeGeo,this.gridMaterial);
  this.root.add(this.gridPlane);

  const count=1200;
  const positions=new Float32Array(count*3);
  const seeds=new Float32Array(count);
  const sizes=new Float32Array(count);
  for(let i=0;i<count;i++){
   positions[i*3]=-18+Math.random()*28;
   positions[i*3+1]=-2+Math.random()*20;
   positions[i*3+2]=-38+Math.random()*46;
   seeds[i]=Math.random();
   sizes[i]=0.04+Math.random()*0.12;
  }
  const particleGeo=new T.BufferGeometry();
  particleGeo.setAttribute('position',new T.BufferAttribute(positions,3));
  particleGeo.setAttribute('seed',new T.BufferAttribute(seeds,1));
  particleGeo.setAttribute('size',new T.BufferAttribute(sizes,1));
  this.particleMaterial=new T.ShaderMaterial({
   vertexShader:PARTICLE_VERTEX,
   fragmentShader:PARTICLE_FRAGMENT,
   transparent:true,
   depthWrite:false,
   blending:T.AdditiveBlending,
   uniforms:{
    uTime:{value:0},
    uShowParticles:{value:1},
    uParticleColor:{value:new T.Color(0x63f2eb)}
   }
  });
  this.particles=new T.Points(particleGeo,this.particleMaterial);
  this.particles.frustumCulled=false;
  this.scene.add(this.particles);

  this.targetColors={skyTop:new T.Color(),accent:new T.Color(),secondary:new T.Color(),fog:new T.Color(),particle:new T.Color()};
  this.currentColors={skyTop:new T.Color(this.gradientMaterial.uniforms.uSkyTop.value),accent:new T.Color(this.gradientMaterial.uniforms.uAccent.value),secondary:new T.Color(this.gradientMaterial.uniforms.uSecondary.value),fog:new T.Color(this.gradientMaterial.uniforms.uFog.value),particle:new T.Color(this.particleMaterial.uniforms.uParticleColor.value)};
  this.quality='auto';
  this.effects=true;
  this.visible=false;
  this.lastFov=0;
  this.lastAspect=0;
  this.setVisible(false);
 }
 setWorld(world){
  this.targetColors.skyTop.set(world.skyTop);
  this.targetColors.accent.set(world.accent);
  this.targetColors.secondary.set(world.secondary);
  this.targetColors.fog.set(world.fog);
  this.targetColors.particle.set(world.accent);
 }
 update(dt,clock,effects){
  this.effects=effects;
  const low=this.quality==='low';
  const t=clock;
  this.gradientMaterial.uniforms.uTime.value=t;
  this.gridMaterial.uniforms.uTime.value=t;
  this.particleMaterial.uniforms.uTime.value=t;

  const lerpFactor=Math.min(1,dt*8);
  for(const key of ['skyTop','accent','secondary','fog']){
   this.currentColors[key].lerp(this.targetColors[key],lerpFactor);
   this.gradientMaterial.uniforms['u'+key.charAt(0).toUpperCase()+key.slice(1)].value.copy(this.currentColors[key]);
  }
  this.currentColors.particle.lerp(this.targetColors.particle,lerpFactor);
  this.particleMaterial.uniforms.uParticleColor.value.copy(this.currentColors.particle);
  this.gridMaterial.uniforms.uAccent.value.copy(this.currentColors.accent);

  this.gradientMaterial.uniforms.uNoiseOctaves.value=low?0:(effects?2:1);
  this.gridMaterial.uniforms.uShowGrid.value=low?0:1;
  this.particleMaterial.uniforms.uShowParticles.value=(effects&&!low)?1:0;

  if(this.camera.fov!==this.lastFov||this.camera.aspect!==this.lastAspect){
   const fovRad=this.camera.fov*Math.PI/180;
   const h=2*Math.tan(fovRad/2)*50;
   const w=h*this.camera.aspect;
   const scale=1.05;
   this.gradientPlane.scale.set(w*scale,h*scale,1);
   this.gridPlane.scale.set(w*scale,h*scale,1);
   this.lastFov=this.camera.fov;
   this.lastAspect=this.camera.aspect;
  }
 }
 setVisible(b){
  this.visible=b;
  this.root.visible=b;
  this.particles.visible=b;
 }
 dispose(){
  this.camera.remove(this.root);
  this.scene.remove(this.particles);
  this.gradientMaterial.dispose();
  this.gridMaterial.dispose();
  this.particleMaterial.dispose();
  this.gradientPlane.geometry.dispose();
  this.particles.geometry.dispose();
 }
}
