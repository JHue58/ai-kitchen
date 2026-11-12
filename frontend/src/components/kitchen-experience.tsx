import type {ReactNode} from 'react';
import {useId,useEffect,useLayoutEffect,useRef,useState} from 'react';
import {Link} from 'react-router-dom';
import {BookOpen,Check,ChefHat,Clock,Utensils,Sparkles} from 'lucide-react';

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
 return <div className="section-switch" aria-label={inspiration?'生成类型':'食谱类型'}><span ref={indicator} className={'switch-indicator '+(single?'right':'')}/>{[[inspiration?'/':'/recipes',inspiration?'一桌菜单':'我的菜单',BookOpen],[inspiration?'/inspire-dish':'/dishes',inspiration?'一道好菜':'我的菜品',Utensils]].map(([to,label,Icon]:any,i)=><Link key={to} to={to} aria-current={single===(i===1)?'page':undefined}><Icon size={18}/>{label}</Link>)}</div>
}
type Event={status:string;message:string;detail?:string;at:string};
type Job={status:string;created_at:string;events?:Event[];search_calls?:number;fetch_calls?:number};
export function GenerationProgress({job,connecting,error}:{job?:Job;connecting:boolean;error?:string}){
 const [now,setNow]=useState(Date.now());
 const terminal=job?.status==='failed'||job?.status==='completed';
 useEffect(()=>{if(terminal)return;const id=setInterval(()=>setNow(Date.now()),1000);return()=>clearInterval(id)},[terminal]);
 const events=job?.events||[];const latest=events.at(-1);
 const end=terminal&&latest?new Date(latest.at).getTime():now;
 const elapsed=job?Math.max(0,Math.floor((end-new Date(job.created_at).getTime())/1000)):0;
 return <section className={'chef-progress '+(terminal?'settled':'working')} aria-label="AI 实时工作记录">
  <div className="chef-progress-heading"><div className="cooking-orb" aria-hidden="true"><i/><i/><i/><ChefHat size={29}/></div><div><span className="eyebrow">YOUR CHEF IS AT WORK</span><h3>{error?'暂时无法连接任务':job?.status==='failed'?'这次烹饪灵感遇到了问题':job?.status==='completed'?'美味准备好了':connecting?'正在连接你的主厨':'好饭，值得一点等待'}</h3><p role="status">{latest?.message||'正在获取服务器任务状态'} · {elapsed} 秒</p></div></div>
  <div className="activity-current" aria-hidden="true"><Sparkles size={16}/>{latest?.detail||'将口味、食材和厨房条件，认真搭配在一起。'}</div>
  <details><summary>查看实际工作记录 <span>{events.length} 条</span></summary><ol className="activity-log">{events.map((event,i)=><li key={i} className={i===events.length-1&&!terminal?'current':''}><span className="event-marker">{i===events.length-1&&!terminal?<span className="spinner"/>:event.status==='failed'?'!':<Check size={13}/>}</span><div><strong>{event.message}</strong>{event.detail&&<p>{event.detail}</p>}<time dateTime={event.at}>{new Date(event.at).toLocaleTimeString('zh-CN',{hour12:false})}</time></div></li>)}</ol></details>
  <div className="activity-footer"><span><Clock size={13}/> 刷新后可继续查看</span><span>搜索 {job?.search_calls||0} · 网页 {job?.fetch_calls||0}</span></div>
 </section>
}

export function ServingsPicker({initial=2}:{initial:number}) {
 const [value,setValue]=useState(Math.min(10,Math.max(1,initial)));
 return <div className="servings-picker"><button type="button" aria-label="减少用餐人数" disabled={value<=1} onClick={()=>setValue(value-1)}>−</button><output aria-live="polite">{value} <span>人</span></output><input type="hidden" name="servings" value={value}/><button type="button" aria-label="增加用餐人数" disabled={value>=10} onClick={()=>setValue(value+1)}>+</button></div>
}
export function StepText({text}:{text?:string}) {
 if(!text)return <p className="muted">步骤说明尚未提供，请确认完整内容后再烹饪。</p>;
 const paragraphs=text.split(/\n+/).flatMap(line=>line.length>80?line.split(/(?<=[。！？])/).filter(Boolean):[line]);
 return <div className="step-copy">{paragraphs.map((line,i)=><p key={i}>{line.split(/(\d+(?:\.\d+)?(?:[～~—-]\d+)?\s*(?:分钟|秒钟|秒|小时|℃|°C))/g).map((part,j)=>j%2?<strong key={j}>{part}</strong>:part)}</p>)}</div>;
}

export function AnimatedPreferences({children}:{children:ReactNode}) {
 const [open,setOpen]=useState(false);const id=useId();
 return <section className={'optional-settings '+(open?'expanded':'')}><button className="preferences-toggle" type="button" aria-expanded={open} aria-controls={id} onClick={()=>setOpen(!open)}><Sparkles size={18}/> 更多偏好 <small>时间、预算、炊具与口味 · 可选</small><span aria-hidden="true">{open?'−':'＋'}</span></button><div id={id} className="preferences-reveal" inert={!open}><div><div className="preferences-content">{children}</div></div></div></section>;
}
