import {createRequire} from 'node:module';
import {mkdir,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
const require=createRequire(import.meta.url);
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const base=process.env.UI_REVIEW_URL||'http://127.0.0.1:5175';
const out=process.env.UI_REVIEW_OUTPUT||'.cache/generation-continuity';await mkdir(out,{recursive:true});
const browser=await chromium.launch({headless:true,channel:'chrome'});
const errors=[],reports=[];
const dish={id:2,name:'番茄炒蛋',servings:2,ingredients:[{name:'番茄',quantity:300,unit:'g'}],steps:[{title:'炒香食材',description:'中火翻炒三分钟。'}]};
const recipe={id:1,title:'两个人的家常晚餐',servings:2,dishes:[dish]};
try{
 await Promise.all([[390,844],[834,1112],[1440,900]].map(async([width,height])=>{
  for(const theme of ['light','dark']){
   const page=await browser.newPage({viewport:{width,height}});page.setDefaultTimeout(12000);
   page.on('pageerror',e=>errors.push({width,theme,error:e.message}));
   let status='planning',target='menu',submitCount=0,fail=false,submitDelay=100;
   await page.route('**/api/v1/**',async route=>{
    const req=route.request(),path=new URL(req.url()).pathname.replace('/api/v1','');let json=[];
    if(path==='/me')json={user:{id:99,username:'厨房体验'}};
    else if(path==='/documents/preferences')json=[{id:1,theme}];
    else if(path==='/capabilities')json={llm:true,search:true};
    else if(path==='/tags')json={defaults:['清淡','家常菜']};
    else if(path==='/generate'){
     submitCount++;target=req.postDataJSON().target;
     await new Promise(r=>setTimeout(r,submitDelay));
     if(fail)return route.fulfill({status:500,json:{error:'暂时无法提交'}});
     json={id:8};
    }
    else if(path==='/jobs/8')json={id:8,status,result_kind:target==='dish'?'dishes':'recipes',recipe_id:target==='dish'?2:1,created_at:new Date().toISOString(),events:[]};
    else if(path==='/documents/recipes')json=[recipe];
    else if(path==='/documents/dishes')json=[dish];
    else if(path==='/documents/recipes/1')json=recipe;
    else if(path==='/documents/dishes/2')json=dish;
    else if(path.endsWith('/chat'))json={session_id:1,messages:[],busy:false};
    await route.fulfill({json});
   });
   async function home(single=false){
    await page.goto(base+(single?'/inspire-dish':'/'));await page.locator('.shell').waitFor();
    if(await page.locator('.welcome-enter').isVisible()){await page.locator('.welcome-enter').click();await page.locator('.welcome-page').waitFor({state:'detached'})}
    await page.waitForTimeout(700);
   }
   async function bounds(name){assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,`${width}/${name} overflow`)}
   await home();await page.getByRole('button',{name:'混合模式',exact:false}).click();
   await page.getByLabel('食材名称',{exact:true}).fill('番茄、鸡蛋');await page.getByRole('button',{name:'添加',exact:true}).click();
   await page.getByRole('button',{name:'更多偏好'}).click();await page.getByLabel('其他饮食偏好').fill('清淡一点，少洗几个碗');
   await page.getByRole('button',{name:'清淡',exact:true}).click();
   await page.locator('.generate-button').scrollIntoViewIfNeeded();await page.waitForTimeout(200);
   // Capture real frame samples instead of inferring animation from CSS names.
   await page.evaluate(()=>{
    window.continuityFrames=[];window.sampleUntil=performance.now()+6500;
    function sample(){
     const surface=document.querySelector('.generation-handoff-surface'),capsule=document.querySelector('.generation-assistant-float');
     const rect=surface?.getBoundingClientRect(),cap=capsule?.getBoundingClientRect(),seed=document.querySelector('.generation-handoff-seed')?.getBoundingClientRect();
     window.continuityFrames.push({at:performance.now(),entry:!!document.querySelector('.generation-handoff'),seed:seed?{x:seed.x,y:seed.y}:null,surface:rect?{x:rect.x,y:rect.y,w:rect.width,h:rect.height}:null,capsule:cap?{x:cap.x,y:cap.y,w:cap.width,h:cap.height}:null,morphing:!!capsule?.classList.contains('is-morphing'),snapshot:!!document.querySelector('.generation-assistant-snapshot'),overflow:document.documentElement.scrollWidth>innerWidth});
     if(performance.now()<window.sampleUntil)requestAnimationFrame(sample);
    }requestAnimationFrame(sample);
   });
   await page.locator('.generate-button').click();await page.locator('.generation-handoff-idea').first().waitFor();
   assert.ok(page.url().endsWith('/'),'gather happens on the input page');
   await page.waitForTimeout(200);await page.screenshot({path:`${out}/${theme}-${width}-gather.png`});
   // Extra clicks and scroll gestures cannot cancel or submit another task.
   await page.mouse.click(width/2,height-160);await page.mouse.wheel(0,450);
   await page.locator('.generation-handoff-surface').waitFor();await bounds('entry');
   assert.equal(await page.locator('.generation-handoff').evaluate(el=>el.getAnimations({subtree:true}).some(a=>a.effect?.getKeyframes().some(frame=>'filter' in frame))),false,'the handoff never animates expensive subtree blur');
   await page.waitForTimeout(300);await page.screenshot({path:`${out}/${theme}-${width}-entry.png`});
   await page.waitForURL('**/generating/8');
   await page.locator('.generation-handoff').waitFor({state:'detached'});
   assert.equal(submitCount,1);assert.equal(await page.locator('.generation-assistant-inline').count(),1);
   assert.equal(await page.locator('.shell').evaluate(el=>el.inert),false);
   await page.screenshot({path:`${out}/${theme}-${width}-working.png`});
   // Keep a focused, clicked progress control while the result completes.
   await page.locator('.generation-assistant-inline summary').click();status='completed';
   await page.locator('.generation-assistant-float.is-morphing').waitFor();
   await page.evaluate(()=>{window.visualViewport?.dispatchEvent(new Event('scroll'));window.visualViewport?.dispatchEvent(new Event('resize'))});
   await page.mouse.wheel(0,150);await page.mouse.click(30,130);
   await page.waitForTimeout(240);await page.screenshot({path:`${out}/${theme}-${width}-dock.png`});
   await page.locator('.generation-assistant-float:not(.is-morphing)').waitFor();
   await page.locator('[data-section="6"][data-state="completed"]').waitFor();await bounds('result');
   const capsule=await page.locator('.generation-assistant-float').boundingBox();
   assert.ok(capsule.x>=0&&capsule.y>=0&&capsule.x+capsule.width<=width+1);
   if(width<=700){const nav=await page.locator('aside').boundingBox();assert.ok(capsule.y+capsule.height<=nav.y,'capsule clears navigation')}
   await page.getByRole('button',{name:'展开 AI 菜谱助手'}).click();await page.locator('.generation-assistant-float:not(.is-morphing)').waitFor();
   await bounds('expanded');const expanded=await page.locator('.generation-assistant-float').boundingBox();assert.ok(expanded.y>=0&&expanded.y+expanded.height<=height);
   await page.keyboard.press('Escape');await page.locator('.generation-assistant-float:not(.is-morphing)').waitFor();
   const frames=await page.evaluate(()=>window.continuityFrames);
   const entry=frames.filter(f=>f.surface),flight=frames.filter(f=>f.morphing&&f.capsule);
   const gathering=frames.filter(frame=>frame.seed&&!frame.surface);
   assert.ok(gathering.length>3&&Math.abs(gathering.at(-1).seed.y-gathering[0].seed.y)>2,'the button lifts while ideas gather, with no stationary handoff');
   assert.ok(entry.length>8,'entry renders multiple frames');assert.ok(flight.length>8,'dock renders multiple frames');
   assert.ok(entry.some(f=>Math.abs(f.surface.y-entry.at(-1).surface.y)>30),'entry travels through space');
   assert.ok(flight.some(f=>Math.abs(f.capsule.y-capsule.y)>30),'dock travels through space');
   assert.ok(flight.some(f=>f.snapshot),'progress survives through takeoff');
   assert.ok(frames.every(f=>!f.overflow),'no overflow in animation frames');
   reports.push({width,height,theme,entryFrames:entry.length,dockFrames:flight.length,submitCount});
   // Fast completed jobs wait for entry to settle before docking.
   await home(true);await page.locator('.generate-button').click();await page.locator('.generation-handoff-surface').waitFor();
   assert.equal(await page.locator('.generation-assistant-float').count(),0,'fast jobs keep the entry surface');
   await page.locator('.generation-handoff').waitFor({state:'detached'});await page.locator('.generation-assistant-float:not(.is-morphing)').waitFor();
   // Reduced motion skips decorative stages but keeps all actions usable.
   await page.emulateMedia({reducedMotion:'reduce'});status='planning';await home();await page.locator('.generate-button').click();
   await page.waitForURL('**/generating/8');assert.equal(await page.locator('.generation-handoff').count(),0);
   status='completed';await page.locator('[data-section="6"][data-state="completed"]').waitFor();await page.locator('.generation-assistant-float:not(.is-morphing)').waitFor();
   // A rejected submission releases the temporary surface and restores navigation.
   await page.emulateMedia({reducedMotion:'no-preference'});fail=true;await home();await page.locator('.generate-button').click();
   await page.getByRole('alert').waitFor();await page.locator('.generation-handoff').waitFor({state:'detached'});assert.equal(await page.locator('.shell').evaluate(el=>el.inert),false);
   await page.close();console.log(`PASS continuity ${width} ${theme}`);
  }
 }));
 assert.deepEqual(errors,[]);await writeFile(`${out}/report.json`,JSON.stringify({reports,errors},null,2));
 console.log('PASS: phone/tablet/desktop × light/dark; full form→progress→capsule trajectory, duplicate clicks, scrolling, focused controls, fast completion, reduced motion, submission errors, live frame overflow and runtime checks.');
}finally{await browser.close()}
