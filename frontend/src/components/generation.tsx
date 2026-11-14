import {createContext,useContext,useEffect,useLayoutEffect,useRef,useState,type ReactNode} from 'react';
import {Link,useNavigate,useParams,useLocation} from 'react-router-dom';
import {useQuery,useQueryClient} from '@tanstack/react-query';
import {api,type Doc} from '../api';
import {GenerationAssistant} from './generation-assistant';
import {RecipeConversation} from './recipe-conversation';
import {AIUpdateSection,type RecipeSection} from './recipe-updates';
import {Button} from './ui/button';
import {ArrowLeft,ArrowUpRight,Check,Sparkles} from 'lucide-react';
import '../generation-redesign.css';
import {generationIsEntering,landGeneration} from './generation-handoff';

const submissions=new Map<string,{request:any;promise:Promise<any>}>();
export function beginGeneration(request:any,storageKey?:string){
 const key='new-'+crypto.randomUUID();
 const promise=api('/generate','POST',request).then(result=>{
  if(storageKey)try{localStorage.removeItem(storageKey)}catch{}
  return result;
 });
 // Keep the rejection handled even if the user leaves before the route mounts.
 void promise.catch(()=>{});submissions.set(key,{request,promise});return key;
}
const labels=['菜品概览','统计信息','食材清单','烹饪步骤','营养分析','参考来源','购物清单'];
type State='pending'|'loading'|'completed'|'error';
const RevealContext=createContext<{states:State[];single:boolean}|null>(null);
export function Reveal({index,children,anchorId,dishIndex}:{index:number;children:ReactNode;anchorId?:string;dishIndex?:number}){
 const section:RecipeSection=anchorId?.startsWith('dish-insights-')?'dish-analysis':(['overview','statistics','ingredients','steps','analysis','sources','shopping'] as const)[index];
 const content=<AIUpdateSection section={section} dishIndex={dishIndex}>{children}</AIUpdateSection>;
 const context=useContext(RevealContext);if(!context)return <div className="reveal-section">{content}</div>;
 const state=context.states[index];
 return <div className={'reveal-section reveal-'+index+' is-'+state} data-section={index} data-state={state} aria-busy={state==='pending'||state==='loading'}>
 {state==='completed'?<div className="revealed-content">{content}</div>:<section id={anchorId||["overview","statistics",context.single?"ingredients":"ingredients-0",context.single?"dish-steps":"steps-0","analysis","sources","shopping-preview"][index]} className="card section-skeleton" aria-label={labels[index]}><header><h2>{labels[index]}</h2><small>{state==='error'?'我还需要再试一次':state==='loading'?'我正在细心整理':'我会依次端上来'}</small></header><div className="skeleton-shapes" aria-hidden="true">{index===0&&<div className="skeleton-photo"/>}{Array.from({length:index===3?6:4},(_,i)=><div className="skeleton-line" key={i}/>)}</div>{state==='error'&&<p className="hint">我会在恢复后，把这一部分继续补齐。</p>}</section>}
 </div>
}
export function GenerationPage({render}:{render:(recipe:Doc,single:boolean)=>ReactNode}){
 const contentRef=useRef<HTMLDivElement>(null),pageRef=useRef<HTMLDivElement>(null);
 const [entering,setEntering]=useState(generationIsEntering);
 useLayoutEffect(()=>{const finish=()=>setEntering(false);window.addEventListener('generation-entry-finished',finish);if(pageRef.current)landGeneration(pageRef.current);return()=>window.removeEventListener('generation-entry-finished',finish)},[]);
 const {id=''}=useParams();const route=useLocation();const nav=useNavigate(),client=useQueryClient();const submission=submissions.get(id);
 const start=useQuery({queryKey:['generation-submit',id],queryFn:()=>submission!.promise,enabled:!!submission,retry:false,staleTime:Infinity,gcTime:Infinity,refetchOnMount:false});
 useEffect(()=>{if(start.data?.id)nav('/generating/'+start.data.id,{replace:true,state:{...route.state,single:submission?.request.target==='dish',generationSession:route.state?.generationSession||id}})},[start.data,nav]);
 const job=useQuery({queryKey:['job',id],queryFn:()=>api('/jobs/'+id),enabled:!id.startsWith('new-'),refetchInterval:q=>['completed','failed'].includes(q.state.data?.status)?false:1500});
 const kind=job.data?.result_kind==='dishes'?'dishes':'recipes';const single=kind==='dishes'||submission?.request.target==='dish'||route.state?.single===true;
 const result=useQuery({queryKey:['generation-result',id,kind],queryFn:async()=>{
  const found=await api<Doc>('/documents/'+kind+'/'+job.data.recipe_id);
  if(!found)throw new Error('我已经准备好这一餐，但暂时没能打开菜谱。请再读取一次。');
  if(kind==='recipes'&&(!Array.isArray(found.dishes)||!found.dishes.length))throw new Error('我没能完整整理好菜品，请返回偏好，再让我试一次。');
  const cleanDish=(d:any)=>({...d,ingredients:Array.isArray(d.ingredients)?d.ingredients.filter(Boolean):[],steps:Array.isArray(d.steps)?d.steps.filter(Boolean):[]});
  const clean={...cleanDish(found),...(kind==='recipes'?{dishes:found.dishes.filter(Boolean).map(cleanDish)}:{})};
  client.invalidateQueries({queryKey:['docs',kind]});
  // A completed menu also contributes its individual dishes to the collection.
  if(kind==='recipes')client.invalidateQueries({queryKey:['docs','dishes']});
  return clean;
 },enabled:job.data?.status==='completed',retry:false,refetchInterval:q=>q.state.data?.image_status==='pending'?2000:false});
 const error=start.error?.message||job.error?.message||(!result.data?result.error?.message:'')||(job.data?.status==='failed'?(job.data.error||'我暂时没能完成这一餐，调整一下偏好，让我再试一次。'):'')||(id.startsWith('new-')&&!submission?'我没找到这次的提交记录，请返回偏好；已接到的任务会自动恢复。':'');
 const session=route.state?.generationSession||id;
 const ready=!!result.data;const [revealed,setRevealed]=useState(0);
 useEffect(()=>{setRevealed(0);if(!ready)return;const media=matchMedia('(prefers-reduced-motion: reduce)');if(media.matches){setRevealed(7);return}
  const timers=labels.map((_,i)=>setTimeout(()=>setRevealed(previous=>Math.max(previous,i+1)),100+i*380));const reduce=()=>{if(media.matches){timers.forEach(clearTimeout);setRevealed(7)}};media.addEventListener('change',reduce);return()=>{timers.forEach(clearTimeout);media.removeEventListener('change',reduce)};
 },[ready,session]);
 const states:State[]=labels.map((_,i)=>i<revealed?'completed':error?'error':ready&&i===revealed||!ready&&i===0?'loading':'pending');
 const placeholder={id:0,dishes:[{name:'',ingredients:[],steps:[]}],ingredients:[],steps:[]};
 return <div ref={pageRef} className={'generation-page '+(!ready?'awaiting-result':'has-result')+(error?' has-error':'')}>
 <div className="generation-heading"><div><Link className="generation-back" to={single?'/inspire-dish':'/'}><ArrowLeft size={15}/>回到灵感厨房</Link><span className="generation-kicker"><Sparkles size={14}/> YOUR PERSONAL AI CHEF</span><h1 tabIndex={-1}>{error?'这一餐，我还差一点。':ready?'我把这一餐准备好了。':'稍等会，我在为你认真准备。'}</h1><p>{error?'我记得你的想法，让我再尝试一下。':ready?'食材、做法与每一个细节，我都整理在这里。':'从你的口味到厨房里的小细节，我都会照顾好。'}</p></div>{ready&&revealed<7&&<Button variant="secondary" onClick={()=>setRevealed(7)}>查看完整菜谱<ArrowUpRight size={16}/></Button>}{ready&&revealed===7&&<span className="generation-done"><Check size={15}/>已经为你保存</span>}</div>
 {error&&<div className="notice" role="alert">{error.replace(/生成/g,'制作').replace(/\bAgent\b/gi,'我')}<div className="actions"><Button variant="secondary" onClick={()=>{if(job.data?.status==='failed')nav(single?'/inspire-dish':'/');else if(result.isError)void result.refetch();else if(!id.startsWith('new-'))void job.refetch();else nav(single?'/inspire-dish':'/')}}>{job.data?.status==='failed'?'调整偏好再试':'让我再试一次'}</Button><Link to={single?'/inspire-dish':'/'}>返回调整偏好 →</Link></div></div>}
 <RecipeConversation key={session} recipe={result.data||placeholder} kind={kind}>{onChange=><>
 {(job.data||!error)&&<GenerationAssistant key={session} job={job.data} connecting={!job.data} error={job.error?.message} completed={job.data?.status==='completed'&&!job.error&&!entering} contentRef={contentRef} recipe={result.data} kind={kind} onRecipeChange={onChange}/>}
 <div ref={contentRef} className="generation-results"><RevealContext.Provider value={{states,single}}>{render(result.data||placeholder,single)}</RevealContext.Provider></div>
 </>}</RecipeConversation>
 {ready&&revealed===7&&<Link className="btn secondary generation-saved-link" to={'/'+kind+'/'+result.data.id}>查看我为你保存的{single?'菜品':'菜单'}<ArrowUpRight size={17}/></Link>}
 </div>
}
