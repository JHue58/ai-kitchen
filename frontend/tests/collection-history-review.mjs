import {createRequire} from 'node:module';
import {mkdir} from 'node:fs/promises';
import assert from 'node:assert/strict';
const require=createRequire(import.meta.url);
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const base=process.env.UI_REVIEW_URL||'http://127.0.0.1:5175';
const out=process.env.UI_REVIEW_OUTPUT||'.cache/collection-history-review';await mkdir(out,{recursive:true});
const browser=await chromium.launch({headless:true,channel:'chrome'}),errors=[];
const day=n=>new Date(Date.UTC(2026,0,n)).toISOString();
const dish={name:'番茄炒蛋',description:'熟悉的家常菜。',servings:2,ingredients:[],steps:[]};
try{
 for(const [width,height] of [[390,844],[834,1112],[1440,900]])for(const kind of ['recipes','dishes']){
  const page=await browser.newPage({viewport:{width,height},reducedMotion:'reduce'});page.on('pageerror',e=>errors.push(e.message));
  const requests=[];
  const docs=Array.from({length:54},(_,i)=>({id:i+1,title:'菜单 '+i,name:'菜品 '+i,dishes:[dish],servings:2,created_at:day(i+1),generated_at:day(i+1)})).reverse();
  const saved=[{...docs[53],saved:true,saved_at:day(60)},{...docs[52],saved:true,saved_at:day(59)}];
  const favorite=[{...docs[51],favorite:true,favorited_at:day(70)},{...docs[50],favorite:true,favorited_at:day(69)}];
  const label=doc=>kind==='recipes'?doc.title:doc.name;
  await page.route('**/api/v1/**',async route=>{
   const url=new URL(route.request().url()),path=url.pathname.replace('/api/v1','');let json=[];
   if(path==='/me')json={user:{id:1,username:'厨房体验'}};
   if(path==='/documents/preferences')json=[{id:1,theme:'light'}];
   if(path==='/tags')json={defaults:[]};
   if(path==='/documents/'+kind){requests.push(url.search);json=url.searchParams.get('saved')==='true'?saved:url.searchParams.get('favorite')==='true'?favorite:url.searchParams.get('recent')==='true'?docs.slice(0,50):docs}
   if(path==='/documents/'+kind+'/'+saved[0].id)json={...saved[0],...(kind==='dishes'?dish:{})};
   if(path.endsWith('/chat'))json={session_id:1,messages:[],busy:false};
   await route.fulfill({json});
  });
  await page.goto(base+'/'+kind);await page.locator('.welcome-enter').waitFor();await page.locator('.welcome-enter').click();
  await page.getByRole('button',{name:'最近生成',exact:true}).waitFor();
  await page.waitForFunction(()=>document.querySelectorAll('.recipe-grid .recipe-card').length===50);
  assert.equal(await page.locator('.recipe-card h3').first().innerText(),label(docs[0]));
  assert.ok(requests.some(query=>new URLSearchParams(query).get('recent')==='true'));
  await page.getByText('最近生成保留 50 条，保存或收藏后可长期保留。').waitFor();
  await page.getByRole('button',{name:'已保存',exact:true}).click();
  await page.waitForFunction(()=>document.querySelectorAll('.recipe-grid .recipe-card').length===2);
  assert.equal(await page.locator('.recipe-card h3').first().innerText(),label(saved[0]));
  assert.ok(requests.some(query=>new URLSearchParams(query).get('saved')==='true'));
  await page.getByRole('button',{name:'收藏',exact:true}).click();
  await page.locator('.recipe-card h3').first().getByText(label(favorite[0]),{exact:true}).waitFor();
  assert.ok(requests.some(query=>new URLSearchParams(query).get('favorite')==='true'));
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>document.documentElement.clientWidth),false);
  await page.screenshot({path:`${out}/${kind}-${width}.png`});
  await page.getByRole('button',{name:'已保存',exact:true}).click();await page.locator('.recipe-card h3').first().getByText(label(saved[0]),{exact:true}).waitFor();
  await page.locator('.recipe-card').first().click();await page.waitForURL('**/'+kind+'/'+saved[0].id);
  await page.locator(kind==='recipes'?'.recipe-reading':'.dish-reading').waitFor();
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>document.documentElement.clientWidth),false);
  await page.close();
 }
 assert.deepEqual(errors,[]);
 console.log('PASS: recent 50-window, generated order, save/favorite query and order, protected old detail links, menu/dish × mobile/tablet/desktop, no overflow or runtime errors.');
}finally{await browser.close()}
