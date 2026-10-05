import {clamp,stepVehicle} from './physics.js';
import {flightPath} from './world-data.js';
import {buildObsFor,OBS_WIDTH,OBS_TACTICS} from './obs.js';
export const TACTICS=OBS_TACTICS;
export const ENCOUNTERS=['recover','balanced','pressure','duel'];
export const PERSONALITIES=[
 {name:'VIPER',style:'aggressive',lane:-4,pace:1.07},
 {name:'GHOST',style:'technical',lane:0,pace:1},
 {name:'ECHO',style:'patient',lane:4,pace:.95},
 {name:'SABLE',style:'ruthless',lane:-2,pace:1.04},
 {name:'KITE',style:'draft',lane:2,pace:.97}
];
export function validDecision(d){return !!d&&TACTICS.includes(d.tactic)&&ENCOUNTERS.includes(d.encounter)}
export function guardTactic(tactic,a,p,director,profile,gap){
 if(director.encounter==='recover')return 'yield';
 if(tactic==='block'&&!(gap<0&&gap>-22&&p.health>55&&(profile.style==='ruthless'||profile.style==='aggressive')))return 'defend';
 if(tactic==='slipstream'&&!(gap>3.5&&gap<17))return 'race';
 if(tactic==='bait')return 'race';   // bait is chosen locally in avoidHazards only
 return TACTICS.includes(tactic)?tactic:'race';
}
export class SkillTracker{
 constructor(storage=null){this.rating=0;this.races=0;this.storage=storage;
  try{const s=JSON.parse(this.storage?.getItem('neon-rash-v3-skill')||'null');if(s&&Number.isFinite(s.rating)&&Number.isFinite(s.races)){this.rating=Math.max(-1,Math.min(1,s.rating));this.races=Math.max(0,Math.floor(s.races))}}catch{}}
 record({place=1,total=4,wrecked=false,distance=0,time=1,vmax=80,crashes=0}){
  const placeScore=wrecked?-1:((total-place)/Math.max(1,total-1))*2-1;        // 1st=+1, last=-1
  const ratio=Math.min(1.2,distance/Math.max(1,time)/Math.max(1,vmax));
  const speedScore=Math.max(-1,Math.min(1,(ratio-.62)/.18));
  const crashScore=Math.max(-1,Math.min(1,1-crashes/6));
  const perf=Math.max(-1,Math.min(1,placeScore*.5+speedScore*.3+crashScore*.2));
  this.rating=Math.max(-1,Math.min(1,this.rating+(perf-this.rating)*.35));
  this.races++;try{this.storage?.setItem('neon-rash-v3-skill',JSON.stringify({rating:this.rating,races:this.races}))}catch{}return this.rating;
 }
 get paceScale(){return 1+this.rating*.06}                // [0.94, 1.06]
 get aggression(){return Math.max(0,Math.min(1,.5+this.rating*.5))} // [0, 1]
}
export function rosterFor(count,seed=0){
 const out=[];for(let k=0;k<count;k++)out.push((seed+k)%PERSONALITIES.length);return out;
}
// Fixed reference top speeds (m/s, mid-fleet) so rival pace no longer scales with the player's bike choice.
export const RIVAL_REF={road:68,air:101};
export function rivalTarget(air,i){return (air?RIVAL_REF.air*.74:RIVAL_REF.road*.84)+i*(air?2.4:1.9)}
const BANDS=5;
export function bandOf(x,flight){const half=flight?28:6.8;return Math.max(0,Math.min(BANDS-1,Math.round((x+half)/(2*half/(BANDS-1)))))}

export function surveyRivals(rivals,p,dt,field={}){
 const n=rivals.length;
 field.n=n;
 field.claims=field.claims||[];field.claims.length=n;
 field.aheadOf=field.aheadOf||[];field.aheadOf.length=n;
 field.side=field.side||[];field.side.length=n;
 field.close=field.close||[];
 field.band=field.band||new Int8Array(BANDS);field.band.fill(-1);
 field.order=(field.order&&field.order.length===n?field.order:Array.from({length:n},(_,i)=>i));
 field.order.sort((x,y)=>rivals[y].s-rivals[x].s);          // leader first, n log n
 field.leader=field.order[0]??-1;
 field.strikeLock=Math.max(0,(field.strikeLock||0)-dt);

 let duel=-1,duelBest=0,striker=-1,strikerGap=Infinity;
 for(let k=0;k<n;k++){
  const i=field.order[k],a=rivals[k===0?field.order[0]:i],r=rivals[i];
  // nearest actor ahead of r: the rival one place up in the order, or the player if closer
  const up=k>0?rivals[field.order[k-1]]:null;
  const playerAhead=p.s>r.s?{s:p.s,x:p.x,v:p.v}:null;
  field.aheadOf[i]=(up&&playerAhead)?(up.s<playerAhead.s?{s:up.s,x:up.x,v:up.v}:playerAhead)
    :(up?{s:up.s,x:up.x,v:up.v}:playerAhead);
  field.claims[i]={x:r.lane??r.x,s:r.s};
  field.side[i]=(r.x>=p.x?1:-1);
  // sustained-proximity duel timer
  const near=Math.abs(r.s-p.s)<11&&Math.abs(r.x-p.x)<4.2&&Math.abs((r.y||0)-(p.y||0))<3;
  field.close[i]=near?(field.close[i]||0)+dt:Math.max(0,(field.close[i]||0)-dt*1.5);
  if(field.close[i]>6&&field.close[i]>duelBest){duelBest=field.close[i];duel=i}
  const g=Math.abs(r.s-p.s);
  if(g<strikerGap&&(r.stun||0)===0){strikerGap=g;striker=i}
 }
 field.duel=duel;field.striker=striker;
 return field;
}
export class Director {
 constructor(){this.reset()}
 reset(){this.encounter='balanced';this.changed=0;this.next=0;this.lastHealth=100;this.damageAt=-100;this.tactic='race';this.remoteUntil=0;this.cleanTime=0;this.notice='';this.aggression=0;this.duel=-1}
 update(p,dt,remote,vmax=80,field=null){
  if(p.health<this.lastHealth){this.damageAt=p.time;this.cleanTime=0}this.lastHealth=p.health;
  this.cleanTime+=dt;
  if(remote&&validDecision(remote)){this.tactic=remote.tactic;this.remoteUntil=p.time+3;this.requested=remote.encounter}
  const duelReady=!!field&&field.duel>=0;
  this.duel=duelReady?field.duel:-1;
  if(p.time<this.next)return;this.next=p.time+.75;
  // Fairness guardrails override model output; recovery cannot be skipped.
  const desired=p.health<32||p.time-this.damageAt<5?'recover':this.remoteUntil>p.time&&(this.requested!=='duel'||duelReady)?this.requested:duelReady&&this.cleanTime>5?'duel':this.cleanTime>9-(this.aggression||0)*3&&p.v>vmax*.45?'pressure':'balanced';
  if(desired!==this.encounter&&(desired==='recover'||p.time-this.changed>6)){
   this.encounter=desired;this.changed=p.time;this.notice=desired==='recover'?'RIVALS BACKING OFF / RECOVER YOUR LINE':desired==='pressure'?'RIVALS PUSHING / WATCH YOUR MIRRORS':desired==='duel'?(field.duelName||'RIVAL')+' HAS LOCKED ONTO YOU':'RIVALS REGROUPING';
  }
 }
}
// Shared tactical brain for both controllers: picks tactic, lane and speed limit under Director guardrails.
export function planRival(a,i,p,obstacles,director,dt,field=null){
 const profile=PERSONALITIES[a.pi??(i%PERSONALITIES.length)],path=a.flight?flightPath(a.s):{x:0,y:0};
 a.stun=Math.max(0,a.stun-dt);a.attack=Math.max(0,a.attack-dt);
 a.think=(a.think||0)-dt;
 if(a.think>0)return;
 {
  a.think=(director.encounter==='pressure'?.10:.20)+i*.05;const gap=p.s-a.s;
  const lead=field?.aheadOf?.[i]??(gap>0?{s:p.s,x:p.x,v:p.v}:null);
  const leadGap=lead?lead.s-a.s:Infinity;
  const canDraft=!!lead&&leadGap>3.5&&leadGap<17&&Math.abs(lead.x-a.x)<2.2&&director.encounter!=='recover'&&(a.draftTime||0)<1.8;
  let tactic=director.remoteUntil>p.time?guardTactic(director.tactic,a,p,director,profile,gap):canDraft?'slipstream':gap>0&&gap<(director.encounter==='pressure'?90:38+(director.aggression||0)*10)?'overtake':gap<0&&gap>-30&&(profile.style==='aggressive'||director.encounter==='pressure')?'defend':'race';
  const ruthless=profile.style==='ruthless'||profile.style==='aggressive';
  if(gap<0&&gap>-22&&ruthless&&(director.encounter==='pressure'||director.encounter==='duel')&&p.health>55&&a.stun===0)tactic='block';
  if(director.encounter==='recover')tactic='yield';
  if(profile.style==='patient'&&Math.abs(gap)<5&&tactic==='defend')tactic='yield';
  const holdingStation=director.encounter==='duel'&&i!==director.duel;
  if(director.encounter==='duel'&&i===director.duel)a.think=.08+i*.02;
  if(holdingStation)tactic='race';
  if(tactic==='slipstream'){a.draftTime=(a.draftTime||0)+a.think;if(a.draftTime>=1.8&&leadGap<12){tactic='overtake';a.draftTime=0}}
  else a.draftTime=0;
  a.tactic=tactic;
  let lane=path.x+profile.lane;
  if(tactic==='overtake')lane=p.x+(p.x>path.x?-2.8:2.8);
  if(tactic==='defend')lane=clamp(p.x,path.x-5,path.x+5);
  if(tactic==='yield')lane=path.x+(profile.lane<0?-6:6);
  if(tactic==='slipstream'&&lead)lane=lead.x;
  if(tactic==='block'){const drift=Math.sign(p.vx||0)||(p.x>path.x?1:-1);lane=clamp(p.x+drift*1.9,path.x-5.5,path.x+5.5)}
  a.speedLimit=a.target*profile.pace*(tactic==='yield'?.84:tactic==='slipstream'?1.06:1);
  if(tactic==='slipstream')a.speedLimit=Math.min(a.speedLimit,a.target*profile.pace*1.06);
  if(tactic==='block')a.speedLimit=Math.min(a.target*profile.pace,Math.max(0,p.v*1.02));
  if(holdingStation)a.speedLimit=a.target*profile.pace*.97;
  if(field&&(director.encounter==='pressure'||director.encounter==='duel')&&tactic==='overtake'&&Math.abs(gap)<30)lane=p.x+field.side[i]*2.8;
  if(field&&field.band){
   const b=bandOf(lane,a.flight),owner=field.band[b];
   if(owner>=0&&owner!==i&&Math.abs(field.claims[owner].s-a.s)<16)lane=path.x-(lane-path.x);
   field.band[bandOf(lane,a.flight)]=i;
  }
  for(const car of obstacles){const distance=car.s-a.s;if(distance>0&&distance<12+a.v*.8&&Math.abs(car.y-a.y)<2.5&&Math.abs(car.x-a.x)<2.4){lane=car.x+(car.x>path.x?-3.5:3.5);if(distance<10)a.speedLimit=Math.min(a.speedLimit,Math.max(0,car.v-2))}}
  a.lane=clamp(lane,a.flight?-28:-6.8,a.flight?28:6.8);
 }
}
// Kinematic fallback controller (default): integrates lane/speed directly, no physics.
export function controlRival(a,i,p,obstacles,director,dt,field=null){
 planRival(a,i,p,obstacles,director,dt,field);
 const path=a.flight?flightPath(a.s):{x:0,y:0};
 const desiredVX=clamp((a.lane-a.x)*2.4,-4.6,4.6);a.vx=(a.vx||0)+clamp(desiredVX-(a.vx||0),-8*dt,8*dt);a.x+=a.vx*dt;
 a.x=clamp(a.x,a.flight?-30:-7.5,a.flight?30:7.5);
 const target=(a.speedLimit||a.target)*(a.stun>0?.55:1);a.v+=clamp(target-a.v,-10*dt,6.5*dt);a.s+=a.v*dt;
 a.y+=(a.flight?path.y+i*.4-a.y:-a.y)*(1-Math.exp(-dt*.8));a.lean=clamp(-a.vx*.07,-.35,.35);
}
// Pure-pursuit mapping of planRival's lane/speed targets into player-shaped input.
export function pursuitInput(a){
 const limit=(a.speedLimit||a.target)*(a.stun>0?.55:1);
 return {steer:clamp((a.lane-a.x)*.3-(a.vx||0)*.15,-1,1),throttle:a.v<limit-.3,brake:a.v>limit+1.5};
}
function stepRival(a,input,bike,setup,dt,i){
 if(a.flight||a.landing){const path=flightPath(a.s);stepVehicle(a,{...input,climb:clamp((path.y+i*.4-(a.y||0))*.18,-1,1),boost:false},bike,setup,dt)}
 else{stepVehicle(a,input,bike,setup,dt);a.y=(a.y||0)+(0-(a.y||0))*(1-Math.exp(-dt*.8))}
}
// Pure-pursuit heuristic driver (B1): turns planRival's lane/speed targets into the same
// player-shaped input stepVehicle() consumes, so rivals are subject to grip, gears and drag.
// Optional trailing hook (headless tools only, e.g. tools/gen-dataset.mjs): hook(a,i,expertInput)
// observes the pursuit expert's action and may return a replacement input (DAgger-style
// noise injection); the expert action remains the recording label. Omitting it is unchanged.
export function driveRival(a,i,p,obstacles,director,bike,setup,dt,field=null,hook=null){
 planRival(a,i,p,obstacles,director,dt,field);
 let input=pursuitInput(a);
 if(hook){const alt=hook(a,i,input);if(alt)input={steer:alt.steer??input.steer,throttle:alt.throttle??input.throttle,brake:alt.brake??input.brake}}
 stepRival(a,input,bike,setup,dt,i);
}
// Policy-net driver (B8): planRival stays the Director-authoritative tactical brain; the
// tier-wrapped net only maps the shared obs vector (src/obs.js) to input. Falls back to
// the pursuit mapping when the policy is missing, throws or returns non-finite output,
// and the plan's speed limit is hard-enforced after the net — guardrails stay authoritative.
// The obs builder is dispatched on the policy's input width (policy.width, attached by
// makeTierPolicy): neon-rash-mlp@1 width-40 nets get the frozen v1 vector, anything else
// gets the canonical v2 vector — old placeholder weights keep working.
// Optional trailing hook (headless tools only, tools/gen-dataset.mjs DAgger rounds):
// hook(a,i,expertInput,executedInput,obs) observes the pursuit-expert action (the recording
// label) alongside the net's action at the learner-visited state, and may return a
// replacement executed input. Omitting it is unchanged.
export function driveNet(a,i,p,obstacles,rivals,director,bike,setup,dt,field,policy,hook=null){
 planRival(a,i,p,obstacles,director,dt,field);
 const obs=policy?buildObsFor(policy.width||OBS_WIDTH,a,[p,...rivals.filter((r,k)=>k!==i)].slice(0,3)):null;
 let input=null;
 if(policy)try{
  const act=policy(obs);
  if(act&&Number.isFinite(act[0])&&Number.isFinite(act[1])&&Number.isFinite(act[2]))input={steer:clamp(act[0],-1,1),throttle:act[1]>.5,brake:act[2]>.5};
 }catch{input=null}
 const expert=pursuitInput(a);
 if(!input)input=expert;
 if(hook){const alt=hook(a,i,expert,input,obs);if(alt)input={steer:alt.steer??input.steer,throttle:alt.throttle??input.throttle,brake:alt.brake??input.brake}}
 if(a.v>(a.speedLimit||a.target)*(a.stun>0?.55:1)){input.throttle=false;input.brake=true}
 stepRival(a,input,bike,setup,dt,i);
}
export function avoidHazards(a,hazards,p,director){
 const next=hazards.find(h=>h.s>a.s&&h.s-a.s<38&&Math.abs(h.x-a.x)<h.width*.5+1.2);
 const bait=hazards.find(h=>h.s-a.s>14&&h.s-a.s<58&&Math.abs(h.x-p.x)<h.width*.5+2.6);
 if(!next&&bait&&(director.encounter==='pressure'||director.encounter==='duel')&&Math.abs(p.s-a.s)<14&&p.health>45&&director.encounter!=='recover'){
  const side=bait.x>=0?-1:1;
  a.tactic='bait';a.lane=clamp(bait.x+side*4.4,-6.8,6.8);
  a.speedLimit=Math.min(a.speedLimit||a.target,Math.max(8,p.v+1));
  return;
 }
 if(!next)return;
 const alternate=next.lane%2===0?next.lane+1:next.lane-1;
 if(director.encounter==='recover'||next.type==='closure')a.lane=clamp(alternate,0,3)*4.4-6.6;
 else a.speedLimit=Math.min(a.speedLimit||a.target,Math.max(8,(next.s-a.s)*.9));
}
// Single in-flight request. Failure never stalls the game; late runs cannot mutate a new race.
export class DecisionClient {
 constructor(fetcher=globalThis.fetch){this.fetcher=fetcher;this.generation=0;this.status='LOCAL AI';this.next=0;this.pending=false;this.latest=null}
 reset(){this.generation++;this.controller?.abort();this.pending=false;this.latest=null;this.next=0}
 tick(p,rivals,setup,perception={},director=null,skillRating=0){
  if(setup.brain!=='laya'){this.status='LOCAL AI';return}
  if(this.pending||p.time<this.next)return;this.next=p.time+.8;this.pending=true;const generation=this.generation,at=p.time;const controller=new AbortController();this.controller=controller;const timer=setTimeout(()=>controller.abort(),900);
  const state={speed:Math.round(p.v),health:Math.round(p.health),altitude:Math.round(p.y),flight:!!p.flight,boost:!!p.boosting,bike:setup.bike,tires:setup.tires,world:setup.world,hazards:perception.hazards||[],encounter:director?.encounter??'balanced',position:1+rivals.filter(a=>a.s>p.s).length,clean:Math.round(director?.cleanTime??0),skill:Math.round(skillRating*100)/100,rivals:rivals.map((a,i)=>({personality:PERSONALITIES[a.pi??(i%PERSONALITIES.length)].style,gap:Math.round(a.s-p.s),lane:Math.round(a.x*10)/10,tactic:a.tactic||'race'}))};
  this.fetcher('/api/decision',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(state),signal:controller.signal}).then(async r=>{if(!r.ok)throw Error('unavailable');return r.json()}).then(d=>{if(generation!==this.generation||setup.brain!=='laya'||p.time-at>1.6)return;if(!validDecision(d))throw Error('invalid');this.latest=d;this.status='LAYA CONNECTED'}).catch(()=>{if(generation===this.generation){this.status='LAYA OFFLINE / LOCAL AI';this.next=p.time+4}}).finally(()=>{clearTimeout(timer);if(generation===this.generation)this.pending=false});
 }
 consume(){const d=this.latest;this.latest=null;return d}
}

// Visual assets receive behavior through actor state, independent of their meshes.
export function reactToPlayer(car,p,director,dt){
 car.baseSpeed??=car.v;car.baseX??=car.x;
 const ahead=p.s-car.s,close=ahead>0&&ahead<30&&Math.abs(p.x-car.x)<2.5&&Math.abs(p.y-car.y)<3;
 const target=close?Math.min(car.baseSpeed,Math.max(0,p.v-3)):car.baseSpeed;
 car.v+=clamp(target-car.v,-6*dt,2*dt);
 // Air traffic yields gradually when a rider approaches in its altitude band.
 if(car.y>3){const approaching=Math.abs(p.s-car.s)<40&&Math.abs(p.y-car.y)<4&&Math.abs(p.x-car.baseX)<4;const offset=approaching?(car.baseX>=0?3:-3):0;car.x+=clamp(car.baseX+offset-car.x,-1.2*dt,1.2*dt)}
 car.braking=close;
}
