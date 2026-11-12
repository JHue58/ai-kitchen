import gallery from '../resources/gallery/manifest.json';
import catalog from '../resources/icons/manifest.json';
import tablePhoto from '../resources/gallery/images/kitchen-table.jpg';

export {tablePhoto};

// Import through Vite so production builds include the files and respect base URLs.
const photos = import.meta.glob('../resources/gallery/images/**/*.{webp,jpg}', {eager:true, query:'?url', import:'default'}) as Record<string,string>;
type Dish = {id?:number|string;name?:string;description?:string;tags?:string[];ingredients?:{name:string}[]};
const categories: [string, RegExp][] = [
  ['soups-stews', /汤|羹|煲|火锅/],
  ['noodles-staples', /面|饭|饺|馄饨|馒头|包子|粥|饼|主食/],
  ['meat-braises', /肉|排骨|牛|猪|鸡|鸭|羊|鱼|虾|荤菜/],
  ['vegetables-eggs-tofu', /蔬菜|素菜|蛋|豆腐|青菜|白菜|西兰花|茄子|土豆|菌|菇/],
];
export function defaultDishPhoto(dish: Dish = {}) {
  const name = dish.name || '';
  const context = [dish.description, ...(dish.tags || []), ...(dish.ingredients || []).map(i=>i.name)].join(' ');
  const category = /(?:番茄|西红柿).*蛋|蛋.*(?:番茄|西红柿)/.test(name) ? 'eggs'
    : categories.find(([,pattern])=>pattern.test(name))?.[0]
      || categories.find(([,pattern])=>pattern.test(context))?.[0];
  const pool = category ? gallery.images.filter(image=>image.category===category) : gallery.images.filter(image=>image.category!=='eggs');
  // Stable across renders and across the collection/detail pages.
  const seed = name || String(dish.id || context);
  const hash = Array.from(seed).reduce((value,char)=>(Math.imul(value,31)+char.charCodeAt(0))>>>0,0);
  const image = pool[hash % pool.length];
  return {src:photos['../resources/gallery/'+image.src] || tablePhoto, description:image.description};
}

type IconKind = 'equipment'|'ingredient'|'dish';
const normalize = (value:string)=>value.trim().toLowerCase().replace(/西红柿/g,'番茄');
export function kitchenIconName(name:string, kind:IconKind) {
  const categories = kind==='equipment' ? ['cookware','appliances'] : kind==='ingredient' ? ['ingredients','seasonings'] : ['dishes'];
  const input = normalize(name);
  const items = catalog.items.filter(item=>categories.includes(item.category));
  const exact = items.find(item=>[item.id,item.name,item.name_en].some(word=>normalize(word)===input))
    || items.find(item=>item.keywords.some(word=>normalize(word)===input));
  if (exact && input) return exact.id;
  const matches = items.flatMap(item=>[item.name,item.name_en,item.id].map(normalize).filter(word=>word.length>=2 && input.includes(word)).map(word=>({id:item.id,length:word.length})));
  return matches.sort((a,b)=>b.length-a.length)[0]?.id || (kind==='equipment'?'stockpot':kind==='ingredient'?'rice':'soup');
}
