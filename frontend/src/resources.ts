import gallery from '../resources/gallery/manifest.json';
import abstractGallery from '../resources/gallery/abstract-manifest.json';
import catalog from '../resources/icons/manifest.json';
import tablePhoto from '../resources/gallery/images/kitchen-table.jpg';

export {tablePhoto};

// Import through Vite so production builds include the files and respect base URLs.
const photos = import.meta.glob(['../resources/gallery/images/**/*.{webp,jpg}', '../resources/gallery/abstract/*.webp'], {eager:true, query:'?url', import:'default'}) as Record<string,string>;
type Dish = {id?:number|string;name?:string;description?:string;tags?:string[];ingredients?:{name:string}[]};

// Even the last-resort image is neutral if a local asset cannot be loaded.
export const neutralPhoto = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 800"><rect width="1200" height="800" fill="#f3edde"/><ellipse cx="340" cy="620" rx="620" ry="440" fill="#c9d2b8"/><ellipse cx="960" cy="900" rx="650" ry="630" fill="#e5b594"/><ellipse cx="540" cy="800" rx="580" ry="470" fill="#f8f1e3"/></svg>');

export type DecorativePhotoItem = {id:string;src:string;name:string;description:string};
export const decorativePhotos:DecorativePhotoItem[] = [
  ...gallery.images.map(image=>({
    id:image.id,src:photos['../resources/gallery/'+image.src],
    name:image.keywords?.[0] || (image.category==='eggs'?'番茄炒蛋':'家常餐桌'),description:image.description,
  })),
  {id:'kitchen-table',src:tablePhoto,name:'一桌家常味',description:'阳光下的一桌家常饭'},
];

export function defaultDishPhoto(dish: Dish = {}) {
  // Names keep list/detail covers stable even when only the name is available.
  // Food categories deliberately do not select identifiable food photographs.
  const seed = dish.name?.trim() || String(dish.id ?? 'ai-kitchen');
  const hash = Array.from(seed).reduce((value,char)=>Math.imul(value^char.codePointAt(0)!,16777619)>>>0,2166136261);
  const image = abstractGallery.images[hash % abstractGallery.images.length];
  return {src:photos['../resources/gallery/'+image?.src] || neutralPhoto, description:image?.description || '抽象餐桌意象，不代表具体菜品'};
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
