// Before/after sky + headlight screenshots for G4/G6 (UPLIFT-PLAN). Not part of the test suite.
// Usage: TAG=before|after node previews/.work/sky-shots.cjs   (requires playwright, run in container)
const {chromium}=require('playwright');
const {spawn}=require('child_process');const path=require('path');
const TAG=process.env.TAG||'after';
const server=spawn(process.execPath,[path.join(__dirname,'../../server.mjs')],{env:{...process.env,PORT:'8092'},stdio:'inherit'});
(async()=>{let browser;try{
 browser=await chromium.launch({headless:true,args:['--no-sandbox','--enable-unsafe-swiftshader','--use-gl=angle','--use-angle=swiftshader']});
 const page=await browser.newPage({viewport:{width:1280,height:800}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('http://127.0.0.1:8092/?test');await page.waitForFunction(()=>!!window.__game);
 await page.evaluate(()=>{window.__game.setup.quality='high'});
 for(const w of ['akuma','solstice','pelagic','elysium']){
  await page.evaluate(id=>window.__game.selectWorld(id),w);
  await page.waitForTimeout(1500);
  await page.screenshot({path:path.join(__dirname,`..`, `sky-${TAG}-${w}.png`)});
 }
 // Headlight visibility check: night city race, lights on the road ahead.
 await page.evaluate(()=>window.__game.selectWorld('akuma'));
 await page.click('#ride');
 await page.evaluate(()=>{const g=window.__game;g.advance(2.6);g.setInput('w',true);g.advance(5);g.setInput('w',false)});
 await page.waitForTimeout(800);
 await page.screenshot({path:path.join(__dirname,'..',`headlight-${TAG}-akuma.png`)});
 console.log(`sky-shots ${TAG}: done, page errors: ${errors.length}`);if(errors.length){console.error(errors.join('\n'));process.exitCode=1}
 }finally{await browser?.close();server.kill()}})().catch(e=>{console.error(e);process.exitCode=1});
