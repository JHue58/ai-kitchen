import {createRequire} from 'node:module';
import assert from 'node:assert/strict';
const require=createRequire(import.meta.url);
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const browser=await chromium.launch({headless:true,channel:'chrome'});
const base=process.env.UI_REVIEW_URL||'http://127.0.0.1:5175';
const recipe={id:1,title:'测试菜单',summary:'家常饭',servings:2,dishes:[{name:'番茄炒蛋',ingredients:[{name:'番茄',quantity:300,unit:'g'}],steps:[{title:'翻炒',description:'炒熟即可',duration_minutes:3}]}]};
try {
 for(const width of [320,390,1440]) {
  const page=await browser.newPage({viewport:{width,height:844}});
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  let failed=false;
  await page.route('**/api/v1/**',async route=>{
   const path=new URL(route.request().url()).pathname.replace('/api/v1','');let json=[];
   if(path==='/me')json={user:{id:1,username:'测试'}};
   else if(path==='/documents/recipes')json=[recipe];
   else if(path==='/share/test')json=recipe;
   else if(path==='/recipes/1/share'){
    await new Promise(resolve=>setTimeout(resolve,100));
    if(failed)return route.fulfill({status:500,json:{error:'分享失败'}});
    json={url:'/share/test'};
   }
   await route.fulfill({json});
  });
  await page.addInitScript(()=>{
   window.copied='';window.copyFails=false;
   Object.defineProperty(navigator,'clipboard',{value:{
    write:async items=>{if(window.copyFails)throw Error('denied');window.copied=await (await items[0].getType('text/plain')).text()},
    writeText:async text=>{if(window.copyFails)throw Error('denied');window.copied=text},
   },configurable:true});
   document.execCommand=()=>false;
  });
  await page.goto(base+'/recipes/1');
  await page.locator('.welcome-enter').click();
  // The exit must fade continuously even when clicked during the entry animations.
  const opacities=[];
  for(let i=0;i<5;i++) {opacities.push(await page.locator('.welcome-page').evaluate(el=>Number(getComputedStyle(el).opacity)).catch(()=>0));await page.waitForTimeout(60)}
  assert.ok(opacities.some(v=>v>0&&v<1),String(opacities));
  for(let i=1;i<opacities.length;i++)assert.ok(opacities[i]<=opacities[i-1],String(opacities));
  await page.locator('.welcome-page').waitFor({state:'detached'});
  await page.locator('.more-actions summary').click();
  await page.waitForTimeout(100);
  const menu=page.locator('.more-actions-list');
  await menu.getByRole('button',{name:'分享',exact:true}).scrollIntoViewIfNeeded();
  if(width===390)await page.screenshot({path:'/tmp/ai-kitchen-mobile-menu.png'});
  const bounds=await menu.boundingBox();assert.ok(bounds.x>=0&&bounds.x+bounds.width<=width);
  assert.ok(await menu.getByRole('button',{name:'分享',exact:true}).evaluate(el=>{
   const r=el.getBoundingClientRect();return el.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2));
  }),'Menu button must be visible and hit-testable');
  await menu.getByRole('button',{name:'分享',exact:true}).click();
  assert.equal(await page.locator('.more-actions').getAttribute('open'),null);
  await page.getByRole('status').filter({hasText:'分享链接已复制'}).waitFor();
  assert.equal(await page.evaluate(()=>window.copied),base+'/share/test');
  await page.evaluate(()=>{window.copyFails=true});
  await page.getByRole('button',{name:'复制分享链接'}).click();
  await page.getByText('复制失败，请长按链接手动复制',{exact:true}).waitFor();
  assert.equal(await page.getByLabel('分享链接').inputValue(),base+'/share/test');
  failed=true;
  await page.locator('.more-actions summary').click();
  await menu.getByRole('button',{name:'分享',exact:true}).click();
  await page.getByText('分享失败',{exact:true}).waitFor();
  assert.equal(await page.locator('.more-actions').getAttribute('open'),null);
  await page.goto(base+'/share/test');
  await page.locator('.reading-nav').waitFor();
  await page.evaluate(()=>scrollTo({top:500,behavior:'instant'}));
  await page.waitForTimeout(150);
  const top=await page.locator('.reading-nav').evaluate(el=>el.getBoundingClientRect().top);
  assert.ok(Math.abs(top-(width<=700?0:12))<1,'Shared navigation top: '+top);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  assert.deepEqual(errors,[]);
  await page.close();
 }
 const context=await browser.newContext({permissions:['clipboard-read','clipboard-write'],reducedMotion:'reduce',viewport:{width:390,height:844}});
 const page=await context.newPage();
 await page.route('**/api/v1/**',async route=>{
  const path=new URL(route.request().url()).pathname.replace('/api/v1','');
  const json=path==='/me'?{user:{id:1,username:'测试'}}:path==='/documents/recipes'?[recipe]:path==='/recipes/1/share'?{url:'/share/test'}:[];
  await route.fulfill({json});
 });
 await page.goto(base+'/recipes/1');
 await page.locator('.welcome-enter').click();
 await page.locator('.welcome-page').waitFor({state:'detached'});
 await page.locator('.more-actions summary').click();
 await page.locator('.more-actions-list').getByRole('button',{name:'分享',exact:true}).click();
 await page.getByText('分享链接已复制',{exact:true}).waitFor();
 assert.equal(await page.evaluate(()=>navigator.clipboard.readText()),base+'/share/test');
 // Simulate HTTP/older browsers where the Clipboard API is absent.
 await page.evaluate(()=>{
  Object.defineProperty(navigator,'clipboard',{value:undefined,configurable:true});
  document.execCommand=command=>{window.fallbackCopy=command==='copy'?document.activeElement.value:'';return true};
 });
 await page.getByRole('button',{name:'复制分享链接'}).click();
 assert.equal(await page.evaluate(()=>window.fallbackCopy),base+'/share/test');
 await context.close();
 console.log('PASS: 320/390/1440px; continuous welcome fade; visible action menu; automatic copy; menu closes; copy/API failures; real clipboard; legacy copy; reduced motion; shared sticky navigation; no overflow or browser errors.');
} finally {await browser.close()}
