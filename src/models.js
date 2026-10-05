import * as T from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';
const neon=(color,intensity=2.6)=>new T.MeshStandardMaterial({color,emissive:color,emissiveIntensity:intensity,roughness:.6,metalness:0});
const black=new T.MeshStandardMaterial({color:0x080d16,roughness:.65,metalness:.45});
const metal=new T.MeshStandardMaterial({color:0x727f89,metalness:.85,roughness:.3});
const rubber=new T.MeshStandardMaterial({color:0x07090d,roughness:.92});
black.color.set(0x0b1019);black.roughness=.45;black.metalness=0;
metal.color.set(0x8d98a3);metal.metalness=1;metal.roughness=.28;
rubber.color.set(0x14171c);rubber.roughness=.82;rubber.metalness=0;
const cube=new T.BoxGeometry(1,1,1);
function box(parent,w,h,d,x,y,z,mat){const m=new T.Mesh(cube,mat);m.scale.set(w,h,d);m.position.set(x,y,z);parent.add(m);return m}
function ball(parent,x,y,z,sx,sy,sz,mat){const m=new T.Mesh(new T.SphereGeometry(1,16,12),mat);m.position.set(x,y,z);m.scale.set(sx,sy,sz);parent.add(m);return m}
function rod(parent,a,b,r,mat){const av=new T.Vector3(...a),bv=new T.Vector3(...b),d=bv.clone().sub(av);const m=new T.Mesh(new T.CylinderGeometry(r,r,d.length(),10),mat);m.position.copy(av.add(bv).multiplyScalar(.5));m.quaternion.setFromUnitVectors(new T.Vector3(0,1,0),d.normalize());parent.add(m);return m}
// Batch static mesh parts by material, preserving independently rotating wheels.
function batch(group,exclude=[]){group.updateMatrixWorld(true);const inverse=group.matrixWorld.clone().invert(),buckets=new Map(),old=[];function walk(node){if(exclude.includes(node))return;if(node.isMesh){const geo=node.geometry.clone().applyMatrix4(new T.Matrix4().multiplyMatrices(inverse,node.matrixWorld));if(!buckets.has(node.material))buckets.set(node.material,[]);buckets.get(node.material).push(geo);old.push(node)}else for(const child of node.children)walk(child)}for(const child of group.children)walk(child);for(const mesh of old)mesh.removeFromParent();for(const [mat,geos] of buckets){const merged=mergeGeometries(geos,false);if(merged)group.add(new T.Mesh(merged,mat));geos.forEach(g=>g.dispose())}return group}
export function makeBike(bike,color,rider=true){if(bike.id==='nightblade'&&heroTemplate)return makeHero(color,rider);const g=new T.Group(),body=new T.MeshPhysicalMaterial({color,metalness:.05,roughness:.38,clearcoat:1,clearcoatRoughness:.05});g.userData.paint=body;const glow=neon(color,2.4);g.userData.glow=glow;const classic=bike.style==='classic',cruiser=bike.style==='cruiser',hyper=bike.style==='hyper';const front=cruiser?-1.22:hyper?-1.12:-1.04,rear=1.02;
g.userData.wheels=[];g.userData.cockpit=[];const tag=m=>{m.userData.cockpit=true;g.userData.cockpit.push(m);return m};
for(const z of [front,rear]){const wheel=new T.Group();wheel.position.set(0,.43,z);const tire=new T.Mesh(new T.TorusGeometry(.32,.115,12,32),rubber);tire.rotation.y=Math.PI/2;wheel.add(tire);const rim=new T.Mesh(new T.CylinderGeometry(.27,.27,.14,24),black);rim.rotation.z=Math.PI/2;wheel.add(rim);for(const x of [-.085,.085]){const ring=new T.Mesh(new T.TorusGeometry(.268,.012,6,32),glow);ring.rotation.y=Math.PI/2;ring.position.x=x;wheel.add(ring);for(let i=0;i<6;i++){const a=i*Math.PI/3;rod(wheel,[x,0,0],[x,Math.sin(a)*.255,Math.cos(a)*.255],.019,metal)}const disc=new T.Mesh(new T.CylinderGeometry(.19,.19,.012,24),metal);disc.rotation.z=Math.PI/2;disc.position.x=x*1.4;wheel.add(disc)}g.add(wheel);g.userData.wheels.push(wheel)}
for(const side of [-1,1]){rod(g,[side*.18,.45,rear],[side*.20,.79,0],.06,metal);rod(g,[side*.18,.45,front],[side*.22,1.24,-.58],.037,metal);rod(g,[side*.25,.61,.5],[side*.28,1.08,-.3],.04,body);rod(g,[side*.25,.61,.5],[side*.28,1.0,.6],.04,body)}
ball(g,0,.77,.10,.32,.29,.42,black);for(let i=0;i<5;i++)box(g,.63,.025,.47,0,.69+i*.065,.1,metal);
ball(g,0,1.18,-.2,cruiser?.33:.34,.23,.49,body);box(g,.40,.13,.7,0,1.16,.52,black);const tail=box(g,.48,.17,.49,0,1.17,.89,body);tail.rotation.x=-.18;box(g,.36,.04,.03,0,1.19,1.145,neon(0xff2359,7.5));
for(const side of [-1,1]){rod(g,[side*.33,.59,.3],[side*.40,.48,.94],.09,metal);rod(g,[side*.20,.7,-.25],[side*.34,.5,.3],.043,metal);tag(rod(g,[0,1.27,-.61],[side*.43,cruiser?1.55:1.28,-.6],.035,metal));tag(box(g,.19,.055,.1,side*.40,cruiser?1.55:1.28,-.6,black))}
if(classic||cruiser){const lamp=new T.Mesh(new T.CylinderGeometry(.18,.18,.12,24),neon(0xd4eeff,3));lamp.rotation.x=Math.PI/2;lamp.position.set(0,1.24,-.85);g.add(lamp);box(g,.12,.09,.08,-.35,1.22,-.78,neon(0xffad42));box(g,.12,.09,.08,.35,1.22,-.78,neon(0xffad42));}else{fairing(g,hyper?.46:.38,body);for(const side of [-1,1]){const panel=box(g,.1,.45,.72,side*.29,.84,-.30,body);panel.rotation.z=side*-.2;box(g,.21,.037,.08,side*.2,1.16,-1.09,neon(0xa8f8ff,5));const stripe=box(g,.02,.035,.8,side*.38,1.01,-.3,glow);stripe.rotation.x=.08;tag(rod(g,[side*.28,1.31,-.71],[side*.47,1.37,-.74],.02,black));tag(box(g,.16,.07,.09,side*.49,1.37,-.74,metal))}const glass=new T.MeshStandardMaterial({color:0x254f65,metalness:0,roughness:.05,transparent:true,opacity:.42});const windshield=tag(ball(g,0,1.37,-.75,.27,.27,.16,glass));windshield.rotation.x=-.4;}
box(g,.035,.018,.8,0,.44,0,glow);
if(rider){const suit=new T.MeshStandardMaterial({color:0x111924,metalness:0,roughness:.55});const torso=ball(g,0,1.65,.21,.28,.42,.24,suit);torso.rotation.x=-.48;ball(g,0,2.04,-.13,.22,.26,.23,black);ball(g,0,2.07,-.295,.19,.105,.075,new T.MeshPhysicalMaterial({color:0x416778,metalness:.92,roughness:.11,clearcoat:1}));box(g,.14,.025,.025,0,2.29,-.19,glow);g.userData.arms=[];for(const side of [-1,1]){rod(g,[side*.2,1.76,.05],[side*.36,1.53,-.25],.09,suit);const arm=rod(g,[side*.36,1.53,-.25],[side*.40,cruiser?1.55:1.28,-.6],.075,suit);g.userData.arms.push(arm);tag(arm);rod(g,[side*.20,1.36,.46],[side*.40,.96,.04],.13,suit);rod(g,[side*.40,.96,.04],[side*.32,.61,.44],.105,suit);box(g,.18,.12,.33,side*.33,.57,.33,black);rod(g,[side*.24,1.9,.11],[side*.28,1.63,.27],.018,glow)}}for(const side of [-1,1]){
 for(let z=-.28;z<.2;z+=.09)box(g,.02,.24,.023,side*.325,.8,z,black);
 for(const z of [front,rear]){box(g,.055,.16,.10,side*.135,.53,z-.16,new T.MeshStandardMaterial({color:0xb85e30,metalness:1,roughness:.34}));}
 rod(g,[side*.22,.83,-.78],[side*.23,1.2,-.60],.048,new T.MeshStandardMaterial({color:0xc4a66d,metalness:1,roughness:.23}));
 for(let i=0;i<4;i++)ball(g,side*.335,.82+i*.065,.22,.016,.016,.016,metal);
}
// Reinforced riding suit: shoulder armor, knee pads, gloves and a segmented spine.
if(rider){const armor=new T.MeshStandardMaterial({color:0x29323b,metalness:0,roughness:.45});
for(const side of [-1,1]){ball(g,side*.23,1.79,.07,.115,.12,.15,armor);ball(g,side*.40,.98,.02,.105,.14,.095,armor);tag(ball(g,side*.40,cruiser?1.55:1.28,-.6,.075,.07,.10,black));rod(g,[side*.17,1.66,.39],[side*.16,1.38,.49],.015,metal);}
for(let i=0;i<4;i++){const plate=box(g,.23,.08,.065,0,1.80-i*.1,.40+i*.025,armor);plate.rotation.x=-.35;}
box(g,.10,.065,.055,0,2.05,-.37,black);for(const side of [-1,1])ball(g,side*.205,2.06,-.08,.026,.07,.07,metal);}
const fender=new T.Mesh(new T.TorusGeometry(.43,.055,8,24,Math.PI*.8),body);fender.rotation.y=Math.PI/2;fender.rotation.z=.1;fender.position.set(0,.43,front);g.add(fender);
for(const wheel of g.userData.wheels)batch(wheel);batch(g,[...g.userData.wheels,...g.userData.cockpit]);addFlightRig(g,glow);g.traverse(o=>{if(o.isMesh){o.castShadow=true;o.receiveShadow=true}});return g}

function fairing(parent,width,material){
 const sections=[[-1.17,1.12,.12,.045],[-1.0,1.09,width*.75,.14],[-.72,1.0,width,.28],[-.28,.89,width*.83,.29],[.10,.83,width*.70,.24]];
 const pos=[],uv=[],ix=[],n=18;
 for(let i=0;i<sections.length;i++){const [z,y,w,h]=sections[i];for(let j=0;j<=n;j++){const a=j/n*Math.PI*2;pos.push(Math.cos(a)*w,y+Math.sin(a)*h,z);uv.push(j/n,i/(sections.length-1));if(i<sections.length-1&&j<n){const k=i*(n+1)+j;ix.push(k,k+1,k+n+1,k+1,k+n+2,k+n+1)}}}
 const geo=new T.BufferGeometry();geo.setAttribute('position',new T.Float32BufferAttribute(pos,3));geo.setAttribute('uv',new T.Float32BufferAttribute(uv,2));geo.setIndex(ix);geo.computeVertexNormals();const m=new T.Mesh(geo,material);parent.add(m);return m;
}
function addFlightRig(bike,glow){
 const rig=new T.Group(),rotors=[],jets=[];
 for(const side of [-1,1])for(const z of [-.7,.7]){
  rod(rig,[side*.2,.62,z],[side*.72,.58,z],.055,metal);
  const pod=new T.Group();pod.position.set(side*.78,.56,z);
  const rim=new T.Mesh(new T.TorusGeometry(.26,.065,10,32),black);rim.rotation.x=Math.PI/2;pod.add(rim);
  const light=new T.Mesh(new T.TorusGeometry(.265,.012,6,32),glow);light.rotation.x=Math.PI/2;light.position.y=.042;pod.add(light);
  const fan=new T.Group();for(let i=0;i<5;i++){const blade=box(fan,.4,.018,.052,0,0,0,metal);blade.rotation.y=i*Math.PI/5}pod.add(fan);rotors.push(fan);
  const jet=new T.Mesh(new T.ConeGeometry(.17,.65,16,1,true),new T.MeshBasicMaterial({color:0x65e9ff,transparent:true,opacity:.22,depthWrite:false,blending:T.AdditiveBlending,side:T.DoubleSide}));jet.position.y=-.35;jet.rotation.z=Math.PI;pod.add(jet);jets.push(jet);rig.add(pod);
 }
 for(const side of [-1,1]){const wing=box(rig,.8,.025,.35,side*.55,.9,.35,metal);wing.rotation.z=side*.10;}
 rig.visible=false;bike.add(rig);bike.userData.flightRig=rig;bike.userData.rotors=rotors;bike.userData.jets=jets;
}
export function animateBike(bike,{speed=0,flight=0,boost=false,time=0,dt=0}){
 const blend=flight;bike.userData.flightRig.visible=blend>.01;bike.userData.flightRig.scale.setScalar(Math.max(.01,blend));
 for(const wheel of bike.userData.wheels){wheel.userData.spin=(wheel.userData.spin||0)-speed*dt/(wheel.userData.radius||.43);wheel.rotation.set(wheel.userData.spin*(1-blend),0,blend*Math.PI/2);}
 for(const rotor of bike.userData.rotors)rotor.rotation.y+=dt*(boost?110:65);
 bike.userData.jets.forEach((j,i)=>{j.scale.y=(boost?1.8:1)+Math.sin(time*32+i)*.12;j.material.opacity=boost?.45:.2});
}
export function disposeModel(model){const gs=new Set(),ms=new Set();model.traverse(o=>{if(o.isMesh){if(o.userData.sharedTemplate)return;if(o.geometry!==cube)gs.add(o.geometry);if(![black,metal,rubber].includes(o.material))ms.add(o.material)}});gs.forEach(g=>g.dispose());ms.forEach(m=>m.dispose());}
export {box,ball,rod,batch,neon,black,metal,rubber};

let heroTemplate=null;
export async function loadHero(){
 try{heroTemplate=(await new GLTFLoader().loadAsync('./assets/models/kestrel.glb')).scene;return true}catch(error){console.warn('Hero asset unavailable; using built-in bike',error);return false}
}
function makeHero(color,rider){
 const g=new T.Group(),body=new T.MeshPhysicalMaterial({color,metalness:.05,roughness:.38,clearcoat:1,clearcoatRoughness:.05}),glow=neon(color,2.2);
 const model=heroTemplate.clone(true);model.traverse(o=>{if(o.isMesh){o.geometry=o.geometry.clone();o.material=o.material.name==='custom-paint'?body:o.material.clone();o.castShadow=true;o.receiveShadow=true}});g.add(model);
 g.userData.paint=body;g.userData.glow=glow;g.userData.wheels=[model.getObjectByName('front-wheel'),model.getObjectByName('rear-wheel')];g.userData.wheels[0].userData.radius=.523;g.userData.wheels[1].userData.radius=.437;
 // Original cyberpunk conversion; the source's chassis and wheels are preserved.
 for(const side of [-1,1]){box(g,.022,.025,.62,side*.25,.98,-.1,glow);box(g,.14,.045,.04,side*.18,1.01,-.65,neon('#c7f5ff',3));box(g,.16,.04,.035,side*.15,1.08,.95,neon('#ff3759',5))}
 if(rider){const suit=new T.MeshStandardMaterial({color:0x121b23,roughness:.7}),armor=new T.MeshStandardMaterial({color:0x36444c,roughness:.45,metalness:0}),r=new T.Group();
 const torso=ball(r,0,1.45,.22,.24,.36,.18,suit);torso.rotation.x=-.6;
 for(const side of [-1,1]){rod(r,[side*.18,1.54,0],[side*.3,1.32,-.25],.08,suit);rod(r,[side*.3,1.32,-.25],[side*.37,1.13,-.48],.067,suit);ball(r,side*.37,1.13,-.48,.075,.065,.09,black);rod(r,[side*.15,1.23,.36],[side*.32,.84,-.02],.12,suit);rod(r,[side*.32,.84,-.02],[side*.27,.45,.4],.09,suit);ball(r,side*.32,.84,-.02,.1,.13,.08,armor);box(r,.15,.10,.28,side*.27,.42,.29,black);ball(r,side*.2,1.58,.03,.12,.10,.13,armor)}
 const helmet=ball(r,0,1.81,-.15,.195,.225,.225,armor);helmet.rotation.x=-.16;ball(r,0,1.82,-.327,.173,.085,.064,new T.MeshPhysicalMaterial({color:0x273943,metalness:1,roughness:.12,clearcoat:1}));box(r,.18,.016,.025,0,1.83,-.39,glow);
 for(let i=0;i<4;i++)box(r,.18,.065,.04,0,1.62-i*.085,.34+i*.02,armor);batch(r);g.add(r);
 }
 addFlightRig(g,glow);g.userData.asset='kestrel.glb';return g;
}

let trafficTemplates=null;
export async function loadTraffic(){
 try{const loader=new GLTFLoader();trafficTemplates=await Promise.all(['./assets/models/traffic/sedan.glb','./assets/models/traffic/van.glb','./assets/models/traffic/taxi.glb'].map(p=>loader.loadAsync(p).then(r=>r.scene)));return true}catch(error){console.warn('Traffic assets unavailable; using procedural cars only',error);trafficTemplates=null;return false}
}
export function trafficTemplateLoaded(){return !!trafficTemplates}
export function makeImportedCar(i){
 if(!trafficTemplates)return null;
 const car=trafficTemplates[i%trafficTemplates.length].clone(true);
 car.scale.set(1.4,1.4,1.4);car.rotation.y=Math.PI;
 car.traverse(o=>{if(o.isMesh){o.castShadow=true;o.receiveShadow=true;o.userData.sharedTemplate=true}});
 return car;
}

let hazardTemplates=null;
export async function loadHazards(){
 try{const loader=new GLTFLoader();const[barrier,fence]=await Promise.all(['./assets/models/hazards/barrier-red/barrierRed.gltf','./assets/models/hazards/fence-straight/fenceStraight.gltf'].map(p=>loader.loadAsync(p).then(r=>r.scene)));[barrier,fence].forEach(t=>t.traverse(o=>{if(o.isMesh){o.material.roughness=.55;o.material.metalness=0;o.material.envMapIntensity=1;if(o.material.name==='net'){o.material.alphaTest=.5;o.material.transparent=false;o.material.depthWrite=true;o.material.side=T.DoubleSide;if(o.material.map)o.material.map.anisotropy=8}}}));hazardTemplates={barrier,fence};return true}catch(error){console.warn('Hazard assets unavailable; using procedural hazards only',error);hazardTemplates=null;return false}
}
export function hazardTemplateLoaded(){return !!hazardTemplates}
export function makeImportedHazard(name){
 if(!hazardTemplates)return null;
 const template=hazardTemplates[name];if(!template)return null;
 const wrap=new T.Group(),h=template.clone(true);wrap.add(h);
 const box=new T.Box3().setFromObject(h),c=box.getCenter(new T.Vector3());
 h.position.set(-c.x,-box.min.y,-c.z);
 wrap.traverse(o=>{if(o.isMesh){o.castShadow=true;o.receiveShadow=true;o.userData.sharedTemplate=true}});
 return wrap;
}
