// Opt-in, local-only telemetry recorder (UPLIFT-PLAN B3): fixed-rate
// {obs,input,tactic,world,bike,seed} frames into a ring buffer, JSONL export via browser
// download only. No network, off by default — enable with ?telemetry=1 or the
// 'neon-rash-v3-telemetry' localStorage flag.
//
// Schema contract with tools/ai-train/train_bc.py (settled in 3.17.0): `tactic` is ONE
// string id (one of the seven TACTICS from rivals.js; the trainer validates this). Any
// richer tactical context is kept in a separate optional `tacticDetail` object, which the
// trainer ignores. Callers may still pass the legacy object form
// {encounter,director,rivals}; sample() canonicalises it to tactic=director string +
// tacticDetail=<the object>, so the on-disk JSONL always matches the trainer schema.
function normTactic(t){
 if(typeof t==='string')return {tactic:t};
 if(t&&typeof t==='object')return {tactic:typeof t.director==='string'?t.director:'race',tacticDetail:t};
 return {tactic:'race'};
}
export function createTelemetry({capacity=36000,rate=30}={}){
 const buffer=new Array(capacity);
 let head=0,size=0,lastSample=-Infinity,meta={world:'',bike:'',seed:0},recording=false;
 const t={
  enabled:false,
  get count(){return size},
  get recording(){return recording},
  begin(m={}){meta={world:String(m.world??''),bike:String(m.bike??''),seed:m.seed|0};head=0;size=0;lastSample=-Infinity;recording=t.enabled},
  sample(time,frame){if(!recording||!t.enabled)return false;if(time-lastSample<1/rate-1e-9)return false;lastSample=time;buffer[head]={t:Math.round(time*1000)/1000,world:meta.world,bike:meta.bike,seed:meta.seed,obs:frame.obs,input:frame.input,...normTactic(frame.tactic)};head=(head+1)%capacity;size=Math.min(capacity,size+1);return true},
  end(){recording=false},
  records(){const out=[];for(let i=0;i<size;i++)out.push(buffer[(head-size+i+capacity)%capacity]);return out},
  toJSONL(){return size?t.records().map(r=>JSON.stringify(r)).join('\n')+'\n':''},
  download(filename='yoru-telemetry.jsonl'){
   if(typeof document==='undefined'||typeof URL==='undefined'||typeof URL.createObjectURL!=='function')return false;
   const url=URL.createObjectURL(new Blob([t.toJSONL()],{type:'application/x-ndjson'}));
   const a=document.createElement('a');a.href=url;a.download=filename;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);return true;
  }
 };
 return t;
}
