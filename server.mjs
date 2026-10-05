import http from 'node:http';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createDecisionService,sanitizeState} from './server/decision-service.mjs';
const root=path.dirname(fileURLToPath(import.meta.url));
const service=createDecisionService(process.env.LAYA==='1'||process.argv.includes('--laya'));
const types={'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.json':'application/json','.jpg':'image/jpeg','.png':'image/png','.glb':'model/gltf-binary'};
const json=(res,status,data)=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(data))};
const server=http.createServer(async(req,res)=>{
 try{
  const url=new URL(req.url,'http://localhost');
  if(url.pathname==='/api/status')return json(res,200,{laya:service.status});
  if(url.pathname==='/api/decision'){
   if(req.method!=='POST')return json(res,405,{error:'POST required'});
   if(req.headers.origin&&req.headers.origin!==`http://${req.headers.host}`)return json(res,403,{error:'Same origin required'});
   if(service.status!=='ready')return json(res,503,{error:service.status});
   let body='',bytes=0;for await(const chunk of req){bytes+=chunk.length;if(bytes>4096)return json(res,413,{error:'Request too large'});body+=chunk}
   let state;try{state=sanitizeState(JSON.parse(body))}catch{return json(res,400,{error:'Invalid state'})}
   try{return json(res,200,await service.decide(state))}catch{return json(res,503,{error:'Local AI fallback'})}
  }
  if(req.method!=='GET'&&req.method!=='HEAD'){res.writeHead(405).end();return}
  let p=decodeURIComponent(url.pathname);if(p.endsWith('/'))p+='index.html';
  if(!/^\/(index\.html|style\.css|src\/|vendor\/|assets\/)/.test(p)){res.writeHead(404).end();return}
  const file=path.resolve(root,'.'+p);if(!file.startsWith(root+path.sep)){res.writeHead(403).end();return}
  const relative=path.relative(root,file).split(path.sep).join('/');if(!/^(index\.html$|style\.css$|src\/|vendor\/|assets\/)/.test(relative)){res.writeHead(404).end();return}
  const data=await readFile(file);res.writeHead(200,{'Content-Type':types[path.extname(file)]||'application/octet-stream','Cache-Control':'no-cache'});res.end(req.method==='HEAD'?undefined:data);
 }catch{res.writeHead(404).end('Not found')}
});
server.requestTimeout=5000;
server.listen(Number(process.env.PORT)||8080,'127.0.0.1',()=>console.log('YORU → http://localhost:'+ (Number(process.env.PORT)||8080)+' · Laya '+service.status));
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>{service.close();server.close(()=>process.exit())});
