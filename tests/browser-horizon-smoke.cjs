const {chromium}=require('playwright');const {spawn}=require('child_process');const assert=require('assert/strict');
const path=require('path'),fs=require('fs');const previewDir=process.env.YORU_PREVIEW_DIR||require('os').tmpdir();fs.mkdirSync(previewDir,{recursive:true});
const server=spawn(process.execPath,[path.join(__dirname,'../server.mjs')],{env:{...process.env,PORT:'8092'},stdio:'inherit'});
(async()=>{let browser;try{
 browser=await chromium.launch({headless:true,args:['--no-sandbox','--enable-unsafe-swiftshader','--use-gl=angle','--use-angle=swiftshader']});
 const page=await browser.newPage({viewport:{width:1440,height:900}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('http://127.0.0.1:8092/?test');await page.waitForFunction(()=>!!window.__game);
 await page.screenshot({path:path.join(previewDir,'horizon-menu.png')});
 await page.click('#garageButton');assert.equal(await page.locator('.tuning-heading').count(),3);
 await page.locator('#fxVolume').focus();await page.keyboard.press('Tab');assert.equal(await page.evaluate(()=>document.activeElement.id),'closeGarage');
 await page.keyboard.press('Shift+Tab');assert.equal(await page.evaluate(()=>document.activeElement.id),'fxVolume');
 await page.keyboard.press('Escape');assert.equal(await page.locator('#garage').isVisible(),false);
 await page.click('#worldButton');await page.screenshot({path:path.join(previewDir,'horizon-worlds.png')});await page.keyboard.press('Escape');
 await page.setViewportSize({width:390,height:844});await page.screenshot({path:path.join(previewDir,'horizon-mobile.png')});
 for(const [width,height] of [[390,844],[360,640],[360,560],[844,390],[1280,720]]){
  await page.setViewportSize({width,height});
  await page.screenshot({path:path.join(previewDir,`horizon-layout-${width}x${height}.png`)});
  const boxes=await page.locator('#ride,#worldButton,#garageButton').evaluateAll(els=>els.map(el=>{const r=el.getBoundingClientRect();return {x:r.x,y:r.y,right:r.right,bottom:r.bottom}}));
  for(const r of boxes)assert.ok(r.x>=0&&r.y>=0&&r.right<=width&&r.bottom<=height,JSON.stringify({width,height,r}));
  if(width<=650&&await page.locator('#bikeCaption').isVisible()){
   const caption=await page.locator('#bikeCaption').boundingBox();assert.ok(caption.y>=Math.max(...boxes.map(r=>r.bottom)),JSON.stringify({caption,boxes}));
  }
 }
 await page.setViewportSize({width:390,height:844});await page.emulateMedia({reducedMotion:'reduce'});
 assert.equal(await page.locator('#ride').evaluate(el=>getComputedStyle(el).transitionDuration),'0s');
 await page.click('#ride');await page.evaluate(()=>window.__game.advance(3.1));await page.screenshot({path:path.join(previewDir,'horizon-hud-mobile.png')});
 assert.deepEqual(errors,[]);console.log('PASS: dialog keyboard navigation, worlds, responsive actions, reduced motion, mobile HUD');
}finally{await browser?.close();server.kill()}})().catch(e=>{console.error(e);process.exitCode=1});
