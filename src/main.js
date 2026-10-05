import {BIKES,clamp,createState,road,toggleFlight} from './physics.js';
import {WORLDS,getWorld,nextGate} from './world-data.js';
import {World} from './world.js';
import {loadHero,loadTraffic,loadHazards} from './models.js';
await loadHero();
await loadTraffic();
await loadHazards();
import {AudioEngine} from './audio.js';
import {FrameClock,FrameStats,interpolate} from './timing.js';
import {DecisionClient,PERSONALITIES,SkillTracker,rivalTarget} from './rivals.js';
import {nearbyHazards} from './hazards.js';
import {createSim,resetSim,idleSim,stepSim} from './sim.js';
import {createTelemetry} from './telemetry.js';
import {loadMLP} from './mlp.js';
import {buildObs} from './obs.js';
import {estimateHz,probeTier,rungForTier} from './quality.js';
const fixed=new FrameClock(),stats=new FrameStats(),decisions=new DecisionClient(),skill=new SkillTracker(globalThis.localStorage);
let director,crashes=0,raceSeed=0;
const HITSTOP=true;
let previous={},renderState={},actorPrevious=new WeakMap(),actorRender=new WeakMap(),hudAt=0,perfAt=0,lastPosition=1,lastBeat=-1,lastHealth=100,hitStop=0,hitStopDebt=0,displayHz=60;
function snapshot(){Object.assign(previous,p);for(const a of [...rivals,...traffic,...drones]){let old=actorPrevious.get(a);if(!old){old={};actorPrevious.set(a,old)}Object.assign(old,a)}}
function smoothActors(actors,alpha){return actors.map(a=>{let out=actorRender.get(a);if(!out){out={};actorRender.set(a,out)}const old=actorPrevious.get(a)||a;return interpolate(Math.abs(old.s-a.s)>50?a:old,a,alpha,out)})}
const $=id=>document.getElementById(id),show=(id,v)=>$(id).hidden=!v;
const defaults={bike:0,paint:BIKES[0].color,gearing:1,tires:'street',weather:'rain',assist:1,mode:'race',quality:'auto',brain:'local',style:'solid',rivalBrain:'heuristic',gfxShadow:'on',gfxGtao:'on',gfxDetail:'on',gfxSsr:'off',gfxTunnels:'on',music:.5,fx:.7,world:'akuma',launch:'street'};
let setup={...defaults};
try{const saved=JSON.parse(localStorage.getItem('neon-rash-setup')||'null');if(saved&&typeof saved==='object')for(const k of Object.keys(defaults))if(typeof saved[k]===typeof defaults[k])setup[k]=saved[k]}catch{}
setup.bike=clamp(Math.floor(setup.bike),0,BIKES.length-1);setup.gearing=clamp(setup.gearing,.8,1.2);setup.world=getWorld(setup.world).id;
for(const [key,values] of Object.entries({tires:['street','rain','slick'],weather:['rain','dry'],mode:['race','free'],quality:['auto','high','low'],brain:['local','laya'],style:['solid','dither'],rivalBrain:['heuristic','net'],launch:['street','flight'],gfxShadow:['on','off'],gfxGtao:['on','off'],gfxDetail:['on','off'],gfxSsr:['on','off'],gfxTunnels:['on','off']}))if(!values.includes(setup[key]))setup[key]=defaults[key];
try{if(new URLSearchParams(location.search).get('rival-brain')==='net')setup.rivalBrain='net'}catch{}
if(!/^#[0-9a-f]{6}$/i.test(setup.paint))setup.paint=defaults.paint;
let bike=BIKES[setup.bike],p=createState(),mode='menu',rivals=[],traffic=[],drones=[],hazards=[],countdown=0,messageUntil=0,clock=0,accumulator=0,last=performance.now();
// Physics-driven rivals stay opt-in (URL ?rival-physics or localStorage flag) until proven by eval; default keeps the kinematic feel.
const rivalPhysics=(()=>{try{return new URLSearchParams(location.search).has('rival-physics')||localStorage.getItem('neon-rash-v3-rival-physics')==='1'}catch{return false}})();
// Policy-net rivals (B8) are doubly opt-in: setup.rivalBrain='net' AND the physical-rivals
// path. The shipped weights are an UNTRAINED synthetic placeholder (see ASSETS.md), so the
// default stays 'heuristic' and any fetch/load failure silently keeps the heuristic.
let rivalNet=null;
if(setup.rivalBrain==='net'&&rivalPhysics){try{const r=await fetch('assets/ai/rival-policy-synthetic.json');if(!r.ok)throw new Error('policy fetch '+r.status);rivalNet=loadMLP(await r.json())}catch{rivalNet=null}}
const sim=createSim({setup,paceScale:skill.paceScale,rivalBrain:rivalNet?'net':rivalPhysics?'physical':'kinematic',net:rivalNet,skillRating:skill.rating,hooks:{message:(t,d)=>message(t,d),collision:(r,t,k,s)=>collision(r,t,k,s)}});
const telemetry=createTelemetry();
try{telemetry.enabled=new URLSearchParams(location.search).has('telemetry')||localStorage.getItem('neon-rash-v3-telemetry')==='1'}catch{}
function linkSim(){p=sim.p;rivals=sim.rivals;traffic=sim.traffic;drones=sim.drones;hazards=sim.hazards;director=sim.director}
linkSim();
const keys=new Set(),audio=new AudioEngine();audio.musicVolume=setup.music;audio.fxVolume=setup.fx;
let world;try{world=new World($('world'),bike,setup)}catch(e){show('error',true);$('error').textContent='WebGL 2 is required. Enable hardware acceleration or try a current browser. '+e.message;throw e}
// Initial GPU capability probe (3.19.0): a HEURISTIC hint for the adaptive ladder's start rung.
// The renderer string match is best-effort (browsers may mask it) — the measured ladder in
// world.adapt() corrects any wrong guess within seconds. Manual quality ignores the probe.
{let gpu='';try{const gl=world.renderer.getContext(),ext=gl.getExtension('WEBGL_debug_renderer_info');gpu=ext?gl.getParameter(ext.UNMASKED_RENDERER_WEBGL):(gl.getParameter(gl.RENDERER)||'')}catch{}
 world.probeTier=probeTier({renderer:gpu,maxTextureSize:world.renderer.capabilities.maxTextureSize,dpr:devicePixelRatio,memory:navigator.deviceMemory||0,cores:navigator.hardwareConcurrency||0,coarse:matchMedia('(pointer:coarse)').matches});
 if(setup.quality==='auto')world.setInitialRung(rungForTier(world.probeTier))}
function save(){try{localStorage.setItem('neon-rash-setup',JSON.stringify(setup))}catch{}}
function records(){try{const r=JSON.parse(localStorage.getItem('neon-rash-v3-records')||'[]');return Array.isArray(r)?r.filter(x=>Number.isFinite(x.time)&&typeof x.bike==='string').slice(0,40):[]}catch{return []}}
function matchingRecords(){return records().filter(r=>r.world===setup.world&&r.launch===setup.launch).sort((a,b)=>a.time-b.time)}
function time(v){return `${String(Math.floor(v/60)).padStart(2,'0')}:${(v%60).toFixed(1).padStart(4,'0')}`}
function updateCaption(){
 const w=getWorld(setup.world);$('bikeName').textContent=bike.name;$('bikeNumber').textContent=String(setup.bike+1).padStart(2,'0');$('inspiration').textContent=(bike.id==='nightblade'?'':'Inspired by ')+bike.inspired;$('powerStat').textContent=bike.hp;$('massStat').textContent=bike.mass;
 $('condition').textContent=(setup.weather==='rain'?'RAIN / ':'CLEAR / ')+w.temperature;$('worldCaption').textContent=w.name;$('worldStatus').textContent=w.short+' · '+w.time;
 const r=matchingRecords();$('best').textContent=r.length?'BEST '+time(r[0].time):'NO PERSONAL BEST YET';
 audio.worldRoot=w.musicRoot;audio.worldKind=w.kind;
}
function buildGarage(){
 $('bikes').replaceChildren();BIKES.forEach((b,i)=>{const btn=document.createElement('button');btn.className='bike-card';btn.setAttribute('aria-pressed',String(i===setup.bike));btn.innerHTML=`<small>0${i+1} / ${b.era}</small><b>${b.name}</b><span>${b.inspired} · ${b.hp} HP*</span>`;
 btn.onclick=()=>{audio.uiClick();setup.bike=i;bike=b;setup.paint=b.color;$('paint').value=setup.paint;world.setBike(bike,setup.paint);save();buildGarage();updateCaption()};btn.onmouseenter=()=>audio.uiHover();$('bikes').append(btn)})
}
function selectWorld(id){setup.world=id;setup.weather=getWorld(id).weather;$('weather').value=setup.weather;world.setWorld(id);save();updateCaption();buildWorlds()}
function buildWorlds(){
 $('worldCards').replaceChildren();for(const w of WORLDS){const btn=document.createElement('button');btn.className='world-card';btn.dataset.world=w.id;btn.setAttribute('aria-pressed',String(w.id===setup.world));btn.style.setProperty('--world-image',`url('./assets/${w.id}.jpg')`);btn.innerHTML=`<small>${w.tag}</small><span class="selected">${w.id===setup.world?'SELECTED / ✓':'EXPLORE ↗'}</span><b>${w.name}</b><p>${w.description}</p>`;btn.onclick=()=>{audio.uiClick();selectWorld(w.id)};btn.onmouseenter=()=>audio.uiHover();$('worldCards').append(btn)}
}
for(const id of ['paint','gearing','tires','weather','assist','mode','quality','style','launch','brain','rivalBrain','gfxShadow','gfxGtao','gfxDetail','gfxSsr','gfxTunnels']){
 $(id).value=setup[id];$(id).addEventListener('input',()=>{setup[id]=['gearing','assist'].includes(id)?Number($(id).value):$(id).value;if(id==='paint'){world.player.userData.paint.color.set(setup.paint);world.player.userData.glow.color.set(setup.paint);world.player.userData.glow.emissive.set(setup.paint)}if(id==='launch')world.initialized=false;if(id==='style')world.grade.uniforms.uDither.value=setup.style==='dither'?1:0;if(id.startsWith('gfx'))world.applyGraphicsFlags(setup);$('gearingValue').textContent=setup.gearing.toFixed(2)+'×';save();updateCaption()})
}
$('gearingValue').textContent=setup.gearing.toFixed(2)+'×';
for(const [id,key,audioKey] of [['musicVolume','music','musicVolume'],['fxVolume','fx','fxVolume']]){$(id).value=setup[key];$(id).oninput=()=>{setup[key]=Number($(id).value);audio[audioKey]=setup[key];save()}}
$('garageButton').onclick=()=>{audio.uiClick();show('garage',true);$('closeGarage').focus()};$('garageButton').onmouseenter=()=>audio.uiHover();$('closeGarage').onclick=()=>{show('garage',false);$('garageButton').focus()};
$('worldButton').onclick=()=>{show('worldPanel',true);$('closeWorlds').focus()};$('closeWorlds').onclick=()=>{show('worldPanel',false);$('worldButton').focus()};
async function enableAudio(){try{await audio.start();$('audio').textContent='SOUND ON'}catch{$('audio').textContent='AUDIO UNAVAILABLE'}}
$('audio').onclick=async()=>{if(!audio.ctx)await enableAudio();else{audio.setEnabled(!audio.enabled);$('audio').textContent=audio.enabled?'SOUND ON':'SOUND OFF'}};
function message(text,duration=1.6){if($('message').textContent!==text)$('message').textContent=text;messageUntil=clock+duration}
function start(){
 raceSeed++;sim.paceScale=skill.paceScale;sim.skillRating=skill.rating;resetSim(sim,raceSeed);linkSim();
 world.conversion=setup.launch==='flight'?1:0;
 fixed.reset();director.aggression=skill.aggression;decisions.reset();world.resetQuality(setup.quality);previous={...p};actorPrevious=new WeakMap();actorRender=new WeakMap();crashes=0;hitStop=0;hitStopDebt=0;countdown=3;lastBeat=-1;lastHealth=100;keys.clear();mode='race';world.initialized=false;world.setActors(rivals,traffic,BIKES,drones,hazards);snapshot();lastPosition=1+rivals.filter(a=>a.s>p.s).length;$('world').classList.remove('desaturating');
 telemetry.begin({world:setup.world,bike:bike.id,seed:raceSeed});
 for(const id of ['menu','bikeCaption','menuFooter','garage','worldPanel','overlay'])show(id,false);show('hud',true);show('pause',true);show('touch',matchMedia('(pointer:coarse)').matches);document.body.classList.add('playing');$('pause').textContent='PAUSE Ⅱ';
 if(!audio.ctx)enableAudio();else if($('audio').textContent==='SOUND ON')audio.setEnabled(true);message('3',4);audio.fadeMusic(0,.4);$('ride').blur();
}
$('ride').onclick=()=>{audio.uiClick();start()};$('ride').onmouseenter=()=>audio.uiHover();
function setPaused(){
 if(mode==='race'){mode='paused';snapshot();fixed.reset();decisions.reset();keys.clear();show('overlay',true);show('flightTouch',false);$('overlayTag').textContent='TAKE A BREATH';$('overlayTitle').textContent='PAUSED.';$('overlayText').textContent='Your world is right where you left it.';show('resume',true);$('records').replaceChildren();audio.setEnabled(false);$('resume').focus()}
 else if(mode==='paused'){mode='race';show('overlay',false);if($('audio').textContent==='SOUND ON')audio.setEnabled(true)}
}
$('pause').onclick=setPaused;$('resume').onclick=setPaused;$('restart').onclick=start;
$('home').onclick=()=>{decisions.reset();telemetry.end();mode='menu';idleSim(sim);linkSim();keys.clear();$('world').classList.remove('desaturating');document.body.classList.remove('critical');lastHealth=100;for(const id of ['overlay','hud','pause','touch','flightTouch'])show(id,false);for(const id of ['menu','bikeCaption','menuFooter'])show(id,true);document.body.classList.remove('playing');world.setActors([],[],BIKES,[]);world.initialized=false;audio.fadeMusic(1,.6);updateCaption();$('ride').focus()};
function finish(wrecked=false){
 if(mode!=='race')return;decisions.reset();telemetry.end();if(telemetry.enabled&&telemetry.count)telemetry.download(`neon-rash-${setup.world}-${Date.now()}.jsonl`);mode='finished';keys.clear();$('world').classList.add('desaturating');const place=1+rivals.filter(a=>a.s>p.s).length;show('overlay',true);show('touch',false);show('flightTouch',false);show('resume',false);
 $('overlayTag').textContent=wrecked?'LIVE TO RIDE ANOTHER DAY':getWorld(setup.world).name+' / COMPLETE';$('overlayTitle').textContent=wrecked?'WIPED OUT.':place===1?'WORLD OWNED.':'RUN COMPLETE.';
 $('overlayText').textContent=`${time(p.time+hitStopDebt)} · ${(p.s/1000).toFixed(2)} km · ${sim.nearMisses} near misses · ${sim.gatesPassed} air gates${wrecked?'':` · Position ${place} of ${rivals.length+1}`}`;
 if(!wrecked&&setup.mode==='race'){const r=records();r.push({time:p.time+hitStopDebt,bike:bike.name,weather:setup.weather,assist:setup.assist,world:setup.world,launch:setup.launch,flightUsed:p.flightUsed,gates:sim.gatesPassed,position:place});r.sort((a,b)=>a.time-b.time);try{localStorage.setItem('neon-rash-v3-records',JSON.stringify(r.slice(0,40)))}catch{}}
 if(setup.mode==='race')skill.record({place,total:rivals.length+1,wrecked,distance:p.s,time:p.time+hitStopDebt,vmax:p.flightUsed?bike.vair:bike.vmax,crashes});
 $('records').replaceChildren();const label=document.createElement('div');label.textContent='PERSONAL RUNS / THIS WORLD + START MODE';$('records').append(label);for(const [i,r] of matchingRecords().slice(0,5).entries()){const row=document.createElement('div');row.textContent=`${i+1}. ${time(r.time)} — ${r.bike} / ${r.flightUsed?'HYBRID':'ROAD ONLY'}`;$('records').append(row)}$('restart').focus();
}
function strike(side){
 if(mode!=='race'||countdown>0||sim.hitCooldown>0)return;sim.hitCooldown=.65;let hit=false;
 for(const a of rivals){const dx=a.x-p.x;if(Math.abs(a.s-p.s)<3.2&&Math.abs(a.y-p.y)<1.8&&Math.abs(dx)<2.9&&dx*side>0){a.stun=1.3;a.v*=.65;a.x=clamp(a.x+side*1.1,-30,30);hit=true}}
 if(hit){world.burst(p.x+side*.6,p.y,0,SPARK.rival);audio.crash('rival');if(HITSTOP)hitStop=Math.max(hitStop,.045)}
 message(hit?'RIVAL STAGGERED':'STRIKE '+(side<0?'LEFT':'RIGHT'),.65);
}
function fly(){if(mode!=='race'||countdown>0)return;message(toggleFlight(p),2.2);rivals.forEach((a,i)=>{const wasAir=a.flight;a.flight=p.flight;a.target=rivalTarget(p.flight,i);if(rivalPhysics){if(a.flight)a.altTarget=Math.max(24,a.y||0);else if(wasAir){a.landing=true;a.altTarget=0}}})}
$('flyButton').onclick=fly;$('cameraButton').onclick=()=>world.cameraMode=(world.cameraMode+1)%3;
const consumed=new Set(['w','a','s','d','arrowup','arrowdown','arrowleft','arrowright',' ','q','e','p','c','f','shift','control','escape']);
addEventListener('keydown',e=>{const k=e.key.toLowerCase();if(['INPUT','SELECT','TEXTAREA'].includes(e.target.tagName))return;if(consumed.has(k))e.preventDefault();keys.add(k);if(e.repeat)return;if(k==='p'||k==='escape'){if(!$('garage').hidden)$('closeGarage').click();else if(!$('worldPanel').hidden)$('closeWorlds').click();else setPaused()}if(k==='c')world.cameraMode=(world.cameraMode+1)%3;if(k==='f')fly();if(k==='q')strike(-1);if(k==='e')strike(1)});
addEventListener('keyup',e=>keys.delete(e.key.toLowerCase()));addEventListener('blur',()=>{keys.clear();if(mode==='race')setPaused()});document.addEventListener('visibilitychange',()=>{if(document.hidden&&mode==='race')setPaused()});
addEventListener('pointermove',e=>{world.pointer.x=(e.clientX/innerWidth)*2-1;world.pointer.y=(e.clientY/innerHeight)*2-1});
addEventListener('pointerleave',()=>{world.pointer.x=0;world.pointer.y=0});
for(const btn of document.querySelectorAll('[data-key]')){const key=btn.dataset.key;btn.addEventListener('pointerdown',e=>{e.preventDefault();btn.setPointerCapture(e.pointerId);keys.add(key);if(key==='q')strike(-1);if(key==='e')strike(1)});for(const ev of ['pointerup','pointercancel','lostpointercapture'])btn.addEventListener(ev,()=>keys.delete(key))}
function input(){
 const air=p.flight||p.landing;
 let steer=(keys.has('d')||keys.has('arrowright')?1:0)-(keys.has('a')||keys.has('arrowleft')?1:0),throttle=keys.has('w')||keys.has('arrowup'),brake=keys.has('s')||keys.has('arrowdown')||(!air&&keys.has(' ')),climb=(keys.has(' ')?1:0)-(keys.has('control')?1:0),boost=keys.has('shift');
 const pad=navigator.getGamepads?.()[0];if(pad){if(Math.abs(pad.axes[0])>.13)steer=pad.axes[0];throttle ||=pad.buttons[7]?.value>.1;brake ||=pad.buttons[6]?.value>.1;if(Math.abs(pad.axes[3]||0)>.15)climb=-pad.axes[3];boost ||=!!pad.buttons[4]?.pressed}
 return {steer,throttle,brake,climb,boost};
}
const SPARK={structure:{count:34,color:0xfff0c4,speed:1.5,life:[.35,1.1],gravity:14},traffic:{count:22,color:0xffb967,speed:1,life:[.3,.8],gravity:12},rival:{count:14,color:0x9df0ff,speed:.8,life:[.22,.55],gravity:10},debris:{count:10,color:0xb0a68c,speed:.7,life:[.2,.45],gravity:16}};
// Presentation hook for sim-reported impacts; the damage roll (impact()) happens inside stepSim.
function collision(relative,text,kind,stop){crashes++;world.burst(p.x,p.y,0,SPARK[kind]||SPARK.traffic);world.hitFlash=1;audio.crash(kind);message(text,1);const hs=stop??(kind==='structure'?.13:kind==='rival'?.05:kind==='debris'?.035:Math.abs(relative)>28?.11:.06);if(HITSTOP&&hs>=.03)hitStop=Math.max(hitStop,hs)}
function simulate(dt){
 if(countdown>0){countdown-=dt;const beat=Math.ceil(Math.max(0,countdown));message(countdown>0?String(beat):'GO.',.8);if(beat!==lastBeat){lastBeat=beat;audio.countdownBeep(beat);const m=$('message');m.classList.remove('beat');void m.offsetWidth;m.classList.add('beat')}if(countdown<=0){$('message').classList.add('go');setTimeout(()=>$('message').classList.remove('go'),250);audio.fadeMusic(1,.8)}return}
 // Race rules live in src/sim.js (DOM-free, seeded); presentation stays here via hooks.
 const controls=input();stepSim(sim,dt,controls,decisions.consume());
 telemetry.sample(p.time,{obs:buildObs(p,rivals),input:controls,tactic:{encounter:director.encounter,director:director.tactic,rivals:rivals.map(a=>a.tactic||'race')}});
 if(sim.done)finish(sim.done==='wrecked');
}
function hud(){
 if(mode==='menu')return;
 $('aiStatus').textContent=decisions.status+' · '+director.encounter.toUpperCase();
 $('rivalStatus').textContent=rivals.map((a,i)=>PERSONALITIES[a.pi??(i%PERSONALITIES.length)].name+' / '+(a.tactic||'race').toUpperCase()).join(' · ');
 const air=p.flight||p.landing;
 $('speed').textContent=Math.round(p.v*3.6);$('gear').textContent=air?'V':p.v<.2?'N':p.gear;$('rpmbar').style.width=clamp(p.rpm/bike.redline*100,0,100)+'%';$('rpmbar').style.background=p.boosting?'#75ecff':'#b8ff55';const tach=$('rpmbar').parentElement;tach.style.setProperty('--rpm',clamp(p.rpm/bike.redline*100,0,100));tach.style.setProperty('--rpm-color',p.boosting?'#75ecff':'#b8ff55');
 $('healthbar').style.width=p.health+'%';document.body.classList.toggle('critical',p.health<30);if(p.health<lastHealth){const v=$('vignette');v.classList.remove('hit-flash');void v.offsetWidth;v.classList.add('hit-flash');setTimeout(()=>v.classList.remove('hit-flash'),120)}lastHealth=p.health;$('healthText').textContent=Math.round(p.health)+'%';$('distance').innerHTML=(p.s/1000).toFixed(2)+' <em>KM</em>';$('timer').textContent=time(p.time);const place=1+rivals.filter(a=>a.s>p.s).length;$('position').textContent=place;$('position').classList.toggle('leading',place===1);if(place!==lastPosition){lastPosition=place;const b=$('position').parentElement;b.classList.remove('rank-change');void b.offsetWidth;b.classList.add('rank-change')}$('score').textContent=sim.nearMisses;$('progress').style.width=(setup.mode==='race'?Math.min(100,p.s/40):p.s/40%100)+'%';
 $('grip').textContent=air?(p.boosting?'OVERDRIVE / ACTIVE':'VECTOR THRUST / STABILIZED'):p.slip>.15?'GRIP LIMIT / EASE OFF':setup.assist?'TRACTION CONTROL / ACTIVE':'EXPERT HANDLING';
 $('altitude').textContent=Math.round(p.y);$('driveStatus').textContent=p.landing?'AUTO LANDING':p.flight?'VECTOR DRIVE':'ROAD DRIVE';$('energybar').style.width=p.energy+'%';const g=nextGate(sim.gateIndex);$('gateInfo').textContent=air?`GATE ${sim.gateIndex+1} / ${Math.max(0,Math.round(g.s-p.s))} M · ALT ${Math.round(g.y)} M`:'F / ENGAGE VECTOR DRIVE';$('flyButton').textContent=p.flight?'F / AUTO LAND':'F / TAKE OFF';
 $('raceHelp').innerHTML=air?'W / S THRUST / AIRBRAKE · A D BANK<br>SPACE / CTRL ALTITUDE · SHIFT BOOST · F LAND':'W / S THROTTLE / BRAKE · A D STEER<br>F TAKE OFF · Q / E STRIKE · C CAMERA';
 show('flightTouch',air&&mode==='race'&&matchMedia('(pointer:coarse)').matches);
 if(clock>messageUntil)$('message').textContent='';
 const ctx=$('map').getContext('2d');ctx.clearRect(0,0,160,180);ctx.strokeStyle='#87b0c255';ctx.lineWidth=air?30:22;ctx.beginPath();for(let i=0;i<180;i++){const s=p.s+(150-i)*2,x=80+(road(s)-road(p.s))*.65;i?ctx.lineTo(x,i):ctx.moveTo(x,i)}ctx.stroke();
 if(setup.mode==='race'){const fy=150-(4000-p.s)/2;if(fy>=0&&fy<180){ctx.strokeStyle='#ffcf4d';ctx.lineWidth=2;ctx.beginPath();ctx.moveTo(0,fy);ctx.lineTo(160,fy);ctx.stroke()}}
 ctx.fillStyle='#5c6f7c';for(const a of traffic){const y=150-(a.s-p.s)/2;if(y>=0&&y<180){ctx.beginPath();ctx.arc(80+(road(a.s)-road(p.s))*.65+a.x,y,2,0,Math.PI*2);ctx.fill()}}
 ctx.fillStyle='#ff7b55';for(const h of hazards){if(h.type!=='closure'&&h.type!=='debris')continue;const y=150-(h.s-p.s)/2;if(y>=0&&y<180){ctx.beginPath();ctx.arc(80+(road(h.s)-road(p.s))*.65+h.x,y,2.5,0,Math.PI*2);ctx.fill()}}
 const ranked=[...rivals].sort((a,b)=>b.s-a.s);for(const [i,a] of ranked.entries()){const y=150-(a.s-p.s)/2;if(y>=0&&y<180){ctx.fillStyle=i===0?'#ffcf4d':'#ff7b9e';ctx.beginPath();ctx.arc(80+(road(a.s)-road(p.s))*.65+a.x,y,3,0,Math.PI*2);ctx.fill()}}ctx.fillStyle='#b8ff55';ctx.beginPath();ctx.arc(80+p.x,150,4,0,Math.PI*2);ctx.fill();
}
function frame(now){
 const raw=Math.max(0,(now-last)/1000),dt=Math.min(.1,raw);last=now;
 if(mode!=='paused'&&mode!=='finished')clock+=dt;
 let alpha=1,tScale=1;
 if(mode==='race'){
  if(HITSTOP&&hitStop>0)tScale=.22;hitStopDebt+=raw*(1-tScale);hitStop=Math.max(0,hitStop-raw);
  alpha=fixed.advance(raw,step=>{if(mode==='race'){snapshot();simulate(step)}},tScale);
  if(countdown<=0)  decisions.tick(p,rivals,setup,{hazards:nearbyHazards(hazards,p)},director,skill.rating);
 }else fixed.reset();
 if(now-hudAt>66){hud();hudAt=now}
 stats.add(raw*1000);
 if(now-perfAt>2000){const report=stats.summary();displayHz=estimateHz(report,displayHz);if(mode!=='menu'&&!window.__benchRunning)world.adapt(report,setup.quality,displayHz);$('performance').textContent=Math.round(report.p50)+' MS P50 · '+Math.round(report.p95)+' MS P95 · '+world.renderScale.toFixed(2)+'× · '+world.qualityText(setup.quality)+' · '+displayHz+'HZ';perfAt=now}
 audio.encounter=director.encounter;audio.update(p,bike,mode==='race'&&countdown<=0,input().throttle,setup.weather,p.surfaceGrip,rivals,traffic,tScale);
 $('vignette').style.setProperty('--vig',Math.min(.62,.22+(1-p.health/100)*.28+Math.min(.12,p.v/260)));
 const shown=mode==='race'?interpolate(previous,p,alpha,renderState):p;
 world.render(shown,smoothActors(rivals,alpha),smoothActors(traffic,alpha),mode==='menu'?'menu':'race',mode==='paused'||mode==='finished'?0:dt,clock,setup,smoothActors(drones,alpha));requestAnimationFrame(frame);
}
buildGarage();buildWorlds();updateCaption();requestAnimationFrame(frame);
const urlParams=new URLSearchParams(location.search);
if(urlParams.has('test')||urlParams.has('bench'))window.__game={get performance(){return {...stats.summary(),droppedSeconds:fixed.dropped,calls:world.renderer.info.render.calls,triangles:world.renderer.info.render.triangles}},director,decisions,get state(){return p},get mode(){return mode},get rivals(){return rivals},get traffic(){return traffic},get drones(){return drones},get hazards(){return hazards},get setup(){return setup},get audio(){return audio},get gates(){return {passed:sim.gatesPassed,missed:sim.gatesMissed,index:sim.gateIndex}},get sim(){return sim},telemetry,get renderInfo(){return world.renderer.info.render},get quality(){return {rung:world.ladder.rung,label:world.tier.label,hz:displayHz,probe:world.probeTier}},advance(seconds){for(let t=0;t<seconds;t+=1/120)if(mode==='race')simulate(1/120)},setInput(key,down){down?keys.add(key):keys.delete(key)},selectWorld,fly,start,finish,strike,world};
// ?bench=1 (3.19.0): per-feature cost harness, see src/bench.js. Results go to window.__bench and a
// downloaded JSON. NOT a benchmark when run under SwiftShader/headless containers (software rendering).
if(urlParams.has('bench'))import('./bench.js').then(m=>m.runBench(window.__game,{measureMs:+urlParams.get('benchMs')||4000,warmupMs:+urlParams.get('benchWarmup')||1200,reps:+urlParams.get('benchReps')||3})).catch(e=>{console.error('bench failed',e);window.__benchError=String(e&&e.message||e)});
