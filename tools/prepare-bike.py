"""Convert Teh_Bucket's CC0 OBJ to glTF with independently rotating wheels.
Requires numpy. Run from project root: python3 tools/prepare-bike.py
Original source and provenance are retained in assets/models and ASSETS.md.
"""
import json, struct
from pathlib import Path
import numpy as np
root=Path(__file__).resolve().parent.parent
v=[];normals=[];faces=[];mat=''
for l in (root/'assets/models/fancy-motorcycle-source.obj').read_text().splitlines():
 p=l.split()
 if not p:continue
 if p[0]=='v':v.append(list(map(float,p[1:])))
 if p[0]=='vn':normals.append(list(map(float,p[1:])))
 if p[0]=='usemtl':mat=p[1]
 if p[0]=='f':faces.append(([[int(t.split('/')[0])-1,int(t.split('/')[2])-1] for t in p[1:]],mat))
v=np.array(v);normals=np.array(normals);parent=list(range(len(v)))
def find(x):
 while parent[x]!=x:parent[x]=parent[parent[x]];x=parent[x]
 return x
def union(a,b):parent[find(a)]=find(b)
positions={}
for i,p in enumerate(v):
 key=tuple(np.round(p,5))
 if key in positions:union(i,positions[key])
 else:positions[key]=i
for f,m in faces:
 for vi,ni in f[1:]:union(f[0][0],vi)
components={}
for f,m in faces:components.setdefault(find(f[0][0]),[]).extend(vi for vi,ni in f)
wheel_ids={}
for k,ids in components.items():
 pts=v[ids];bounds=pts.max(0)-pts.min(0);center=(pts.max(0)+pts.min(0))/2
 if len(ids)>2000 and bounds[0]<1.5 and bounds[1]>1:wheel_ids[k]='front-wheel' if center[0]>-1 else 'rear-wheel'
def transform(a,normal=False):return np.array([a[2],a[1],-a[0]])*(1 if normal else .8)+(0 if normal else np.array([0,.006,-1.32*.8]))
centers={name:transform((v[components[k]].max(0)+v[components[k]].min(0))/2) for k,name in wheel_ids.items()}
buckets={}
for f,m in faces:
 component=find(f[0][0]);name=wheel_ids.get(component,'chassis');pts=v[[i for i,n in f]]
 material=1 if m=='tire' else 0 if name=='chassis' and pts[:,1].mean()>.95 and len(components[component])>2000 else 2
 bucket=buckets.setdefault((name,material),[[],[]])
 for i in range(1,len(f)-1):
  for vi,ni in [f[0],f[i],f[i+1]]:bucket[0].append(transform(v[vi])-centers.get(name,np.zeros(3)));bucket[1].append(transform(normals[ni],True))
bin=bytearray();views=[];accessors=[];meshes=[];nodes=[]
def attribute(values):
 a=np.array(values,dtype='<f4');idx=len(views);offset=len(bin);bin.extend(a.tobytes());views.append({'buffer':0,'byteOffset':offset,'byteLength':a.nbytes,'target':34962});accessors.append({'bufferView':idx,'componentType':5126,'count':len(a),'type':'VEC3','min':a.min(0).tolist(),'max':a.max(0).tolist()});return len(accessors)-1
for name in ['chassis','front-wheel','rear-wheel']:
 primitives=[]
 for (part,material),(pos,norm) in buckets.items():
  if part==name:primitives.append({'attributes':{'POSITION':attribute(pos),'NORMAL':attribute(norm)},'material':material})
 meshes.append({'name':name,'primitives':primitives});nodes.append({'name':name,'mesh':len(meshes)-1,'translation':centers.get(name,np.zeros(3)).tolist()})
materials=[{'name':'custom-paint','pbrMetallicRoughness':{'baseColorFactor':[.45,.68,.12,1],'metallicFactor':.7,'roughnessFactor':.28}},{'name':'rubber','pbrMetallicRoughness':{'baseColorFactor':[.015,.019,.025,1],'metallicFactor':.05,'roughnessFactor':.8}},{'name':'brushed-alloy','pbrMetallicRoughness':{'baseColorFactor':[.35,.41,.45,1],'metallicFactor':.85,'roughnessFactor':.3}}]
gltf={'asset':{'version':'2.0','generator':'Yoru asset preparation','copyright':'Fancy motorcycle by Teh_Bucket, CC0; https://opengameart.org/content/fancy-motorcycle'},'scene':0,'scenes':[{'nodes':list(range(len(nodes)))}],'nodes':nodes,'meshes':meshes,'materials':materials,'buffers':[{'byteLength':len(bin)}],'bufferViews':views,'accessors':accessors}
j=json.dumps(gltf,separators=(',',':')).encode();j+=b' '*((-len(j))%4);bin+=b'\0'*((-len(bin))%4)
glb=struct.pack('<III',0x46546c67,2,12+8+len(j)+8+len(bin))+struct.pack('<II',len(j),0x4e4f534a)+j+struct.pack('<II',len(bin),0x004e4942)+bin
(root/'assets/models/kestrel.glb').write_bytes(glb)
print(f'{len(glb)} bytes; {sum(len(b[0])//3 for b in buckets.values())} triangles; {len(buckets)} primitives; wheel pivots {centers}')
