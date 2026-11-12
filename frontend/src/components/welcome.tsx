import {useEffect,useRef,useState} from 'react';
import {ArrowRight,Sun,Moon,Sunrise,Sparkles} from 'lucide-react';
import {KitchenLogo} from './kitchen-brand';

const stories=[
 {name:'一碗人间烟火',title:'把日子，\n煮成喜欢的样子。',note:'一餐一饭，是生活写给你的温柔。',theme:'hearth'},
 {name:'一席四季风物',title:'把新鲜，\n留给今天的自己。',note:'让当季的鲜，遇见你喜欢的味道。',theme:'garden'},
 {name:'一盏为你而留的灯',title:'回到这里，\n好好吃一顿饭。',note:'忙碌暂时放一放，厨房里有新的期待。',theme:'lamplight'},
];
const weekdays=['周日，慢下来，把时间留给喜欢的味道。','周一，新的开始，也要认真吃饭。','周二，平常的日子，也值得一顿好饭。','周三，走到半周，给自己加一道喜欢的菜。','周四，生活有点忙，饭要好好吃。','周五，用一桌好饭，迎接属于自己的时间。','周六，和喜欢的人，分享厨房的好时光。'];
export function greeting(date=new Date()) {
 const hour=date.getHours();
 return hour<5?{salute:'夜深了，厨房还为你留着灯',meal:'来一份轻盈的夜宵',Icon:Moon}:hour<11?{salute:'早安，新的一天慢慢来',meal:'从一顿暖暖的早餐开始',Icon:Sunrise}:hour<14?{salute:'午安，给忙碌按下暂停',meal:'为午餐找一点新灵感',Icon:Sun}:hour<17?{salute:'下午好，偷得一刻闲',meal:'提前想想今晚的好味道',Icon:Sun}:hour<22?{salute:'晚上好，欢迎回家',meal:'一起准备一顿温暖的晚餐',Icon:Moon}:{salute:'夜深了，给自己一点温柔',meal:'来一份轻盈的夜宵',Icon:Moon};
}
let chosen:number|undefined;
function chooseStory(){
 if(chosen!==undefined)return chosen;
 let previous=-1;try{previous=Number(localStorage.getItem('kitchen-welcome-story')??-1)}catch{}
 const choices=stories.map((_,i)=>i).filter(i=>i!==previous);
 chosen=choices[Math.floor(Math.random()*choices.length)];
 try{localStorage.setItem('kitchen-welcome-story',String(chosen))}catch{}
 return chosen;
}
export function DailyHeading(){const {salute,meal}=greeting();return <><span className="eyebrow">{salute}</span><h1 tabIndex={-1}>今天，想吃点什么？</h1><p>{meal}。选好方式和人数，剩下的交给 AI。</p></>}

export function Welcome({onEnter}:{onEnter:()=>void}) {
 const [story]=useState(()=>stories[chooseStory()]);const [leaving,setLeaving]=useState(false);
 const panel=useRef<HTMLElement>(null),timer=useRef<ReturnType<typeof setTimeout>|undefined>(undefined);
 const {salute,Icon}=greeting();const date=new Date();
 const enter=()=>{if(leaving)return;setLeaving(true);timer.current=setTimeout(onEnter,matchMedia('(prefers-reduced-motion: reduce)').matches?0:420)};
 const enterRef=useRef(enter);enterRef.current=enter;
 useEffect(()=>{
  const previous=document.activeElement as HTMLElement|null;const overflow=document.body.style.overflow;document.body.style.overflow='hidden';
  panel.current?.querySelector<HTMLButtonElement>('.welcome-enter')?.focus();
  const keys=(e:KeyboardEvent)=>{if(e.key==='Escape'){e.preventDefault();enterRef.current()}
   if(e.key==='Tab'){const buttons=panel.current?.querySelectorAll<HTMLButtonElement>('button');if(!buttons?.length)return;const first=buttons[0],last=buttons[buttons.length-1];if(e.shiftKey&&document.activeElement===first){e.preventDefault();last.focus()}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus()}}};
  document.addEventListener('keydown',keys);return()=>{clearTimeout(timer.current);document.body.style.overflow=overflow;document.removeEventListener('keydown',keys);previous?.focus()};
 },[]);
 return <section ref={panel} className={'welcome-page '+story.theme+(leaving?' is-leaving':'')} role="dialog" aria-modal="true" aria-labelledby="welcome-title">
  <header className="welcome-header"><div className="welcome-brand"><KitchenLogo/><span>AI Kitchen<small>好好吃饭 · 好好生活</small></span></div><span className="welcome-date">{date.toLocaleDateString('zh-CN',{month:'long',day:'numeric',weekday:'long'})}</span><button onClick={enter} className="welcome-skip">进入厨房 <ArrowRight size={15}/></button></header>
  <div className="welcome-layout"><div className="welcome-copy"><span className="welcome-salute"><Icon size={17}/>{salute}</span><h1 id="welcome-title">{story.title}</h1><p>{story.note}</p><div className="welcome-weekday">{weekdays[date.getDay()]}</div><button className="btn primary welcome-enter" onClick={enter}>开启今天的美味 <ArrowRight size={19}/></button><span className="welcome-companion"><Sparkles size={14}/>你的 AI 厨房伙伴，已在这里等你</span></div>
   <div className="welcome-art" aria-hidden="true"><div className="art-orbit"/><div className="art-halo"/><div className="table-shadow"/><div className="ceramic-plate"><div className="soup"><i className="herb herb-one"/><i className="herb herb-two"/><i className="herb herb-three"/><i className="oil oil-one"/><i className="oil oil-two"/></div></div><div className="steam steam-one"/><div className="steam steam-two"/><div className="steam steam-three"/><div className="table-linen"/><span className="art-caption">{story.name}<small>A LITTLE TASTE OF HOME</small></span></div>
  </div><footer className="welcome-footer"><span>每一餐，都是好好生活的开始。</span><span className="welcome-edition">{String(stories.indexOf(story)+1).padStart(2,'0')} / 03 · DAILY KITCHEN</span></footer>
 </section>
}
