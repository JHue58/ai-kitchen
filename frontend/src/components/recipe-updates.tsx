import {Children,cloneElement,createContext,isValidElement,useCallback,useContext,useEffect,useRef,useState,type ReactElement,type ReactNode,type Ref} from 'react';
import type {Doc} from '../api';
import '../recipe-updates.css';

export type RecipeSection='overview'|'statistics'|'ingredients'|'steps'|'analysis'|'sources'|'shopping'|'tags'|'dish-overview'|'dish-analysis';
export type RecipeUpdate={before:Doc;after:Doc;revision:string|number};
type Version=string;
const UpdatesContext=createContext<ReadonlyMap<string,Version>|null>(null);
const sectionKey=(section:RecipeSection,dishIndex?:number)=>section+':'+(dishIndex??'root');
const fields=(value:any,names:string[])=>Object.fromEntries(names.map(name=>[name,value?.[name]??null]));

// Ignore JSON object key order, document metadata and image-enrichment status.
// Only a successful chat edit supplies an update to the provider.
function canonical(value:any):string{
 if(Array.isArray(value))return '['+value.map(canonical).join(',')+']';
 if(value&&typeof value==='object')return '{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+canonical(value[key])).join(',')+'}';
 return JSON.stringify(value??null);
}
function dishOverview(dish:any){return fields(dish,['name','description','tags','prep_minutes','cook_minutes','cost','nutrition','image'])}
function dishAnalysis(dish:any){return fields(dish,['ai_commentary','description','energy_usage','theoretical_kwh','theoretical_energy_cost'])}
function shopping(dishes:any[]){
 // ShoppingPreview merges ingredients and normalizes kg/L before inventory
 // deduction. Moving an unchanged total between dishes must not flash it.
 const totals=new Map<string,{name:string;quantity:number;unit:string}>();
 for(const dish of dishes)for(const ingredient of dish?.ingredients||[]){
  const unit=ingredient.unit==='kg'?'g':ingredient.unit==='L'?'ml':ingredient.unit;
  const quantity=Number(ingredient.quantity)*(ingredient.unit==='kg'||ingredient.unit==='L'?1000:1);
  const key=ingredient.name+'|'+unit;
  totals.set(key,{name:ingredient.name,unit,quantity:quantity+(totals.get(key)?.quantity||0)});
 }
 return [...totals.values()];
}

/** Keys identify the rendered blocks that actually changed, including derived totals. */
export function changedRecipeSections(before:Doc,after:Doc):Set<string>{
 const changed=new Set<string>();
 const single=!Array.isArray(after.dishes);
 const oldDishes=Array.isArray(before.dishes)?before.dishes:[before];
 const newDishes=single?[after]:after.dishes;
 const compare=(section:RecipeSection,oldValue:any,newValue:any,dishIndex?:number)=>{
  if(canonical(oldValue)!==canonical(newValue))changed.add(sectionKey(section,dishIndex));
 };
 compare('overview',single?fields(before,['name','description','image']):{...fields(before,['title','summary']),dishes:oldDishes.map((dish:any)=>fields(dish,['name','image']))},single?fields(after,['name','description','image']):{...fields(after,['title','summary']),dishes:newDishes.map((dish:any)=>fields(dish,['name','image']))});
 compare('statistics',fields(before,single?['servings','prep_minutes','cook_minutes','cost']:['servings','total_elapsed_minutes','total_cost']),fields(after,single?['servings','prep_minutes','cook_minutes','cost']:['servings','total_elapsed_minutes','total_cost']));
 const analysis=(recipe:Doc,dishes:any[])=>({...fields(recipe,['nutrition','ai_commentary','description','tips','substitutions','energy_usage','theoretical_kwh','theoretical_energy_cost','purchase_cost']),safety:dishes.flatMap(dish=>(dish?.steps||[]).filter((step:any)=>step.safety_note).map((step:any)=>[dish.name,step.safety_note]))});
 compare('analysis',analysis(before,oldDishes),analysis(after,newDishes));
 compare('tags',before.tags||[],after.tags||[]);
 compare('sources',before.sources||[],after.sources||[]);
 compare('shopping',shopping(oldDishes),shopping(newDishes));
 for(let index=0;index<Math.max(oldDishes.length,newDishes.length);index++){
  const previous=oldDishes[index],next=newDishes[index];
  const dishIndex=single?undefined:index;
  compare('ingredients',previous?.ingredients||[],next?.ingredients||[],dishIndex);
  compare('steps',previous?.steps||[],next?.steps||[],dishIndex);
  compare('dish-overview',dishOverview(previous),dishOverview(next),dishIndex);
  compare('dish-analysis',dishAnalysis(previous),dishAnalysis(next),dishIndex);
 }
 return changed;
}

export function RecipeUpdatesProvider({update,children}:{update?:RecipeUpdate|null;children:ReactNode}){
 const [versions,setVersions]=useState<ReadonlyMap<string,Version>>(()=>new Map());
 const previous=useRef<{identity:string;version:Version}|null>(null);
 useEffect(()=>{
  if(!update)return;
  const identity=(Array.isArray(update.after.dishes)?'recipes:':'dishes:')+update.after.id;
  const version=identity+':'+typeof update.revision+':'+update.revision;
  if(previous.current?.version===version)return;
  const sameRecipe=previous.current?.identity===identity;
  previous.current={identity,version};
  const changed=changedRecipeSections(update.before,update.after);
  // Retain unviewed changes when another edit happens before a hidden dish is opened.
  setVersions(current=>{
   const next=new Map(sameRecipe?current:[]);
   changed.forEach(key=>next.set(key,version));
   return next;
  });
 },[update]);
 return <UpdatesContext.Provider value={versions}>{children}</UpdatesContext.Provider>;
}

function setRef(ref:Ref<HTMLElement>|undefined,node:HTMLElement|null){
 if(typeof ref==='function')ref(node);
 else if(ref)ref.current=node;
}

/** Adds no box around a single DOM child, preserving existing grids and form state. */
export function AIUpdateSection({section,dishIndex,children}:{section:RecipeSection;dishIndex?:number;children:ReactNode}){
 const versions=useContext(UpdatesContext);
 const key=sectionKey(section,dishIndex),version=versions?.get(key);
 const [node,setNode]=useState<HTMLElement|null>(null);
 const played=useRef<Version|undefined>(undefined);
 const only=Children.count(children)===1&&isValidElement(children)?children as ReactElement<{ref?:Ref<HTMLElement>}>:null;
 const direct=!!only&&typeof only.type==='string';
 const existingRef=direct?only?.props.ref:undefined;
 const attach=useCallback((element:HTMLElement|null)=>{setNode(element);setRef(existingRef,element)},[existingRef]);

 useEffect(()=>{
  if(!node||!version||played.current===version)return;
  const targets=direct?[node]:Array.from(node.children).filter((child):child is HTMLElement=>child instanceof HTMLElement);
  if(!targets.length)return;
  let timer:ReturnType<typeof setTimeout>|undefined;
  let running=false,completed=false;
  const decorations:HTMLElement[]=[];
  const motion=matchMedia('(prefers-reduced-motion: reduce)');
  // Freeze an in-flight effect immediately. Keep it static if the preference
  // is toggled back before cleanup, rather than restarting a sweep midway.
  const preference=()=>{if(motion.matches)decorations.forEach(decoration=>decoration.classList.add('ai-update-reduced'))};
  const cleanupTargets=()=>{
   motion.removeEventListener('change',preference);
   decorations.forEach(decoration=>decoration.remove());
   targets.forEach(target=>{target.classList.remove('ai-update-target','ai-update-positioned');target.removeAttribute('data-ai-updated');target.style.removeProperty('--ai-update-radius')});
  };
  const start=()=>{
   if(running)return;
   running=true;played.current=version;
   observer?.disconnect();
   targets.forEach(target=>{
    const style=getComputedStyle(target);
    if(style.position==='static')target.classList.add('ai-update-positioned');
    target.style.setProperty('--ai-update-radius',style.borderRadius==='0px'?'18px':style.borderRadius);
    target.classList.add('ai-update-target');target.setAttribute('data-ai-updated',key);
    const decoration=document.createElement('span');
    decoration.className='ai-update-decoration';decoration.setAttribute('aria-hidden','true');
    if(motion.matches)decoration.classList.add('ai-update-reduced');
    target.append(decoration);decorations.push(decoration);
   });
   timer=setTimeout(()=>{completed=true;cleanupTargets()},motion.matches?1250:1950);
  };
  // Hidden menu dishes and off-screen sections reveal their update when first seen.
  const observer=typeof IntersectionObserver==='undefined'?null:new IntersectionObserver(entries=>{
   if(entries.some(entry=>entry.isIntersecting&&entry.boundingClientRect.width>0&&entry.boundingClientRect.height>0))start();
  },{threshold:0});
  motion.addEventListener('change',preference);
  if(observer)targets.forEach(target=>observer.observe(target));else start();
  return()=>{
   observer?.disconnect();if(timer)clearTimeout(timer);cleanupTargets();
   // React StrictMode may clean up and re-run a newly mounted effect. Only a
   // completed decoration consumes the version permanently.
   if(running&&!completed&&played.current===version)played.current=undefined;
  };
 },[node,version,key,direct]);

 if(direct)return cloneElement(only!,{ref:attach});
 return <div ref={attach} className="ai-update-anchor">{children}</div>;
}
