// Run against Vite with PLAYWRIGHT_MODULE pointing to an installed Playwright package.
import {createRequire} from 'node:module';
import assert from 'node:assert/strict';
const require=createRequire(import.meta.url);
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const browser=await chromium.launch({headless:true,channel:'chrome'});
const base=process.env.TEST_BASE_URL||'http://127.0.0.1:5176';
try {
  for(const width of [1440,390]) {
    const page=await browser.newPage({viewport:{width,height:900}});
    const errors=[];page.on('pageerror',e=>errors.push(e.message));
    let preferences={id:7,theme:'light',electricity_price:.9,global_prompt:'原有个人要求',notes:'保留的饮食习惯'};
    let system='原有系统要求';
    await page.route('**/api/v1/**',async route=>{
      const req=route.request(),path=new URL(req.url()).pathname.replace('/api/v1','');let data=[];
      if(path==='/me')data={user:{id:1,username:'管理员',admin:true},csrf:'test'};
      else if(path.startsWith('/documents/preferences')) {
        if(req.method()!=='GET')preferences={...req.postDataJSON(),id:7};
        data=req.method()==='GET'?[preferences]:preferences;
      }else if(path==='/admin/global-prompt') {
        if(req.method()==='PUT')system=req.postDataJSON().global_prompt;
        data={global_prompt:system};
      }else if(path==='/capabilities')data={registration:true};
      else if(path==='/tags')data={defaults:[],global:[]};
      await route.fulfill({json:data});
    });
    await page.goto(base+'/settings');
    const personal=page.getByLabel('个人全局提示词',{exact:true});
    await personal.waitFor();await page.waitForFunction(()=>document.querySelector('textarea')?.value==='原有个人要求');
    await personal.fill('只对我生效\n优先清淡');
    await page.getByRole('button',{name:'保存设置',exact:true}).click();
    await page.getByText('已保存',{exact:true}).waitFor();
    assert.equal(preferences.global_prompt,'只对我生效\n优先清淡');assert.equal(preferences.notes,'保留的饮食习惯');
    await page.reload();await page.waitForFunction(()=>document.querySelector('textarea')?.value==='只对我生效\n优先清淡');
    await page.getByRole('link',{name:'管理员设置',exact:true}).click();
    const global=page.getByLabel('对所有用户生效的提示词');
    await global.waitFor();await page.waitForFunction(()=>document.querySelector('[name=global_prompt]')?.value==='原有系统要求');
    await global.fill('全站生效\n统一简体中文');
    await page.getByRole('button',{name:'保存系统提示词',exact:true}).click();
    await page.getByText('系统全局提示词已保存',{exact:true}).waitFor();
    assert.equal(system,'全站生效\n统一简体中文');
    await global.fill('');await page.getByRole('button',{name:'保存系统提示词',exact:true}).click();
    await page.waitForFunction(()=>document.querySelector('[name=global_prompt]')?.value==='');
    assert.equal(system,'');
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
    assert.deepEqual(errors,[]);
    await page.close();
  }
  console.log('PASS: desktop/mobile personal and system prompt editing, persistence, clearing, existing preferences preservation, and no overflow.');
}finally{await browser.close()}
