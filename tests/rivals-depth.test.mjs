import test from 'node:test';import assert from 'node:assert/strict';
import {TACTICS,ENCOUNTERS,PERSONALITIES,validDecision,guardTactic,SkillTracker,rosterFor,bandOf,surveyRivals,Director,controlRival} from '../src/rivals.js';
import {sanitizeState} from '../server/decision-service.mjs';

test('surveyRivals ranks leader/striker, fills aheadOf and is deterministic',()=>{
 const rivals=[{s:50,x:1,y:0,v:30,stun:0},{s:80,x:-2,y:0,v:32,stun:0},{s:65,x:0,y:0,v:31,stun:1}],p={s:60,x:0,y:0,v:30};
 const field=surveyRivals(rivals,p,1/60);
 assert.equal(field.n,3);assert.equal(field.leader,1);assert.deepEqual(field.order,[1,2,0]);
 assert.equal(field.striker,0);                       // rival 2 is stunned, rival 0 is nearest non-stunned
 assert.equal(field.aheadOf[1],null);                 // leader has nobody ahead (player is behind)
 assert.deepEqual(field.aheadOf[0],{s:60,x:0,v:30});  // player is the nearest actor ahead of rival 0
 assert.equal(field.duel,-1);
 const again=surveyRivals(rivals,p,1/60,{});
 assert.deepEqual(again.order,field.order);assert.deepEqual([...again.band],[...field.band]);
});
test('surveyRivals detects a duel only after sustained proximity',()=>{
 const rivals=[{s:101,x:1,y:0,v:40,stun:0}],p={s:100,x:0,y:0,v:40};
 let field={};for(let i=0;i<300;i++)field=surveyRivals(rivals,p,1/60,field);   // 5 s: not yet
 assert.equal(field.duel,-1);
 for(let i=0;i<90;i++)field=surveyRivals(rivals,p,1/60,field);                 // past 6 s
 assert.equal(field.duel,0);
 for(let i=0;i<400;i++){rivals[0].s=160;field=surveyRivals(rivals,p,1/60,field)} // rival pulls away, timer decays
 assert.equal(field.duel,-1);
});
test('director adopts duel only when survey reports one, remote duel is gated',()=>{
 const p={health:100,time:10,v:50},d=new Director();
 d.update(p,6,{tactic:'race',encounter:'duel'},80,{duel:-1});                   // remote wants duel, nobody locked on
 assert.notEqual(d.encounter,'duel');assert.equal(d.duel,-1);
 const e=new Director();e.update(p,6,null,80,{duel:1,duelName:'SABLE'});
 assert.equal(e.encounter,'duel');assert.equal(e.duel,1);assert.match(e.notice,/SABLE/);
 const f=new Director();f.update(p,.1,null,80);                                 // no field at all: legacy branch tree
 assert.equal(f.encounter,'balanced');
});
test('controlRival with a shared field de-conflicts lane claims (pincer splits flanks)',()=>{
 const d=new Director();d.encounter='pressure';
 const p={s:100,x:0,y:0,v:40,time:10,health:100};
 const rivals=[{s:95,x:3,y:0,v:35,target:60,stun:0,attack:0},{s:94,x:1.5,y:0,v:35,target:60,stun:0,attack:0}];
 const field=surveyRivals(rivals,p,1/60);
 for(const i of field.order)controlRival(rivals[i],i,p,[],d,1/60,field);
 assert.equal(rivals[0].tactic,'overtake');assert.equal(rivals[1].tactic,'overtake');
 assert.ok(rivals[0].lane>0&&rivals[1].lane<0,'trailing rival mirrors to the free side');
 assert.notEqual(bandOf(rivals[0].lane),bandOf(rivals[1].lane));
});
test('controlRival without a field keeps the legacy fallback path',()=>{
 const d=new Director(),p={s:100,x:0,y:0,v:40,time:30,health:100},a={s:70,x:0,y:0,v:30,target:40,stun:0,attack:0};
 controlRival(a,0,p,[],d,.01);
 assert.equal(a.tactic,'overtake');assert.ok(Number.isFinite(a.lane)&&Number.isFinite(a.speedLimit));
});
test('guardTactic downgrades remote tactics whose preconditions are false',()=>{
 const d=new Director(),a={},p={health:100};
 d.encounter='recover';assert.equal(guardTactic('block',a,p,d,PERSONALITIES[3],-5),'yield');
 d.encounter='pressure';
 assert.equal(guardTactic('block',a,p,d,PERSONALITIES[2],-5),'defend');        // patient never blocks
 assert.equal(guardTactic('block',a,p,d,PERSONALITIES[3],-5),'block');         // ruthless, gap in (-22,0)
 assert.equal(guardTactic('block',a,{health:40},d,PERSONALITIES[3],-5),'defend'); // hurt player
 assert.equal(guardTactic('slipstream',a,p,d,PERSONALITIES[0],30),'race');     // outside 3.5..17 window
 assert.equal(guardTactic('slipstream',a,p,d,PERSONALITIES[0],8),'slipstream');
 assert.equal(guardTactic('bait',a,p,d,PERSONALITIES[0],8),'race');            // bait is local-only
 assert.equal(guardTactic('teleport',a,p,d,PERSONALITIES[0],8),'race');
});
test('validDecision accepts the widened enums and rejects unknowns',()=>{
 assert.ok(validDecision({tactic:'slipstream',encounter:'duel'}));
 assert.ok(validDecision({tactic:'block',encounter:'balanced'}));
 assert.ok(!validDecision({tactic:'teleport',encounter:'duel'}));
 assert.ok(!validDecision({tactic:'race',encounter:'swarm'}));
 assert.ok(!validDecision(null));
 assert.deepEqual(TACTICS,['race','overtake','defend','yield','slipstream','block','bait']);
 assert.deepEqual(ENCOUNTERS,['recover','balanced','pressure','duel']);
});
test('SkillTracker persists through injected storage and tolerates corruption',()=>{
 const mem={},storage={getItem:k=>mem[k]??null,setItem:(k,v)=>{mem[k]=String(v)}};
 const s1=new SkillTracker(storage);s1.record({place:1,total:4,distance:3000,time:60,vmax:80,crashes:0});
 const s2=new SkillTracker(storage);
 assert.equal(s2.races,1);assert.equal(s2.rating,s1.rating);assert.ok(s2.rating>0);
 mem['neon-rash-v3-skill']='{corrupt';const s3=new SkillTracker(storage);
 assert.equal(s3.rating,0);assert.equal(s3.races,0);
 const s4=new SkillTracker();                                                   // no storage at all
 s4.record({place:4,total:4,wrecked:true});assert.ok(s4.rating<0);
});
test('SkillTracker stays within documented bounds',()=>{
 const win=new SkillTracker(),lose=new SkillTracker();
 for(let i=0;i<50;i++){win.record({place:1,total:4,distance:3200,time:60,vmax:80,crashes:0});lose.record({place:4,total:4,wrecked:true,distance:900,time:60,vmax:80,crashes:9})}
 assert.ok(win.rating<=1&&win.paceScale<=1.06);assert.ok(lose.rating>=-1&&lose.paceScale>=.94);
 assert.ok(win.aggression>=0&&win.aggression<=1&&lose.aggression>=0&&lose.aggression<=1);
 assert.equal(win.races,50);
});
test('roster keeps the original three archetypes stable and rotates trios',()=>{
 assert.deepEqual(PERSONALITIES.slice(0,3).map(x=>x.name),['VIPER','GHOST','ECHO']);
 for(let seed=0;seed<5;seed++){const r=rosterFor(3,seed);assert.equal(r.length,3);assert.equal(new Set(r).size,3);for(const i of r)assert.ok(i>=0&&i<PERSONALITIES.length)}
});
test('sanitizeState keeps the new fields and coerces unknowns',()=>{
 const s=sanitizeState({speed:50,health:80,altitude:0,bike:1,tires:'rain',world:'akuma',encounter:'duel',position:2,clean:7,skill:.4,rivals:[{personality:'ruthless',gap:-5,lane:2,tactic:'block'}]});
 assert.equal(s.encounter,'duel');assert.equal(s.position,2);assert.equal(s.clean,7);assert.equal(s.skill,.4);
 assert.deepEqual(s.rivals[0],{personality:'ruthless',gap:-5,lane:2,tactic:'block'});
 const c=sanitizeState({speed:50,health:80,altitude:0,bike:1,encounter:'swarm',skill:9,rivals:[{personality:'teleport',tactic:'teleport'}]});
 assert.equal(c.encounter,'balanced');assert.equal(c.skill,1);
 assert.equal(c.rivals[0].personality,'patient');assert.equal(c.rivals[0].tactic,'race');
 assert.throws(()=>sanitizeState({speed:'fast'}));
});
