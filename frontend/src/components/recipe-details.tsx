import {useEffect,useMemo,useState} from 'react';
import {useQuery,useQueryClient} from '@tanstack/react-query';
import {BookOpen,ExternalLink,ShoppingBasket,Flame,Zap,ShieldCheck,ArrowLeftRight,Sparkles,Wheat,Fish,Droplets,Check,ArrowUpRight} from 'lucide-react';
import {api} from '../api';
import {Button} from './ui/button';
import {StepText} from './kitchen-experience';
import {defaultDishPhoto,tablePhoto} from '../resources';
import {ResourceIcon} from './kitchen-icon';
import {ColorStatCards} from './color-stat-cards';
import '../recipe-redesign.css';
import '../dish-insights.css';

const safe=(url?:string)=>!!url&&/^https?:\/\//i.test(url);
function useDishImage(dish:any) {
 const [failedUrl,setFailedUrl]=useState<string>();
 const [failedLocal,setFailedLocal]=useState<string>();
 const photo=safe(dish.image?.url)&&failedUrl!==dish.image.url?dish.image:null;
 const fallback=defaultDishPhoto(dish);
 const src=photo?.url||(failedLocal===fallback.src?tablePhoto:fallback.src);
 return {photo,fallback,props:{src,alt:photo?dish.name+' · 近似参考图':(dish.name||'菜品')+' · 默认示意图',referrerPolicy:'no-referrer' as const,
  onError:()=>{if(photo)setFailedUrl(photo.url);else setFailedLocal(fallback.src)},
  onLoad:(e:React.SyntheticEvent<HTMLImageElement>)=>{if(photo&&(e.currentTarget.naturalWidth<480||e.currentTarget.naturalHeight<320))setFailedUrl(photo.url)}}};
}
export function DishImage({dish}:{dish:any}){const {props}=useDishImage(dish);return <img {...props} loading="lazy"/>}
export function ImageProgress({status}:{status?:string}){
 return status==='pending'?<p className="image-progress" role="status"><Sparkles size={16}/><span>菜谱已经准备好，我还在为你挑选合适的参考图。<small>现在就可以开始烹饪，图片会自动补上。</small></span></p>:status==='timed_out'?<p className="hint">我保留了已找到的参考图，其余先用灵感示意图陪你开饭。</p>:null;
}
export function DishPhoto({dish}:{dish:any}){
 const {photo,props}=useDishImage(dish);
 return <figure className="dish-photo"><img {...props}/><figcaption>{photo?<a href={safe(photo.source_url)?photo.source_url:undefined} target="_blank" rel="noreferrer">{dish.name} · 参考图 <ArrowUpRight size={12}/><small>{photo.credit} {photo.license}</small></a>:<span>餐桌灵感 <i/>默认示意图</span>}</figcaption></figure>;
}
export function MenuPhoto({dishes:input}:{dishes?:any[]}){
 const dishes=input||[];
 return <div className={'menu-mosaic '+(dishes.length>1?'multiple':'')}>{(dishes.length?dishes:[{}]).map((dish,i)=><DishPhoto key={i} dish={dish}/>)}</div>;
}
export function ReadingNav({activeDish=0,single=false,shared=false}:{activeDish?:number;single?:boolean;shared?:boolean}){
 const items=useMemo(()=>[['overview','美味概览'],[single?'ingredients':`ingredients-${activeDish}`,'食材准备'],[single?'dish-steps':`steps-${activeDish}`,'烹饪步骤'],['analysis','营养分析'],['sources','参考来源'],...shared?[]:[['shopping-preview','购物清单']]],[activeDish,single,shared]);
 const [active,setActive]=useState('overview');
 useEffect(()=>{
  let pending=0;
  const update=()=>{pending=0;let id=items[0][0];for(const [key] of items){const el=document.getElementById(key);if(el&&el.getBoundingClientRect().top<=180)id=key}if(innerHeight+scrollY>=document.documentElement.scrollHeight-4)id=items.at(-1)![0];setActive(id)};
  const scroll=()=>{if(!pending)pending=requestAnimationFrame(update)};
  update();window.addEventListener('scroll',scroll,{passive:true});
  return()=>{window.removeEventListener('scroll',scroll);cancelAnimationFrame(pending)};
 },[items]);
 return <nav className="reading-nav" aria-label="菜谱章节">{items.map(([id,label],i)=><a key={id} href={'#'+id} aria-current={active===id?'location':undefined}><span className="reading-number">{String(i+1).padStart(2,'0')}</span>{label}</a>)}</nav>;
}
function FullText({text}:{text:string}){
 if(!text)return <p className="muted">本次没有额外的搭配说明。</p>;
 return text.length>300?<><p className="analysis-intro">{text.slice(0,180)}…</p><details><summary>继续阅读我的建议</summary><div className="full-ai-text" tabIndex={0}><p>{text}</p></div></details></>:<p className="full-ai-text">{text}</p>;
}
type IngredientCategory='main'|'supporting'|'seasoning'|'uncategorized';
const ingredientCategories:{key:IngredientCategory;label:string;note:string}[]=[
 {key:'main',label:'主要食材',note:'这一道的主角'},
 {key:'supporting',label:'配料',note:'添一点层次'},
 {key:'seasoning',label:'调料',note:'把味道调好'},
 {key:'uncategorized',label:'其他食材',note:'历史食材尚未分类'},
];
function ingredientCategory(category?:string):IngredientCategory{
 if(category==='main'||category==='主料'||category==='主要食材')return 'main';
 if(category==='supporting'||category==='配料'||category==='辅料')return 'supporting';
 if(category==='seasoning'||category==='调料'||category==='调味料')return 'seasoning';
 return 'uncategorized';
}
const estimate=(value:unknown,digits=2)=>value==null||!Number.isFinite(Number(value))?'—':Number(value).toFixed(digits);
export function IngredientGroups({ingredients=[],showCosts=false}:{ingredients?:any[];showCosts?:boolean}){
 const rows=(Array.isArray(ingredients)?ingredients:[]).filter(Boolean);
 if(!rows.length)return <p className="hint">食材清单尚未提供，请补全后再烹饪。</p>;
 return <div className="ingredient-groups">{ingredientCategories.map(group=>{
  const items=rows.filter(i=>ingredientCategory(i.category)===group.key);
  if(!items.length)return null;
  return <section className={'ingredient-group ingredient-group-'+group.key} key={group.key} aria-label={group.label}>
   <header><div><h4>{group.label}</h4><small>{group.note}</small></div><span>{items.length} 样</span></header>
   {items.map((i,n)=><div className="ingredient-line" key={n}><span><ResourceIcon name={i.name} kind="ingredient" size={22}/>{i.name}{showCosts&&<small>{i.is_pantry?'制作时库存已有':'制作时需采购'} · {i.cost_source==='personal'?'个人价格':i.cost_source==='unknown'?'价格未知':'AI 估价'}</small>}</span><span>{i.quantity??'适量'} {i.unit}{showCosts&&<small>{i.cost==null?'—':'¥'+estimate(i.cost)}</small>}</span></div>)}
  </section>;
 })}</div>;
}
function EnergyEstimate({recipe:r,shared=false,single=false}:{recipe:any;shared?:boolean;single?:boolean}){
 const equipment=useQuery({queryKey:['docs','equipment'],queryFn:()=>api('/documents/equipment'),enabled:!shared});
 const usage=Array.isArray(r.energy_usage)?r.energy_usage.filter(Boolean):[];
 const unknown=usage.some((u:any)=>u.theoretical_kwh==null||!Number.isFinite(Number(u.theoretical_kwh)));
 const known=usage.some((u:any)=>u.theoretical_kwh!=null&&Number.isFinite(Number(u.theoretical_kwh)));
 return <div className="card energy-analysis"><h3><Zap size={18}/>{single?'这道菜的电费预估':'整桌电费预估'}</h3>
  <div className="energy-total"><span>{unknown&&known?'已知部分理论电费':'满功率理论电费'}</span><strong className={unknown&&!known?'energy-unknown':undefined}>{unknown&&!known?'功率待确认':r.theoretical_energy_cost==null?'—':'¥'+estimate(r.theoretical_energy_cost)}<small>{unknown?'未知功率未计入':single?'本菜合计':'菜单合计'}</small></strong></div>
  {usage.length?usage.map((u:any,i:number)=><div className="energy-row" key={i}><span>{equipment.data?.find((e:any)=>e.id===u.equipment_id)?.name||'设备 #'+u.equipment_id}<small>计划加热 {u.heating_minutes??'—'} 分钟</small></span><strong>{estimate(u.theoretical_kwh,3)}<small>kWh · 理论{u.estimated_kwh!=null?' / 估算 '+estimate(u.estimated_kwh,3):''}</small></strong></div>):<p className="muted">{r.theoretical_energy_cost===0?'未记录电器耗电。':'这份历史菜谱暂无单独耗电记录。'}</p>}
  {!single&&r.purchase_cost!=null&&<p className="hint">本次需购食材消耗估算 ¥{estimate(r.purchase_cost)}，待购数量以当前库存为准。</p>}
  <details><summary>关于电费估算</summary><p className="hint">按设备功率、加热时长与制作时电价计算。未知功率不计入；实际耗电受加热周期影响。{!single&&'菜单合计汇总各菜品的用电。'}</p></details>
 </div>;
}
export function DishInsights({dish,shared=false}:{dish:any;shared?:boolean}){
 return <section className="dish-insights" aria-label={(dish.name||'本菜')+'的点评与电费'}>
  <div className="card analysis-copy"><div className="analysis-card-title"><span className="analysis-icon"><Sparkles size={19}/></span><div><small>A NOTE FOR THIS DISH</small><h3>菜品点评</h3></div></div><FullText text={dish.ai_commentary||dish.description||''}/></div>
  <EnergyEstimate recipe={dish} shared={shared} single/>
 </section>;
}
export function NutritionRibbon({recipe:r}:{recipe:any}){
 return <ColorStatCards className="nutrition-ribbon" label="整份营养估算" items={[
  {id:'calories',label:'热量',unit:'kcal',icon:Flame,tone:'lime' as const},
  {id:'carbs',label:'碳水',unit:'g',icon:Wheat,tone:'butter' as const},
  {id:'protein',label:'蛋白质',unit:'g',icon:Fish,tone:'orange' as const},
  {id:'fat',label:'脂肪',unit:'g',icon:Droplets,tone:'stone' as const},
 ].map(item=>({...item,value:r.nutrition?.[item.id]==null||!Number.isFinite(Number(r.nutrition[item.id]))?'—':Math.round(Number(r.nutrition[item.id]))}))}/>;
}
export function Analysis({recipe:r,shared=false}:{recipe:any;shared?:boolean}){
 const menu=Array.isArray(r.dishes);
 const dishes=r.dishes||[r];
 const safety=dishes.flatMap((d:any)=>(d.steps||[]).filter((s:any)=>s.safety_note).map((s:any)=>d.name+' · '+s.safety_note));
 return <section id="analysis" className="analysis-section">
  <div className="detail-section-heading"><div><span className="detail-kicker">A LITTLE BALANCE</span><h2>{menu?'整桌搭配，心里有数':'这一道菜，心里有数'}</h2></div><span className="detail-subtitle">{menu?'整桌营养':'本菜营养'} · 参考估算</span></div>
  <NutritionRibbon recipe={r}/>
  <p className="nutrition-estimate-note hint">按整份用量估算，非每人份。个人数据优先，其次内置参考值与 AI 估算，未知项不计入。</p>
  <div className="analysis-grid">
   <div className="card analysis-copy"><div className="analysis-card-title"><span className="analysis-icon"><Sparkles size={20}/></span><div><small>YOUR AI COMPANION</small><h3>{menu?'整桌菜单点评':'菜品点评'}</h3></div></div><FullText text={r.ai_commentary||(!menu?r.description:'')||''}/>{r.tips?.length>0&&<details><summary>我的烹饪小贴士 · {r.tips.length} 条</summary>{r.tips.map((t:string,i:number)=><StepText key={i} text={t}/>)}</details>}</div>
   <EnergyEstimate recipe={r} shared={shared} single={!menu}/>
   <div className="card safety-analysis"><h3><ShieldCheck size={18}/>我为你留意的细节</h3>{safety.length?<><StepText text={safety[0]}/>{safety.length>1&&<details><summary>还有 {safety.length-1} 个小提醒</summary>{safety.slice(1).map((t:string,i:number)=><StepText key={i} text={t}/>)}</details>}</>:<p className="muted">请留意步骤中的火候与操作提醒。</p>}</div>
   {r.substitutions?.length>0&&<div className="card substitutions"><h3><ArrowLeftRight size={18}/>换一种食材，也很好</h3>{r.substitutions.map((t:string,i:number)=><FullText key={i} text={t}/>)}</div>}
  </div>
 </section>;
}
type TokenUsage = {model:string;input_tokens:number;output_tokens:number;total_tokens:number;calls:number;missing_calls:number};
function GenerationUsage({usage:u}:{usage?:TokenUsage}) {
 if(!u)return null;
 const known=u.calls>u.missing_calls,format=(n:number)=>n.toLocaleString('zh-CN');
 return <details className="generation-usage hint"><summary>{known?'本次制作 · '+(u.missing_calls?'已知 ':'')+format(u.total_tokens)+' tokens':'本次制作 · token 用量未提供'}</summary><p>{u.model} · {u.calls} 次模型调用</p>{known&&<p>输入 {format(u.input_tokens)} · 输出 {format(u.output_tokens)} tokens</p>}<p>{u.missing_calls?u.missing_calls+' 次调用未返回完整用量，实际消耗可能更高。':'包含本次规划、图片检查和修正中实际发生的模型调用。'}费用请按服务商的输入、输出及缓存计价核算；不含搜索等其他服务费用。</p></details>;
}
export function Sources({sources:input,usage}:{sources?:any[];usage?:TokenUsage}){
 const sources=input||[];const [open,setOpen]=useState(false);
 const sorted=useMemo(()=>sources.map((s,i)=>({...s,index:i})).sort((a,b)=>(b.rerank_score||0)-(a.rerank_score||0)),[sources]);
 return <section id="sources" className="card mt sources"><div className="detail-section-heading"><div><span className="detail-kicker">GOOD FOOD, GOOD SOURCES</span><h2>美味，也有迹可循</h2></div><span className="source-count">{sources.length} 份参考</span></div>{sorted.slice(0,open?undefined:4).map((s,n)=>{let host='原始来源';try{host=new URL(s.url).hostname}catch{}return <div className="source-row" key={s.index}><span className="source-number">{String(n+1).padStart(2,'0')}</span><div><small>{s.site_name||host}{s.date?' · '+s.date:''}</small><a href={safe(s.url)?s.url:undefined} target="_blank" rel="noreferrer">{s.title||s.url}<ExternalLink size={13}/></a>{(s.summary||s.snippet||s.content)&&<details><summary>看看参考内容</summary>{[s.summary,s.snippet,s.content].filter(Boolean).map((t,i)=><StepText key={i} text={t}/>)}</details>}</div></div>})}{!sources.length&&<p className="muted">这一餐没有额外的联网参考。</p>}{sources.length>4&&<Button variant="secondary" aria-expanded={open} onClick={()=>setOpen(!open)}>{open?'收起参考':`查看全部 ${sources.length} 份参考`}</Button>}<GenerationUsage usage={usage}/></section>;
}

// Same unit normalization and shopping document API as the existing shopping flow.
export function shoppingPreview(dishes:any[],pantry:any[],prices:any[]){const normalize=(q:number,u:string)=>({quantity:q*(u==='kg'||u==='L'?1000:1),unit:u==='kg'?'g':u==='L'?'ml':u});const merged=new Map<string,any>();for(const d of dishes)for(const i of d.ingredients||[]){const n=normalize(Number(i.quantity),i.unit);const key=i.name+'|'+n.unit;const old=merged.get(key);merged.set(key,{key,name:i.name,...n,quantity:n.quantity+(old?.quantity||0)})}return [...merged.values()].map(i=>{let available=0,uncertain=false;for(const p of pantry.filter(p=>p.name===i.name)){const n=normalize(Number(p.quantity),p.unit);if(p.quantity==null||n.unit!==i.unit)uncertain=true;else available+=n.quantity}const missing=Math.max(0,i.quantity-available);const price=prices.find(p=>p.name===i.name&&p.price!=null&&normalize(1,p.unit).unit===i.unit);const cost=price?missing*price.price/normalize(1,price.unit).quantity:null;return {...i,available,missing,uncertain,cost}})}
export function ShoppingPreview({recipe:r}:{recipe:any}){
 const pantry=useQuery({queryKey:['docs','pantry'],queryFn:()=>api('/documents/pantry')});const prices=useQuery({queryKey:['docs','prices'],queryFn:()=>api('/documents/prices')});const client=useQueryClient();
 const [excluded,setExcluded]=useState<string[]>([]),[busy,setBusy]=useState(false),[message,setMessage]=useState('');
 const rows=shoppingPreview(r.dishes||[r],pantry.data||[],prices.data||[]);const missing=rows.filter(i=>i.missing>0),selected=missing.filter(i=>!excluded.includes(i.key));const known=selected.filter(i=>i.cost!=null);
 return <section id="shopping-preview" className="card mt shopping-preview"><div className="detail-section-heading"><div><span className="detail-kicker">READY FOR THE TABLE</span><h2>把新鲜，带回家</h2></div><span className="shopping-heading-icon"><ShoppingBasket size={22}/></span></div><p className="hint">我会先核对你的库存，再把需要的食材放在这里。</p>{pantry.isPending?<p role="status">我正在核对库存…</p>:pantry.isError?<p role="alert">库存读取失败，请重试。<button onClick={()=>pantry.refetch()}>重新加载</button></p>:<><div className="shopping-preview-heading"><h3>需要添购</h3><span>{missing.length} 样食材</span></div>{missing.length?missing.map(i=><label className={'shopping-preview-row '+(excluded.includes(i.key)?'is-excluded':'')} key={i.key}><input type="checkbox" checked={!excluded.includes(i.key)} onChange={e=>setExcluded(e.target.checked?excluded.filter(k=>k!==i.key):[...excluded,i.key])}/><span className="shopping-food"><ResourceIcon name={i.name} kind="ingredient" size={28}/><span>{i.name}<small>{i.uncertain?'库存数量或单位待确认，暂按未扣减部分采购':i.available>0?`库存已抵扣 ${i.available} ${i.unit}`:'库存未记录'}</small></span></span><strong>{Number(i.missing.toFixed(3))}<small>{i.unit}</small></strong></label>):<div className="shopping-all-ready"><Check size={20}/><p>食材已经齐全，随时可以开饭。</p></div>}<details><summary>看看库存已备齐的食材 · {rows.filter(i=>i.missing===0).length} 样</summary>{rows.filter(i=>i.missing===0).map(i=><p key={i.key}>{i.name} · 需要 {i.quantity} {i.unit}，已有 {i.available} {i.unit}</p>)}</details><div className="shopping-preview-footer"><p className="hint">{known.length?`已选食材${known.length<selected.length?'已知部分':''}预计 ¥${known.reduce((s,i)=>s+i.cost,0).toFixed(2)}（个人价格，按用量）`:'暂无可靠采购价格'}{selected.length>known.length?` · ${selected.length-known.length} 样价格未知`:''}</p><Button disabled={busy||!selected.length} onClick={async()=>{setBusy(true);setMessage('');try{await api('/documents/shopping','POST',{name:r.title||r.name,items:selected.map(i=>({name:i.name,quantity:Number(i.missing.toFixed(3)),unit:i.unit,checked:false}))});await client.invalidateQueries({queryKey:['docs','shopping']});setMessage('已经放进购物清单，带上它去挑选新鲜吧。');setExcluded(rows.map(i=>i.key))}catch(e){setMessage((e as Error).message)}finally{setBusy(false)}}}>{busy?'我正在整理…':'放进购物清单'}<ArrowUpRight size={16}/></Button></div></>}{message&&<p role="status" className="shopping-preview-message">{message}</p>}<a className="shopping-view-link" href="/shopping">查看我的购物清单 <ArrowUpRight size={14}/></a></section>;
}
