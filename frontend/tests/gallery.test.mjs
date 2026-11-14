import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {after,test} from 'node:test';
import {createServer} from 'vite';

const root=fileURLToPath(new URL('../',import.meta.url));
const server=await createServer({root,server:{middlewareMode:true,hmr:false,ws:false,watch:null},appType:'custom'});
after(()=>server.close());
const {defaultDishPhoto,decorativePhotos,neutralPhoto}=await server.ssrLoadModule('/src/resources.ts');
const original=JSON.parse(readFileSync(new URL('../resources/gallery/manifest.json',import.meta.url)));
const abstract=JSON.parse(readFileSync(new URL('../resources/gallery/abstract-manifest.json',import.meta.url)));

test('the abstract collection replaces the entire original collection in equal quantity',()=>{
 assert.equal(abstract.images.length,31);
 assert.equal(abstract.images.length,original.images.length);
 assert.equal(new Set(abstract.images.map(image=>image.src)).size,31);
 for(const image of [...abstract.images,...original.images]){
  assert.ok(existsSync(new URL('../resources/gallery/'+image.src,import.meta.url)),image.src);
 }
});

test('all dish categories, including exact original matches, use neutral covers',()=>{
 for(const name of ['红烧肉','蒜蓉虾','清蒸鲈鱼','宫保鸡丁','番茄炒蛋','家常豆腐','葱油拌面','玉米排骨汤','苹果派','一份随意搭配']){
  const photo=defaultDishPhoto({name});
  assert.match(photo.src,/\/abstract\/.*\.webp$/);
  assert.doesNotMatch(photo.src,/\/images\//);
 }
 assert.match(neutralPhoto,/^data:image\/svg\+xml,/);
});

test('the same dish keeps its cover with partial data and changing metadata',()=>{
 const photo=defaultDishPhoto({name:'红烧肉'});
 assert.deepEqual(defaultDishPhoto({id:15,name:'红烧肉',description:'加入香菇',tags:['家常'],ingredients:[{name:'猪肉'}]}),photo);
 assert.deepEqual(defaultDishPhoto({name:' 红烧肉 '}),photo);
 assert.deepEqual(defaultDishPhoto({id:0}),defaultDishPhoto({id:0}));
 assert.ok(defaultDishPhoto().src);
 const used=new Set(Array.from({length:1000},(_,id)=>defaultDishPhoto({name:'菜品'+id}).src));
 assert.equal(used.size,31);
});

test('every original photograph is available to decorative surfaces',()=>{
 assert.equal(decorativePhotos.length,32);
 assert.equal(new Set(decorativePhotos.map(photo=>photo.id)).size,32);
 for(const image of original.images){
  const photo=decorativePhotos.find(photo=>photo.id===image.id);
  assert.ok(photo?.src.endsWith(image.src),image.id);
 }
});
