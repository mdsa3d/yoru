import {Worker} from 'node:worker_threads';
import {validDecision,TACTICS} from '../src/rivals.js';
export function createDecisionService(enabled){
 let status=enabled?'loading':'disabled',pending=null,seq=0,worker;
 if(enabled){worker=new Worker(new URL('./laya-worker.mjs',import.meta.url));worker.on('message',m=>{if(m.ready){status='ready';console.log('Laya ready')}else if(m.id&&pending?.id===m.id){const job=pending;pending=null;clearTimeout(job.timer);validDecision(m.result)?job.resolve(m.result):job.reject(Error('Invalid decision'))}else if(m.error){status='unavailable';console.warn('Laya unavailable:',m.error)}});worker.on('error',()=>{status='unavailable';fail()});worker.on('exit',()=>{status='unavailable';fail()})}
 function fail(){if(pending){clearTimeout(pending.timer);pending.reject(Error('Unavailable'));pending=null}}
 return {get status(){return status},async decide(state){
  if(status!=='ready'||pending)throw Error('Unavailable or busy');
  return new Promise((resolve,reject)=>{const id=++seq;pending={id,resolve,reject,timer:setTimeout(()=>{status='unavailable';fail();worker?.terminate()},2500)};worker.postMessage({id,state})});
 },close(){fail();return worker?.terminate()}};
}
export function sanitizeState(s){
 if(!s||typeof s!=='object'||Array.isArray(s))throw Error('Invalid state');
 const n=(k,min,max)=>{if(typeof s[k]!=='number'||!Number.isFinite(s[k]))throw Error('Invalid '+k);return Math.min(max,Math.max(min,s[k]))};
 return {speed:n('speed',0,150),health:n('health',0,100),altitude:n('altitude',0,100),flight:!!s.flight,boost:!!s.boost,bike:n('bike',0,5),tires:['street','rain','slick'].includes(s.tires)?s.tires:'street',world:['akuma','solstice','pelagic','elysium'].includes(s.world)?s.world:'akuma',hazards:Array.isArray(s.hazards)?s.hazards.slice(0,8).map(h=>({type:['debris','oil','puddle','closure'].includes(h?.type)?h.type:'debris',distance:Math.max(-10,Math.min(120,Number(h?.distance)||0)),lane:Math.max(0,Math.min(3,Number(h?.lane)||0)),severity:Math.max(0,Math.min(1,Number(h?.severity)||0)),width:Math.max(.5,Math.min(8,Number(h?.width)||1))})):[],encounter:['recover','balanced','pressure','duel'].includes(s.encounter)?s.encounter:'balanced',position:Math.max(1,Math.min(8,Number(s.position)||1)),clean:Math.max(0,Math.min(600,Number(s.clean)||0)),skill:Math.max(-1,Math.min(1,Number(s.skill)||0)),rivals:Array.isArray(s.rivals)?s.rivals.slice(0,6).map(a=>({personality:['aggressive','technical','patient','ruthless','draft'].includes(a?.personality)?a.personality:'patient',gap:Math.max(-200,Math.min(200,Number(a?.gap)||0)),lane:Math.max(-34,Math.min(34,Number(a?.lane)||0)),tactic:TACTICS.includes(a?.tactic)?a.tactic:'race'})):[]};
}
