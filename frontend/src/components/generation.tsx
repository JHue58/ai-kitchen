import {createContext,useContext,useEffect,useState,type ReactNode} from 'react';
import {Link,useNavigate,useParams,useLocation} from 'react-router-dom';
import {useQuery,useQueryClient} from '@tanstack/react-query';
import {api,type Doc} from '../api';
import {GenerationProgress} from './kitchen-experience';
import {Button} from './ui/button';

const submissions=new Map<string,{request:any;promise:Promise<any>}>();
export function beginGeneration(request:any){
 const key='new-'+crypto.randomUUID();
 const promise=api('/generate','POST',request);
 // Keep the rejection handled even if the user leaves before the route mounts.
 void promise.catch(()=>{});submissions.set(key,{request,promise});return key;
}
const labels=['菜品概览','统计信息','食材清单','烹饪步骤','营养分析','参考来源','购物清单'];
type State='pending'|'loading'|'completed'|'error';
const RevealContext=createContext<{states:State[];single:boolean}|null>(null);
export function Reveal({index,children}:{index:number;children:ReactNode}){
 const context=useContext(RevealContext);if(!context)return <>{children}</>;
 const state=context.states[index];
 return <div className={'reveal-section reveal-'+index+' is-'+state} data-section={index} data-state={state} aria-busy={state==='pending'||state==='loading'}>
 {state==='completed'?<div className="revealed-content">{children}</div>:<section id={["overview","statistics",context.single?"ingredients":"ingredients-0",context.single?"dish-steps":"steps-0","analysis","sources","shopping-preview"][index]} className="card section-skeleton" aria-label={labels[index]}><header><h2>{labels[index]}</h2><small>{state==='error'?'暂未生成':state==='loading'?'正在整理':'等待结果'}</small></header><div className="skeleton-shapes" aria-hidden="true">{index===0&&<div className="skeleton-photo"/>}{Array.from({length:index===3?6:4},(_,i)=><div className="skeleton-line" key={i}/>)}</div>{state==='error'&&<p className="hint">恢复任务后将在这里显示内容。</p>}</section>}
 </div>
}
export function GenerationPage({render}:{render:(recipe:Doc,single:boolean)=>ReactNode}){
 const {id=''}=useParams();const route=useLocation();const nav=useNavigate(),client=useQueryClient();const submission=submissions.get(id);
 const start=useQuery({queryKey:['generation-submit',id],queryFn:()=>submission!.promise,enabled:!!submission,retry:false,staleTime:Infinity,gcTime:Infinity,refetchOnMount:false});
 useEffect(()=>{if(start.data?.id)nav('/generating/'+start.data.id,{replace:true,state:{single:submission?.request.target==='dish'}})},[start.data,nav]);
 const job=useQuery({queryKey:['job',id],queryFn:()=>api('/jobs/'+id),enabled:!id.startsWith('new-'),refetchInterval:q=>['completed','failed'].includes(q.state.data?.status)?false:1500});
 const kind=job.data?.result_kind==='dishes'?'dishes':'recipes';const single=kind==='dishes'||submission?.request.target==='dish'||route.state?.single===true;
 const result=useQuery({queryKey:['generation-result',id,kind],queryFn:async()=>{
  const docs=await api<Doc[]>('/documents/'+kind);const found=docs.find(d=>d.id===job.data.recipe_id);
  if(!found)throw new Error('生成已结束，但暂时无法读取菜谱。请重新读取结果。');
  if(kind==='recipes'&&(!Array.isArray(found.dishes)||!found.dishes.length))throw new Error('返回的菜单缺少菜品，请返回表单重新生成。');
  const cleanDish=(d:any)=>({...d,ingredients:Array.isArray(d.ingredients)?d.ingredients.filter(Boolean):[],steps:Array.isArray(d.steps)?d.steps.filter(Boolean):[]});
  const clean={...cleanDish(found),...(kind==='recipes'?{dishes:found.dishes.filter(Boolean).map(cleanDish)}:{})};
  client.invalidateQueries({queryKey:['docs',kind]});return clean;
 },enabled:job.data?.status==='completed',retry:false});
 const error=start.error?.message||job.error?.message||result.error?.message||(job.data?.status==='failed'?(job.data.error||'生成未完成，请调整偏好后重试。'):'')||(id.startsWith('new-')&&!submission?'提交记录已过期，请返回表单；已提交的任务会自动恢复。':'');
 const ready=!!result.data;const [revealed,setRevealed]=useState(0);
 useEffect(()=>{setRevealed(0);if(!ready)return;const media=matchMedia('(prefers-reduced-motion: reduce)');if(media.matches){setRevealed(7);return}
  const timers=labels.map((_,i)=>setTimeout(()=>setRevealed(previous=>Math.max(previous,i+1)),100+i*380));const reduce=()=>{if(media.matches){timers.forEach(clearTimeout);setRevealed(7)}};media.addEventListener('change',reduce);return()=>{timers.forEach(clearTimeout);media.removeEventListener('change',reduce)};
 },[ready,id]);
 const states:State[]=labels.map((_,i)=>i<revealed?'completed':error?'error':ready&&i===revealed||!ready&&i===0?'loading':'pending');
 const placeholder={id:0,dishes:[{name:'',ingredients:[],steps:[]}],ingredients:[],steps:[]};
 return <div className={'generation-page '+(!ready?'awaiting-result':'has-result')}>
 <div className="generation-heading"><div><span className="eyebrow">A LITTLE INSPIRATION, TAKING SHAPE</span><h1>{error?'灵感暂时停了一下':revealed===7?'你的美味，准备好了':ready?'美味，逐一呈现':'正在构思你的下一餐'}</h1><p role="status">{error?'已保留当前任务，可重试读取或返回调整。':ready?(revealed===7?'所有板块已呈现，可以开始准备了。':'AI 已返回完整结果，正在依次呈现各个板块。'):'AI 正在生成完整菜谱，下方为内容占位，并非生成进度。'}</p></div>{ready&&revealed<7&&<Button variant="secondary" onClick={()=>setRevealed(7)}>立即查看全部</Button>}</div>
 {error?<div className="notice" role="alert">{error}<div className="actions"><Button variant="secondary" onClick={()=>{if(result.isError)void result.refetch();else if(!id.startsWith('new-'))void job.refetch();else nav(single?'/inspire-dish':'/')}}>重试 / 恢复</Button><Link to={single?'/inspire-dish':'/'}>返回调整偏好 →</Link></div></div>:!ready&&<GenerationProgress job={job.data} connecting={!job.data}/>}
 <RevealContext.Provider value={{states,single}}>{render(result.data||placeholder,single)}</RevealContext.Provider>
 {revealed===7&&<Link className="btn secondary" to={'/'+kind+'/'+result.data.id}>打开已保存的{single?'菜品':'菜单'} →</Link>}
 </div>
}
