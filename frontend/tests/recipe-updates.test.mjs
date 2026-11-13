import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import test from 'node:test';

// Exercise the actual TypeScript diff without adding a test framework/runtime.
const require=createRequire(import.meta.url);
const ts=require('typescript');
const source=readFileSync(new URL('../src/components/recipe-updates.tsx',import.meta.url),'utf8').replace("import '../recipe-updates.css';",'');
const compiled=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2022}}).outputText;
const local={exports:{}};
new Function('require','exports','module',compiled)(require,local.exports,local);
const {changedRecipeSections}=local.exports;

const dish=name=>({
 name,description:'家常做法',tags:['家常'],prep_minutes:5,cook_minutes:10,cost:5,
 ingredients:[{name:'盐',quantity:2,unit:'g',cost:.1}],
 steps:[{title:'翻炒',description:'炒匀',duration_minutes:3}],
 nutrition:{calories:100,protein:10},energy_usage:[{equipment_id:1,heating_minutes:10}],
 ai_commentary:'注意火候。',theoretical_energy_cost:.1,
});
const recipe=()=>({id:1,title:'晚餐',summary:'一桌好饭',servings:2,total_cost:10,total_elapsed_minutes:15,dishes:[dish('第一道'),dish('第二道')],nutrition:{calories:200,protein:20},sources:[]});
const keys=(before,after)=>[...changedRecipeSections(before,after)].sort();

test('editing the second dish preserves unaffected dish and step sections',()=>{
 const before=recipe(),after=structuredClone(before);
 after.dishes[1].ingredients[0].quantity=1;
 assert.deepEqual(keys(before,after),['ingredients:1','shopping:root']);
 assert.deepEqual(before.dishes[0],after.dishes[0]);
});

test('a technique clarification changes only the affected steps',()=>{
 const before=recipe(),after=structuredClone(before);
 after.dishes[1].steps[0].description='小火炒匀，避免炒焦。';
 assert.deepEqual(keys(before,after),['steps:1']);
});

test('derived recipe totals and dish insights receive their own updates',()=>{
 const before=recipe(),after=structuredClone(before);
 after.dishes[1].ingredients[0].quantity=1;
 after.dishes[1].cost=4;
 after.dishes[1].nutrition.calories=90;
 after.dishes[1].theoretical_energy_cost=.08;
 after.total_cost=9;
 after.nutrition.calories=190;
 assert.deepEqual(keys(before,after),['analysis:root','dish-analysis:1','dish-overview:1','ingredients:1','shopping:root','statistics:root']);
});

test('replacement names update the visible overviews without changing other dishes',()=>{
 const before=recipe(),after=structuredClone(before);
 after.dishes[1].name='新的第二道';
 assert.deepEqual(keys(before,after),['dish-overview:1','overview:root']);
});

test('a safety-note edit also updates the safety summary',()=>{
 const before=recipe(),after=structuredClone(before);
 after.dishes[1].steps[0].safety_note='使用隔热手套。';
 assert.deepEqual(keys(before,after),['analysis:root','steps:1']);
});

test('standalone dishes use root section keys',()=>{
 const before={id:2,servings:2,...dish('独立菜')},after=structuredClone(before);
 after.ingredients[0].quantity=1;
 after.steps[0].description='先用小火。';
 assert.deepEqual(keys(before,after),['ingredients:root','shopping:root','steps:root']);
});

test('an answer, document flags, usage, and image task metadata never flash the recipe',()=>{
 const before=recipe(),after={...structuredClone(before),saved:true,favorite:true,updated_at:'2026-11-13',token_usage:{total_tokens:1000},image_status:'completed'};
 after.dishes[0].collection_id=123;
 assert.deepEqual(keys(before,after),[]);
});

test('JSON object key ordering and missing versus empty source lists are equivalent',()=>{
 const before=recipe(),after=structuredClone(before);
 after.dishes[1].ingredients[0]={cost:.1,unit:'g',quantity:2,name:'盐'};
 delete after.sources;
 assert.deepEqual(keys(before,after),[]);
});

test('a cost-only ingredient recalculation does not change the shopping list',()=>{
 const before=recipe(),after=structuredClone(before);
 after.dishes[1].ingredients[0].cost=.2;
 assert.deepEqual(keys(before,after),['ingredients:1']);
});

test('redistributing quantities between dishes does not flash an unchanged shopping total',()=>{
 const before=recipe(),after=structuredClone(before);
 after.dishes[0].ingredients[0].quantity=1;
 after.dishes[1].ingredients[0].quantity=3;
 assert.deepEqual(keys(before,after),['ingredients:0','ingredients:1']);
});

test('equivalent kg/g amounts do not flash an unchanged shopping total',()=>{
 const before=recipe(),after=structuredClone(before);
 before.dishes[1].ingredients[0]={name:'番茄',quantity:1,unit:'kg'};
 after.dishes[1].ingredients[0]={name:'番茄',quantity:1000,unit:'g'};
 assert.deepEqual(keys(before,after),['ingredients:1']);
});

test('new references update the source section without replaying the entire recipe',()=>{
 const before=recipe(),after=structuredClone(before);
 after.sources=[{title:'做法参考',url:'https://example.com/recipe'}];
 assert.deepEqual(keys(before,after),['sources:root']);
});

test('menu tags have an independent root update section',()=>{
 const before=recipe(),after=structuredClone(before);
 after.tags=['家常','少盐'];
 assert.deepEqual(keys(before,after),['tags:root']);
});

test('standalone tags update the root tags block',()=>{
 const before={id:2,...dish('独立菜')},after=structuredClone(before);
 after.tags=['少盐'];
 assert.deepEqual(keys(before,after),['dish-overview:root','tags:root']);
});

test('nested dish tags update its header without flashing the menu tags',()=>{
 const before=recipe(),after=structuredClone(before);
 after.dishes[1].tags=['少盐'];
 assert.deepEqual(keys(before,after),['dish-overview:1']);
});

test('successive edits identify only each new change, including revisions to one dish',()=>{
 const first=recipe(),second=structuredClone(first);
 second.dishes[1].ingredients[0].quantity=1;
 const third=structuredClone(second);
 third.dishes[1].steps[0].description='调料减半，最后试味。';
 assert.deepEqual(keys(first,second),['ingredients:1','shopping:root']);
 assert.deepEqual(keys(second,third),['steps:1']);
 const fourth=structuredClone(third);
 fourth.dishes[1].ingredients[0].quantity=.5;
 assert.deepEqual(keys(third,fourth),['ingredients:1','shopping:root']);
});
