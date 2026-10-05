// Per-feature before/after screenshots + frame-time sampling for 3.16.0 (G2/G3/G5/G7/tunnels).
// Not part of the test suite. Requires playwright; run in the container (see CHANGELOG 3.16.0).
// Frame times are rAF-to-rAF deltas of the game loop under SwiftShader — SOFTWARE RENDERING,
// indicative only, NOT hardware evidence (same caveat as VALIDATION.md).
const {chromium}=require('playwright');
const {spawn}=require('child_process');const path=require('path');const fs=require('fs');
const server=spawn(process.execPath,[path.join(__dirname,'../server.mjs')],{env:{...process.env,PORT:'8093'},stdio:'inherit'});
const FRAMES=24;
(async()=>{let browser;try{
 browser=await chromium.launch({headless:true,args:['--no-sandbox','--enable-unsafe-swiftshader','--use-gl=angle','--use-angle=swiftshader']});
 const page=await browser.newPage({viewport:{width:800,height:500}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('http://127.0.0.1:8093/?test');await page.waitForFunction(()=>!!window.__game);
 await page.evaluate(()=>{window.__game.setup.quality='high'});
 await page.click('#ride');
 await page.evaluate(()=>{const g=window.__game;g.advance(2.6);g.setInput('w',true);g.advance(6)});
 const metrics={environment:'Headless Chromium / SwiftShader software renderer; rAF-to-rAF deltas, NOT hardware FPS evidence',frames:FRAMES,scenarios:{}};
 const scenario=async(name,flags,tunnelS)=>{
  await page.evaluate(([f,ts])=>{const g=window.__game;Object.assign(g.setup,{gfxShadow:'off',gfxGtao:'off',gfxDetail:'off',gfxSsr:'off',gfxTunnels:'off'},f);g.world.applyGraphicsFlags(g.setup);if(ts!=null){g.setInput('w',false);g.state.s=ts;g.state.v=0}g.advance(.4)},[flags,tunnelS??null]);
  const times=await page.evaluate(n=>new Promise(res=>{const t=[];let last=performance.now();(function tick(){const now=performance.now();t.push(now-last);last=now;if(t.length<n)requestAnimationFrame(tick);else res(t)})(0)}),FRAMES);
  times.sort((a,b)=>a-b);const p50=times[Math.floor(times.length*.5)],p95=times[Math.floor(times.length*.95)];
  metrics.scenarios[name]={p50:+p50.toFixed(1),p95:+p95.toFixed(1)};
  await page.screenshot({path:path.join(__dirname,`gfx-${name}.png`)});
  console.log(`gfx-${name}: p50=${p50.toFixed(1)}ms p95=${p95.toFixed(1)}ms`);
 };
 await scenario('baseline',{});
 await scenario('shadow-on',{gfxShadow:'on'});
 await scenario('gtao-on',{gfxGtao:'on'});
 await scenario('detail-on',{gfxDetail:'on'});
 await scenario('ssr-on',{gfxSsr:'on'});
 await scenario('tunnels-off',{},760);
 await scenario('tunnels-on',{gfxTunnels:'on'},760);
 fs.writeFileSync(path.join(__dirname,'gfx-metrics.json'),JSON.stringify(metrics,null,2));
 console.log(`gfx-shots: done, page errors: ${errors.length}`);if(errors.length){console.error(errors.join('\n'));process.exitCode=1}
 }finally{await browser?.close();server.kill()}})().catch(e=>{console.error(e);process.exitCode=1});
