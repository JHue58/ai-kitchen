// PLAYWRIGHT_MODULE=/path/to/playwright node frontend/tests/theme-review.mjs
import {createRequire} from 'node:module';
import {mkdir} from 'node:fs/promises';
import assert from 'node:assert/strict';
const require=createRequire(import.meta.url);
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const out=process.env.UI_REVIEW_OUTPUT||'/tmp/ai-kitchen-theme-review';
const base=process.env.UI_REVIEW_URL||'http://127.0.0.1:5175';
await mkdir(out,{recursive:true});
const browser=await chromium.launch({headless:true,channel:'chrome'});
const errors=[];
const dish={id:2,name:'番茄炒蛋',description:'一份熟悉的家常味道。',servings:2,cost:12,tags:['家常菜'],ingredients:[{name:'番茄',quantity:300,unit:'g',cost:5}],steps:[{title:'翻炒食材',description:'中火翻炒 3 分钟，最后调味。',duration_minutes:3,temperature_c:160,safety_note:'注意热锅。'}]};
const recipe={id:1,title:'两个人的家常晚餐',summary:'把新鲜食材变成今晚的小满足。',servings:2,total_elapsed_minutes:20,total_cost:24,nutrition:{calories:800},tags:['家常菜'],dishes:[dish]};
try{for(const [width,height] of [[1440,900],[1280,800],[390,844]]){
 const page=await browser.newPage({viewport:{width,height}});
 page.on('pageerror',e=>errors.push(e.message));let preference={id:1,theme:'light',electricity_price:.9};let lastSearch;
 await page.route('**/api/v1/**',async route=>{const req=route.request();const url=new URL(req.url());const path=url.pathname.replace('/api/v1','');let data=[];
 if(path==='/me')data={user:{id:99,username:'厨房体验'}};
 else if(path.startsWith('/documents/preferences')){if(req.method()!=='GET')preference={...preference,...req.postDataJSON()};data=req.method()==='GET'?[preference]:preference;}
 else if(path==='/capabilities')data={llm:true,search:true};
 else if(path==='/tags')data={defaults:['家常菜'],global:[]};
 else if(path==='/documents/recipes'){lastSearch=url.searchParams;data=[recipe];}
 else if(path==='/documents/dishes')data=[dish];
 else if(path==='/generate')data={id:8};
 else if(path==='/jobs/8')data={id:8,status:'planning',created_at:new Date().toISOString(),events:[{status:'planning',message:'正在搭配食材与口味',at:new Date().toISOString()}]};
 await route.fulfill({json:data});});
 async function visit(url){await page.goto(url);await page.locator('.shell, .welcome-page').first().waitFor();if(await page.locator('.welcome-enter').isVisible()){await page.locator('.welcome-enter').click();await page.locator('.welcome-page').waitFor({state:'detached'});}}
 async function capture(name){await page.waitForTimeout(500);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,name);await page.screenshot({path:`${out}/${name}-${width}.png`,fullPage:true});}
 async function setTheme(theme){await visit(base+'/settings');await page.getByLabel('外观主题').selectOption(theme);await page.getByRole('button',{name:'保存设置',exact:true}).click();await page.getByText('已保存',{exact:true}).waitFor();await page.waitForFunction(expected=>document.documentElement.dataset.theme===expected,theme==='system'?'light':theme);}
 for(const theme of ['light','dark']){
 await setTheme(theme);await visit(base+'/recipes');await page.locator('.recipe-card').waitFor();
 assert.equal(await page.locator('html').getAttribute('data-theme'),theme);
 assert.equal(await page.locator('.theme-shortcut').count(),0);
 const geometry=await page.locator('.collection-filters').evaluate(el=>{const c=el.getBoundingClientRect(),i=el.querySelector('input').getBoundingClientRect();return {left:i.left-c.left,top:i.top-c.top}});assert.ok(geometry.left>=20&&geometry.top>=20);
 if(theme==='dark'){const bg=await page.locator('.collection-filters').evaluate(el=>getComputedStyle(el).backgroundColor);assert.equal(bg,'rgb(37, 45, 40)');assert.equal(await page.locator('html').evaluate(el=>getComputedStyle(el).colorScheme),'dark');}
 await capture(theme+'-search');await page.getByLabel('搜索菜单名称').fill('晚餐');await page.getByLabel('最低费用 / 元').fill('10');await page.waitForTimeout(300);assert.equal(lastSearch.get('q'),'晚餐');assert.equal(lastSearch.get('min_cost'),'10');await page.getByRole('button',{name:'清空筛选'}).click();assert.equal(await page.getByLabel('搜索菜单名称').inputValue(),'');
 if(theme==='dark'){
 await visit(base+'/recipes/1');await page.locator('.stat').first().waitFor();
 assert.equal(await page.locator('.dish.card').count(),0);
 for(const selector of ['.dish','#overview']){assert.deepEqual(await page.locator(selector).first().evaluate(el=>{const s=getComputedStyle(el);return [s.backgroundColor,s.boxShadow,s.borderTopWidth]}),['rgba(0, 0, 0, 0)','none','0px']);}
 assert.equal(await page.locator('.stat').first().evaluate(el=>getComputedStyle(el).boxShadow),'none');
 assert.equal(new Set(await page.locator('.stat').evaluateAll(els=>els.map(el=>getComputedStyle(el).backgroundColor))).size,4);await capture('dark-recipe');
 await visit(base+'/dishes/2');await page.locator('#dish-steps').waitFor();await capture('dark-dish');
 await visit(base);await page.getByRole('button',{name:'混合模式',exact:false}).click();await page.getByLabel('食材名称',{exact:true}).fill('番茄');await capture('dark-kitchen');await page.getByRole('button',{name:'生成菜谱',exact:true}).click();await page.waitForURL('**/generating/8');await page.locator('.chef-progress.working').waitFor();assert.deepEqual(await page.locator('.chef-progress').evaluate(el=>[getComputedStyle(el).boxShadow,getComputedStyle(el,'::before').display]),['none','none']);await page.waitForTimeout(600);await page.locator('.chef-progress').screenshot({path:`${out}/dark-ai-${width}.png`});
 }
 }
 await page.emulateMedia({colorScheme:'light'});await setTheme('system');await page.emulateMedia({colorScheme:'dark'});await page.waitForFunction(()=>document.documentElement.dataset.theme==='dark');await page.emulateMedia({colorScheme:'light'});await page.waitForFunction(()=>document.documentElement.dataset.theme==='light');
 await page.close();
}assert.deepEqual(errors,[]);console.log('PASS: light/dark settings saved and restored, live system theme changes, search/reset, padded filters, 4 distinct dark stats, generation, 3 viewports; no overflow or runtime errors. '+out);}finally{await browser.close();}
