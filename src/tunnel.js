// Pure tunnel placement (no three.js, no DOM): deterministic tunnel zones along the route.
// Geometry, interior lighting and ambient/probe handling live in world.js; physics.js is untouched —
// tunnels are visual-only shells and add no collision. Zones sit on the 24 m road-chunk grid
// (offset and period are both multiples of TUNNEL.step) so arch sections line up with the recycled deck chunks.
// Solid pylons (world-data.js pylon(): |x| in [13.5,18.5]) always clear the 13 m arch radius, and
// flight gates (y 13..41) hover mostly above the crown — placement needs no avoidance pass.
export const TUNNEL={offset:528,period:1608,len:288,step:24,radius:13,pool:32,ramp:48};
export function tunnelZone(i){const start=TUNNEL.offset+i*TUNNEL.period;return{start,end:start+TUNNEL.len}}
// Zone containing s, or null. Checks the two zones a point can fall in (period > len ⇒ at most one).
export function tunnelAt(s){const i=Math.floor((s-TUNNEL.offset)/TUNNEL.period);for(const k of[i,i+1]){if(k<0)continue;const z=tunnelZone(k);if(s>=z.start&&s<z.end)return z}return null}
// 0 outside, 1 fully inside, smoothstep ramps of TUNNEL.ramp metres at both mouths.
export function tunnelEnclosure(s){const z=tunnelAt(s);if(!z)return 0;const t=Math.max(0,Math.min((s-z.start)/TUNNEL.ramp,(z.end-s)/TUNNEL.ramp,1));return t*t*(3-2*t)}
// Section anchor positions (multiples of TUNNEL.step) for every zone overlapping (s-behind, s+range),
// capped at TUNNEL.pool so the instanced meshes in world.js can be sized statically.
export function tunnelSections(s,range=500,behind=48){const out=[];const i0=Math.max(0,Math.floor((s-behind-TUNNEL.offset)/TUNNEL.period)),i1=Math.floor((s+range-TUNNEL.offset)/TUNNEL.period);for(let i=i0;i<=i1;i++){const z=tunnelZone(i);for(let at=z.start;at<z.end;at+=TUNNEL.step){if(at>s-behind&&at<s+range){if(out.length>=TUNNEL.pool)return out;out.push(at)}}}return out}
