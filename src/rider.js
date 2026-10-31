import * as T from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
// Articulated riding suit; uses Blender-authored anatomical pilot.glb when loaded and reacts to lean/speed/braking while hands stay on the grips.
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
let riderTemplate=null;
export async function loadRider(){
 try{riderTemplate=(await new GLTFLoader().loadAsync('./assets/models/rider/pilot.glb')).scene;return true}catch(error){console.warn('Rider asset unavailable; using procedural rider',error);riderTemplate=null;return false}
}
export function riderTemplateLoaded(){return !!riderTemplate}
function mesh(parent,geo,mat,pos,scale){const m=new T.Mesh(geo,mat);m.position.set(...pos);if(scale)m.scale.set(...scale);m.castShadow=true;m.receiveShadow=true;parent.add(m);return m}
function clonePart(name,color,scale){
 if(!riderTemplate)return null;
 const src=riderTemplate.getObjectByName(name);if(!src)return null;
 const obj=src.clone(true);obj.position.set(0,0,0);obj.rotation.set(0,0,0);if(scale)obj.scale.set(...scale);
 obj.traverse(o=>{if(o.isMesh){o.castShadow=true;o.receiveShadow=true;o.userData.sharedTemplate=true;if(o.material?.name==='neon-accent'){o.material=o.material.clone();o.material.color.set(color);if(o.material.emissive)o.material.emissive.set(color)}}});
 return obj;
}
export function makeRider({compact=false,cruiser=false,color='#79e5f2'}={}){
 const root=new T.Group();root.name='articulated-rider';const k=compact?.88:1;
 const fabric=new T.MeshPhysicalMaterial({color:0x202b35,roughness:.86,sheen:.45,sheenColor:0x53616b}),armor=new T.MeshStandardMaterial({color:0x3e4a55,roughness:.43,metalness:.12}),rubber=new T.MeshStandardMaterial({color:0x0c141b,roughness:.7}),trim=new T.MeshStandardMaterial({color,emissive:color,emissiveIntensity:.6,roughness:.5});
 const sphere=new T.SphereGeometry(1,24,16),capsule=new T.CapsuleGeometry(1,1,6,12);
 const upper=new T.Group();upper.position.set(0,compact?1.22:1.36,.30);root.add(upper);
 const torsoPart=clonePart('torso',color,[k,k,k]);
 if(torsoPart){upper.add(torsoPart)}else{
  mesh(upper,capsule,fabric,[0,.28,-.10],[.23*k,.25*k,.15*k]).rotation.x=-.38;
  for(const side of [-1,1]){mesh(upper,sphere,armor,[side*.2*k,.47,-.2],[.11,.10,.14]);mesh(upper,new T.BoxGeometry(.025,.28,.03),trim,[side*.13,.34,.07]).rotation.x=-.32}
  for(let i=0;i<4;i++)mesh(upper,new T.BoxGeometry(.19,.052,.04),armor,[0,.44-i*.08,.08+i*.018]);
 }
 const head=new T.Group();head.position.set(0,compact?.61:.69,-.36);upper.add(head);
 const headPart=clonePart('head',color,[1,1,1]);
 if(headPart){head.add(headPart)}else{
  mesh(head,sphere,armor,[0,0,0],[.195,.235,.225]);
  mesh(head,new T.SphereGeometry(1,24,12,Math.PI,Math.PI,Math.PI*.30,Math.PI*.32),new T.MeshPhysicalMaterial({color:0x193d51,metalness:.45,roughness:.13,clearcoat:1}),[0,.012,-.01],[.199,.23,.235]).rotation.x=-.15;
  mesh(head,new T.BoxGeometry(.14,.02,.03),trim,[0,-.015,-.236]);mesh(head,new T.BoxGeometry(.13,.035,.05),rubber,[0,-.13,-.20]);
 }
 const arms=[],legs=[],tmp={a:new T.Vector3(),b:new T.Vector3(),d:new T.Vector3(),up:new T.Vector3(0,1,0)};
 function limb(partName,a,b,r,mat){
  const m=clonePart(partName,color)||mesh(root,new T.CylinderGeometry(r*.88,r,1,12),mat,[0,0,0]);
  if(m.parent!==root)root.add(m);
  placeLimb(m,a,b,tmp);return m;
 }
 function jointPart(partName,fallbackGeo,mat,pos,scale){
  const m=clonePart(partName,color);
  if(m){m.position.set(...pos);root.add(m);return m}
  return mesh(root,fallbackGeo,mat,pos,scale);
 }
 for(const side of [-1,1]){
  const hip=new T.Vector3(side*.15,compact?1.20:1.34,.39),knee=new T.Vector3(side*.35,compact?.85:.97,0),ankle=new T.Vector3(side*.29,compact?.46:.60,.40);
  const thighM=limb('thigh',hip,knee,.115,fabric),shinM=limb('shin',knee,ankle,.085,fabric),kneeM=jointPart('knee-pad',sphere,armor,knee.toArray(),[.10,.135,.085]);
  jointPart('boot',new T.BoxGeometry(.16,.12,.30),rubber,[ankle.x,ankle.y-.025,.29]);
  legs.push({side,hip,knee,ankle,baseKneeX:knee.x,thigh:thighM,shin:shinM,kneePad:kneeM});
  const hand=new T.Vector3(side*(compact?.37:.40),cruiser?1.55:compact?1.13:1.28,compact?-.48:-.60);
  const shoulder=new T.Vector3(side*.21,compact?1.61:1.82,.01),elbow=new T.Vector3(side*.34,hand.y+.19,hand.z+.22);
  arms.push({side,hand,shoulder,elbow,upper:limb('upper-arm',shoulder,elbow,.078,fabric),fore:limb('forearm',elbow,hand,.066,fabric),pad:jointPart('elbow-pad',sphere,armor,elbow.toArray(),[.08,.09,.085])});
  jointPart('gauntlet',sphere,rubber,hand.toArray(),[.075,.065,.09]);
 }
 root.userData={upper,head,arms,legs,tmp,compact,lean:0,tuck:0};return root;
}
function placeLimb(m,a,b,t){t.d.subVectors(b,a);m.position.copy(a).add(b).multiplyScalar(.5);m.scale.set(1,t.d.length(),1);m.quaternion.setFromUnitVectors(t.up,t.d.normalize())}
export function animateRider(root,{lean=0,speed=0,accel=0,time=0,dt=0}={}){
 const r=root.userData,t=1-Math.exp(-Math.max(0,dt)*8),target=clamp(lean,-.7,.7);
 r.lean+=(target-r.lean)*t;r.tuck+=(clamp(speed/95,0,1)*.14+clamp(accel/35,-.10,.08)-r.tuck)*t;
 r.upper.rotation.set(-r.tuck,0,-r.lean*.20);r.upper.position.x=r.lean*.12;r.upper.position.y=(r.compact?1.22:1.36)+Math.sin(time*1.7)*.003;
 r.head.rotation.y=r.lean*.18;r.head.rotation.x=-r.tuck*.2;r.head.rotation.z=r.lean*.12;
 for(const a of r.arms){r.tmp.a.set(a.side*.21,r.compact?.39:.46,-.20).applyEuler(r.upper.rotation).add(r.upper.position);a.elbow.set(a.side*.34+r.lean*.035,a.hand.y+.19-r.tuck*.12,a.hand.z+.22);placeLimb(a.upper,r.tmp.a,a.elbow,r.tmp);placeLimb(a.fore,a.elbow,a.hand,r.tmp);a.pad.position.copy(a.elbow)}
 if(r.legs)for(const l of r.legs){const inside=l.side*r.lean>0?Math.abs(r.lean)*.08:0;l.knee.x=l.baseKneeX+l.side*inside;placeLimb(l.thigh,l.hip,l.knee,r.tmp);placeLimb(l.shin,l.knee,l.ankle,r.tmp);l.kneePad.position.copy(l.knee)}
}
