import {createRequire} from 'node:module';
import {mkdir} from 'node:fs/promises';
import assert from 'node:assert/strict';

const require=createRequire(import.meta.url);
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const base=process.env.UI_REVIEW_URL||'http://127.0.0.1:5175';
const output=process.env.UI_REVIEW_OUTPUT||'.cache/chat-palette-review';
await mkdir(output,{recursive:true});
const browser=await chromium.launch({headless:true,channel:'chrome'});
const errors=[];
try{
 for(const [width,height] of [[390,844],[834,1112],[1440,900]])for(const theme of ['light','dark']){
  const page=await browser.newPage({viewport:{width,height},reducedMotion:'reduce'});
  page.on('pageerror',error=>errors.push({width,theme,error:error.message}));
  const dish={id:2,name:'番茄炒蛋',description:'把今晚的家常味，调成你喜欢的样子。',servings:2,ingredients:[],steps:[]};
  let recipe={chat_suggestions:[{label:"蛋更嫩一些",message:"番茄炒蛋怎样让鸡蛋更嫩？"},{label:"番茄出汁",message:"番茄怎么炒才更容易出汁？"},{label:"一起出锅",message:"番茄炒蛋和清炒时蔬怎样安排顺序？"},{label:"时蔬火候",message:"清炒时蔬怎样保持脆嫩？"},{label:"提前准备",message:"这顿饭哪些步骤可以提前准备？"}],id:1,title:'两个人的家常晚餐',servings:2,dishes:[dish,{...dish,name:'清炒时蔬'}]};
  let messages=[];
  await page.route('**/api/v1/**',async route=>{
   const request=route.request(),path=new URL(request.url()).pathname.replace('/api/v1','');let json=[];
   if(path==='/me')json={user:{id:99,username:'厨房体验'}};
   if(path==='/documents/preferences')json=[{id:1,theme}];
   if(path==='/documents/recipes')json=[recipe];
   if(path==='/documents/recipes/1')json=recipe;
   if(path==='/documents/dishes')json=[dish];
   if(path==='/tags')json={defaults:[]};
   if(path==='/jobs/8')json={id:8,status:'completed',result_kind:'recipes',recipe_id:1,events:[]};
   if(path.endsWith('/chat')){
    if(request.method()==='POST'){
     const data=request.postDataJSON();
     recipe={...recipe,chat_suggestions:[{label:"保留鲜味",message:"减少盐和生抽后，番茄炒蛋怎样保留鲜味？"},{label:"时蔬脆嫩",message:"清炒时蔬怎样保持脆嫩？"}]};
     messages=[{id:'user',role:'user',content:data.message},{id:'assistant',role:'assistant',content:'可以，盐从 3 克减到 1.5 克，生抽也减半。先尝味道，再少量补盐，其他菜的做法保持原样。'}];
    }
    json={session_id:1,messages,busy:false,document:recipe,changed_sections:[]};
   }
   await route.fulfill({json});
  });
  await page.goto(base+'/generating/8');
  await page.getByRole('button',{name:'展开 AI 菜谱助手'}).click();
  await page.locator('.recipe-chat-suggestions button').first().waitFor();
  assert.equal(await page.getByRole('button',{name:'不要牛肉'}).count(),0,'no hardcoded beef suggestion');
  await page.getByRole('button',{name:'蛋更嫩一些'}).click();
  assert.equal(await page.getByRole('textbox',{name:'对当前菜谱提问'}).inputValue(),'番茄炒蛋怎样让鸡蛋更嫩？');
  await page.mouse.move(0,0);await page.waitForTimeout(350);
  const palette=await page.locator('.recipe-chat-suggestions button').evaluateAll(elements=>{
   const luminance=rgb=>rgb.map(v=>v/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4).reduce((total,v,index)=>total+v*[.2126,.7152,.0722][index],0);
   const canvas=document.createElement('canvas');canvas.width=canvas.height=1;const ctx=canvas.getContext('2d');
   const rgb=color=>{ctx.clearRect(0,0,1,1);ctx.fillStyle=color;ctx.fillRect(0,0,1,1);return [...ctx.getImageData(0,0,1,1).data].slice(0,3)};
   return elements.map(element=>{const style=getComputedStyle(element),background=style.backgroundColor,a=luminance(rgb(background)),b=luminance(rgb(style.color));return {background,contrast:(Math.max(a,b)+.05)/(Math.min(a,b)+.05)}});
  });
  assert.equal(new Set(palette.map(color=>color.background)).size,1,'suggestions share a quiet sage palette');
  assert.ok(palette.every(color=>color.contrast>=4.5),'small chip text meets 4.5:1 contrast: '+JSON.stringify(palette));
  async function bounds(visibleHeight=height){
   const panel=await page.locator('.generation-assistant-float').boundingBox();
   assert.ok(panel.x>=0&&panel.x+panel.width<=width+1&&panel.y>=0&&panel.y+panel.height<=visibleHeight,'panel fits viewport');
   if(width===390)assert.ok(panel.y+panel.height<=visibleHeight-80,'mobile navigation stays clear');
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>document.documentElement.clientWidth),false,'no horizontal overflow');
  }
  await bounds();await page.locator('.generation-assistant-float').screenshot({path:`${output}/${theme}-${width}-welcome.png`});
  await page.getByRole('textbox',{name:'对当前菜谱提问'}).fill('这道菜少一点盐，其他不要动。');
  await page.getByRole('button',{name:'发送消息'}).click();
  await page.locator('.recipe-chat-message[data-role="assistant"]').waitFor();
  await page.getByRole('button',{name:'保留鲜味'}).waitFor();
  assert.equal(await page.getByRole('button',{name:'蛋更嫩一些'}).count(),0,'replace stale suggestions after conversation');
  const bubbles=await page.locator('.recipe-chat-message>p').evaluateAll(elements=>elements.map(element=>getComputedStyle(element).backgroundColor));
  assert.notEqual(bubbles[0],bubbles[1],'user and assistant bubbles have distinct hues');
  await bounds();await page.locator('.generation-assistant-float').screenshot({path:`${output}/${theme}-${width}-conversation.png`});
  if(width===390){await page.setViewportSize({width,height:400});await page.waitForTimeout(100);await bounds(400)}
  await page.close();
 }
 assert.deepEqual(errors,[]);
 console.log('PASS: warm neutral/sage palette, 4.5:1 chip contrast, distinct chat bubbles, mobile/tablet/desktop × light/dark, short viewport, no overflow or runtime errors.');
}finally{await browser.close()}
