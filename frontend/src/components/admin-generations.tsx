import {useId,useState} from 'react';
import {useQuery} from '@tanstack/react-query';
import {BookOpen,ChevronDown,ChevronLeft,ChevronRight,Clock,RefreshCw,Utensils,Users} from 'lucide-react';
import {api,type Doc} from '../api';
import {Button} from './ui/button';
import {DishImage} from './recipe-details';
import '../admin-generations.css';

type User={id:number;username:string;admin?:boolean};
type Generation=Doc&{kind:'recipes'|'dishes';generated_at?:string;created_at?:string;updated_at?:string};
type History={user:User;items:Generation[];total:number;limit:number;offset:number;has_more:boolean};
type Kind='all'|'recipes'|'dishes';
const filters:[Kind,string][]=[['all','全部'],['recipes','菜单'],['dishes','菜品']];
const rows=(value:unknown):any[]=>Array.isArray(value)?value.filter(Boolean):[];
function dateLabel(value?:string){
 if(!value)return '生成时间未记录';
 const date=new Date(value);if(!Number.isFinite(date.getTime()))return '生成时间未记录';
 return date.toLocaleString('zh-CN',{year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false});
}
function DishRecord({dish}:{dish:Doc}){
 const ingredients=rows(dish.ingredients),steps=rows(dish.steps);
 return <section className="admin-generation-dish">
  <header><h4>{dish.name||'未命名菜品'}</h4>{dish.description&&<p>{dish.description}</p>}</header>
  <div className="admin-generation-dish-grid">
   <section><h5>食材准备</h5>{ingredients.length?<ul className="admin-generation-ingredients">{ingredients.map((ingredient,index)=><li key={index}><span>{ingredient.name||'食材'}</span><span>{ingredient.quantity??'适量'} {ingredient.unit||''}</span></li>)}</ul>:<p className="hint">这份记录没有提供食材清单。</p>}</section>
   <section><h5>烹饪步骤</h5>{steps.length?<ol className="admin-generation-steps">{steps.map((step,index)=><li key={index}><span>{String(index+1).padStart(2,'0')}</span><div>{step.title&&<strong>{step.title}</strong>}<p>{step.description||step.instruction||'步骤说明未提供'}</p>{step.duration_minutes!=null&&<small>{step.duration_minutes} 分钟</small>}{step.safety_note&&<p className="admin-generation-safety">{step.safety_note}</p>}</div></li>)}</ol>:<p className="hint">这份记录没有提供烹饪步骤。</p>}</section>
  </div>
  {dish.ai_commentary&&<p className="admin-generation-comment">{dish.ai_commentary}</p>}
 </section>;
}
function GenerationRecord({item,open,onToggle}:{item:Generation;open:boolean;onToggle:()=>void}){
 const detailId=useId(),menu=item.kind==='recipes',dishes=menu?rows(item.dishes):[item];
 const title=menu?item.title:item.name;
 const minutes=menu?item.total_elapsed_minutes:(item.prep_minutes||0)+(item.cook_minutes||0);
 const date=item.generated_at||item.created_at;
 return <article className={'admin-generation-record'+(open?' is-open':'')}>
  <button type="button" className="admin-generation-summary" aria-expanded={open} aria-controls={detailId} onClick={onToggle}>
   <span className="admin-generation-photo"><DishImage dish={dishes[0]||{name:title}}/></span>
   <span className="admin-generation-copy"><span className="admin-generation-type">{menu?<BookOpen size={12}/>:<Utensils size={12}/>} {menu?'菜单':'菜品'}{item.saved&&<i>已保存</i>}{item.favorite&&<i>已收藏</i>}</span><strong>{title||'未命名的美味'}</strong><span className="admin-generation-meta"><time dateTime={date}>{dateLabel(date)}</time><span>{item.servings!=null&&<><Users size={12}/>{item.servings} 人</>}{minutes>0&&<><Clock size={12}/>{minutes} 分钟</>}</span></span></span>
   <span className="admin-generation-disclosure"><span>{open?'收起':'查看'}</span><ChevronDown size={17}/></span>
  </button>
  <div id={detailId} className="admin-generation-reveal" aria-hidden={!open} inert={!open}>
   <div><div className="admin-generation-content">
    {menu&&item.summary&&<p className="admin-generation-intro">{item.summary}</p>}
    {rows(item.tags).length>0&&<div className="admin-generation-tags">{rows(item.tags).map((tag,index)=><span key={index}>{String(tag)}</span>)}</div>}
    {rows(item.warnings).length>0&&<div className="notice">{rows(item.warnings).map((warning,index)=><p key={index}>{String(warning)}</p>)}</div>}
    {dishes.length?dishes.map((dish,index)=><DishRecord key={index} dish={dish}/>):<p className="hint">这份历史菜单没有提供菜品详情。</p>}
   </div></div>
  </div>
 </article>;
}
function UserGenerations({user}:{user:User}){
 const [kind,setKind]=useState<Kind>('all'),[offset,setOffset]=useState(0),[expanded,setExpanded]=useState<string|null>(null);
 const limit=12;
 const query=useQuery<History>({queryKey:['admin','generations',user.id,kind,offset],queryFn:({signal})=>api(`/admin/users/${user.id}/generations?kind=${kind}&limit=${limit}&offset=${offset}`,'GET',undefined,{signal}),staleTime:15000});
 const total=query.data?.total||0,items=query.data?.items||[];
 return <>
  <div className="admin-generation-toolbar"><div className="admin-generation-filters" role="group" aria-label="生成记录类型">{filters.map(([value,label])=><button type="button" key={value} aria-pressed={kind===value} onClick={()=>{setKind(value);setOffset(0);setExpanded(null)}}>{label}</button>)}</div><button type="button" className="admin-generation-refresh" aria-label="刷新生成记录" disabled={query.isFetching} onClick={()=>void query.refetch()}><RefreshCw size={14}/><span>{query.isFetching?'更新中':'刷新'}</span></button></div>
  <div className="admin-generation-results" aria-busy={query.isFetching}>
   {query.isPending?<div className="admin-generation-empty" role="status"><BookOpen size={24}/><p>正在整理 {user.username} 的最近美味…</p></div>:query.isError?<div className="notice" role="alert"><p>{query.error.message}</p><Button variant="secondary" onClick={()=>void query.refetch()}>重新加载</Button></div>:<>
    <p className="admin-generation-count" role="status">{user.username} · {total} {kind==='recipes'?'份菜单':kind==='dishes'?'道菜品':'条记录'}<span>按最近生成排序</span></p>
    {!items.length?<div className="admin-generation-empty"><Utensils size={26}/><h3>这一页，等待新的美味</h3><p>{offset?'没有更多生成记录了。':'这位用户还没有'+(kind==='recipes'?'生成菜单':kind==='dishes'?'生成菜品':'生成记录')+'。'}</p></div>:items.map(item=>{const key=item.kind+':'+item.id;return <GenerationRecord key={key} item={item} open={expanded===key} onToggle={()=>setExpanded(expanded===key?null:key)}/>})}
    {(total>limit||offset>0)&&<nav className="admin-generation-pagination" aria-label="生成记录分页"><Button variant="secondary" disabled={offset===0||query.isFetching} onClick={()=>{setOffset(Math.max(0,offset-limit));setExpanded(null)}}><ChevronLeft size={15}/>上一页</Button><span>第 {Math.floor(offset/limit)+1} / {Math.max(1,Math.ceil(total/limit))} 页</span><Button variant="secondary" disabled={!query.data?.has_more||query.isFetching} onClick={()=>{setOffset(offset+limit);setExpanded(null)}}>下一页<ChevronRight size={15}/></Button></nav>}
   </>}
  </div>
 </>;
}
export function AdminGenerations({users}:{users:User[]}){
 const [selected,setSelected]=useState<number|null>(null);
 const user=users.find(user=>user.id===selected)||users[0];
 return <section className="card mt admin-generations" aria-labelledby="admin-generations-title">
  <div className="admin-generations-heading"><div><span className="eyebrow">FROM EVERY KITCHEN</span><h2 id="admin-generations-title">每个人最近的美味</h2><p>看看最近制作的菜单与菜品，展开即可阅读食材和做法。</p></div><span className="admin-generations-mark"><BookOpen size={23}/></span></div>
  <label className="field admin-generation-user"><span>查看用户</span><select aria-label="查看用户的生成记录" value={user?.id||''} disabled={!users.length} onChange={event=>setSelected(Number(event.target.value))}>{users.length?users.map(user=><option key={user.id} value={user.id}>{user.username}{user.admin?' · 管理员':''}</option>):<option value="">暂无用户</option>}</select></label>
  {user?<UserGenerations key={user.id} user={user}/>:<p className="hint">加载用户后，即可查看每个人的生成记录。</p>}
 </section>;
}
