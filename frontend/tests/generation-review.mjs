import {createRequire} from 'node:module';
import {mkdir} from 'node:fs/promises';
import assert from 'node:assert/strict';
const require=createRequire(import.meta.url);
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const out=process.env.UI_REVIEW_OUTPUT||'.cache/generation-review';await mkdir(out,{recursive:true});
const browser=await chromium.launch({headless:true,channel:'chrome'});
const base='http://127.0.0.1:5175',errors=[];
try{for(const width of [1440,390])for(const theme of ['light','dark']){
 const page=await browser.newPage({viewport:{width,height:900}});page.on('pageerror',e=>errors.push(e.message));
 let status='planning',target='menu',failRead=false,missing=false,submitFail=false;
 const dish={id:2,name:'番茄炒蛋',description:'一份温暖的家常味道。',servings:2,ingredients:[{name:'番茄',quantity:300,unit:'g'}],steps:[{title:'翻炒食材',description:'中火翻炒 3 分钟。',duration_minutes:3}]};
 const recipe={id:1,title:'两个人的家常晚餐',summary:'把新鲜食材变成今晚的小满足。',servings:2,total_elapsed_minutes:20,dishes:[dish]};
 await page.route('**/api/v1/**',async route=>{const req=route.request(),path=new URL(req.url()).pathname.replace('/api/v1','');let data=[];
 if(path==='/me')data={user:{id:99,username:'厨房体验'}};
 else if(path==='/documents/preferences')data=[{id:1,theme}];
 else if(path==='/capabilities')data={llm:true};
 else if(path==='/tags')data={defaults:[]};
 else if(path==='/generate'){target=req.postDataJSON().target;await new Promise(r=>setTimeout(r,650));if(submitFail)return route.fulfill({status:500,json:{error:'提交失败'}});data={id:8};}
 else if(path==='/jobs/8') {if(failRead)return route.fulfill({status:503,json:{error:'连接暂时中断'}});data={id:8,status,result_kind:target==='dish'?'dishes':'recipes',recipe_id:target==='dish'?2:1,created_at:new Date().toISOString(),error:status==='failed'?'模型暂时不可用':'',events:[]};}
 else if(path==='/documents/recipes')data=[recipe];
 else if(path==='/documents/dishes')data=[missing?{id:2,name:'待补充的菜品'}:dish];
 await route.fulfill({json:data});});
 async function capture(name){await page.waitForTimeout(700);await page.evaluate(()=>scrollTo({top:0,behavior:'instant'}));assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,name);await page.screenshot({path:`${out}/${theme}-${width}-${name}.png`,fullPage:true});}
 await page.goto(base);await page.getByRole('button',{name:'混合模式',exact:false}).click();await page.getByLabel('食材名称',{exact:true}).fill('番茄、鸡蛋');await page.getByRole('button',{name:'添加',exact:true}).click();assert.equal(await page.locator('.ingredient-input button').count(),2);await capture('ingredients');
 await page.getByRole('button',{name:'生成菜谱',exact:true}).click();await page.waitForURL('**/generating/new-*');await page.locator('.section-skeleton').first().waitFor();assert.equal(await page.locator('.section-skeleton').count(),7);await page.waitForURL('**/generating/8');await capture('pending');
 // Reload retains the server task and all seven placeholders.
 await page.reload();await page.locator('.section-skeleton').first().waitFor();assert.equal(await page.locator('.section-skeleton').count(),7);
 await page.evaluate(()=>{window.revealOrder=[];new MutationObserver(()=>{for(const el of document.querySelectorAll('[data-state="completed"]')){const i=Number(el.dataset.section);if(!window.revealOrder.includes(i))window.revealOrder.push(i)}}).observe(document.body,{subtree:true,attributes:true,childList:true})});
 status='completed';await page.locator('[data-section="6"][data-state="completed"]').waitFor();assert.deepEqual(await page.evaluate(()=>window.revealOrder),[0,1,2,3,4,5,6]);await capture('complete');
 assert.equal(await page.getByText('本次没有联网参考来源。').count(),1);
 status='failed';await page.reload();await page.getByRole('alert').waitFor();assert.equal(await page.locator('[data-state="error"]').count(),7);await capture('failed');
 status='planning';failRead=true;await page.reload();await page.getByRole('alert').waitFor();failRead=false;await page.getByRole('button',{name:'重试 / 恢复'}).click();await page.locator('.chef-progress.working').waitFor();
 // Independent dish path and missing optional/required section fields.
 await page.goto(base+'/inspire-dish');missing=true;await page.getByRole('button',{name:'生成一道菜',exact:true}).click();await page.waitForURL('**/generating/8');status='completed';await page.getByRole('button',{name:'立即查看全部'}).click();await page.waitForTimeout(2600);assert.equal(await page.locator('[data-state="completed"]').count(),7);await page.getByText('本次未提供食材清单。').waitFor();await capture('dish-missing');
 await page.emulateMedia({reducedMotion:'reduce'});await page.reload();await page.locator('[data-section="6"][data-state="completed"]').waitFor();assert.equal(await page.locator('.revealed-content').first().evaluate(el=>getComputedStyle(el).animationName),'none');
 await page.goto(base);submitFail=true;await page.getByRole('button',{name:'生成菜谱',exact:true}).click();await page.getByRole('alert').waitFor();await page.close();
}assert.deepEqual(errors,[]);console.log('PASS: 2 themes × desktop/mobile; inline ingredients, immediate navigation, 7 skeletons, ordered reveal, reload, job/read/submit failures, missing fields, skip animation, reduced motion, no overflow/runtime errors.');}finally{await browser.close()}


