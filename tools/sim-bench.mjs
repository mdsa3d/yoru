// Headless sim throughput benchmark (UPLIFT-PLAN B2): steps/s for both rival controllers.
// Run: node tools/sim-bench.mjs   (or in the container: podman run --rm -v "$PWD":/app -w /app node:20 node tools/sim-bench.mjs)
import {createSim,resetSim,stepSim,SIM_STEP} from '../src/sim.js';
const setup={bike:0,tires:'street',weather:'rain',assist:1,gearing:1,mode:'race',world:'akuma',launch:'street'};
const input={steer:0,throttle:true,brake:false,climb:0,boost:false};
console.log(`yoru sim benchmark · node ${process.version} · step ${(SIM_STEP*1000).toFixed(2)} ms`);
for(const brain of ['kinematic','physical']){
 const sim=createSim({setup,rivalBrain:brain});
 resetSim(sim,1);for(let i=0;i<12000;i++){stepSim(sim,SIM_STEP,input);if(sim.done)resetSim(sim,1+i%13)}
 let steps=0;const t0=performance.now();
 while(performance.now()-t0<3000){stepSim(sim,SIM_STEP,input);steps++;if(sim.done)resetSim(sim,2+steps%97)}
 const el=(performance.now()-t0)/1000,rate=steps/el;
 console.log(`${brain.padEnd(10)} ${Math.round(rate).toLocaleString('en-US')} steps/s · ${(rate*SIM_STEP).toFixed(1)}x realtime (${steps} steps in ${el.toFixed(2)} s)`);
}
