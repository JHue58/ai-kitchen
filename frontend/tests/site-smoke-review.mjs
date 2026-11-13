// PLAYWRIGHT_MODULE=<installed package> UI_REVIEW_URL=http://127.0.0.1:4175 node frontend/tests/site-smoke-review.mjs
// All API requests are mocked. Any mutating request fails the read-only review.
import {createRequire} from 'node:module';
import {mkdir,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
const require=createRequire(import.meta.url);
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const browser=await chromium.launch({headless:true,channel:'chrome'});
const base=process.env.UI_REVIEW_URL||'http://127.0.0.1:4175',out=process.env.UI_REVIEW_OUTPUT||'.cache/site-smoke-review';await mkdir(out,{recursive:true});
const errors=[],mutations=[],checks=[],issues=[],artifacts=new Set();
const dish={id:2,name:'番茄炒蛋',description:'熟悉的家常味道。',servings:2,prep_minutes:5,cook_minutes:8,cost:8.1,tags:['家常菜'],ingredients:[{name:'番茄',quantity:300,unit:'g',category:'main'},{name:'鸡蛋',quantity:2,unit:'个',category:'main'},{name:'盐',quantity:2,unit:'g',category:'seasoning'}],steps:[{title:'准备食材',description:'把番茄切块，鸡蛋打散。',duration_minutes:3,start_minute:0},{title:'炒香与调味',description:'热锅后翻炒 3 分钟，保持食材鲜嫩。',duration_minutes:3,start_minute:3,equipment_id:4,safety_note:'注意热油飞溅。'}],ai_commentary:'番茄的酸甜搭配鸡蛋的鲜香，最后加盐，保留柔嫩口感。',theoretical_kwh:.2,theoretical_energy_cost:.18,energy_usage:[{equipment_id:4,heating_minutes:8,theoretical_kwh:.2}],nutrition:{calories:360,protein:22,carbs:18,fat:22}};
const recipe={id:1,title:'两个人的家常晚餐',summary:'把新鲜食材变成今晚的小满足。',servings:2,total_elapsed_minutes:20,total_cost:18,nutrition:{calories:500},tags:['家常菜'],dishes:[dish]};
try{await Promise.all([[390,844],[834,1112],[1440,900]].map(async([width,height])=>{for(const theme of ['light','dark']){
 const page=await browser.newPage({viewport:{width,height}});page.setDefaultTimeout(12000);page.on('pageerror',e=>errors.push({width,theme,error:e.message}));
 await page.route('**/api/v1/**',async route=>{
  const req=route.request(),path=new URL(req.url()).pathname.replace('/api/v1','');let json=[];
  if(req.method()!=='GET'){mutations.push({width,theme,method:req.method(),path});return route.fulfill({status:409,json:{error:'Read-only UI review'}})}
  if(path==='/me')json={user:{id:99,username:'厨房体验'}};
  else if(path==='/documents/preferences')json=[{id:1,theme,electricity_price:.9,allergies:['花生'],avoid:[],dislikes:[],tastes:['清淡'],cuisines:['家常菜']}];
  else if(path==='/capabilities')json={llm:true,search:true};
  else if(path==='/tags')json={defaults:['家常菜','清爽','少油'],global:[]};
  else if(path==='/documents/tags')json=[{id:6,name:'清爽'}];
  else if(path==='/documents/equipment')json=[{id:4,name:'电磁炉',electric:true,watts:1500,capacity:28,unit:'cm',description:'适合日常快炒与煲汤。'}];
  else if(path==='/documents/pantry')json=[{id:5,name:'番茄',category:'食材',quantity:300,unit:'g'},{id:7,name:'盐',category:'调料',quantity:100,unit:'g'}];
  else if(path==='/documents/prices')json=[{id:8,name:'番茄',price:8,unit:'kg'}];
  else if(path==='/documents/shopping')json=[{id:9,name:'今晚的购物清单',items:[{name:'番茄',quantity:300,unit:'g',checked:false},{name:'鸡蛋',quantity:2,unit:'个',checked:true}]}];
  else if(path==='/documents/recipes')json=[recipe];
  else if(path==='/documents/dishes')json=[dish];
  await route.fulfill({json});
 });
 async function visit(path){await page.goto(base+path);await page.locator('.shell').waitFor();if(await page.locator('.welcome-enter').isVisible()){await page.locator('.welcome-enter').click();await page.locator('.welcome-page').waitFor({state:'detached'})}await page.waitForFunction(()=>document.querySelector('.route-view')?.getAnimations().every(a=>a.playState==='finished'));for(const src of await page.locator('script[src*="/assets/"],link[href*="/assets/"]').evaluateAll(els=>els.map(el=>el.src||el.href)))artifacts.add(src.split('/').at(-1));}
 async function shot(name){await page.evaluate(()=>scrollTo({top:0,behavior:'instant'}));await page.waitForTimeout(100);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>document.documentElement.clientWidth),false,`${width}/${theme}/${name} overflow`);await page.screenshot({path:`${out}/${theme}-${width}-${name}.png`,fullPage:true});checks.push(`${width}/${theme}/${name}`)}
 async function dialogBounds(){
  await page.waitForFunction(()=>document.querySelector('[role="dialog"]')?.getAnimations().every(a=>a.playState==='finished'));
  const b=await page.getByRole('dialog').boundingBox(),backdrop=await page.locator('.modal-backdrop').boundingBox();
  // The stable scrollbar gutter is outside the document's layout surface.
  const layoutWidth=await page.evaluate(()=>document.documentElement.getBoundingClientRect().width);
  if(!(b.x>=0&&b.y>=0&&b.x+b.width<=width+1&&b.y+b.height<=height+1&&backdrop.x===0&&backdrop.y===0&&backdrop.width>=layoutWidth-1&&backdrop.height>=height-1)){
   issues.push({width,theme,path:page.url(),dialog:b,backdrop});console.log('ISSUE modal '+JSON.stringify(issues.at(-1)));await page.screenshot({path:`${out}/${theme}-${width}-modal-issue-${issues.length}.png`,fullPage:true});
  }
 }
 for(const path of ['/','/inspire-dish']){await visit(path);await page.locator('.generate-button').click({trial:true});await page.getByRole('button',{name:'混合模式',exact:false}).click();await page.getByLabel('食材名称',{exact:true}).fill('番茄、鸡蛋');await page.getByRole('button',{name:'添加',exact:true}).click();assert.equal(await page.locator('.ingredient-tokens button').count(),2);await page.getByRole('button',{name:'更多偏好'}).click();await page.waitForTimeout(650);await shot(path==='/'?'inspiration-menu':'inspiration-dish')}
 await visit('/kitchen');
 for(const [tab,label]of [['equipment','我的炊具'],['pantry','食材与调料'],['prices','食材价格']]){await page.getByRole('button',{name:label,exact:true}).click();await page.locator('.item-card').first().waitFor();await shot('kitchen-'+tab);await page.getByRole('button',{name:'添加',exact:true}).click();await page.getByRole('dialog').waitFor();await dialogBounds();await shot('kitchen-'+tab+'-dialog');await page.getByRole('button',{name:'取消',exact:true}).click();await page.getByRole('button',{name:'编辑',exact:true}).first().click();await page.getByRole('dialog').waitFor();await dialogBounds();await page.getByRole('button',{name:'取消',exact:true}).click()}
 await visit('/shopping');await page.getByRole('heading',{name:'今晚的购物清单'}).waitFor();await page.getByRole('button',{name:'新建清单',exact:false}).click({trial:true});await page.getByRole('checkbox').first().click({trial:true});await shot('shopping');
 for(const path of ['/cook/1','/cook-dish/2']){await visit(path);await page.locator('.cook-card').waitFor();await page.getByRole('button',{name:'开始计时',exact:false}).click();await page.getByRole('button',{name:'暂停',exact:true}).click();await page.getByRole('button',{name:'重置',exact:true}).click();await page.getByRole('button',{name:'下一步',exact:false}).click();await page.getByRole('button',{name:'上一步',exact:true}).click();await shot(path.includes('dish')?'cook-dish':'cook-menu')}
 await visit('/settings');await page.getByRole('button',{name:'保存设置',exact:true}).click({trial:true});assert.equal(await page.getByRole('heading',{name:'个人标签',exact:true}).count(),0);await shot('settings');
 await visit('/preferences');await page.getByRole('heading',{name:'个人标签',exact:true}).waitFor();await page.getByRole('button',{name:'保存设置',exact:true}).click({trial:true});await page.getByRole('button',{name:'添加',exact:true}).click();await page.getByRole('dialog').waitFor();await dialogBounds();await page.getByRole('button',{name:'取消',exact:true}).click();await shot('preferences');
 await page.close();console.log(`PASS site smoke ${width}x${height} ${theme}`);
}}));assert.deepEqual(errors,[]);assert.deepEqual(mutations,[]);console.log('BUILD '+[...artifacts].join(', '));console.log(`PASS ${checks.length} screenshots/routes; no horizontal overflow, runtime errors, or mutating API calls. ${issues.length} geometry findings.`);await writeFile(`${out}/report.json`,JSON.stringify({artifacts:[...artifacts],errors,mutations,checks,issues},null,2));assert.deepEqual(issues,[],'modal geometry and viewport coverage');}finally{await browser.close()}

