import {createRequire} from 'node:module';
import {mkdir} from 'node:fs/promises';
import assert from 'node:assert/strict';
const require=createRequire(import.meta.url);
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const base=process.env.UI_REVIEW_URL||'http://127.0.0.1:5175';
const out=process.env.UI_REVIEW_OUTPUT||'.cache/admin-generations-review';
await mkdir(out,{recursive:true});
const browser=await chromium.launch({headless:true,channel:'chrome'});
const errors=[];
try{
 for(const width of [390,834,1440])for(const theme of ['light','dark']){
  const page=await browser.newPage({viewport:{width,height:900}});page.on('pageerror',error=>errors.push(error.message));
  let fail=false;const requests=[];
  const users=[{id:1,username:'厨房管理员',admin:true},{id:2,username:'周末认真做饭的人',admin:false},{id:3,username:'新来的朋友',admin:false}];
  const dish={id:90,name:'番茄炒蛋',description:'一份简单的家常好味。',servings:2,prep_minutes:5,cook_minutes:8,ingredients:[{name:'番茄',quantity:300,unit:'g'},{name:'鸡蛋',quantity:2,unit:'个'}],steps:[{title:'准备食材',description:'番茄洗净切块，鸡蛋打散。',duration_minutes:5},{title:'翻炒出锅',description:'中火翻炒食材，调味后出锅。',duration_minutes:8,safety_note:'鸡蛋彻底加热后再食用。'}]};
  const data=Array.from({length:13},(_,index)=>index%2?{...dish,id:index+1,kind:'dishes',generated_at:'2026-11-14T08:30:00Z'}:{id:index+1,kind:'recipes',title:'两个人的家常晚餐 '+(index+1),summary:'从冰箱里的一点灵感，变成餐桌上的一顿好饭。',servings:2,total_elapsed_minutes:20,dishes:[dish],generated_at:'2026-11-14T08:30:00Z',tags:['家常','清淡'],saved:true});
  await page.route('**/api/v1/**',async route=>{
   const url=new URL(route.request().url()),path=url.pathname.replace('/api/v1','');let json=[];
   if(path==='/me')json={user:users[0]};
   else if(path==='/documents/preferences')json=[{id:1,theme}];
   else if(path==='/capabilities')json={llm:true,registration:true};
   else if(path==='/tags')json={defaults:[],global:[]};
   else if(path==='/admin/global-prompt')json={global_prompt:''};
   else if(path==='/admin/users')json=users;
   else if(/^\/admin\/users\/\d+\/generations$/.test(path)){
    requests.push(path+url.search);const user=users.find(user=>user.id===Number(path.split('/')[3]));
    if(fail)return route.fulfill({status:503,json:{error:'厨房记录暂时不可用'}});
    const kind=url.searchParams.get('kind'),offset=Number(url.searchParams.get('offset'));
    const matching=user.id===3?[]:data.filter(item=>kind==='all'||item.kind===kind);
    json={user,items:matching.slice(offset,offset+12),total:matching.length,limit:12,offset,has_more:offset+12<matching.length};
   }
   await route.fulfill({json});
  });
  await page.goto(base+'/admin');
  const history=page.locator('.admin-generations');await history.waitFor();
  if(await page.locator('.welcome-enter').count()){await page.locator('.welcome-enter').click();await page.locator('.welcome-page').waitFor({state:'detached'});}
  await page.getByLabel('查看用户的生成记录').selectOption('2');
  await page.getByText('周末认真做饭的人 · 13 条记录').waitFor();
  assert.equal(await history.locator('.admin-generation-record').count(),12);
  assert.ok(requests.some(request=>request.includes('/users/2/generations?kind=all&limit=12&offset=0')));
  const first=history.locator('.admin-generation-summary').first();await first.click();
  await page.waitForTimeout(650);
  assert.equal(await first.getAttribute('aria-expanded'),'true');
  assert.ok(await history.locator('.admin-generation-record.is-open').getByText('番茄洗净切块，鸡蛋打散。').isVisible());
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  await history.scrollIntoViewIfNeeded();await history.screenshot({path:`${out}/${theme}-${width}-expanded.png`});
  await first.click();await page.waitForTimeout(600);
  assert.equal(await history.locator('.admin-generation-reveal').first().evaluate(element=>element.getBoundingClientRect().height),0);
  await page.getByRole('button',{name:'下一页',exact:true}).click();
  await page.getByText('第 2 / 2 页').waitFor();
  assert.equal(await history.locator('.admin-generation-record').count(),1);
  await page.getByRole('button',{name:'上一页',exact:true}).click();await page.getByText('第 1 / 2 页').waitFor();
  await page.getByRole('group',{name:'生成记录类型'}).getByRole('button',{name:'菜品',exact:true}).click();
  await page.getByText('周末认真做饭的人 · 6 道菜品').waitFor();
  assert.equal(await history.locator('.admin-generation-record').count(),6);
  assert.equal(await history.locator('.admin-generation-pagination').count(),0);
  await page.getByLabel('查看用户的生成记录').selectOption('3');
  await page.getByText('这位用户还没有生成记录。').waitFor();
  fail=true;await page.getByRole('button',{name:'刷新生成记录'}).click();await history.getByRole('alert').waitFor();
  await page.getByText('厨房记录暂时不可用').waitFor();fail=false;
  await page.getByRole('button',{name:'重新加载',exact:true}).click();await page.getByText('这位用户还没有生成记录。').waitFor();
  await page.emulateMedia({reducedMotion:'reduce'});await page.getByLabel('查看用户的生成记录').selectOption('2');
  await history.locator('.admin-generation-summary').first().click();
  assert.equal(await history.locator('.admin-generation-reveal').first().evaluate(element=>getComputedStyle(element).transitionDuration),'0s');
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  await page.close();
 }
 assert.deepEqual(errors,[]);
 console.log('PASS: mobile/tablet/desktop × light/dark; user selection, menu/dish filters, paginated history, read-only ingredients/steps, inline expansion/collapse, empty/error/retry/refresh, reduced motion, no overflow or runtime errors.');
}finally{await browser.close()}
