import * as T from 'three';
// Shared showroom set. No extra reflection pass: its environment is baked once.
export class Studio{
 constructor(scene){
  this.root=new T.Group();this.root.name='yoru-showroom';scene.add(this.root);
  const floor=new T.MeshStandardMaterial({color:0x151c24,roughness:.28,metalness:.35});
  const slab=new T.Mesh(new T.CylinderGeometry(3.1,3.16,.13,80),floor);slab.position.set(1.3,-.10,0);slab.receiveShadow=true;this.root.add(slab);
  const ground=new T.Mesh(new T.PlaneGeometry(180,180),new T.MeshBasicMaterial({color:0x070d14}));ground.rotation.x=-Math.PI/2;ground.position.y=-.18;ground.receiveShadow=true;this.root.add(ground);
  this.accent=new T.MeshStandardMaterial({color:0x79e5f2,emissive:0x79e5f2,emissiveIntensity:.65,roughness:.45});
  const ring=new T.Mesh(new T.TorusGeometry(3.08,.018,6,96),this.accent);ring.rotation.x=-Math.PI/2;ring.position.set(1.3,-.025,0);this.root.add(ring);
  const white=new T.MeshStandardMaterial({color:0xcbdfea,emissive:0xcbdfea,emissiveIntensity:.8});
  for(const x of [-3.5,5.7]){const strip=new T.Mesh(new T.BoxGeometry(.04,3.8,.04),white);strip.position.set(x,1.72,-3.7);this.root.add(strip)}
  for(let i=0;i<9;i++){const line=new T.Mesh(new T.BoxGeometry(.015,.012,12),new T.MeshBasicMaterial({color:0x223442}));line.position.set(-9+i*2,-.16,-3);this.root.add(line)}
  this.key=new T.DirectionalLight(0xe5f4ff,0);this.key.position.set(3,6,3);this.key.target.position.set(1.3,.8,0);
  this.edge=new T.DirectionalLight(0x78ddeb,0);this.edge.position.set(-3,3,-4);this.edge.target.position.set(1.3,1,0);
  scene.add(this.key,this.key.target,this.edge,this.edge.target);this.setVisible(false);
 }
 setVisible(on){this.root.visible=on;this.key.visible=this.edge.visible=on;this.key.intensity=on?1.8:0;this.edge.intensity=on?.8:0}
 setWorld(w){this.accent.color.set(w.accent);this.accent.emissive.set(w.accent)}
 dispose(){this.root.removeFromParent();for(const o of [this.key,this.key.target,this.edge,this.edge.target])o.removeFromParent();const gs=new Set(),ms=new Set();this.root.traverse(o=>{if(o.geometry)gs.add(o.geometry);if(o.material)ms.add(o.material)});gs.forEach(g=>g.dispose());ms.forEach(m=>m.dispose())}
}
