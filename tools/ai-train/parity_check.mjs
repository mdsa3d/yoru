// Parity smoke: load an exported weights JSON with src/mlp.js and compare against
// Python-computed outputs (tests/fixtures/*.json). Exits non-zero past 1e-5.
// Run in the node container, e.g.:
//   podman run --rm -v "$PWD":/app -w /app node:20 node tools/ai-train/parity_check.mjs
import {readFileSync} from 'node:fs';
import {loadMLP} from '../../src/mlp.js';
const TOL=1e-5;
let worst=0,cases=0;
for(const fixture of ['tests/fixtures/mlp-reference.json','tests/fixtures/mlp-asset-vectors.json']){
 let spec,vectors;
 try{
  const f=JSON.parse(readFileSync(fixture,'utf8'));
  spec=f.weights||JSON.parse(readFileSync(f.weightsPath,'utf8'));vectors=f.vectors;
 }catch(e){console.log(`SKIP ${fixture}: ${e.message}`);continue}
 const net=loadMLP(spec);
 for(const [i,v] of vectors.entries()){
  const out=net.forward(Float32Array.from(v.in));
  for(let j=0;j<out.length;j++){
   const d=Math.abs(out[j]-v.out[j]);worst=Math.max(worst,d);cases++;
   if(d>TOL){console.error(`FAIL ${fixture} vector ${i} output ${j}: |${out[j]}-${v.out[j]}|=${d}`);process.exit(1)}
  }
 }
 console.log(`OK ${fixture}: ${vectors.length} vectors within ${TOL}`);
}
console.log(cases?`PARITY PASS (${cases} outputs, worst |diff| ${worst.toExponential(2)})`:'NO FIXTURES FOUND');
process.exit(cases?0:1);
