import * as T from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {makeRider,animateRider,loadRider} from './rider.js';
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

let heroTemplate=null,bikeTemplates={};
export async function loadHero(){
 try{
  const loader=new GLTFLoader();
  await loadRider();
  const entries=await Promise.all([
   loader.loadAsync('./assets/models/kestrel.glb').then(r=>['nightblade',r.scene]),
   ...['redline','ronin','ghost','outlaw','cafe'].map(id=>loader.loadAsync(`./assets/models/bikes/${id}.glb`).then(r=>[id,r.scene]).catch(()=>[id,null]))
  ]);
  bikeTemplates=Object.fromEntries(entries.filter(([,s])=>!!s));
  heroTemplate=bikeTemplates.nightblade||null;
  return !!heroTemplate;
 }catch(error){console.warn('Hero asset unavailable; using built-in bike',error);return false}
}

function makeImportedBike(bike,template,color,rider){
 const g=new T.Group(),body=new T.MeshPhysicalMaterial({color,metalness:.12,roughness:.28,clearcoat:1,clearcoatRoughness:.04}),glow=neon(color,2.4),brakeMat=neon('#ff1e42',3.2);
 const model=template.clone(true);
 g.userData.cockpit=[];
 const cpNode=model.getObjectByName('cockpit');
 if(cpNode)cpNode.traverse(o=>{if(o.isMesh){o.userData.cockpit=true;g.userData.cockpit.push(o)}});
 model.traverse(o=>{
  if(o.isMesh){
   o.geometry=o.geometry.clone();
   if(o.material.name==='custom-paint')o.material=body;
   else if(o.material.name==='brake-light')o.material=brakeMat;
   else if(o.material.name==='neon')o.material=glow;
   else o.material=o.material.clone();
   o.castShadow=true;o.receiveShadow=true;
  }
 });
 g.add(model);
 g.userData.paint=body;g.userData.glow=glow;g.userData.brakeLight=brakeMat;
 const fw=model.getObjectByName('front-wheel'),rw=model.getObjectByName('rear-wheel');
 g.userData.wheels=[fw,rw].filter(Boolean);
 if(fw){fw.userData.radius=.523;fw.userData.isFront=true}
 if(rw){rw.userData.radius=.437}
 if(rider){g.userData.rider=makeRider({compact:bike.id==='nightblade',cruiser:bike.style==='cruiser',color});g.add(g.userData.rider)}
 addFlightRig(g,glow);
 g.userData.asset=bike.id==='nightblade'?'kestrel.glb':`${bike.id}.glb`;
 return g;
}

export function makeBike(bike,color,rider=true){
 const tpl=bikeTemplates[bike.id]||(bike.id==='nightblade'?heroTemplate:null);
 if(tpl)return makeImportedBike(bike,tpl,color,rider);
 const g=new T.Group(),body=new T.MeshPhysicalMaterial({color,metalness:.05,roughness:.38,clearcoat:1,clearcoatRoughness:.05}),brakeMat=neon(0xff2359,4.0);
 g.userData.paint=body;const glow=neon(color,2.4);g.userData.glow=glow;g.userData.brakeLight=brakeMat;
 const classic=bike.style==='classic',cruiser=bike.style==='cruiser',hyper=bike.style==='hyper';const front=cruiser?-1.22:hyper?-1.12:-1.04,rear=1.02;
 g.userData.wheels=[];g.userData.cockpit=[];const tag=m=>{m.userData.cockpit=true;g.userData.cockpit.push(m);return m};
 for(const z of [front,rear]){const wheel=new T.Group();wheel.position.set(0,.43,z);wheel.userData.radius=.43;if(z===front)wheel.userData.isFront=true;const tire=new T.Mesh(new T.TorusGeometry(.32,.115,12,32),rubber);tire.rotation.y=Math.PI/2;wheel.add(tire);const rim=new T.Mesh(new T.CylinderGeometry(.27,.27,.14,24),black);rim.rotation.z=Math.PI/2;wheel.add(rim);for(const x of [-.085,.085]){const ring=new T.Mesh(new T.TorusGeometry(.268,.012,6,32),glow);ring.rotation.y=Math.PI/2;ring.position.x=x;wheel.add(ring);for(let i=0;i<6;i++){const a=i*Math.PI/3;rod(wheel,[x,0,0],[x,Math.sin(a)*.255,Math.cos(a)*.255],.019,metal)}const disc=new T.Mesh(new T.CylinderGeometry(.19,.19,.012,24),metal);disc.rotation.z=Math.PI/2;disc.position.x=x*1.4;wheel.add(disc)}g.add(wheel);g.userData.wheels.push(wheel)}
 for(const side of [-1,1]){rod(g,[side*.18,.45,rear],[side*.20,.79,0],.06,metal);rod(g,[side*.18,.45,front],[side*.22,1.24,-.58],.037,metal);rod(g,[side*.25,.61,.5],[side*.28,1.08,-.3],.04,body);rod(g,[side*.25,.61,.5],[side*.28,1.0,.6],.04,body)}
 ball(g,0,.77,.10,.32,.29,.42,black);for(let i=0;i<5;i++)box(g,.63,.025,.47,0,.69+i*.065,.1,metal);
 ball(g,0,1.18,-.2,cruiser?.33:.34,.23,.49,body);box(g,.40,.13,.7,0,1.16,.52,black);const tail=box(g,.48,.17,.49,0,1.17,.89,body);tail.rotation.x=-.18;box(g,.36,.04,.03,0,1.19,1.145,brakeMat);
 for(const side of [-1,1]){rod(g,[side*.33,.59,.3],[side*.40,.48,.94],.09,metal);rod(g,[side*.20,.7,-.25],[side*.34,.5,.3],.043,metal);tag(rod(g,[0,1.27,-.61],[side*.43,cruiser?1.55:1.28,-.6],.035,metal));tag(box(g,.19,.055,.1,side*.40,cruiser?1.55:1.28,-.6,black))}
 if(classic||cruiser){const lamp=new T.Mesh(new T.CylinderGeometry(.18,.18,.12,24),neon(0xd4eeff,3));lamp.rotation.x=Math.PI/2;lamp.position.set(0,1.24,-.85);g.add(lamp);box(g,.12,.09,.08,-.35,1.22,-.78,neon(0xffad42));box(g,.12,.09,.08,.35,1.22,-.78,neon(0xffad42));}else{fairing(g,hyper?.46:.38,body);for(const side of [-1,1]){const panel=box(g,.1,.45,.72,side*.29,.84,-.30,body);panel.rotation.z=side*-.2;box(g,.21,.037,.08,side*.2,1.16,-1.09,neon(0xa8f8ff,5));const stripe=box(g,.02,.035,.8,side*.38,1.01,-.3,glow);stripe.rotation.x=.08;tag(rod(g,[side*.28,1.31,-.71],[side*.47,1.37,-.74],.02,black));tag(box(g,.16,.07,.09,side*.49,1.37,-.74,metal))}const glass=new T.MeshStandardMaterial({color:0x254f65,metalness:0,roughness:.05,transparent:true,opacity:.42});const windshield=tag(ball(g,0,1.37,-.75,.27,.27,.16,glass));windshield.rotation.x=-.4;}
 box(g,.035,.018,.8,0,.44,0,glow);
 if(rider){g.userData.rider=makeRider({cruiser,color});g.add(g.userData.rider)}for(const side of [-1,1]){
  for(let z=-.28;z<.2;z+=.09)box(g,.02,.24,.023,side*.325,.8,z,black);
  for(const z of [front,rear]){box(g,.055,.16,.10,side*.135,.53,z-.16,new T.MeshStandardMaterial({color:0xb85e30,metalness:1,roughness:.34}));}
  rod(g,[side*.22,.83,-.78],[side*.23,1.2,-.60],.048,new T.MeshStandardMaterial({color:0xc4a66d,metalness:1,roughness:.23}));
  for(let i=0;i<4;i++)ball(g,side*.335,.82+i*.065,.22,.016,.016,.016,metal);
 }
 const fender=new T.Mesh(new T.TorusGeometry(.43,.055,8,24,Math.PI*.8),body);fender.rotation.y=Math.PI/2;fender.rotation.z=.1;fender.position.set(0,.43,front);g.add(fender);
 for(const wheel of g.userData.wheels)batch(wheel);batch(g,[...g.userData.wheels,...g.userData.cockpit,...(g.userData.rider?[g.userData.rider]:[])]);addFlightRig(g,glow);g.traverse(o=>{if(o.isMesh){o.castShadow=true;o.receiveShadow=true}});return g;
}

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
export function animateBike(bike,{speed=0,flight=0,boost=false,time=0,dt=0,lean=0,accel=0}){
 if(bike.userData.rider)animateRider(bike.userData.rider,{lean,speed,accel,time,dt});
 if(bike.userData.brakeLight)bike.userData.brakeLight.emissiveIntensity=accel<-1.5?7.8:2.8;
 const blend=flight;bike.userData.flightRig.visible=blend>.01;bike.userData.flightRig.scale.setScalar(Math.max(.01,blend));
 for(const wheel of bike.userData.wheels){
  wheel.userData.spin=(wheel.userData.spin||0)-speed*dt/(wheel.userData.radius||.43);
  const steerYaw=wheel.userData.isFront?-lean*.18*(1-blend):0;
  wheel.rotation.set(wheel.userData.spin*(1-blend),steerYaw,blend*Math.PI/2);
 }
 for(const rotor of bike.userData.rotors)rotor.rotation.y+=dt*(boost?110:65);
 bike.userData.jets.forEach((j,i)=>{j.scale.y=(boost?1.8:1)+Math.sin(time*32+i)*.12;j.material.opacity=boost?.45:.2});
}
export function disposeModel(model){const gs=new Set(),ms=new Set();model.traverse(o=>{if(o.isMesh){if(o.userData.sharedTemplate)return;if(o.geometry!==cube)gs.add(o.geometry);if(![black,metal,rubber].includes(o.material))ms.add(o.material)}});gs.forEach(g=>g.dispose());ms.forEach(m=>m.dispose());}
export {box,ball,rod,batch,neon,black,metal,rubber};

let trafficTemplates=null,droneTemplate=null;
const CAR_PAINTS=[0x1d5e8a,0x8f2d38,0x3c4f62,0xc7b9a1,0x2a6b5d,0x594d6b];
export async function loadTraffic(){
 try{
  const loader=new GLTFLoader();
  trafficTemplates=await Promise.all(['./assets/models/traffic/sedan.glb','./assets/models/traffic/van.glb','./assets/models/traffic/taxi.glb'].map(p=>loader.loadAsync(p).then(r=>r.scene)));
  droneTemplate=await loader.loadAsync('./assets/models/traffic/drone.glb').then(r=>r.scene).catch(()=>null);
  return true;
 }catch(error){console.warn('Traffic assets unavailable; using procedural cars only',error);trafficTemplates=null;droneTemplate=null;return false}
}
export function trafficTemplateLoaded(){return !!trafficTemplates}
export function makeImportedCar(i){
 if(!trafficTemplates)return null;
 const idx=i%trafficTemplates.length,car=trafficTemplates[idx].clone(true);
 car.scale.set(1.4,1.4,1.4);car.rotation.y=Math.PI;
 const wheels=[],paintColor=idx!==2?CAR_PAINTS[i%CAR_PAINTS.length]:null;
 const paintMat=paintColor?new T.MeshPhysicalMaterial({color:paintColor,metalness:.35,roughness:.28,clearcoat:1,clearcoatRoughness:.06}):null;
 const brakeMat=neon('#ff1e38',3.0);
 for(const wn of ['wheel-fl','wheel-fr','wheel-rl','wheel-rr']){const w=car.getObjectByName(wn);if(w)wheels.push(w)}
 car.traverse(o=>{
  if(o.isMesh){
   o.castShadow=true;o.receiveShadow=true;o.userData.sharedTemplate=true;
   if(paintMat&&o.material?.name==='CarBody')o.material=paintMat;
   else if(o.material?.name==='brake-light')o.material=brakeMat;
  }
 });
 car.userData.wheels=wheels;car.userData.brakeLight=brakeMat;
 return car;
}
export function makeImportedDrone(i){
 if(!droneTemplate)return null;
 const drone=droneTemplate.clone(true);
 drone.scale.set(1.35,1.35,1.35);drone.rotation.y=Math.PI;
 const rotors=[];for(let r=0;r<4;r++){const rn=drone.getObjectByName(`rotor-${r}`);if(rn)rotors.push(rn)}
 drone.traverse(o=>{if(o.isMesh){o.castShadow=true;o.receiveShadow=true;o.userData.sharedTemplate=true}});
 drone.userData.rotors=rotors;
 return drone;
}
export function animateTrafficVehicle(mesh,actor,dt,clock=0){
 if(!mesh)return;
 if(mesh.userData.brakeLight)mesh.userData.brakeLight.emissiveIntensity=actor.braking?8.0:2.8;
 if(mesh.userData.wheels){
  for(const w of mesh.userData.wheels){w.rotation.x+=(actor.v||0)*dt/.44}
 }
 if(mesh.userData.rotors){
  for(const r of mesh.userData.rotors){r.rotation.y+=dt*85}
 }
}

let hazardTemplates=null,debrisGeometries=null,worldTemplates=null;
export async function loadHazards(){
 try{
  const loader=new GLTFLoader();
  const [barrier,fence,debrisScene,gantryScene,towerScene,propsScene]=await Promise.all([
   loader.loadAsync('./assets/models/world/barrier.glb').then(r=>r.scene).catch(()=>loader.loadAsync('./assets/models/hazards/barrier-red/barrierRed.gltf').then(r=>r.scene)),
   loader.loadAsync('./assets/models/hazards/fence-straight/fenceStraight.gltf').then(r=>r.scene),
   loader.loadAsync('./assets/models/world/debris.glb').then(r=>r.scene).catch(()=>null),
   loader.loadAsync('./assets/models/world/gantry.glb').then(r=>r.scene).catch(()=>null),
   loader.loadAsync('./assets/models/world/tower.glb').then(r=>r.scene).catch(()=>null),
   loader.loadAsync('./assets/models/world/props.glb').then(r=>r.scene).catch(()=>null),
  ]);
  [barrier,fence].forEach(t=>t?.traverse(o=>{if(o.isMesh){o.material.roughness=.55;o.material.metalness=0;o.material.envMapIntensity=1;if(o.material.name==='net'){o.material.alphaTest=.5;o.material.transparent=false;o.material.depthWrite=true;o.material.side=T.DoubleSide;if(o.material.map)o.material.map.anisotropy=8}}}));
  hazardTemplates={barrier,fence};
  if(debrisScene){
   debrisGeometries={};
   for(const k of ['debris1','debris2','debris3']){
    const n=debrisScene.getObjectByName(k);
    let found=null;n?.traverse(o=>{if(o.isMesh&&!found)found={geo:o.geometry.clone(),mat:o.material.clone()}});
    if(found)debrisGeometries[k]=found;
   }
  }
  worldTemplates={
   gantry:gantryScene,
   tower:towerScene,
   streetlamp:propsScene?.getObjectByName('streetlamp')||null,
   pylon:propsScene?.getObjectByName('pylon')||null,
  };
  return true;
 }catch(error){console.warn('Hazard assets unavailable; using procedural hazards only',error);hazardTemplates=null;return false}
}
export function hazardTemplateLoaded(){return !!hazardTemplates}
export function makeImportedHazard(name){
 if(!hazardTemplates)return null;
 const template=hazardTemplates[name];if(!template)return null;
 const wrap=new T.Group(),h=template.clone(true);wrap.add(h);
 const b=new T.Box3().setFromObject(h),c=b.getCenter(new T.Vector3());
 h.position.set(-c.x,-b.min.y,-c.z);
 wrap.traverse(o=>{if(o.isMesh){o.castShadow=true;o.receiveShadow=true;o.userData.sharedTemplate=true}});
 return wrap;
}
export function getDebrisAsset(key){return debrisGeometries?.[key]||null}
export function makeWorldProp(name){
 const tpl=worldTemplates?.[name];if(!tpl)return null;
 const clone=tpl.clone(true);
 clone.traverse(o=>{if(o.isMesh){o.castShadow=true;o.receiveShadow=true;o.userData.sharedTemplate=true}});
 return clone;
}
