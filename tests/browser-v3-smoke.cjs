const {chromium}=require('playwright');
const {spawn}=require('child_process');const fs=require('fs');const assert=require('assert/strict');
const server=spawn(process.execPath,[require('path').join(__dirname,'../server.mjs')],{env:{...process.env,PORT:'8091'},stdio:'inherit'});
(async()=>{let browser;try{
 browser=await chromium.launch({...(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH}:{}),headless:true,args:['--no-sandbox','--enable-unsafe-swiftshader','--use-gl=angle','--use-angle=swiftshader']});
 const page=await browser.newPage({viewport:{width:1280,height:800}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('http://127.0.0.1:8091/?test');await page.waitForFunction(()=>!!window.__game);await page.evaluate(()=>window.__game.setup.quality='low');
 assert.equal(await page.evaluate(()=>window.__game.world.player.userData.asset),'kestrel.glb');
 await page.waitForTimeout(1000);await page.screenshot({path:require('path').join(require('os').tmpdir(),'v3-kestrel.png')});
 await page.click('#ride');await page.evaluate(()=>{const g=window.__game;g.advance(3.1);g.setup.brain='laya';g.setInput('w',true);g.advance(6);g.setInput('w',false)});
 await page.waitForFunction(()=>window.__game.decisions.status.includes('OFFLINE'),{timeout:15000});
 assert.equal(await page.evaluate(()=>window.__game.rivals.length),3);
 await page.evaluate(()=>{const g=window.__game;g.state.health=30;g.advance(3)});assert.equal(await page.evaluate(()=>window.__game.director.encounter),'recover');
 await page.screenshot({path:require('path').join(require('os').tmpdir(),'v3-rivals.png')});
 fs.writeFileSync(require('path').join(require('os').tmpdir(),'v3-frame-metrics.json'),JSON.stringify(await page.evaluate(()=>({environment:'Headless Chromium / SwiftShader software renderer; not hardware FPS evidence',...window.__game.performance})),null,2));
 assert.equal(errors.length,0,errors.join('\n'));console.log('V3 PASS hero GLB, 3 rivals, offline fallback, recovery, screenshots; no page errors');
 }finally{await browser?.close();server.kill()}})().catch(e=>{console.error(e);process.exitCode=1});
