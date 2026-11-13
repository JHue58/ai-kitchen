import {createRequire} from 'node:module';
import assert from 'node:assert/strict';
const require=createRequire(import.meta.url);
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const base=process.env.UI_REVIEW_URL||'http://127.0.0.1:5175';
const browser=await chromium.launch({channel:'chrome',headless:true});
const errors=[],visits=new Map(),cleared=[];
const dish={id:2,name:'煎豆腐',servings:2,ingredients:[{name:'豆腐',category:'main',quantity:200,unit:'g'}],steps:[{title:'煎熟',description:'小火煎熟。'}]};
let releaseTask;
let recipe={id:1,title:'豆腐晚餐',servings:2,dishes:[dish]};
try{
 const context=await browser.newContext({viewport:{width:390,height:844},reducedMotion:'reduce'});
 await context.route('**/api/v1/**',async route=>{
  const request=route.request(),url=new URL(request.url()),path=url.pathname.replace('/api/v1','');let json=[];
  if(path==='/me')json={user:{id:1,username:'厨房体验'},csrf:'csrf-test'};
  if(path==='/documents/preferences')json=[{id:1,theme:'light'}];
  if(path==='/tags')json={defaults:[]};
  if(path==='/documents/recipes')json=[recipe];
  if(path==='/documents/dishes')json=[dish];
  if(path==='/documents/recipes/1')json=recipe;
  if(path==='/documents/dishes/2')json=dish;
  if(path.endsWith('/chat')){
   const visit=url.searchParams.get('visit_id');assert.ok(visit,'all chat requests must be page-scoped');
   const state=visits.get(visit)||{session_id:visits.size+1,messages:[],busy:false,closed:false};visits.set(visit,state);
   if(request.method()==='DELETE'){
    assert.equal(request.headers()['x-csrf-token'],'csrf-test');
    state.messages=[];state.closed=true;cleared.push(visit);json={ok:true};
   }else if(state.closed){await route.fulfill({status:410,json:{error:'本页对话已结束'}});return}
   else{
    if(request.method()==='POST'){
     const input=request.postDataJSON();
     if(input.message.startsWith('等待恢复')){
      state.busy=true;
      await new Promise(resolve=>{releaseTask=()=>{state.busy=false;resolve()}});
     }
     state.messages.push({id:input.request_id+'-u',request_id:input.request_id,role:'user',content:input.message},{id:input.request_id+'-a',request_id:input.request_id,role:'assistant',content:'小火煎到两面金黄即可。'});
    }
    json={...state,document:recipe,changed_sections:[]};
   }
  }
  await route.fulfill({json});
 });
 const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
 await page.goto(base+'/recipes/1');await page.locator('.welcome-enter').waitFor();await page.locator('.welcome-enter').click();
 const open=p=>p.getByRole('button',{name:'展开 AI 菜谱助手'});
 const input=p=>p.getByRole('textbox',{name:'对当前菜谱提问'});
 await open(page).click();await input(page).waitFor();
 assert.equal(await page.locator('.recipe-chat-suggestions button').count(),0,'legacy recipes do not get unrelated fixed suggestions');
 await input(page).fill('豆腐要煎多久？');await page.getByRole('button',{name:'发送消息'}).click();
 await page.getByText('小火煎到两面金黄即可。',{exact:true}).waitFor();
 const firstVisit=[...visits.keys()][0];
 await page.getByRole('button',{name:'收起 AI 菜谱助手'}).click();await open(page).click();
 assert.equal(visits.get(firstVisit).messages.length,2,'collapsing keeps current-page conversation');
 // Separate tabs open fresh conversations without clearing one another.
 const other=await context.newPage();other.on('pageerror',e=>errors.push(e.message));
 await other.goto(base+'/recipes/1');await other.locator('.welcome-enter').waitFor();await other.locator('.welcome-enter').click();await open(other).click();await input(other).waitFor();
 assert.equal(await other.locator('.recipe-chat-message').count(),0,'another page does not inherit history');
 assert.equal(visits.get(firstVisit).messages.length,2,'another tab does not reset this visit');
 await other.close();
 await page.keyboard.press('Escape');await page.locator('.back-link').click();
 await page.locator('.recipe-card[href="/recipes/1"]').waitFor();
 await page.waitForFunction(()=>!document.querySelector('.generation-assistant-float'));
 await new Promise(resolve=>setTimeout(resolve,80));
 assert.ok(cleared.includes(firstVisit),'leaving issues DELETE');assert.deepEqual(visits.get(firstVisit).messages,[]);
 await page.locator('.recipe-card[href="/recipes/1"]').click();await open(page).click();await input(page).waitFor();
 assert.equal(await page.locator('.recipe-chat-message').count(),0,'returning starts empty');
 assert.equal(await input(page).inputValue(),'');
 const beforeRefresh=[...visits.keys()].at(-1);
 await page.reload();await page.locator('.welcome-enter').waitFor();await page.locator('.welcome-enter').click();await open(page).click();await input(page).waitFor();
 assert.notEqual([...visits.keys()].at(-1),beforeRefresh,'refresh starts a distinct visit');
 for(let attempt=0;attempt<10&&!cleared.includes(beforeRefresh);attempt++)await new Promise(resolve=>setTimeout(resolve,40));
 assert.ok(cleared.includes(beforeRefresh),'pagehide clears server history: '+JSON.stringify({beforeRefresh,cleared,visits:[...visits.keys()]}));

 // Both a route exit and a refresh must retain the visit while the server works.
 for(const mode of ['route','refresh']){
  await input(page).fill('等待恢复 '+mode);await page.getByRole('button',{name:'发送消息'}).click();
  await page.waitForFunction(()=>Object.keys(sessionStorage).some(key=>key.startsWith('recipe-chat-task:')));
  while(!releaseTask)await new Promise(resolve=>setTimeout(resolve,10));
  const taskVisit=[...visits.keys()].at(-1),finish=releaseTask,expectedMessages=visits.get([...visits.keys()].at(-1)).messages.length+2;releaseTask=null;
  if(mode==='route'){
   await page.keyboard.press('Escape');await page.locator('.back-link').click();
   await page.locator('.recipe-card[href="/recipes/1"]').click();
  }else{
   await page.reload();await page.locator('.welcome-enter').waitFor();await page.locator('.welcome-enter').click();
  }
  await open(page).click();await input(page).waitFor();
  await page.locator('.recipe-chat-pending').waitFor();
  assert.equal(cleared.includes(taskVisit),false,'unfinished visit must not be deleted');
  assert.equal([...visits.keys()].at(-1),taskVisit,'recover the same visit');
  finish();await page.locator('.recipe-chat-pending').waitFor({state:'hidden'});
  assert.equal(await page.locator('.recipe-chat-message').count(),expectedMessages,'recover question and answer');
  assert.equal(await input(page).inputValue(),'','successful recovery does not resend');
 }
 assert.deepEqual(errors,[]);
 console.log('PASS: page-scoped UUIDs, StrictMode-safe lifecycle, collapse preserves messages, independent tabs, SPA leave DELETE+erase, return empty, refresh/pagehide idle cleanup, active task survives route exit and refresh, authenticated cleanup, no runtime errors.');
 await context.close();
}finally{await browser.close()}
