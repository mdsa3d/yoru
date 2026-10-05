// Smoke for the ?bench=1 harness (3.19.0). NOT a benchmark: runs under SwiftShader software
// rendering in the container, so it only proves the harness executes end to end (all 7 configs
// measure, JSON is exposed, no page errors). Requires playwright; run in the container.
const {chromium}=require('playwright');
const {spawn}=require('child_process');const path=require('path');const fs=require('fs');const assert=require('assert/strict');
const server=spawn(process.execPath,[path.join(__dirname,'../server.mjs')],{env:{...process.env,PORT:'8095'},stdio:'inherit'});
(async()=>{let browser;try{
 browser=await chromium.launch({headless:true,args:['--no-sandbox','--enable-unsafe-swiftshader','--use-gl=angle','--use-angle=swiftshader']});
 const page=await browser.newPage({viewport:{width:800,height:500}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('http://127.0.0.1:8095/?bench=1&benchMs=400&benchWarmup=300');await page.waitForFunction(()=>!!window.__game,undefined,{timeout:120000});
 await page.waitForFunction(()=>window.__benchDone||window.__benchError,undefined,{timeout:300000});
 const err=await page.evaluate(()=>window.__benchError||null);assert.equal(err,null,'bench error: '+err);
 const bench=await page.evaluate(()=>window.__bench);
 const names=Object.keys(bench.configs);
 assert.deepEqual(names,['baseline','fxaa','gtao','ssr','shadows','tunnels','dither']);
 for(const n of names){const c=bench.configs[n];assert.ok(c.frames>0&&c.p50>0&&c.p95>=c.p50&&c.p99>=c.p95,n+' produced no usable samples')}
 assert.ok(bench.renderer&&bench.dpr>0&&bench.resolution[0]===800);
 fs.writeFileSync(path.join(__dirname,'bench-swiftshader.json'),JSON.stringify(bench,null,2));
 assert.equal(errors.length,0,errors.join('\n'));
 console.log('BENCH SMOKE PASS ('+names.length+' configs, SwiftShader software rendering — numbers NOT hardware evidence)');
 }finally{await browser?.close();server.kill()}})().catch(e=>{console.error(e);process.exitCode=1});
