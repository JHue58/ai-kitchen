import {createRequire} from 'node:module';
import {mkdir} from 'node:fs/promises';
import assert from 'node:assert/strict';
const require=createRequire(import.meta.url);
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const base=process.env.UI_REVIEW_URL||'http://127.0.0.1:5175';
const out=process.env.UI_REVIEW_OUTPUT||'.cache/recipe-chat-review';
await mkdir(out,{recursive:true});
const browser=await chromium.launch({headless:true,channel:'chrome'});
const errors=[];
const initialDish={id:2,name:'番茄炒蛋',description:'熟悉的家常味。',servings:2,prep_minutes:5,cook_minutes:8,cost:8,ingredients:[{name:'番茄',quantity:300,unit:'g',category:'main'},{name:'盐',quantity:2,unit:'g',category:'seasoning'}],steps:[{title:'翻炒',description:'大火翻炒三分钟。',duration_minutes:3,start_minute:0}],nutrition:{calories:300},ai_commentary:'鲜香柔嫩。'};
try{
 for(const [width,height] of (process.env.UI_REVIEW_SAVED_ONLY?[]:[[390,844],[834,1112],[1440,900]]))for(const theme of ['light','dark']){
  const page=await browser.newPage({viewport:{width,height}});page.setDefaultTimeout(12000);
  page.on('pageerror',error=>errors.push({width,theme,error:error.message}));
  let status='planning',failNext=false,posts=0,release;
  let recipe={id:1,title:'两个人的家常饭',summary:'今晚，好好吃饭。',servings:2,total_cost:18,total_elapsed_minutes:20,dishes:[structuredClone(initialDish),{...structuredClone(initialDish),name:'清炒时蔬'}],nutrition:{calories:600}};
  const firstDish=structuredClone(recipe.dishes[0]);
  let chat={session_id:1,messages:[],busy:false};
  await page.route('**/api/v1/**',async route=>{
   const request=route.request(),path=new URL(request.url()).pathname.replace('/api/v1','');let json=[];
   if(path==='/me')json={user:{id:99,username:'厨房体验'},csrf:'csrf'};
   if(path==='/documents/preferences')json=[{id:1,theme}];
   if(path==='/capabilities')json={llm:true};
   if(path==='/tags')json={defaults:[]};
   if(path==='/jobs/8')json={id:8,status,result_kind:'recipes',recipe_id:1,created_at:new Date().toISOString(),events:[{status:'planning',message:'只属于生成阶段的说明',at:new Date().toISOString()}]};
   if(path==='/documents/recipes')json=[recipe];
   if(path==='/documents/dishes')json=[initialDish];
   if(path==='/documents/recipes/1')json=recipe;
   if(path==='/documents/dishes/2')json=initialDish;
   if(path.endsWith('/chat')){
    if(request.method()==='POST'){
     const body=request.postDataJSON();assert.equal(typeof body.message,'string');assert.ok(!('recipe' in body)&&!('history' in body),'server owns context');posts++;
     if(failNext){failNext=false;await route.fulfill({status:503,json:{error:'测试网络暂时中断'}});return}
     if(body.message.includes('第二道')){
      await new Promise(resolve=>{release=resolve});
      recipe={...recipe,total_cost:16,dishes:[recipe.dishes[0],{...recipe.dishes[1],name:'蒜蓉西兰花',ingredients:[{name:'西兰花',quantity:250,unit:'g',category:'main'}],steps:[{title:'快炒',description:'蒜末爆香后，放入西兰花快炒。'}]}]};
     }
     const changed=body.message.includes('第二道')?['dish-1','ingredients','timeline']:[];
     chat={...chat,messages:[...chat.messages,{id:String(posts*2-1),role:'user',content:body.message},{id:String(posts*2),role:'assistant',content:changed.length?'第二道已替换成蒜蓉西兰花，其他菜保持原样。':'大火快炒，鸡蛋刚凝固就盛出，口感会更嫩。',changed_sections:changed}]};
     json={...chat,document:recipe,changed_sections:changed};
    }else json=chat;
   }
   await route.fulfill({json});
  });
  const dock=()=>page.locator('.generation-assistant-float:not(.is-morphing)[data-mode="docked"]');
  const expanded=()=>page.locator('.generation-assistant-float:not(.is-morphing)[data-mode="expanded"]');
  const input=()=>page.getByRole('textbox',{name:'对当前菜谱提问'});
  async function bounds(){
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>document.documentElement.clientWidth),false,'no document overflow');
   const box=await page.locator('.generation-assistant-float').boundingBox();
   assert.ok(box.x>=0&&box.x+box.width<=width+1&&box.y>=0,'panel fits viewport');
   if(width===390)assert.ok(box.y+box.height<=height-80,'navigation remains clear');
  }
  await page.goto(base+'/generating/8');await page.locator('.generation-assistant-inline').waitFor();
  status='completed';await dock().waitFor();await page.locator('[data-section="6"][data-state="completed"]').waitFor();
  await page.getByRole('button',{name:'展开 AI 菜谱助手'}).click();await expanded().waitFor();await input().waitFor();await bounds();
  assert.ok(!await page.locator('.recipe-chat').innerText().then(text=>text.includes('只属于生成阶段的说明')));
  const guide=await page.locator('.recipe-chat-guidance').innerText();
  await page.getByRole('button',{name:'收起 AI 菜谱助手'}).click();await dock().waitFor();
  await page.getByRole('button',{name:'展开 AI 菜谱助手'}).click();await expanded().waitFor();
  assert.notEqual(await page.locator('.recipe-chat-guidance').innerText(),guide,'guidance varies every reopen');
  await page.screenshot({path:`${out}/${theme}-${width}-welcome.png`});
  // A cooking question updates conversation only.
  await input().fill('怎么判断鸡蛋炒好了？');await page.getByRole('button',{name:'发送消息'}).click();
  await page.locator('.recipe-chat-message[data-role="assistant"]').waitFor();
  assert.equal(await page.locator('[data-ai-updated]').count(),0);
  // A failed request preserves the draft; an edit survives collapsing during a request.
  failNext=true;await input().fill('只替换第二道菜，其他不要动');await page.getByRole('button',{name:'发送消息'}).click();
  await page.getByText('测试网络暂时中断').waitFor();assert.equal(await input().inputValue(),'只替换第二道菜，其他不要动');
  await page.getByRole('button',{name:'发送消息'}).click();await page.locator('.recipe-chat-pending').waitFor();
  await page.getByRole('button',{name:'收起 AI 菜谱助手'}).click();await dock().waitFor();
  assert.equal(posts,3);release();
  await page.locator('.deck-navigation').getByRole('button',{name:'2 · 蒜蓉西兰花'}).waitFor();
  assert.deepEqual(recipe.dishes[0],firstDish,'untouched dish is preserved');
  assert.equal(await page.locator('#ingredients-0').getAttribute('data-ai-updated'),null,'untouched ingredients have no effect');
  assert.equal(await page.locator('#steps-0').getAttribute('data-ai-updated'),null,'untouched steps have no effect');
  await page.locator('.deck-navigation').getByRole('button',{name:'2 · 蒜蓉西兰花'}).click();
  await page.locator('#ingredients-1').scrollIntoViewIfNeeded();
  await page.locator('#ingredients-1[data-ai-updated="ingredients:1"]').waitFor();
  await page.screenshot({path:`${out}/${theme}-${width}-update.png`});await bounds();
  await page.getByRole('button',{name:'展开 AI 菜谱助手'}).click();await expanded().waitFor();
  await page.getByText('第二道已替换成蒜蓉西兰花，其他菜保持原样。',{exact:true}).waitFor();
  await page.screenshot({path:`${out}/${theme}-${width}-conversation.png`});
  await page.keyboard.press('Escape');await dock().waitFor();
  await page.emulateMedia({reducedMotion:'reduce'});
  await page.getByRole('button',{name:'展开 AI 菜谱助手'}).click();await expanded().waitFor();
  assert.equal(await page.locator('.generation-assistant-float').evaluate(el=>el.getAnimations().length),0);await bounds();
  await page.close();
 }
 // Saved recipe and standalone dish retain the same assistant entry point.
 for(const path of ['/recipes/1','/dishes/2']){
  const page=await browser.newPage({viewport:{width:390,height:844},reducedMotion:'reduce'});
  page.on('pageerror',e=>errors.push({path,error:e.message}));
  await page.route('**/api/v1/**',async route=>{
   const endpoint=new URL(route.request().url()).pathname;let json=[];
   if(endpoint.endsWith('/me'))json={user:{id:1,username:'体验'}};
   if(endpoint.endsWith('/recipes'))json=[{id:1,title:'晚餐',dishes:[initialDish]}];
   if(endpoint.endsWith('/dishes'))json=[initialDish];
   if(endpoint==='/api/v1/documents/recipes/1')json={id:1,title:'晚餐',dishes:[initialDish]};
   if(endpoint==='/api/v1/documents/dishes/2')json=initialDish;
   if(endpoint.endsWith('/chat'))json={session_id:1,messages:[],busy:false};
   if(endpoint==='/api/v1/tags')json={defaults:[]};
   await route.fulfill({json});
  });
  await page.goto(base+path);
  await page.locator('.welcome-enter').waitFor();await page.locator('.welcome-enter').click();
  await page.getByRole('button',{name:'展开 AI 菜谱助手'}).click();
  await page.getByRole('textbox',{name:'对当前菜谱提问'}).waitFor();
  assert.equal(await page.getByRole('button',{name:'制作记录',exact:true}).count(),0);
  await page.close();
 }
 assert.deepEqual(errors,[]);
 console.log('PASS: recipe follow-up chat; questions versus scoped changes; error draft recovery; collapsed pending completion; hidden dish effects; saved menu/dish; 3 viewports × 2 themes; navigation clearance, reduced motion, no overflow/runtime errors.');
}finally{await browser.close()}
