import {createRequire} from 'node:module';
import assert from 'node:assert/strict';
const require=createRequire(import.meta.url);
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const base=process.env.UI_REVIEW_URL||'http://127.0.0.1:5175';
const browser=await chromium.launch({headless:true,channel:'chrome'});
const errors=[];
try{
 for(const [width,height] of [[390,600],[834,900],[1440,900]]){
  const page=await browser.newPage({viewport:{width,height}});
  page.on('pageerror',e=>errors.push(e.message));
  let status='planning',release;
  const dish={name:'清炒时蔬',ingredients:[{name:'西兰花',quantity:200,unit:'g'}],steps:[{title:'快炒',description:'大火快炒。'}]};
  const recipe={id:1,title:'家常晚餐',servings:2,dishes:[dish]};
  await page.route('**/api/v1/**',async route=>{
   const path=new URL(route.request().url()).pathname.replace('/api/v1','');let json=[];
   if(path==='/me')json={user:{id:99,username:'厨房体验'}};
   if(path==='/documents/preferences')json=[{id:1,theme:'light'}];
   if(path==='/tags')json={defaults:[]};
   if(path==='/jobs/8')json={id:8,status,result_kind:'recipes',recipe_id:1,events:[]};
   if(path==='/documents/recipes/1'){await new Promise(resolve=>{release=resolve});json=recipe}
   if(path==='/documents/recipes')json=[recipe];
   if(path.endsWith('/chat'))json={session_id:1,messages:[],busy:false};
   await route.fulfill({json});
  });
  await page.goto(base+'/generating/8');await page.locator('.generation-assistant-inline').waitFor();
  status='completed';await page.locator('.generation-assistant-float:not(.is-morphing)').waitFor();
  assert.equal(await page.locator('.has-result').count(),0);
  await page.getByRole('button',{name:'展开 AI 制作记录'}).click();
  await page.locator('.generation-assistant-float.is-morphing[data-mode="expanded"]').waitFor();
  await page.evaluate(()=>document.querySelector('.generation-assistant-float').getAnimations({subtree:true}).forEach(animation=>{animation.pause();animation.currentTime=300}));
  const before=await page.locator('.generation-assistant-float').boundingBox();
  release();await page.locator('.has-result').waitFor();
  await page.getByRole('textbox',{name:'对当前菜谱提问'}).waitFor();
  const after=await page.locator('.generation-assistant-float').boundingBox();
  assert.ok(Math.abs(after.height-before.height)<1&&Math.abs(after.y-before.y)<1,'late result must preserve in-flight panel geometry');
  await page.evaluate(()=>document.querySelector('.generation-assistant-float').getAnimations({subtree:true}).forEach(animation=>animation.play()));
  await page.locator('.generation-assistant-float:not(.is-morphing)').waitFor();
  const box=await page.locator('.generation-assistant-float').boundingBox();
  assert.ok(box.y>=0&&box.y+box.height<=height-(width<=700?80:0),'late-result panel fits viewport');
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  // A progress surface outside the viewport should introduce the capsule locally.
  status='planning';await page.goto(base+'/generating/8');await page.locator('.generation-assistant-inline').waitFor();
  await page.evaluate(()=>scrollTo({top:document.documentElement.scrollHeight,behavior:'instant'}));
  const source=await page.locator('.generation-assistant-inline').boundingBox();assert.ok(source.y+source.height<=0);
  status='completed';await page.locator('.generation-assistant-float.is-morphing').waitFor();
  await page.evaluate(()=>document.querySelector('.generation-assistant-float').getAnimations().forEach(animation=>{animation.pause();animation.currentTime=1}));
  assert.equal(await page.locator('.generation-assistant-snapshot').count(),0);
  const arrival=await page.locator('.generation-assistant-float').boundingBox();
  assert.ok(arrival.y>=0&&arrival.y+arrival.height<=height&&arrival.x>=0,'offscreen source animates locally');
  await page.emulateMedia({reducedMotion:'reduce'});await page.locator('.generation-assistant-float:not(.is-morphing)').waitFor();
  release();await page.close();
 }
 assert.deepEqual(errors,[]);
 console.log('PASS: mobile/tablet/desktop late-result arrival preserves expansion geometry; offscreen progress uses local capsule arrival; navigation clearance; reduced motion; no overflow/runtime errors.');
}finally{await browser.close()}
