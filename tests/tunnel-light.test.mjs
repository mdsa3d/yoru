import test from 'node:test';import assert from 'node:assert/strict';
import {tunnelLightLevel} from '../src/world.js';
import {tunnelEnclosure,TUNNEL} from '../src/tunnel.js';
// The PointLight object/visibility wiring is GPU-side (not Node-testable per CLAUDE.md); the level
// mapping that replaced the visible-toggle is pure and pinned here so the constant-light-count
// contract can't regress: intensity carries the envelope, visibility is never touched.

test('tunnelLightLevel: 0 when effects are off regardless of enclosure',()=>{
 assert.equal(tunnelLightLevel(0,true),0);
 assert.equal(tunnelLightLevel(1,false),0);
 assert.equal(tunnelLightLevel(.5,false),0);
});

test('tunnelLightLevel follows the enclosure ramp and clamps to [0,1]',()=>{
 assert.equal(tunnelLightLevel(.5,true),.5);
 assert.equal(tunnelLightLevel(1,true),1);
 assert.equal(tunnelLightLevel(1.4,true),1,'clamped');
 assert.equal(tunnelLightLevel(-.2,true),0,'clamped');
});

test('level is a pure function of enclosure — no threshold, no hysteresis, no toggling',()=>{
 // The 3.19.0 code gated on enc>.02 and flipped light.visible, changing the light count and forcing
 // a full-scene program recompile at every tunnel mouth. The level mapping must be continuous.
 let prev=0;
 for(const s of [0,.001,.01,.02,.05,.5,1]){const v=tunnelLightLevel(s,true);assert.ok(v>=prev&&v<=1);prev=v}
 // Across a real zone boundary the level is continuous (ramp over TUNNEL.ramp metres).
 const z0=TUNNEL.offset,steps=[];
 for(let d=-2;d<=TUNNEL.ramp+2;d+=2)steps.push(tunnelLightLevel(tunnelEnclosure(z0+d),true));
 for(let i=1;i<steps.length;i++)assert.ok(Math.abs(steps[i]-steps[i-1])<=.2,'no discontinuity at the mouth');
 assert.equal(steps[0],0);assert.ok(steps[steps.length-1]>.9);
});
