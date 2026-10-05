import * as T from 'three';
import {box,rod,batch,neon,black,metal} from './models.js';
import {road,slope} from './physics.js';
import {getWorld,random,nextGate,pylon,skyParams} from './world-data.js';
import {heightField,normalFromHeight,roughnessFromHeight} from './materials.js';

function canvasTexture(draw,w=512,h=512){const c=document.createElement('canvas');c.width=w;c.height=h;draw(c.getContext('2d'),w,h);const t=new T.CanvasTexture(c);t.colorSpace=T.SRGBColorSpace;t.anisotropy=8;return t}
// G5: wrap a procedural typed-array map (materials.js) in a mipmapped, tiling DataTexture.
function dataTexture(data,size,rx=1,ry=1){const t=new T.DataTexture(data,size,size,T.RGBAFormat);t.wrapS=t.wrapT=T.RepeatWrapping;t.minFilter=T.LinearMipmapLinearFilter;t.magFilter=T.LinearFilter;t.generateMipmaps=true;t.anisotropy=8;t.repeat.set(rx,ry);t.needsUpdate=true;return t}
function surfaceTexture(color,seed=7){return canvasTexture((c,w,h)=>{c.fillStyle=color;c.fillRect(0,0,w,h);for(let i=0;i<34000;i++){const v=random(i+seed);c.fillStyle=v>.5?'rgba(255,255,255,.08)':'rgba(0,0,0,.10)';c.fillRect(random(i*2)*w,random(i*3+8)*h,1+v*2,1+v*2)}for(let i=0;i<12;i++){c.strokeStyle='#10151c22';c.lineWidth=.6;c.beginPath();let x=random(i*21)*w,y=random(i*32)*h;c.moveTo(x,y);for(let j=0;j<8;j++){x+=random(i*22+j)*20-10;y+=random(i*31+j)*12;c.lineTo(x,y)}c.stroke()}})}
// G4: richer procedural sky (sun disc + wide halo, horizon gradient bands, per-world cloud coverage/haze) —
// same mesh feeds both the background and the PMREM environment in World.setWorld(), so IBL picks it up too.
// The detail uniform gates the new per-pixel cost: World.render() drives it from quality==='high'||autoEffects,
// so adapt() degradation disables it. No external HDRI/texture asset is used.
function makeSky(world){
 const sp=skyParams(world);
 const u={top:{value:new T.Color(world.skyTop)},bottom:{value:new T.Color(world.skyBottom)},sunColor:{value:new T.Color(world.sun)},sunDir:{value:new T.Vector3(-.55,world.sunY,-.85).normalize()},time:{value:0},night:{value:world.kind==='city'?1:world.kind==='alpine'?.5:0},aurora:{value:world.kind==='alpine'?1:0},cover:{value:sp.cover},bandAmp:{value:sp.bands},disc:{value:sp.disc},halo:{value:sp.halo},haze:{value:sp.haze},cloudScale:{value:sp.cloudScale},detail:{value:1}};
 const m=new T.ShaderMaterial({side:T.BackSide,depthWrite:false,uniforms:u,vertexShader:`varying vec3 vDir;void main(){vDir=position;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`,fragmentShader:`
 varying vec3 vDir;uniform vec3 top,bottom,sunColor,sunDir;uniform float time,night,aurora,cover,bandAmp,disc,halo,haze,cloudScale,detail;
 float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
 float noise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(hash(i),hash(i+vec2(1,0)),f.x),mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),f.x),f.y);}
 float fbm(vec2 p){float v=0.,a=.5;for(int i=0;i<5;i++){v+=a*noise(p);p=p*2.03+17.2;a*=.5;}return v;}
 void main(){vec3 d=normalize(vDir);float h=max(d.y,0.);vec3 col=mix(bottom,top,pow(h,.52));
 col=mix(col,bottom*1.12,(1.-smoothstep(0.,.22,h))*haze*.6*detail);
 float sd=max(dot(d,sunDir),0.);col+=sunColor*(pow(sd,7500.)*8.*mix(.35,1.,disc)+pow(sd,90.)*.22+pow(sd,16.)*halo*.6*detail)*(1.-night*.85);
 col+=mix(bottom,top,.55)*(sin(d.y*46.+noise(d.xz*2.5)*3.)*.5+.5)*bandAmp*.14*smoothstep(.4,.04,h)*detail;
 vec2 cp=d.xz/max(.14,d.y)*cloudScale+vec2(time*.002,0);float clouds=smoothstep(cover,cover+.3,fbm(cp));col=mix(col,mix(bottom*.92,vec3(.72,.78,.8),.5),clouds*smoothstep(.01,.22,h)*.55);
 if(night>0.){float star=pow(hash(floor(d.xz/max(.1,d.y)*450.)),170.);col+=vec3(star)*night*smoothstep(.05,.4,h);}
 if(aurora>.5){float curtain=sin(d.x*9.+d.z*4.+sin(d.z*14.+time*.025)*.5);float band=exp(-pow((d.y-.28-.08*curtain)*18.,2.));col+=vec3(.05,.5,.34)*band*(.3+.7*noise(vec2(d.x*70.,d.z*5.)))*.5;}
 gl_FragColor=vec4(col,1.);
#include <tonemapping_fragment>\n#include <colorspace_fragment>}
 `});const sky=new T.Mesh(new T.SphereGeometry(1500,32,16),m);sky.frustumCulled=false;return sky;
}
function mountainGeometry(kind,seed){
 const geo=new T.PlaneGeometry(1700,240,64,16);geo.rotateX(-Math.PI/2);const p=geo.attributes.position,col=[];
 for(let i=0;i<p.count;i++){const x=p.getX(i),z=(seed*80-p.getZ(i))*Math.PI*2/3120;const edge=Math.max(0,(Math.abs(x)-55)/250);let height=(Math.sin(x*.016)*.4+Math.sin(z*5+x*.007)*.2+.85)*Math.min(1,edge)*100;
 height+=Math.min(1,edge)*(Math.sin(x*.09+z*8)*5+Math.sin(z*12+x*.17)*2);
 if(kind==='desert'){height*=.73;height=Math.round(height/5)*5+Math.sin(x*.2)*1.2}else height*=1.6;
 p.setY(i,height-10);const shade=.70+random(i+seed)*.22;const c=new T.Color(kind==='alpine'?(height>65?'#dfebef':'#72838b'):'#ae7957');c.multiplyScalar(shade);col.push(c.r,c.g,c.b);
 }geo.setAttribute('color',new T.Float32BufferAttribute(col,3));geo.computeVertexNormals();return geo;
}
function waterMaterial(world){return new T.ShaderMaterial({transparent:false,uniforms:{time:{value:0},fogColor:{value:new T.Color(world.fog)},sunColor:{value:new T.Color(world.sun)},sunDir:{value:new T.Vector3(-.55,.48,-.85).normalize()}},vertexShader:`varying vec3 wp;varying vec3 vp;uniform float time;void main(){vec3 p=position;p.y+=sin(p.x*.06+time*.55)*.28+sin(p.z*.04-time*.35)*.3;vec4 world=modelMatrix*vec4(p,1.);wp=world.xyz;vec4 v=modelViewMatrix*vec4(p,1.);vp=v.xyz;gl_Position=projectionMatrix*v;}`,fragmentShader:`varying vec3 wp;varying vec3 vp;uniform float time;uniform vec3 fogColor,sunColor,sunDir;void main(){float dx=cos(wp.x*.11+time*.8)*.09+cos(wp.x*.31+wp.z*.16+time)*.035;float dz=cos(wp.z*.075-time*.6)*.08;vec3 n=normalize(vec3(dx,1.,dz));vec3 eye=normalize(cameraPosition-wp);float fres=pow(1.-max(dot(eye,n),0.),4.);vec3 c=mix(vec3(.027,.13,.17),fogColor*.85,fres);float spec=pow(max(dot(reflect(-sunDir,n),eye),0.),180.);c+=sunColor*spec*2.;float wave=pow(.5+.5*sin(wp.x*.12+wp.z*.23+time*.5),18.);c+=vec3(.08,.13,.13)*wave;float fog=1.-exp(-length(vp)*.0015);gl_FragColor=vec4(mix(c,fogColor,fog),1.);
#include <tonemapping_fragment>\n#include <colorspace_fragment>}`})}
export class Environment{
 constructor(scene,id){this.scene=scene;this.root=new T.Group();scene.add(this.root);this.world=getWorld(id);this.fx=true;const w=this.world;
 this.sky=makeSky(w);this.root.add(this.sky);
 this.concrete=new T.MeshStandardMaterial({map:surfaceTexture(w.kind==='city'?'#38424a':'#8b8b83'),roughness:.87,metalness:.06});
 this.roadTexture=surfaceTexture(w.road);this.roadTexture.wrapS=this.roadTexture.wrapT=T.RepeatWrapping;this.roadTexture.repeat.set(3,6);this.roadMat=new T.MeshStandardMaterial({map:this.roadTexture,roughness:.48,metalness:.15});
 // G5: procedural normal + roughness multiplier maps (materials.js — no external assets). Assigned by
 // setDetailMaps() only, gated on quality==='high'||autoEffects; roughness values centre on 1 so the
 // per-frame wet/dry roughness uniform is preserved (the map multiplies it).
 const rh=heightField(256,{period:12,octaves:4,seed:11}),gh=heightField(256,{period:9,octaves:4,seed:29});
 this.detail={roadN:dataTexture(normalFromHeight(rh,256,2.4),256,3,6),roadR:dataTexture(roughnessFromHeight(rh,256),256,3,6),groundN:dataTexture(normalFromHeight(gh,256,3),256,60,60),groundR:dataTexture(roughnessFromHeight(gh,256,{amp:.22}),256,60,60)};
 this.edgeMat=neon(w.accent,2.2);this.secondaryMat=neon(w.secondary,3.4);const line=new T.MeshStandardMaterial({color:'#d8d4be',roughness:.7});
 this.chunks=[];
 for(let i=0;i<44;i++){const g=new T.Group();const deck=box(g,18,.4,24,0,-.23,0,this.roadMat);deck.receiveShadow=true;
 for(const side of [-1,1]){box(g,.38,.62,24,side*9.25,.16,0,this.concrete);box(g,.045,.035,24,side*9.02,.50,0,this.edgeMat);for(let k=0;k<4;k++)box(g,.42,.08,.15,side*9.25,.52,k*6-9,metal);box(g,.10,.015,24,side*8.3,.006,0,line);if(i%3===0){rod(g,[side*10,0,0],[side*10,8,0],.09,metal);rod(g,[side*10,8,0],[side*7.5,8,0],.07,metal);box(g,2,.07,.25,side*7.5,7.94,0,this.edgeMat)}box(g,1.5,13,1.5,side*7,-6,0,this.concrete)}
 for(const x of [-4.5,0,4.5])for(const z of [-8,0,8])box(g,.095,.018,4,x,.008,z,line);
 batch(g);g.traverse(o=>{if(o.isMesh)o.receiveShadow=true});this.chunks.push(g);this.root.add(g);
 }
 this.scenery=[];this.terrain=[];
 if(w.kind==='city')this.buildCity();else this.buildLandscape();
 this.beacons=[];for(let i=0;i<9;i++){const g=new T.Group();const hoop=new T.Mesh(new T.TorusGeometry(7,.13,8,64),this.edgeMat);g.add(hoop);for(let n=0;n<4;n++){const t=box(g,.16,.9,.24,Math.sin(n*Math.PI/2)*7,Math.cos(n*Math.PI/2)*7,0,this.secondaryMat);t.rotation.z=-n*Math.PI/2}const number=canvasTexture((c,a,b)=>{c.clearRect(0,0,a,b);c.fillStyle=w.accent;c.textAlign='center';c.font='bold 70px monospace';c.fillText('VECTOR',a/2,100);c.font='30px monospace';c.fillText('AIR CORRIDOR',a/2,150)},512,256);const label=new T.Mesh(new T.PlaneGeometry(5,2.5),new T.MeshBasicMaterial({map:number,transparent:true,depthWrite:false}));label.position.y=9;g.add(label);this.beacons.push(g);this.root.add(g)}
 this.pylons=[];for(let i=0;i<5;i++){const g=new T.Group();box(g,5,38,7,0,19,0,this.concrete);box(g,5.3,.5,7.3,0,38,0,metal);for(const side of [-1,1])box(g,.065,36,.07,side*2.55,19,3.55,this.secondaryMat);const cap=new T.Mesh(new T.SphereGeometry(.23,10,8),neon('#ff7656',4.5));cap.position.y=38.6;g.add(cap);batch(g);this.pylons.push(g);this.root.add(g)}
 const glow=canvasTexture((c,a,b)=>{const v=c.createRadialGradient(a/2,b/2,0,a/2,b/2,a/2);v.addColorStop(0,'#ffffff66');v.addColorStop(.25,'#ffffff16');v.addColorStop(1,'#ffffff00');c.fillStyle=v;c.fillRect(0,0,a,b)},128,128);
 this.reflections=[];const reflGeo=new T.PlaneGeometry(4,19);reflGeo.rotateX(-Math.PI/2);this.reflM4=new T.Matrix4();for(const color of [w.secondary,w.accent]){const m=new T.InstancedMesh(reflGeo,new T.MeshBasicMaterial({map:glow,color,transparent:true,depthWrite:false,blending:T.AdditiveBlending}),12);m.count=0;m.frustumCulled=false;this.root.add(m);this.reflections.push(m)}
 }
 buildCity(){const w=this.world;
 const facade=canvasTexture((c,a,b)=>{c.fillStyle='#27333f';c.fillRect(0,0,a,b);for(let y=0;y<b;y+=32){c.fillStyle='#2b3540';c.fillRect(0,y,a,2);for(let x=0;x<a;x+=26){const v=random(x+y*8);c.fillStyle=v>.80?'#e8d3a2':v>.62?'#8fb5c2':v>.34?'#354e5f':'#1b303e';c.fillRect(x+4,y+4,15,23);c.fillStyle='#a9b5b122';c.fillRect(x+4,y+4,2,23);if(v>.85){c.fillStyle='#9c886b';c.fillRect(x+5,y+13,13,1)}}}},256,512);
 const mat=new T.MeshStandardMaterial({map:facade,emissiveMap:facade,emissive:'#7b97a4',emissiveIntensity:.30,metalness:.45,roughness:.42});this.cityMat=mat;
 for(let i=0;i<72;i++){const g=new T.Group(),side=i%2?1:-1,x=side*(56+random(i+4)*70),h=28+random(i+8)*155,width=14+random(i+10)*22,depth=14+random(i+19)*20;
 const main=box(g,width,h,depth,x,h/2-3,0,mat);main.castShadow=true;box(g,width+2,8,depth+2,x,-5,0,this.concrete);
 box(g,width*.68,h*.25,depth*.72,x,h+ h*.125-3,0,mat);box(g,width+1,.5,depth+1,x,h-3,0,this.concrete);
 for(let j=0;j<4;j++)box(g,.22,h,depth+.15,x-width/2+width*j/3,h/2-3,0,this.concrete);
 for(let y=10;y<h;y+=18)box(g,width+.3,.3,depth+.3,x,y,0,this.concrete);
 box(g,2,2,4,x+2,h*1.25-2,0,metal);rod(g,[x,h*1.25-2,0],[x,h*1.25+7,0],.06,metal);
 if(i%3===0){box(g,.12,h*.85,.1,x-width*.5-.15,h*.5,depth*.5,this.secondaryMat);const text=['AKUMA','空路 / SKYWAY','NO SLEEP','夜の街','VECTOR','KŌSOKU'][i%6];const tex=canvasTexture((c,a,b)=>{c.fillStyle='#131d2a';c.fillRect(0,0,a,b);c.fillStyle=i%2?w.accent:w.secondary;c.textAlign='center';c.font='bold 68px sans-serif';c.fillText(text,a/2,130);c.font='18px monospace';c.fillText('LIFE ABOVE THE STREET',a/2,186);c.fillStyle='rgba(0,0,0,.14)';for(let y=0;y<b;y+=4)c.fillRect(0,y,a,1);for(let n=0;n<400;n++){const v=random(n*3+i);c.fillStyle=v>.5?'rgba(255,255,255,.06)':'rgba(0,0,0,.10)';c.fillRect(random(n*7+i)*a,random(n*11+i*3)*b,1+v*2,1+v*2)}c.strokeStyle=i%2?w.accent:w.secondary;c.lineWidth=3;c.strokeRect(4,4,a-8,b-8)},512,256);const sign=new T.Mesh(new T.PlaneGeometry(12,6),new T.MeshBasicMaterial({map:tex,side:T.DoubleSide}));sign.position.set(x,Math.min(30,h*.7),depth*.5+.3);g.add(sign)}
 if(i%6===0){const bridge=box(g,side*0+18,2,4,side*27,52,0,this.concrete);box(g,18,.07,4.1,side*27,53.1,0,this.edgeMat)}
 batch(g);this.scenery.push(g);this.root.add(g);
 }
 const ground=new T.Mesh(new T.PlaneGeometry(2500,2500),this.concrete.clone());ground.rotation.x=-Math.PI/2;ground.position.y=-6;ground.receiveShadow=true;this.root.add(ground);this.ground=ground;this.groundMat=ground.material;
 }
 buildLandscape(){const w=this.world;
 if(w.kind==='ocean'){
 const geo=new T.PlaneGeometry(2800,2800,100,100);geo.rotateX(-Math.PI/2);this.water=new T.Mesh(geo,waterMaterial(w));this.water.position.y=-11;this.root.add(this.water);
 }else{
 const mat=new T.MeshStandardMaterial({vertexColors:true,roughness:.98,metalness:.04});for(let i=0;i<13;i++){const t=new T.Mesh(mountainGeometry(w.kind,i*3),mat);t.receiveShadow=true;this.terrain.push(t);this.root.add(t)}
 }
 const desertRock=w.kind==='desert'?new T.MeshStandardMaterial({color:'#8a5a3c',roughness:.95,metalness:0,flatShading:true}):null,desertCactus=w.kind==='desert'?new T.MeshStandardMaterial({color:'#3d5c3a',roughness:.8,metalness:0}):null,frost=w.kind==='alpine'?neon('#cfe9ff',1.1):null;
 for(let i=0;i<24;i++){const g=new T.Group(),side=i%2?1:-1,x=side*(47+random(i+8)*90);
 if(w.kind==='ocean'){
 box(g,25,1.7,24,x,-1,0,this.concrete);box(g,5,11,5,x,-6,0,this.concrete);
 const h=25+random(i+21)*65;box(g,6,h,7,x,h/2,0,metal);box(g,6.1,.10,7.1,x,h-3,0,this.edgeMat);
 const rot=new T.Group();rot.position.set(x,h,0);for(let j=0;j<3;j++){const blade=box(rot,1.2,23,.3,0,11,0,this.concrete);blade.geometry=blade.geometry.clone(); // centered blades on separate groups
 const arm=new T.Group();blade.position.y=11;rot.remove(blade);arm.add(blade);arm.rotation.z=j*2*Math.PI/3;rot.add(arm)}g.add(rot);g.userData.rotor=rot;
 }else if(w.kind==='desert'){
 // Sparse rock clusters with an occasional saguaro replace the industrial tower silhouette.
 for(let j=0;j<4;j++){const a=random(i*7+j)*Math.PI*2,r=1.5+random(i*3+j)*5,rock=new T.Mesh(new T.DodecahedronGeometry(.8+random(i+j*13)*1.7,0),desertRock);rock.position.set(x+Math.cos(a)*r,.25,Math.sin(a)*r);rock.scale.y=.5+random(j*5+i)*.5;rock.rotation.y=a;g.add(rock)}
 if(i%3===0){const ch=6+random(i+2)*5;rod(g,[x,0,0],[x,ch,0],.45,desertCactus);for(const side of[-1,1]){rod(g,[x+side*.4,ch*.55,0],[x+side*1.5,ch*.55,0],.3,desertCactus);rod(g,[x+side*1.5,ch*.55,0],[x+side*1.5,ch*.82,0],.3,desertCactus)}}
 }else{
 const h=8+random(i+4)*12;box(g,19,h,19,x,h/2-2,0,this.concrete);for(const dx of [-7,7])for(const dz of [-7,7])box(g,1.5,35,1.5,x+dx,-18,dz,this.concrete);box(g,15,1,15,x,h-1,0,metal);box(g,18,.06,.1,x,h-2,9.6,this.edgeMat);for(let j=0;j<4;j++)box(g,1.4,1.4,.05,x-6+j*4,h*.65,9.55,new T.MeshStandardMaterial({color:'#1a3540',metalness:.85,roughness:.18}));rod(g,[x,h,0],[x,h+9,0],.1,metal);
 if(w.kind==='alpine'){box(g,15.6,.22,15.6,x,h-.32,0,frost);for(const dx of[-6,0,6])rod(g,[x+dx,h-1.5,7.6],[x+dx,h-2.9-random(i+dx+20),7.6],.09,frost)}
 }
 if(w.kind!=='ocean')batch(g);this.scenery.push(g);this.root.add(g);
 }
 // A distant, monumental ring makes the impossible architecture physically legible.
 const monument=new T.Group(),radius=w.kind==='desert'?95:w.kind==='ocean'?70:80;
 const arch=new T.Mesh(new T.TorusGeometry(radius,4,12,96),this.concrete);monument.add(arch);const inner=new T.Mesh(new T.TorusGeometry(radius-4.4,.18,6,96),this.edgeMat);monument.add(inner);
 for(let i=0;i<8;i++){const a=i*Math.PI/4;const rib=box(monument,5,15,7,Math.sin(a)*radius,Math.cos(a)*radius,0,metal);rib.rotation.z=-a}
 monument.position.set(w.kind==='desert'?-170:190,80,-850);monument.rotation.y=.35;this.root.add(monument);this.monument=monument;
 }
 update(s,clock,setup,flight){const rx=road(s),range=setup.quality==='low'?480:850;this.sky.position.set(0,0,0);this.sky.material.uniforms.time.value=clock;this.sky.material.uniforms.detail.value=this.fx===false?0:1;
 const rb=Math.floor(s/24)-5;for(let i=0;i<this.chunks.length;i++){const n=rb+((i-rb)%this.chunks.length+this.chunks.length)%this.chunks.length,at=n*24;const g=this.chunks[i];g.position.set(road(at)-rx,0,s-at);g.rotation.y=-Math.atan(slope(at));g.visible=s-at>-range&&s-at<100}
 const spacing=this.world.kind==='city'?32:85,cb=Math.floor(s/spacing)-6;for(let i=0;i<this.scenery.length;i++){const n=cb+((i-cb)%this.scenery.length+this.scenery.length)%this.scenery.length,at=n*spacing,g=this.scenery[i];g.position.set(road(at)-rx,0,s-at);g.visible=s-at>-range-150&&s-at<240;if(g.visible&&g.userData.rotor)g.userData.rotor.rotation.z=clock*.18}
 const tb=Math.floor(s/240)-3;for(let i=0;i<this.terrain.length;i++){const n=tb+((i-tb)%this.terrain.length+this.terrain.length)%this.terrain.length;this.terrain[i].position.set(-rx,0,s-n*240)}
 const first=Math.max(0,Math.floor((s-180)/190));for(let i=0;i<this.beacons.length;i++){const gate=nextGate(first+i),m=this.beacons[i];m.position.set(road(gate.s)-rx+gate.x,gate.y,s-gate.s);m.visible=gate.s-s<range&&gate.s-s>-40&&(flight||Math.abs(gate.s-s)<400);m.children[0].material=this.edgeMat;}
 const pb=Math.max(0,Math.floor((s-340)/470));for(let i=0;i<this.pylons.length;i++){const p=pylon(pb+i);this.pylons[i].position.set(road(p.s)-rx+p.x,0,s-p.s)}
 const wet=setup.weather==='rain';this.roadMat.roughness=wet?.26:.83;this.roadMat.metalness=wet?.27:.05;this.roadMat.envMapIntensity=wet?1.6:.8;
 const fb=Math.floor(s/36)-3,rc=[0,0];for(let i=0;i<24;i++){const at=(fb+((i-fb)%24+24)%24)*36;if(!wet||at-s>=range||at-s<=-40)continue;const g=i%2;this.reflM4.makeTranslation(road(at)-rx+(g?6:-6),.018,s-at);this.reflections[g].setMatrixAt(rc[g]++,this.reflM4)}for(let g=0;g<2;g++){this.reflections[g].count=rc[g];if(rc[g])this.reflections[g].instanceMatrix.needsUpdate=true}
 if(this.water)this.water.material.uniforms.time.value=clock;
 if(this.monument)this.monument.position.z=-850+(s%1800)*.14;
 }
 // G5: assign/remove the procedural detail maps (no-op across repeated same-value calls; the one shader
 // recompile per transition is accepted). Called from World.render() with effects && setup.gfxDetail==='on'.
 setDetailMaps(on){if(this.detailMaps===on)return;this.detailMaps=on;const d=on?this.detail:{};
 for(const m of [this.roadMat,this.groundMat]){if(!m)continue;const g=m===this.groundMat;m.normalMap=(g?d.groundN:d.roadN)||null;m.roughnessMap=(g?d.groundR:d.roadR)||null;m.needsUpdate=true}}
 dispose(){this.scene.remove(this.root);const geometry=new Set(),materials=new Set(),textures=new Set();this.root.traverse(o=>{if(o.isInstancedMesh)o.dispose();if(o.geometry)geometry.add(o.geometry);if(o.material&&![black,metal].includes(o.material)){materials.add(o.material);for(const k of ['map','emissiveMap','roughnessMap','normalMap'])if(o.material[k])textures.add(o.material[k])}});for(const k in this.detail)textures.add(this.detail[k]);geometry.forEach(g=>{if(g.type!=='BoxGeometry')g.dispose()});materials.forEach(m=>m.dispose());textures.forEach(t=>t.dispose())}
}
