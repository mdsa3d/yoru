import test from 'node:test';
import assert from 'node:assert/strict';
import {WORLDS,getWorld,skyParams,headlightParams,smoothstepJS,spotAttenuation} from '../src/world-data.js';

test('skyParams: every shipped world resolves a full, sane tuning set',()=>{
 for(const w of WORLDS){const p=skyParams(w);
  for(const k of ['cover','bands','disc','halo','haze'])assert.ok(p[k]>=0&&p[k]<=1,`${w.id}.${k}=${p[k]} in [0,1]`);
  assert.ok(p.cloudScale>0&&p.cloudScale<=4,`${w.id}.cloudScale=${p.cloudScale}`);}
});
test('skyParams: kind defaults differ per kind and world.sky overrides win',()=>{
 assert.notDeepEqual(skyParams({kind:'city'}),skyParams({kind:'desert'}));
 const p=skyParams({kind:'desert',sky:{cover:.1}});assert.equal(p.cover,.1);assert.equal(p.bands,.9);
 assert.deepEqual(skyParams({kind:'unknown'}),skyParams({kind:'ocean'}));
});
test('headlightParams: every world resolves physical settings; akuma keeps legacy 420',()=>{
 assert.equal(headlightParams(getWorld('akuma')).intensity,420);
 for(const w of WORLDS){const h=headlightParams(w);
  assert.ok(h.intensity>0&&h.distance>0&&h.angle>0&&h.angle<Math.PI/2,`${w.id} sane`);
  assert.ok(h.penumbra>=0&&h.penumbra<1,`${w.id} penumbra`);assert.equal(h.decay,2,`${w.id} physical decay`);}
 const o=headlightParams({kind:'desert',headlight:{intensity:999}});assert.equal(o.intensity,999);assert.equal(o.distance,95);
 assert.deepEqual(headlightParams({kind:'unknown'}),headlightParams({kind:'desert'}));
});
test('smoothstepJS matches the GLSL contract',()=>{
 assert.equal(smoothstepJS(0,1,-.5),0);assert.equal(smoothstepJS(0,1,1.5),1);assert.equal(smoothstepJS(0,1,.5),.5);
 assert.ok(Math.abs(smoothstepJS(0,1,.25)+smoothstepJS(0,1,.75)-1)<1e-9,'symmetry');
});
test('spotAttenuation distance term is inverse-square at decay 2 without cutoff',()=>{
 const hp={distance:0,angle:.6,penumbra:0,decay:2};
 assert.ok(Math.abs(spotAttenuation(10,0,hp)/spotAttenuation(20,0,hp)-4)<1e-6,'I(2d)=I(d)/4');
 assert.equal(spotAttenuation(0,0,hp),0,'singular at d=0');
 assert.equal(spotAttenuation(-3,0,hp),0);
});
test('spotAttenuation cutoff window reaches zero at the light distance',()=>{
 const hp={distance:100,angle:.6,penumbra:0,decay:2};
 assert.equal(spotAttenuation(100,0,hp),0);assert.equal(spotAttenuation(150,0,hp),0);
 const near=spotAttenuation(99,0,hp),mid=spotAttenuation(50,0,hp);
 assert.ok(near>0&&near<mid,'cutoff fades smoothly before the limit');
});
test('spotAttenuation penumbra is a smooth cosine falloff between inner and outer cone',()=>{
 const hp={distance:0,angle:.5,penumbra:.5,decay:0};const inner=.5*.5;
 assert.equal(spotAttenuation(10,inner*.9,hp),1,'full inside inner cone');
 assert.equal(spotAttenuation(10,.5,hp),0,'dark at/beyond outer cone');
 const a=spotAttenuation(10,.3,hp),b=spotAttenuation(10,.4,hp);
 assert.ok(a>b&&b>0,'monotonic across the penumbra band');
 const flat=headlightParams(getWorld('solstice'));
 assert.ok(spotAttenuation(5,0,flat)>spotAttenuation(5,flat.angle*.99,flat),'per-world params behave');
});
