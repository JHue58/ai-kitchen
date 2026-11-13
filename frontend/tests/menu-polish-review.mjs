// PLAYWRIGHT_MODULE=<installed package> UI_REVIEW_URL=http://127.0.0.1:5175 node frontend/tests/menu-polish-review.mjs
import {createRequire} from 'node:module';
import {mkdir} from 'node:fs/promises';
import assert from 'node:assert/strict';
const require=createRequire(import.meta.url);
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const base=process.env.UI_REVIEW_URL||'http://127.0.0.1:5175';
const out=process.env.UI_REVIEW_OUTPUT||'.cache/menu-polish-review';
const viewports=JSON.parse(process.env.UI_REVIEW_VIEWPORTS||'[[360,780],[390,844],[768,1024],[834,1112],[1024,768],[1440,900]]');
await mkdir(out,{recursive:true});
const browser=await chromium.launch({headless:true,channel:'chrome'});
const errors=[];
const ingredients=[
 {name:'番茄',quantity:300,unit:'g',category:'main',cost:4,cost_source:'personal'},
 {name:'鸡蛋',quantity:2,unit:'个',category:'main',cost:3},
 {name:'葱',quantity:5,unit:'g',category:'supporting',cost:1,is_pantry:true},
 {name:'盐',quantity:2,unit:'g',category:'seasoning',cost:.1,is_pantry:true},
];
const dish={id:2,name:'番茄炒蛋',description:'熟悉的家常味道。',servings:2,prep_minutes:5,cook_minutes:8,cost:8.1,tags:['家常菜'],ingredients,
 steps:[{title:'炒香与调味',description:'热锅后翻炒 3 分钟，保持食材鲜嫩。',duration_minutes:3,start_minute:0,equipment_id:4,safety_note:'注意热油飞溅。'}],
 ai_commentary:'番茄的酸甜搭配鸡蛋的鲜香，最后加盐，保留柔嫩口感。',theoretical_kwh:.2,theoretical_energy_cost:.18,
 energy_usage:[{equipment_id:4,heating_minutes:8,theoretical_kwh:.2}],nutrition:{calories:360,protein:22,carbs:18,fat:22}};
const second={...dish,id:3,name:'清炒西兰花',description:'一口清爽。',ai_commentary:'西兰花快炒，保留脆嫩，搭配主菜更均衡。',theoretical_kwh:.1,theoretical_energy_cost:.09,ingredients:[{name:'西兰花',quantity:250,unit:'g',category:'main'},{name:'蒜',quantity:5,unit:'g',category:'supporting'},{name:'盐',quantity:2,unit:'g',category:'seasoning'}],energy_usage:[{equipment_id:4,heating_minutes:4,theoretical_kwh:.1}]};
const recipe={id:1,title:'两个人的家常晚餐',summary:'把新鲜食材变成今晚的小满足。',servings:2,total_elapsed_minutes:20,total_cost:18,nutrition:{calories:500,protein:25,carbs:30,fat:24},tags:['家常菜'],dishes:[dish,second],ai_commentary:'一荤一素，为整桌增加色彩和均衡。',theoretical_kwh:.3,theoretical_energy_cost:.27,energy_usage:[{equipment_id:4,heating_minutes:12,theoretical_kwh:.3}]};
try {
 for(const [width,height] of viewports) for(const theme of ['light','dark']) {
  const page=await browser.newPage({viewport:{width,height}});
  page.on('pageerror',e=>errors.push(`${width}/${theme}: ${e.message}`));
  let status='planning',single=false,lastSearch,preference={id:1,theme,electricity_price:.9},old=false;
  await page.route('**/api/v1/**',async route=>{
   const req=route.request(),url=new URL(req.url()),path=url.pathname.replace('/api/v1','');let json=[];
   if(path==='/me')json={user:{id:99,username:'厨房体验'}};
   else if(path.startsWith('/documents/preferences')){if(req.method()!=='GET')preference={...preference,...req.postDataJSON()};json=req.method()==='GET'?[preference]:preference;}
   else if(path==='/capabilities')json={llm:true,search:true};
   else if(path==='/tags')json={defaults:['家常菜'],global:[]};
   else if(path==='/documents/tags')json=[{id:6,name:'清爽'}];
   else if(path==='/documents/equipment')json=[{id:4,name:'电磁炉',electric:true,watts:1500}];
   else if(path==='/documents/recipes'){lastSearch=url.searchParams;json=[old?{...recipe,dishes:[{...dish,ingredients:ingredients.map(({category,...i})=>i),ai_commentary:''}]}:recipe];}
   else if(path==='/documents/dishes')json=[dish,second,{id:7,name:'历史空数据',ingredients:null,steps:[],energy_usage:[null]}];
   else if(path==='/jobs/8')json={id:8,status,result_kind:single?'dishes':'recipes',recipe_id:single?2:1,created_at:new Date(Date.now()-9000).toISOString(),events:[{status,message:'我在整理食材与做法',at:new Date().toISOString()}],error:status==='failed'?'模型暂时不可用':''};
   await route.fulfill({json});
  });
  page.setDefaultTimeout(15000);
  async function visit(path){await page.goto(base+path);await page.locator('.shell').waitFor();if(await page.locator('.welcome-enter').isVisible()){await page.locator('.welcome-enter').click();await page.locator('.welcome-page').waitFor({state:'detached'});}await page.waitForFunction(()=>document.querySelector('.route-view')?.getAnimations().every(a=>a.playState==='finished'));}
  async function noOverflow(label){assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>document.documentElement.clientWidth),false,`${label}: ${width}/${theme}`);}
  async function screenshot(name){await noOverflow(name);if([390,834,1440].includes(width))await page.screenshot({path:`${out}/${theme}-${width}-${name}.png`,fullPage:true});}
  await visit('/settings');assert.equal(await page.getByRole('heading',{name:/个人.*标签/}).count(),0);
  await visit('/preferences');await page.getByRole('heading',{name:'个人标签',exact:true}).waitFor();await noOverflow('preferences');
  for(const kind of ['recipes','dishes']){
   await visit('/'+kind);await page.locator('.recipe-card').first().waitFor();const toggle=page.getByRole('button',{name:'搜索与筛选'});
   assert.equal(await toggle.getAttribute('aria-expanded'),'false');assert.equal(await page.locator('.collection-filter-disclosure').evaluate(el=>el.offsetHeight),0);
   assert.equal(await page.getByRole('searchbox').count(),0);await screenshot(kind+'-default');
   await toggle.click();await page.getByRole('searchbox').waitFor();await page.getByRole('searchbox').fill('晚餐');await page.getByLabel('最低费用 / 元').fill('10');
   await page.waitForFunction(()=>document.querySelector('.collection-filter-disclosure')?.getBoundingClientRect().height>100);await page.waitForTimeout(650);await screenshot(kind+'-filters');
   if(kind==='recipes'){assert.equal(lastSearch.get('q'),'晚餐');assert.equal(lastSearch.get('min_cost'),'10');}
   await toggle.click();await page.waitForTimeout(650);assert.equal(await toggle.getAttribute('aria-expanded'),'false');assert.equal(await page.getByRole('searchbox').count(),0);await noOverflow('filters-close');
   await toggle.click();assert.equal(await page.getByRole('searchbox').inputValue(),'晚餐');await page.getByRole('button',{name:'清空筛选'}).click();assert.equal(await page.getByRole('searchbox').inputValue(),'');
  }
  await visit('/recipes/1');await page.locator('.dish:not([hidden])').waitFor();
  assert.equal(await page.locator('.dish:not([hidden]) .ingredient-group').count(),3);
  assert.equal(new Set(await page.locator('.dish:not([hidden]) .ingredient-group').evaluateAll(els=>els.map(el=>getComputedStyle(el).backgroundColor))).size,3);
  assert.ok((await page.locator('.dish:not([hidden])').innerText()).includes(dish.ai_commentary));
  assert.ok((await page.locator('.dish:not([hidden])').innerText()).includes('0.18'));
  await screenshot('menu');
  const dishSwitch=page.locator('.deck-navigation .chips button').nth(1);await dishSwitch.click();
  assert.ok((await page.locator('.dish:not([hidden])').innerText()).includes(second.ai_commentary));
  assert.ok((await page.locator('.dish:not([hidden])').innerText()).includes('0.09'));await noOverflow('second-dish');
  assert.ok((await page.locator('#analysis').innerText()).includes('0.27'));
  await visit('/dishes/2');await page.locator('#analysis').waitFor();assert.equal(await page.locator('.ingredient-group').count(),3);assert.ok((await page.locator('#analysis').innerText()).includes(dish.ai_commentary));assert.ok((await page.locator('#analysis').innerText()).includes('0.18'));await screenshot('dish');
  old=true;await visit('/recipes/1');await page.locator('.ingredient-group').first().waitFor();assert.equal(await page.locator('.dish:not([hidden]) .ingredient-line').count(),ingredients.length);await noOverflow('legacy-ingredients');old=false;
  await visit('/dishes/7');await page.getByText('食材清单尚未提供，请补全后再烹饪。',{exact:true}).waitFor();await noOverflow('legacy-null-fields');
  await visit('/generating/8');await page.locator('.chef-progress.working').waitFor();assert.equal(await page.locator('[data-mode="docked"]').count(),0);
  await screenshot('generating');
  await page.evaluate(()=>{window.motionOverflow=[];window.watchMotion=true;function tick(){if(document.documentElement.scrollWidth>document.documentElement.clientWidth)window.motionOverflow.push(document.documentElement.scrollWidth);if(window.watchMotion)requestAnimationFrame(tick)}tick()});
  status='completed';const dock=page.getByRole('button',{name:'展开 AI 制作记录',exact:true});await dock.waitFor();await page.waitForFunction(()=>!document.querySelector('.generation-assistant-float.is-morphing'));
  await page.locator('[data-section="6"][data-state="completed"]').waitFor();
  assert.ok((await page.locator('.generation-assistant-slot').boundingBox()).height<10);
  const capsule=await dock.boundingBox();assert.ok(capsule.width<220&&capsule.height>=44);
  if(width<=700){const nav=await page.locator('.shell aside').boundingBox();assert.ok(capsule.y+capsule.height<=nav.y,'dock avoids mobile navigation');}
  await screenshot('completed');await dock.click();const dialog=page.getByRole('dialog',{name:'AI 制作记录',exact:true});await dialog.waitFor();await page.waitForFunction(()=>!document.querySelector('.generation-assistant-float.is-morphing'));
  const box=await dialog.boundingBox();assert.ok(box.x>=0&&box.y>=0&&box.x+box.width<=width+1&&box.y+box.height<=height+1,'expanded assistant stays in viewport');await screenshot('assistant-open');
  await page.keyboard.press('Escape');await dock.waitFor();await page.waitForFunction(()=>!document.querySelector('.generation-assistant-float.is-morphing'));assert.equal(await dock.evaluate(el=>el===document.activeElement),true);
  await dock.click();await dialog.waitFor();await page.getByRole('button',{name:'收起 AI 制作记录',exact:true}).click();await dock.waitFor();await page.waitForFunction(()=>!document.querySelector('.generation-assistant-float.is-morphing'));
  await page.evaluate(()=>window.watchMotion=false);assert.deepEqual(await page.evaluate(()=>window.motionOverflow),[],'no horizontal overflow during animation');
  // The same lifecycle must work for independent dishes and reduced motion.
  single=true;await page.emulateMedia({reducedMotion:'reduce'});await page.reload();await dock.waitFor();await page.locator('[data-section="6"][data-state="completed"]').waitFor();await dock.click();await dialog.waitFor();assert.equal(await page.locator('.generation-assistant-float').evaluate(el=>el.getAnimations().length),0);await page.keyboard.press('Escape');await dock.waitFor();await noOverflow('reduced-motion');
  status='failed';await page.reload();await page.getByRole('alert').waitFor();await page.locator('.chef-progress.is-error').waitFor();assert.equal(await dock.count(),0);await noOverflow('failed');
  await page.close();console.log(`PASS ${width}×${height} ${theme}`);
 }
 assert.deepEqual(errors,[]);console.log(`PASS: ${viewports.length} viewports × 2 themes; settings/tags, hidden filters, per-dish/menu energy/commentary, ingredient colors/legacy data, generation docking/open/close/focus/reduced motion/failure, animation overflow and screenshots.`);
} finally {await browser.close();}
