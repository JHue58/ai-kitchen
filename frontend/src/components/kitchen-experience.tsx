import type {ReactNode} from 'react';
import {useId,useEffect,useLayoutEffect,useRef,useState} from 'react';
import {Link} from 'react-router-dom';
import {BookOpen,Check,Clock,Utensils,Sparkles} from 'lucide-react';

const lastSelection=new Map<string,boolean>();
export function SectionSwitch({kind,single}:{kind:'inspiration'|'collection';single:boolean}){
 const inspiration=kind==='inspiration';
 const indicator=useRef<HTMLSpanElement>(null);
 useLayoutEffect(()=>{
  const previous=lastSelection.get(kind);lastSelection.set(kind,single);
  if(previous===undefined||previous===single||matchMedia('(prefers-reduced-motion: reduce)').matches)return;
  const animation=indicator.current?.animate([{transform:`translateX(${previous?100:0}%)`},{transform:`translateX(${single?100:0}%)`}],{duration:520,easing:'cubic-bezier(.22,1.35,.36,1)'});
  return()=>animation?.cancel();
 },[kind,single]);
 return <div className="section-switch" aria-label={inspiration?'准备哪种餐食':'食谱类型'}><span ref={indicator} className={'switch-indicator '+(single?'right':'')}/>{[[inspiration?'/':'/recipes',inspiration?'一桌菜单':'我的菜单',BookOpen],[inspiration?'/inspire-dish':'/dishes',inspiration?'一道好菜':'我的菜品',Utensils]].map(([to,label,Icon]:any,i)=><Link key={to} to={to} aria-current={single===(i===1)?'page':undefined}><Icon size={18}/>{label}</Link>)}</div>
}
type Event={status:string;message:string;detail?:string;at:string};
type Job={status:string;created_at:string;events?:Event[];search_calls?:number;fetch_calls?:number};
const stageCopy:Record<string,[string,string]>={
 pending:['我已经接到你的想法','我会按顺序开始准备，请稍等一会儿。'],
 analyzing:['我先听懂你的口味','食材、人数和厨房配置，我都在认真看。'],
 searching:['我在寻找一点好灵感','我会挑选适合你的做法，把这一餐搭配得更好。'],
 planning:['我在琢磨这一餐的搭配','口味、营养和下厨的顺序，我会一起照顾。'],
 search_web:['我在翻看一些好做法','我会看看真实的菜谱参考，再为你细心挑选。'],
 view_image:['我在挑选合适的配图','我会仔细看看，让菜品与照片相互对应。'],
 fetch_page:['我在读一份菜谱参考','我会留意食材用量和做法中的小细节。'],
 check_menu:['我在核对这一餐的细节','人数、预算和已有的炊具，我会再确认一遍。'],
 validating:['我在做最后的检查','我会核对用量、营养和时间，方便你安心下厨。'],
 repairing:['我正在调整几个小细节','我想把这一餐安排得更妥帖，再给我一点时间。'],
 saving:['我正把这一餐放进你的食谱','做法与清单都准备妥当，很快就能见面。'],
 completed:['我把这一餐准备好了','我把食材和做法都整理好了，一起开饭吧。'],
 failed:['这一次，我还没准备妥当','我记得你的想法，可以调整偏好后再试一次。'],
};
function readableActivity(text?:string){return (text||'').replace(/生成/g,'制作').replace(/\bAgent\b/gi,'我').replace(/AI 正在/g,'我正在');}
export function GenerationProgress({job,connecting,error}:{job?:Job;connecting:boolean;error?:string}){
 const [now,setNow]=useState(Date.now());
 const terminal=!!error||job?.status==='failed'||job?.status==='completed';
 const complete=job?.status==='completed';
 useEffect(()=>{if(terminal)return;const id=setInterval(()=>setNow(Date.now()),1000);return()=>clearInterval(id)},[terminal]);
 const events=job?.events||[];const latest=events.at(-1);
 const end=terminal&&latest?new Date(latest.at).getTime():now;
 const started=job?new Date(job.created_at).getTime():now;
 const elapsed=Number.isFinite(started)&&Number.isFinite(end)?Math.max(0,Math.floor((end-started)/1000)):0;
 const copy=error?['我暂时没能连接上厨房','我会保留这次任务，你可以稍后恢复连接。']:connecting?['我正在接过你的心意','我会从你的想法出发，为这一餐认真准备。']:stageCopy[job?.status||'pending']||['我在为这一餐忙碌','我会把接下来的每个细节都安排好。'];
 return <section className={'chef-progress '+(terminal?'settled':'working')+(complete?' is-complete':'')+(error||job?.status==='failed'?' is-error':'')} aria-label="AI 实时工作记录" aria-busy={!terminal}>
  <div className="ai-aurora" aria-hidden="true"><i/><i/><i/></div>
  <div className="chef-progress-body">
   <div className="chef-progress-heading"><div className="cooking-orb" aria-hidden="true"><span className="orb-halo"/><i/><i/><i/><span className="orb-core">{complete?<Check size={34}/>:<Sparkles size={34}/>}</span><span className="orb-satellite"/><span className="orb-satellite satellite-two"/></div><div className="chef-progress-copy"><span className="ai-live-label"><i/>{terminal?complete?'AI · 心意已送达':'AI · 我在这里':'AI · 正在为你忙碌'}</span><h3>{copy[0]}</h3><p role="status">{copy[1]}</p></div><div className="ai-elapsed"><strong>{Math.floor(elapsed/60).toString().padStart(2,'0')}<span>:</span>{(elapsed%60).toString().padStart(2,'0')}</strong><small>陪这一餐慢慢成形</small></div></div>
   <div className="ai-milestones" aria-label="任务阶段"><span className={job?'done':!terminal?'current':''}><i>{job?<Check size={12}/>:1}</i>我接过你的想法</span><b/><span className={complete?'done':job&&!terminal?'current':''}><i>{complete?<Check size={12}/>:2}</i>我来细心准备</span><b/><span className={complete?'done':''}><i>{complete?<Check size={12}/>:3}</i>我把好味端上桌</span></div>
   <div className="activity-current"><Sparkles size={15}/><span>{readableActivity(latest?.detail)||'我会把实际进展记在这里，你也可以先去看看厨房。'}</span>{!terminal&&<span className="ai-thinking-dots" aria-hidden="true"><i/><i/><i/></span>}</div>
   <details className="ai-activity-details"><summary>看看我在忙什么 <span>{events.length} 条真实进展</span></summary><ol className="activity-log">{events.map((event,i)=><li key={i} className={i===events.length-1&&!terminal?'current':''}><span className="event-marker">{i===events.length-1&&!terminal?<span className="spinner"/>:event.status==='failed'?'!':<Check size={13}/>}</span><div><strong>{readableActivity(event.message)}</strong>{event.detail&&<p>{readableActivity(event.detail)}</p>}<time dateTime={event.at}>{new Date(event.at).toLocaleTimeString('zh-CN',{hour12:false})}</time></div></li>)}</ol>{!events.length&&<p className="activity-empty">我接到任务后，真实的准备过程会出现在这里。</p>}</details>
   <div className="activity-footer"><span><Clock size={13}/>我会继续忙，刷新也能接着看</span><span>参考搜索 {job?.search_calls||0} · 已读网页 {job?.fetch_calls||0}</span></div>
  </div>
 </section>
}

function CountPicker({initial,min,max,name,unit,label}:{initial:number;min:number;max:number;name:string;unit:string;label:string}) {
 const [value,setValue]=useState(Math.min(max,Math.max(min,Number.isFinite(initial)?initial:min)));
 return <div className="servings-picker"><button type="button" aria-label={'减少'+label} disabled={value<=min} onClick={()=>setValue(value-1)}>−</button><output key={value} className="count-value" aria-live="polite">{value===0?'AI 搭配':<>{value} <span>{unit}</span></>}</output><input type="hidden" name={name} value={value}/><button type="button" aria-label={'增加'+label} disabled={value>=max} onClick={()=>setValue(value+1)}>+</button></div>;
}
export function ServingsPicker({initial=2}:{initial:number}) {
 return <CountPicker initial={initial} min={1} max={10} name="servings" unit="人" label="用餐人数"/>;
}
export function DishCountPicker({initial=0}:{initial:number}) {
 return <CountPicker initial={initial} min={0} max={6} name="dish_count" unit="道菜" label="菜品数量"/>;
}
export function StepText({text}:{text?:string}) {
 if(!text)return <p className="muted">步骤说明尚未提供，请确认完整内容后再烹饪。</p>;
 const paragraphs=text.split(/\n+/).flatMap(line=>line.length>80?line.split(/(?<=[。！？])/).filter(Boolean):[line]);
 return <div className="step-copy">{paragraphs.map((line,i)=><p key={i}>{line.split(/(\d+(?:\.\d+)?(?:[～~—-]\d+)?\s*(?:分钟|秒钟|秒|小时|℃|°C))/g).map((part,j)=>j%2?<strong key={j}>{part}</strong>:part)}</p>)}</div>;
}

export function AnimatedPreferences({children}:{children:ReactNode}) {
 const [open,setOpen]=useState(false);const id=useId();
 return <section className={'optional-settings '+(open?'expanded':'')}><button className="preferences-toggle" type="button" aria-expanded={open} aria-controls={id} onClick={()=>setOpen(!open)}><Sparkles size={18}/> 更多偏好 <span aria-hidden="true">{open?'−':'＋'}</span></button><div id={id} className="preferences-reveal" inert={!open}><div><div className="preferences-content">{children}</div></div></div></section>;
}
