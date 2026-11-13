import {createRequire} from 'node:module';
import {mkdir} from 'node:fs/promises';
import assert from 'node:assert/strict';

const require=createRequire(import.meta.url);
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const base=process.env.UI_REVIEW_URL||'http://127.0.0.1:5175';
const output=process.env.UI_REVIEW_OUTPUT||'.cache/chat-edge-review';
await mkdir(output,{recursive:true});
const browser=await chromium.launch({channel:'chrome',headless:true});
const errors=[];

async function fixture({scenario='normal',width=390,height=844}={}){
 const page=await browser.newPage({viewport:{width,height}});
 page.on('pageerror',error=>errors.push(error.message));
 let recipe={id:1,title:'家常晚餐',servings:2,dishes:[{name:'番茄炒蛋',ingredients:[],steps:[]}]};
 let messages=[];
 const requests=[],calls={chatReads:0};
 await page.route('**/api/v1/**',async route=>{
  const request=route.request(),path=new URL(request.url()).pathname.replace('/api/v1','');let json=[];
  if(path==='/me')json={user:{id:99,username:'厨房体验'}};
  if(path==='/documents/preferences')json=[{id:1,theme:'light'}];
  if(path==='/documents/recipes')json=[recipe];
  if(path==='/documents/recipes/1')json=recipe;
  if(path==='/jobs/8')json={id:8,status:'completed',result_kind:'recipes',recipe_id:1,events:[]};
  if(path.endsWith('/chat')){
   if(request.method()==='GET')calls.chatReads++;
   if(scenario==='remote'&&request.method()==='GET'){
    const busy=calls.chatReads===1;
    if(!busy){recipe={...recipe,title:'少盐家常晚餐'};messages=[{id:'remote-user',role:'user',content:'少一点盐',request_id:'other-tab'},{id:'remote-assistant',role:'assistant',content:'已经为你减少盐用量。',request_id:'other-tab',changed_sections:['overview']}]}
    await route.fulfill({json:{session_id:1,messages,busy,document:recipe,changed_sections:busy?[]:['overview']}});return;
   }
   if(request.method()==='POST'){
    const input=request.postDataJSON();requests.push(input);
    if(scenario==='retry'&&requests.length===1){await route.fulfill({status:500,json:{error:'暂时无法连接'}});return}
    recipe={...recipe,title:'少盐家常晚餐'};
    messages=[{id:'u1',role:'user',content:input.message,request_id:input.request_id},{id:'a1',role:'assistant',content:'已经为你减少盐用量。',request_id:input.request_id,changed_sections:['overview']}];
    if(scenario==='lost'){await route.abort();return}
   }
   json={session_id:1,messages,busy:false,document:recipe,changed_sections:['overview']};
  }
  await route.fulfill({json});
 });
 await page.goto(base+'/generating/8');
 const open=page.getByRole('button',{name:'展开 AI 菜谱助手'});
 await open.waitFor();
 await page.locator('.generation-assistant-float:not(.is-morphing)').waitFor();
 return {page,requests,calls,open,input:page.getByRole('textbox',{name:'对当前菜谱提问'}),send:page.getByRole('button',{name:'发送消息'})};
}
async function settled(page){await page.locator('.generation-assistant-float:not(.is-morphing)').waitFor()}
async function assertBounds(page,height){
 const panel=await page.locator('.generation-assistant-float').boundingBox(),send=await page.locator('.recipe-chat-send').boundingBox();
 assert.ok(panel.y>=0&&panel.y+panel.height<=height+1,JSON.stringify({height,panel}));
 assert.ok(send.y>=panel.y&&send.y+send.height<=panel.y+panel.height,JSON.stringify({panel,send}));
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>document.documentElement.clientWidth),false);
}
try{
 {
  const {page,requests,calls,open}=await fixture({scenario:'remote'});
  await open.click();await settled(page);await page.locator('.recipe-chat-pending').waitFor();
  assert.equal(await page.locator('#overview h1').textContent(),'家常晚餐');
  await page.waitForFunction(()=>document.querySelector('#overview h1')?.textContent==='少盐家常晚餐');
  assert.ok(calls.chatReads>=2,'busy conversation should poll until the external turn completes');
  assert.equal(requests.length,0,'an external turn must synchronize through GET without submitting a new turn');
  assert.equal(await page.locator('.recipe-chat-message[data-role="assistant"]').count(),1);
  assert.equal(await page.locator('.recipe-chat-pending').count(),0);
  await page.close();
 }
 for(const scenario of ['lost','retry']){
  const {page,requests,open,input,send}=await fixture({scenario});
  await open.click();await settled(page);await input.fill('少一点盐');await send.click();
  if(scenario==='retry'){
   await page.locator('.recipe-chat-error').waitFor();
   assert.equal(await input.inputValue(),'少一点盐');
   await send.click();
  }
  await page.waitForFunction(()=>document.querySelector('#overview h1')?.textContent==='少盐家常晚餐');
  assert.equal(await input.inputValue(),'');assert.equal(await page.locator('.recipe-chat-error').count(),0);
  assert.equal(await page.locator('.recipe-chat-message[data-role="assistant"]').count(),1);
  assert.ok(requests[0].request_id);
  if(scenario==='retry'){assert.equal(requests.length,2);assert.equal(requests[0].request_id,requests[1].request_id)}
  else assert.equal(requests.length,1);
  await page.close();
 }
 {
  const {page,requests,open,input,send}=await fixture();
  await open.click();await settled(page);await input.fill('少一点盐');await send.waitFor({state:'visible'});
  await input.evaluate(element=>element.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',keyCode:229,isComposing:true,bubbles:true,cancelable:true})));
  assert.equal(requests.length,0,'IME confirmation must not submit');
  await input.press('Shift+Enter');assert.ok((await input.inputValue()).includes('\n'));assert.equal(requests.length,0);
  await input.press('Enter');await page.waitForFunction(()=>document.querySelectorAll('.recipe-chat-message[data-role="assistant"]').length===1);
  assert.equal(requests.length,1);await page.close();
 }
 for(const [width,height] of [[390,400],[834,450],[1440,450]]){
  const {page,open}=await fixture({width,height});await open.click();await settled(page);await assertBounds(page,height);
  if(width===390){const panel=await page.locator('.generation-assistant-float').boundingBox();assert.ok(panel.y+panel.height<=height-80,'keep mobile navigation clear')}
  await page.screenshot({path:`${output}/short-${width}-${height}.png`});await page.close();
 }
 {
  const {page,open,input}=await fixture();await open.click();await settled(page);
  await page.evaluate(()=>{Object.defineProperty(window.visualViewport,'height',{configurable:true,get:()=>260});window.visualViewport.dispatchEvent(new Event('resize'))});
  await input.fill(Array(10).fill('我想把调味减轻一点').join('\n'));
  await assertBounds(page,260);assert.ok((await input.boundingBox()).height<=64);
  await page.screenshot({path:`${output}/keyboard-260.png`});await page.close();
 }
 {
  const {page,open,input}=await fixture();await open.click();await page.locator('.generation-assistant-float.is-morphing').waitFor();
  await page.emulateMedia({reducedMotion:'reduce'});await settled(page);
  assert.equal(await page.locator('.generation-assistant-float').evaluate(element=>element.getAnimations({subtree:true}).length),0);
  assert.equal(await page.locator('.generation-assistant-snapshot').count(),0);
  await input.fill('少一点盐');
  await page.keyboard.press('Escape');await settled(page);await open.click();await settled(page);
  assert.equal(await input.inputValue(),'少一点盐');
  assert.equal(await page.locator('.generation-assistant-float').evaluate(element=>element.getAnimations({subtree:true}).length),0);
  await page.close();
 }
 assert.deepEqual(errors,[]);
 console.log('PASS: external busy-turn GET synchronization, lost response recovery, idempotent retry, IME/Shift+Enter, mobile/tablet/desktop short viewports, 260px visual keyboard with multiline input, midflight reduced motion, draft retention, no overflow/runtime errors.');
}finally{await browser.close()}
