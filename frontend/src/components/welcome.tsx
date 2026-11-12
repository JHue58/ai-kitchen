import {useEffect,useRef,useState} from 'react';
import {ArrowLeft,ArrowRight,Leaf,Sun,Moon,Sunrise,Sparkles,ChefHat} from 'lucide-react';
import {KitchenLogo} from './kitchen-brand';
import chickenPhoto from '../../resources/gallery/images/meat-braises/shiitake-braised-chicken.webp';
import tofuPhoto from '../../resources/gallery/images/vegetables-eggs-tofu/homestyle-tofu.webp';
import noodlePhoto from '../../resources/gallery/images/noodles-staples/scallion-oil-noodles.webp';
import '../welcome-redesign.css';

const stories=[
 {name:'把平常，过得有滋有味',title:'今天这顿，',accent:'交给我想。',note:'告诉我冰箱里有什么，或是此刻想吃什么。\n我陪你把一点小灵感，做成一顿好饭。',theme:'fresh',photo:chickenPhoto,dish:'香菇烧鸡',caption:'一碗热饭，一份熟悉的家常味',tag:'家常好味',english:'A LITTLE TASTE OF HOME'},
 {name:'让餐桌，长出一点新鲜',title:'把新鲜，',accent:'装进日常。',note:'当季的蔬菜，喜欢的口味，恰好的分量。\n我会记住你的小偏爱，让每一餐都合心意。',theme:'seasonal',photo:tofuPhoto,dish:'家常豆腐',caption:'食材简单，日子也可以很丰盛',tag:'新鲜上桌',english:'SOMETHING FRESH, EVERY DAY'},
 {name:'再忙，也值得好好吃饭',title:'忙碌先放下，',accent:'开饭了。',note:'不用为下一餐反复纠结。\n我来安排，你只管享受厨房里的好时光。',theme:'evening',photo:noodlePhoto,dish:'葱油拌面',caption:'为自己，留一碗热腾腾的满足',tag:'轻松下厨',english:'YOUR MOMENT TO SLOW DOWN'},
];
export function greeting(date=new Date()) {
 const hour=date.getHours();
 return hour<5?{salute:'夜深了，我还为你留着灯',meal:'我陪你准备一份轻盈的夜宵',Icon:Moon}:hour<11?{salute:'早安，今天也要好好吃饭',meal:'我陪你从一顿暖暖的早餐开始',Icon:Sunrise}:hour<14?{salute:'午安，给忙碌按下暂停',meal:'我来为午餐找一点新灵感',Icon:Sun}:hour<17?{salute:'下午好，偷得一刻闲',meal:'我陪你提前想想今晚的好味道',Icon:Sun}:hour<22?{salute:'晚上好，欢迎回家',meal:'我陪你准备一顿温暖的晚餐',Icon:Moon}:{salute:'夜深了，给自己一点温柔',meal:'我陪你准备一份轻盈的夜宵',Icon:Moon};
}
let chosen:number|undefined;
function chooseStory(){
 if(chosen!==undefined)return chosen;
 let previous=-1;try{previous=Number(localStorage.getItem('kitchen-welcome-story')??-1)}catch{}
 const choices=stories.map((_,i)=>i).filter(i=>i!==previous);
 chosen=choices[Math.floor(Math.random()*choices.length)];
 return chosen;
}
export function DailyHeading(){const {salute,meal}=greeting();return <><span className="eyebrow">{salute}</span><h1 tabIndex={-1}>今天，想吃点什么？</h1><p>{meal}。挑好人数和口味，剩下的交给我。</p></>}

export function Welcome({onEnter}:{onEnter:()=>void}) {
 const [index,setIndex]=useState(chooseStory);const story=stories[index];
 const [leaving,setLeaving]=useState(false);const panel=useRef<HTMLElement>(null);
 const timer=useRef<ReturnType<typeof setTimeout>|undefined>(undefined),finished=useRef(false);
 const {salute,Icon}=greeting();const date=new Date();
 const finish=()=>{if(finished.current)return;finished.current=true;onEnter()};
 const enter=()=>{if(leaving)return;setLeaving(true);timer.current=setTimeout(finish,matchMedia('(prefers-reduced-motion: reduce)').matches?0:650)};
 const enterRef=useRef(enter);enterRef.current=enter;
 useEffect(()=>{chosen=index;try{localStorage.setItem('kitchen-welcome-story',String(index))}catch{}},[index]);
 useEffect(()=>{
  const previous=document.activeElement as HTMLElement|null;const overflow=document.body.style.overflow;document.body.style.overflow='hidden';
  panel.current?.querySelector<HTMLButtonElement>('.welcome-enter')?.focus({preventScroll:true});
  const keys=(e:KeyboardEvent)=>{
   if(e.key==='Escape'){e.preventDefault();enterRef.current()}
   if(e.key==='ArrowRight'||e.key==='ArrowLeft'){e.preventDefault();setIndex(i=>(i+(e.key==='ArrowRight'?1:stories.length-1))%stories.length)}
   if(e.key==='Tab'){const buttons=panel.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)');if(!buttons?.length)return;const first=buttons[0],last=buttons[buttons.length-1];if(e.shiftKey&&document.activeElement===first){e.preventDefault();last.focus()}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus()}}
  };
  document.addEventListener('keydown',keys);return()=>{clearTimeout(timer.current);document.body.style.overflow=overflow;document.removeEventListener('keydown',keys);previous?.focus({preventScroll:true})};
 },[]);
 return <section ref={panel} className={'welcome-page entry-page entry-'+story.theme+(leaving?' is-leaving':'')} role="dialog" aria-modal="true" aria-labelledby="welcome-title" onTransitionEnd={e=>{if(leaving&&e.target===e.currentTarget&&e.propertyName==='opacity'){clearTimeout(timer.current);finish()}}}>
  <div className="entry-backdrop" aria-hidden="true"><i/><i/></div>
  <header className="entry-header"><div className="entry-brand"><KitchenLogo size={43}/><span>AI Kitchen<small>好好吃饭，好好生活</small></span></div><span className="entry-date">{date.toLocaleDateString('zh-CN',{month:'long',day:'numeric',weekday:'long'})}</span><button onClick={enter} className="entry-skip">进入厨房 <ArrowRight size={16}/></button></header>
  <div className="entry-layout">
   <div className="entry-copy" key={'copy-'+index}>
    <span className="entry-salute"><Icon size={16}/>{salute}</span>
    <div className="entry-kicker"><span/>你的私人 AI 厨房伙伴</div>
    <h1 id="welcome-title">{story.title}<br/><em>{story.accent}</em></h1>
    <p>{story.note}</p>
    <button className="entry-enter welcome-enter" onClick={enter}>一起准备好吃的 <span><ArrowRight size={20}/></span></button>
    <div className="entry-ai-note"><span className="entry-mini-orb"><Sparkles size={14}/></span><span>我在这里，陪你好好吃饭。</span></div>
   </div>
   <div className="entry-art" key={'art-'+index}>
    <div className="entry-image-wrap"><img src={story.photo} alt={story.dish+'的家常餐桌灵感示意图'} className="entry-photo"/><div className="entry-photo-shade"/>
     <div className="entry-photo-label"><span><Leaf size={13}/>{story.tag}</span><strong>{story.dish}</strong><p>{story.caption}</p></div>
     <div className="entry-image-count" aria-hidden="true">0{index+1}<span>/ 03</span></div>
    </div>
    <div className="entry-float-card"><div className="entry-float-icon"><ChefHat size={24}/></div><div><span>从食材到上桌</span><strong>我都为你想好了 <Sparkles size={13}/></strong></div></div>
    <div className="entry-photo-sticker" aria-hidden="true"><Sparkles size={22}/><span>MADE<br/>FOR YOU</span></div>
    <span className="entry-art-note">{story.english}</span>
   </div>
  </div>
  <footer className="entry-footer"><span className="entry-footer-note">{story.name}<small>每一餐，都是好好生活的开始。</small></span><div className="entry-scenes" role="group" aria-label="选择进入页场景"><button className="entry-arrow" onClick={()=>setIndex(i=>(i+stories.length-1)%stories.length)} aria-label="上一个进入页场景"><ArrowLeft size={16}/></button><div className="entry-dots">{stories.map((s,i)=><button key={s.theme} aria-label={'查看场景：'+s.name} aria-pressed={index===i} className={index===i?'is-active':''} onClick={()=>setIndex(i)}/>)}</div><button className="entry-arrow" onClick={()=>setIndex(i=>(i+1)%stories.length)} aria-label="下一个进入页场景"><ArrowRight size={16}/></button></div><span className="entry-edition">A LITTLE JOY, EVERY DAY</span></footer>
 </section>
}
