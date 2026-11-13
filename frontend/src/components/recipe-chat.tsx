import {useEffect,useId,useLayoutEffect,useRef,useState} from 'react';
import {useQuery,useQueryClient} from '@tanstack/react-query';
import {ArrowUp,Check,ChefHat,CornerDownLeft,MessageCircle,RefreshCw,Sparkles} from 'lucide-react';
import {api,type Doc} from '../api';
import '../recipe-chat.css';

type Message={id:string;role:'user'|'assistant';content:string;created_at:string;changed_sections?:string[];request_id?:string};
type Chat={session_id:number;messages:Message[];busy:boolean;document?:Doc;changed_sections?:string[]};
export type RecipeChatProps={recipe:Doc;kind:'recipes'|'dishes';active:boolean;onRecipeChange?:(recipe:Doc,changedSections:string[])=>void;onBusyChange?:(busy:boolean)=>void};
const guidance=[
 ['觉得不合口味？','和我说，想更下饭一点，还是更清淡一点。'],
 ['喜欢的留下，想换的告诉我。','可以只换一道菜，也可以只调整一点调味。'],
 ['锅已经热了，还有点拿不准？','火候、顺序、怎么判断熟了，都可以问我。'],
 ['这一餐，按你的口味来。','太咸了、还想更香一点，直接和我说就好。'],
 ['冰箱里少了样食材？','告诉我手边有什么，我们一起换个做法。'],
 ['做饭的小疑问，不用攒着。','哪一步没看懂，我可以再讲得细一点。'],
 ['今天想吃得不一样？','少一点油、多一点辣，或是换掉不爱的食材。'],
 ['好吃，还可以更合你的心意。','从一撮盐到一道菜，我们一点点调到喜欢。'],
 ['菜谱是起点，口味由你决定。','想保留什么、只改什么，都可以明确告诉我。'],
 ['第一次做，也可以从容一点。','想知道提前准备什么，或怎么一起出锅？问我就好。'],
];
const chooseGuide=(previous=-1)=>previous<0?Math.floor(Math.random()*guidance.length):(previous+1+Math.floor(Math.random()*(guidance.length-1)))%guidance.length;

export function RecipeChat({recipe,kind,active,onRecipeChange,onBusyChange}:RecipeChatProps){
 const client=useQueryClient(),inputId=useId();
 const storageKey='recipe-chat-task:'+client.getQueryData<{user?:{id:number}}>(['me'])?.user?.id+':'+kind+':'+recipe.id;
 const [visit,setVisit]=useState(()=>{
  let saved:{id:string;message?:string;requestId?:string;at:number}|null=null;
  try{saved=JSON.parse(sessionStorage.getItem(storageKey)||'null');if(saved&&(typeof saved.id!=='string'||typeof saved.at!=='number'||Date.now()-saved.at>24*60*60*1000))saved=null}catch{}
  return {id:saved?.id||crypto.randomUUID(),controller:new AbortController(),restored:!!saved,attempt:saved?.message&&saved.requestId?{message:saved.message,requestId:saved.requestId}:null};
 });
 const rememberTask=(attempt=retryRequest.current)=>{try{sessionStorage.setItem(storageKey,JSON.stringify({id:visit.id,...attempt,at:Date.now()}))}catch{}};
 const forgetTask=()=>{try{if(JSON.parse(sessionStorage.getItem(storageKey)||'null')?.id===visit.id)sessionStorage.removeItem(storageKey)}catch{}};
 const endpoint='/documents/'+kind+'/'+recipe.id+'/chat?visit_id='+encodeURIComponent(visit.id),queryKey=['recipe-chat',kind,recipe.id,visit.id];
 const [draft,setDraft]=useState(''),[sending,setSending]=useState(false),[pending,setPending]=useState(''),[error,setError]=useState('');
 const [guide,setGuide]=useState(()=>chooseGuide()),[unread,setUnread]=useState(false);
 const input=useRef<HTMLTextAreaElement>(null),scroll=useRef<HTMLDivElement>(null),nearBottom=useRef(true),wasActive=useRef(false);
 const requestLock=useRef(false),mounted=useRef(true),mountEpoch=useRef(0),callback=useRef(onRecipeChange);callback.current=onRecipeChange;
 const retryRequest=useRef<{message:string;requestId:string}|null>(visit.attempt);
 const remoteBusy=useRef(visit.restored),preserveTask=useRef(visit.restored);
 const history=useQuery<Chat>({queryKey,queryFn:({signal})=>api(endpoint,'GET',undefined,{signal:AbortSignal.any([signal,visit.controller.signal])}),enabled:active,refetchInterval:q=>q.state.data?.busy?1800:false,gcTime:0});
 const messages=history.data?.messages||[],busy=sending||!!history.data?.busy;
 const visiblePending=pending||(busy&&retryRequest.current&&!messages.some(message=>message.role==='user'&&message.request_id===retryRequest.current?.requestId)?retryRequest.current.message:'');
 useEffect(()=>{
  mounted.current=true;const epoch=++mountEpoch.current;let closed=false;
  const close=()=>{
   if(closed)return;closed=true;
   // Save before aborting the browser request; the server owns the task.
   if(requestLock.current||preserveTask.current)rememberTask();else forgetTask();
   visit.controller.abort();
   void client.cancelQueries({queryKey});client.removeQueries({queryKey});
   // Idle visits are disposable; unfinished visits recover in this tab.
   if(!requestLock.current&&!preserveTask.current)void api(endpoint,'DELETE',undefined,{keepalive:true}).catch(()=>{});
  };
  const show=(event:PageTransitionEvent)=>{if(event.persisted){
   const retain=requestLock.current||preserveTask.current;
   setSending(false);setPending('');requestLock.current=false;remoteBusy.current=retain;
   if(!retain){setDraft('');setError('');retryRequest.current=null}
   setVisit(current=>({...current,id:retain?current.id:crypto.randomUUID(),controller:new AbortController()}));
  }};
  window.addEventListener('pagehide',close);window.addEventListener('beforeunload',close);window.addEventListener('pageshow',show);
  return()=>{
   mounted.current=false;window.removeEventListener('pagehide',close);window.removeEventListener('beforeunload',close);window.removeEventListener('pageshow',show);
   // React StrictMode probes effects without leaving the page; don't end that visit.
   queueMicrotask(()=>{if(mountEpoch.current===epoch)close()});
  };
 },[visit,endpoint,client]);
 useEffect(()=>{onBusyChange?.(busy);return()=>onBusyChange?.(false)},[busy,onBusyChange]);
 useEffect(()=>{
  const data=history.data;if(!data||sending)return;
  const finished=remoteBusy.current&&!data.busy;remoteBusy.current=data.busy;preserveTask.current=data.busy;
  if(data.busy)rememberTask();else if(!sending)forgetTask();
  const retry=retryRequest.current;
  const recovered=retry&&data.messages.find(message=>message.role==='assistant'&&message.request_id===retry.requestId);
  if(recovered&&retry){retryRequest.current=null;setError('');setDraft(current=>current.trim()===retry.message?'':current)}
  else if(finished&&!data.busy&&retry){setDraft(current=>current||retry.message);setError('上次请求未完成，你的消息已保留，可以重新发送。')}
  // Polling also follows a turn started in another tab or before a refresh.
  if(data.document&&(recovered||finished))callback.current?.(data.document,recovered?.changed_sections||data.changed_sections||[]);
 },[history.data,sending]);
 useEffect(()=>{if(active&&!wasActive.current){setGuide(current=>chooseGuide(current));nearBottom.current=true;setUnread(false)}wasActive.current=active},[active]);
 useLayoutEffect(()=>{if(input.current){input.current.style.height='auto';input.current.style.height=Math.min(input.current.scrollHeight,112)+'px'}},[draft,active]);
 useLayoutEffect(()=>{
  const el=scroll.current;if(!el||!active)return;
  if(nearBottom.current){el.scrollTop=el.scrollHeight;setUnread(false)}else setUnread(true);
 },[messages.length,pending,busy,active]);

 async function send(value=draft){
  const message=value.trim();if(!message||busy||requestLock.current||history.isPending||history.isError)return;
  const attempt=retryRequest.current?.message===message?retryRequest.current:{message,requestId:crypto.randomUUID()};
  retryRequest.current=attempt;rememberTask(attempt);preserveTask.current=true;
  requestLock.current=true;setSending(true);setPending(message);setDraft('');setError('');nearBottom.current=true;
  try{
   const result=await api<Chat>(endpoint,'POST',{message,request_id:attempt.requestId},{signal:visit.controller.signal});
   if(!mounted.current||visit.controller.signal.aborted)return;
   retryRequest.current=null;preserveTask.current=false;forgetTask();
   client.setQueryData(queryKey,result);
   if(result.document)callback.current?.(result.document,result.changed_sections||[]);
  }catch(reason){
   if(!mounted.current||visit.controller.signal.aborted)return;
   setError(reason instanceof Error?reason.message:'暂时没能发送，请再试一次。');setDraft(current=>current||message);
   // A lost response may follow a successful save. The persisted request ID lets
   // history reconcile it, and makes a same-message retry idempotent server-side.
   void client.invalidateQueries({queryKey});
  }finally{requestLock.current=false;if(mounted.current&&!visit.controller.signal.aborted){setSending(false);setPending('')}}
 }
 const single=kind==='dishes',title=single?recipe.name:recipe.title;
 const suggestions:Array<{label:string;message:string}>=(Array.isArray(history.data?.document?.chat_suggestions)?history.data.document.chat_suggestions:Array.isArray(recipe.chat_suggestions)?recipe.chat_suggestions:[])
  .filter((item:unknown):item is {label:string;message:string}=>!!item&&typeof (item as {label?:unknown}).label==='string'&&typeof (item as {message?:unknown}).message==='string'&&!!(item as {label:string}).label.trim()&&!!(item as {message:string}).message.trim()).slice(0,5);
 const suggestionChips=!!suggestions.length&&<div className="recipe-chat-suggestions" aria-label="试着这样问">{suggestions.map((item,index)=><button key={index+':'+item.label} type="button" disabled={busy} onClick={()=>{setDraft(item.message);input.current?.focus({preventScroll:true})}}>{item.label}<span aria-hidden="true">↗</span></button>)}</div>;
 return <section className="recipe-chat" aria-label="当前菜谱对话">
  <div className="recipe-chat-context"><span><ChefHat size={14}/><span>{title||'当前菜谱'}</span></span><small>{single?'围绕这一道，接着聊':'围绕这一餐，接着聊'}</small></div>
  <div ref={scroll} className="recipe-chat-scroll" onScroll={()=>{const el=scroll.current;if(el){nearBottom.current=el.scrollHeight-el.scrollTop-el.clientHeight<48;if(nearBottom.current)setUnread(false)}}}>
   {!messages.length&&!visiblePending&&<div className="recipe-chat-welcome">
    <span className="recipe-chat-orb" aria-hidden="true"><Sparkles size={25}/><i/><i/></span>
    <span className="recipe-chat-eyebrow">A LITTLE MORE TO YOUR TASTE</span>
    <h3>{single?'这一道，再调一调。':'这一餐，再调一调。'}</h3>
    <p>口味、食材或做法，都可以和我聊。</p>
    <div className="recipe-chat-guidance" key={guide}><MessageCircle size={16}/><div><strong>{guidance[guide][0]}</strong><p>{guidance[guide][1]}</p></div></div>
    {suggestionChips}
   </div>}
   {history.isPending&&<p className="recipe-chat-loading" role="status">正在打开这一餐的对话…</p>}
   {history.isError&&<div className="recipe-chat-error" role="alert"><p>{history.error.message||'暂时没能读取对话。'}</p><button type="button" onClick={()=>void history.refetch()}><RefreshCw size={13}/>重新读取</button></div>}
   <div className="recipe-chat-messages" role="log" aria-label="与 AI 的菜谱对话" aria-relevant="additions" aria-live={active?'polite':'off'}>{messages.map(message=><article className="recipe-chat-message" data-role={message.role} key={message.id}>
    <span className="recipe-chat-message-author">{message.role==='assistant'?<><Sparkles size={12}/>厨房伙伴</>:'我'}</span><p>{message.content}</p>
    {!!message.changed_sections?.length&&<small className="recipe-chat-updated"><Check size={12}/>已同步更新菜谱</small>}
   </article>)}
   {visiblePending&&<article className="recipe-chat-message" data-role="user"><span className="recipe-chat-message-author">我</span><p>{visiblePending}</p></article>}
   {busy&&<div className="recipe-chat-pending" role="status"><span aria-hidden="true"><i/><i/><i/></span><p>我在认真看你的想法<small>有调整时，会同步到菜谱里</small></p></div>}
   </div>
   {!!messages.length&&!busy&&suggestionChips}
  </div>
  {unread&&<button type="button" className="recipe-chat-latest" onClick={()=>{if(scroll.current)scroll.current.scrollTop=scroll.current.scrollHeight;nearBottom.current=true;setUnread(false)}}>查看新回复 ↓</button>}
  <form className="recipe-chat-composer" onSubmit={event=>{event.preventDefault();void send()}}>
   {error&&<div className="recipe-chat-error" role="alert"><p>{error}</p><span>你的消息已保留，可以编辑后重新发送。</span></div>}
   <label className="recipe-chat-input-label" htmlFor={inputId}>想怎么调整，或哪一步不清楚？</label>
   <div className="recipe-chat-input-wrap"><textarea id={inputId} ref={input} rows={1} maxLength={2000} value={draft} aria-label="对当前菜谱提问" placeholder="说说你的口味，或想弄清楚的步骤…" onChange={event=>setDraft(event.target.value)} onKeyDown={event=>{if(event.key==='Enter'&&!event.shiftKey&&!event.nativeEvent.isComposing&&event.nativeEvent.keyCode!==229){event.preventDefault();void send()}}}/><button className="recipe-chat-send" type="submit" aria-label="发送消息" disabled={!draft.trim()||busy||history.isPending||history.isError}><ArrowUp size={19}/></button></div>
   <div className="recipe-chat-composer-note"><span>{busy?'任务进行中 · 离开或刷新后可恢复':'修改自动保存 · 进行中的任务会保留'}</span><span><CornerDownLeft size={10}/>发送 · Shift + Enter 换行</span></div>
  </form>
 </section>;
}
