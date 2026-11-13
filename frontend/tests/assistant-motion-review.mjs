import {createRequire} from 'node:module';
import {mkdir} from 'node:fs/promises';
import assert from 'node:assert/strict';
const require=createRequire(import.meta.url);
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const base=process.env.UI_REVIEW_URL||'http://127.0.0.1:5175';
const out=process.env.UI_REVIEW_OUTPUT||'.cache/assistant-motion-review';
await mkdir(out,{recursive:true});
const browser=await chromium.launch({headless:true,channel:'chrome'});
const errors=[];
try{
 for(const width of [390,834,1440])for(const theme of ['light','dark']){
  const page=await browser.newPage({viewport:{width,height:900}});
  page.on('pageerror',error=>errors.push(error.message));
  let status='planning',kind='recipes',resultDelay=0;
  const dish={id:2,name:'番茄炒蛋',ingredients:[{name:'番茄',quantity:300,unit:'g'}],steps:[{title:'翻炒',description:'翻炒三分钟。'}]};
  const recipe={id:1,title:'家常晚餐',servings:2,dishes:[dish]};
  await page.route('**/api/v1/**',async route=>{
   const path=new URL(route.request().url()).pathname.replace('/api/v1','');let json=[];
   if(path==='/me')json={user:{id:99,username:'厨房体验'}};
   if(path==='/documents/preferences')json=[{id:1,theme}];
   if(path==='/capabilities')json={llm:true};
   if(path==='/tags')json={defaults:[]};
   if(path==='/jobs/8')json={id:8,status,result_kind:kind,recipe_id:kind==='recipes'?1:2,created_at:new Date().toISOString(),events:[]};
   if(path==='/documents/recipes')json=[recipe];
   if(path==='/documents/dishes')json=[dish];
   if(path==='/documents/recipes/1')json=recipe;
   if(path==='/documents/dishes/2'){if(resultDelay)await new Promise(resolve=>setTimeout(resolve,resultDelay));json=dish}
   await route.fulfill({json});
  });
  async function visit(){
   await page.goto(base+'/generating/8');await page.locator('.shell').waitFor();
   if(await page.locator('.welcome-enter').isVisible())await page.locator('.welcome-enter').click();
   await page.locator('.generation-assistant-inline').waitFor();
   await page.waitForTimeout(650);
  }
  async function bounds(){
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>document.documentElement.clientWidth),false);
  }
  await visit();
  await page.evaluate(()=>{
   window.motionSamples=[];
   const start=performance.now();
   window.motionObserver=new MutationObserver(()=>{
    const panel=document.querySelector('.generation-assistant-float');
    if(panel?.classList.contains('is-from-inline')&&!window.flightAnimations){
     window.flightAnimations=[...panel.getAnimations({subtree:true}),...document.querySelector('.generation-results').getAnimations()];
     window.flightAnimations.forEach(a=>{a.pause();a.currentTime=0});
    }
    if(document.querySelector('.has-result'))window.motionSamples.push({time:performance.now()-start,docked:!!panel,revealed:document.querySelectorAll('[data-state="completed"]').length});
   });window.motionObserver.observe(document.body,{childList:true,subtree:true,attributes:true});
  });
  status='completed';
  await page.locator('.generation-assistant-float.is-morphing').waitFor();
  assert.equal(await page.locator('[data-section="6"][data-state="completed"]').count(),0,'flight must overlap reveal');
  assert.ok(await page.locator('.generation-assistant-snapshot').count());
  assert.equal(await page.locator('.generation-assistant-slot').evaluate(el=>el.getAnimations().length),0,'slot must not animate layout');
  for(const time of [0,180,400]){
   await page.evaluate(time=>window.flightAnimations.forEach(a=>a.currentTime=time),time);await bounds();
   await page.screenshot({path:`${out}/${theme}-${width}-flight-${time}.png`});
  }
  await page.evaluate(()=>window.flightAnimations.forEach(a=>a.play()));
  await page.locator('.generation-assistant-float:not(.is-morphing)').waitFor();
  assert.equal(await page.locator('.generation-assistant-snapshot').count(),0);
  const samples=await page.evaluate(()=>{window.motionObserver.disconnect();return window.motionSamples});
  assert.ok(samples.some(s=>s.docked&&s.revealed<7));
  const first=samples[0],flight=samples.find(s=>s.docked);
  assert.ok(flight.time-first.time<100,'dock must start in the completion commit');
  await page.getByRole('button',{name:'展开 AI 菜谱助手'}).click();
  await page.locator('.generation-assistant-float:not(.is-morphing)').waitFor();await bounds();
  await page.screenshot({path:`${out}/${theme}-${width}-expanded.png`});
  const rect=await page.locator('.generation-assistant-float').boundingBox();
  assert.ok(rect.x>=0&&rect.x+rect.width<=width+1&&rect.y>=0);
  if(width===390)assert.ok(rect.y+rect.height<=812,'keep mobile navigation clear');
  await page.getByRole('button',{name:'制作记录',exact:true}).click();
  assert.ok(await page.locator('.generation-assistant-scroll .chef-progress').isVisible());
  await page.keyboard.press('Escape');await page.locator('.generation-assistant-float:not(.is-morphing)').waitFor();
  await page.locator('[data-section="6"][data-state="completed"]').waitFor();
  // Completion must dock even when a clicked progress summary retains focus,
  // and must not wait for the result-document request.
  status='planning';kind='dishes';await visit();
  await page.locator('.generation-assistant-inline summary').focus();resultDelay=1200;status='completed';
  await page.locator('.generation-assistant-float.is-morphing').waitFor();
  assert.equal(await page.locator('.has-result').count(),0,'dock before slow recipe fetch');
  assert.equal(await page.locator('.generation-assistant-capsule').evaluate(el=>el===document.activeElement),true,'carry focus to capsule');
  await page.evaluate(()=>{
   const panel=document.querySelector('.generation-assistant-float');
   panel.getAnimations().forEach(animation=>{animation.pause();animation.currentTime=120});
   window.visualViewport?.dispatchEvent(new Event('scroll'));
   window.visualViewport?.dispatchEvent(new Event('resize'));
  });
  assert.ok(await page.locator('.generation-assistant-float.is-morphing').count(),'scroll clamp and unchanged viewport must not cancel flight');
  // Interrupting the flight settles cleanly and releases the snapshot.
  await page.emulateMedia({reducedMotion:'reduce'});
  await page.locator('.generation-assistant-float:not(.is-morphing)').waitFor();
  assert.equal(await page.locator('.generation-assistant-snapshot').count(),0);
  await page.reload();await page.locator('.generation-assistant-float').waitFor();
  assert.equal(await page.locator('.generation-assistant-float').evaluate(el=>el.getAnimations().length),0);
  await page.locator('[data-section="6"][data-state="completed"]').waitFor();
  await bounds();await page.close();
 }
 assert.deepEqual(errors,[]);
 console.log('PASS: mobile/tablet/desktop × light/dark; immediate docking before slow result fetch, focus handoff, viewport-scroll continuity, compositor motion, snapshot cleanup, record controls, reduced motion, no overflow or runtime errors.');
}finally{await browser.close()}
