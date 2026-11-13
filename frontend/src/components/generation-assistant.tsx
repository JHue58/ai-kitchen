import {useEffect,useId,useLayoutEffect,useRef,useState,type ComponentProps,type RefObject} from 'react';
import {createPortal} from 'react-dom';
import {Check,ChevronDown,Sparkles} from 'lucide-react';
import {GenerationProgress} from './kitchen-experience';
import {RecipeChat} from './recipe-chat';
import {type Doc} from '../api';
import '../generation-assistant.css';

type Mode='inline'|'docked'|'expanded';
type Props=ComponentProps<typeof GenerationProgress>&{completed:boolean;contentRef:RefObject<HTMLDivElement|null>;recipe?:Doc;kind?:'recipes'|'dishes';initialDocked?:boolean;onRecipeChange?:(recipe:Doc,changedSections:string[])=>void};
const reducedMotion=()=>matchMedia('(prefers-reduced-motion: reduce)').matches;

// A damped spring keeps position and scale on the same continuous trajectory.
// Sampling the physical curve also works in browsers without CSS linear().
function springFrames(from:DOMRect,to:DOMRect,counterScale=false):Keyframe[]{
 const dx=from.left-to.left,dy=from.top-to.top;
 const sx=from.width/to.width,sy=from.height/to.height;
 return Array.from({length:61},(_,index)=>{
  const t=index/60*.86;
  const progress=index===60?1:1-Math.exp(-12*t)*(Math.cos(9.8*t)+12/9.8*Math.sin(9.8*t));
  const arc=Math.sin(Math.PI*Math.min(1,Math.max(0,progress)))*Math.min(28,Math.hypot(dx,dy)*.04);
  const scaleX=sx+(1-sx)*progress,scaleY=sy+(1-sy)*progress;
  return {offset:index/60,transform:counterScale?`scale(${1/scaleX},${1/scaleY})`:`translate3d(${dx*(1-progress)}px,${dy*(1-progress)-arc}px,0) scale(${scaleX},${scaleY})`};
 });
}

export function GenerationAssistant({completed,contentRef,recipe,kind='recipes',initialDocked=false,onRecipeChange,...progress}:Props){
 const recordId=useId();
 const [mode,setMode]=useState<Mode>(initialDocked?'docked':'inline');
 const [view,setView]=useState<'chat'|'record'>('chat'),[chatBusy,setChatBusy]=useState(false);
 const slot=useRef<HTMLDivElement>(null),inline=useRef<HTMLDivElement>(null),floating=useRef<HTMLDivElement>(null);
 const capsule=useRef<HTMLButtonElement>(null),close=useRef<HTMLButtonElement>(null);
 const detail=useRef<HTMLDivElement>(null),capsuleCopy=useRef<HTMLButtonElement>(null);
 const previous=useRef<{rect:DOMRect;visible:boolean;contentTop?:number;snapshot?:HTMLElement;mode:Mode;focus:boolean}|null>(null);
 const snapshot=useRef<HTMLElement|null>(null);
 const animations=useRef<Animation[]>([]);
 const currentMode=useRef(mode);currentMode.current=mode;

 function fitViewport(){
  const viewport=window.visualViewport;if(!viewport||!floating.current)return;
  const panel=floating.current,keyboardOffset=Math.max(0,window.innerHeight-viewport.height-viewport.offsetTop);
  panel.style.setProperty('--assistant-viewport-height',viewport.height+'px');
  panel.style.setProperty('--assistant-keyboard-offset',keyboardOffset+'px');
  panel.toggleAttribute('data-compact',viewport.height<500);
  panel.toggleAttribute('data-keyboard',keyboardOffset>100);
  // Measure the visible chrome rather than guessing at a fixed header height.
  // The composer stays inside the visual viewport even above a tall keyboard.
  panel.style.setProperty('--assistant-viewport-bottom',Math.max(12,parseFloat(getComputedStyle(panel).bottom)-keyboardOffset)+'px');
  const chrome=Array.from(panel.querySelectorAll<HTMLElement>('.generation-assistant-tools,.generation-assistant-tabs')).reduce((height,element)=>height+element.offsetHeight,24);
  panel.style.setProperty('--assistant-chrome-height',chrome+'px');
 }

 function finishMotion(){
  animations.current.forEach(animation=>animation.cancel());animations.current=[];
  floating.current?.classList.remove('is-morphing','is-from-inline');
  snapshot.current?.remove();snapshot.current=null;
  for(const content of [detail.current,capsuleCopy.current])if(content){content.style.width='';content.style.height='';content.style.transformOrigin=''}
 }
 function move(next:Mode,focus=true){
  if(currentMode.current===next)return;
  const source=currentMode.current==='inline'?inline.current:floating.current;
  if(source){
   const rect=source.getBoundingClientRect(),viewport=window.visualViewport;
   const top=viewport?.offsetTop||0,bottom=top+(viewport?.height||innerHeight);
   const visible=rect.bottom>top&&rect.top<bottom&&rect.right>0&&rect.left<innerWidth;
   previous.current={rect,visible,contentTop:contentRef.current?.getBoundingClientRect().top,snapshot:visible&&currentMode.current==='inline'&&!reducedMotion()?source.cloneNode(true) as HTMLElement:undefined,mode:currentMode.current,focus};
  }
  finishMotion();setMode(next);
  if(next==='expanded')setView('chat');
 }

 useLayoutEffect(()=>{
  if(!completed||progress.error||progress.job?.status==='failed'){
   if(currentMode.current!=='inline'){finishMotion();previous.current=null;setMode('inline')}
   return;
  }
  if(mode!=='inline')return;
  // A clicked progress summary can retain focus indefinitely. Complete the
  // handoff immediately and carry that focus to the retrievable capsule.
  move('docked',!!inline.current?.contains(document.activeElement));
 },[completed,mode,progress.error,progress.job?.status]);

 useLayoutEffect(()=>{
  if(mode==='inline')return;
  fitViewport();
  const source=previous.current;previous.current=null;
  if(!source||!floating.current)return;
  const target=floating.current.getBoundingClientRect();
  const panel=floating.current;
  if(source.focus){if(mode==='expanded')close.current?.focus({preventScroll:true});else capsule.current?.focus({preventScroll:true})}
  if(reducedMotion())return;
  panel.classList.add('is-morphing');
  if(source.mode==='inline'&&!source.visible){
   // An unseen source should not spend most of its flight outside the screen.
   // Introduce its retrievable capsule locally with the same soft rebound.
   const arrival=panel.animate([
    {opacity:0,transform:'translate3d(0,8px,0) scale(.9)',transformOrigin:'bottom right'},
    {opacity:1,transform:'translate3d(0,-1px,0) scale(1.015)',transformOrigin:'bottom right',offset:.68},
    {opacity:1,transform:'none',transformOrigin:'bottom right'},
   ],{duration:540,easing:'cubic-bezier(.22,.86,.25,1)',fill:'both'});
   animations.current.push(arrival);
   void arrival.finished.then(()=>{if(animations.current.includes(arrival))finishMotion()},()=>{});
   return;
  }
  if(source.mode==='inline')panel.classList.add('is-from-inline');
  const geometry=panel.animate(springFrames(source.rect,target),{duration:860,fill:'both'});
  animations.current.push(geometry);
  if(source.mode==='inline'&&contentRef.current&&source.contentTop!==undefined){
   // Collapse layout once, then move the recipe on the compositor while it reveals.
   const dy=source.contentTop-contentRef.current.getBoundingClientRect().top;
   animations.current.push(contentRef.current.animate([{transform:`translate3d(0,${dy}px,0)`},{transform:'translate3d(0,0,0)'}],{duration:790,easing:'cubic-bezier(.22,1,.36,1)'}));
  }
  if(source.snapshot){
   // Keep the exact inline layout during takeoff. Scaling this frozen layer avoids
   // reflowing and counter-scaling the entire detailed record on every frame.
   const copy=source.snapshot;snapshot.current=copy;
   copy.className='generation-assistant-snapshot';copy.setAttribute('aria-hidden','true');copy.inert=true;
   Object.assign(copy.style,{width:source.rect.width+'px',height:source.rect.height+'px',transform:`scale(${target.width/source.rect.width},${target.height/source.rect.height})`});
   panel.append(copy);
   animations.current.push(copy.animate([{opacity:1},{opacity:1,offset:.12},{opacity:0,offset:.55},{opacity:0}],{duration:860,easing:'cubic-bezier(.22,1,.36,1)',fill:'both'}));
  }
  if(detail.current&&source.mode!=='inline'){
   detail.current.style.width=(mode==='docked'?source.rect.width:target.width)+'px';detail.current.style.transformOrigin='top left';
   animations.current.push(detail.current.animate(springFrames(source.rect,target,true),{duration:860,fill:'both'}));
   animations.current.push(detail.current.animate(mode==='docked'?[{opacity:1},{opacity:0,offset:.22},{opacity:0}]:[{opacity:0},{opacity:0,offset:.16},{opacity:1,offset:.66},{opacity:1}],{duration:720,easing:'cubic-bezier(.22,1,.36,1)'}));
  }
  if(capsuleCopy.current){
   capsuleCopy.current.style.width=(mode==='expanded'?source.rect.width:target.width)+'px';capsuleCopy.current.style.height=(mode==='expanded'?source.rect.height:target.height)+'px';capsuleCopy.current.style.transformOrigin='top left';
   animations.current.push(capsuleCopy.current.animate(springFrames(source.rect,target,true),{duration:860,fill:'both'}));
   animations.current.push(capsuleCopy.current.animate(mode==='docked'?[{opacity:0},{opacity:0,offset:.48},{opacity:1}]:[{opacity:1},{opacity:0,offset:.2},{opacity:0}],{duration:720,easing:'cubic-bezier(.22,1,.36,1)'}));
  }
  void geometry.finished.then(()=>{if(animations.current.includes(geometry))finishMotion()},()=>{});
 },[mode]);

 // A result may arrive while the user has already opened the preparation
 // record. The outer panel keeps its bounds; only its inner scroll area changes.
 useLayoutEffect(()=>{if(mode!=='inline')fitViewport()},[recipe?.id,view]);

 useEffect(()=>{
  const dimensions=()=>[innerWidth,innerHeight,window.visualViewport?.height||innerHeight,window.visualViewport?.scale||1];
  let previousDimensions=dimensions();
  const resize=()=>{
   const next=dimensions();
   if(next.some((value,index)=>Math.abs(value-previousDimensions[index])>(index===3?.01:2)))finishMotion();
   previousDimensions=next;fitViewport();
  };
  // Collapsing the inline slot can clamp document scroll and fire a visual
  // viewport scroll event. That is expected motion, not a resize: cancelling
  // here used to snap the flying surface straight to the corner.
  const viewportScroll=()=>fitViewport();
  const media=matchMedia('(prefers-reduced-motion: reduce)');
  const preference=()=>{if(media.matches)finishMotion()};
  window.addEventListener('resize',resize);window.visualViewport?.addEventListener('resize',resize);window.visualViewport?.addEventListener('scroll',viewportScroll);media.addEventListener('change',preference);
  return()=>{window.removeEventListener('resize',resize);window.visualViewport?.removeEventListener('resize',resize);window.visualViewport?.removeEventListener('scroll',viewportScroll);media.removeEventListener('change',preference);finishMotion()};
 },[]);

 useEffect(()=>{
  if(mode!=='expanded')return;
  const outside=(event:PointerEvent)=>{if(event.target instanceof Node&&!floating.current?.contains(event.target))move('docked',false)};
  const key=(event:KeyboardEvent)=>{if(event.key==='Escape'&&!event.isComposing){event.preventDefault();move('docked')}};
  document.addEventListener('pointerdown',outside);document.addEventListener('keydown',key);
  return()=>{document.removeEventListener('pointerdown',outside);document.removeEventListener('keydown',key)};
 },[mode]);

 const record=<GenerationProgress {...progress}/>;
 return <>
  <div ref={slot} className={'generation-assistant-slot'+(mode==='inline'?'':' is-vacated')}>
   {mode==='inline'&&<div ref={inline} className="generation-assistant-inline">{record}</div>}
  </div>
  {mode!=='inline'&&createPortal(<div ref={floating} className={'generation-assistant-float'+(chatBusy?' is-chat-busy':'')} data-mode={mode} data-chat={!!recipe?.id}>
   <div id={recordId} ref={detail} className="generation-assistant-detail" role={mode==='expanded'?'dialog':undefined} aria-label={recipe?.id?'AI 菜谱助手':'AI 制作记录'} aria-hidden={mode!=='expanded'} inert={mode!=='expanded'}>
    <div className="generation-assistant-tools"><span><Sparkles size={14}/>{recipe?.id?'你的私人厨房伙伴':'这一餐的制作记录'}</span><button ref={close} type="button" aria-label={recipe?.id?'收起 AI 菜谱助手':'收起 AI 制作记录'} onClick={()=>move('docked')}><ChevronDown size={17}/><span>收起</span></button></div>
    {!!recipe?.id&&!!progress.job&&<div className="generation-assistant-tabs" aria-label="助手内容"><button type="button" aria-pressed={view==='chat'} onClick={()=>setView('chat')}>{kind==='dishes'?'聊聊这道菜':'聊聊这一餐'}</button><button type="button" aria-pressed={view==='record'} onClick={()=>setView('record')}>制作记录</button></div>}
    {!!recipe?.id&&<div className="generation-assistant-view" hidden={view!=='chat'}><RecipeChat key={kind+':'+recipe.id} recipe={recipe} kind={kind} active={mode==='expanded'&&view==='chat'} onRecipeChange={onRecipeChange} onBusyChange={setChatBusy}/></div>}
    <div className="generation-assistant-scroll" hidden={!!recipe?.id&&view!=='record'}>{record}</div>
   </div>
   <button ref={element=>{capsule.current=element;capsuleCopy.current=element}} type="button" className="generation-assistant-capsule" aria-label={recipe?.id?'展开 AI 菜谱助手':'展开 AI 制作记录'} aria-expanded={mode==='expanded'} aria-controls={recordId} aria-haspopup="dialog" aria-hidden={mode!=='docked'} tabIndex={mode==='docked'?0:-1} onClick={()=>move('expanded')}><span className="assistant-mini-orb"><Sparkles size={17}/><i>{chatBusy?<span/>:<Check size={8}/>}</i></span><span>{chatBusy?'AI · 正在回复':recipe?.id?'AI · 菜谱助手':'AI · 已完成'}</span></button>
  </div>,document.body)}
 </>;
}
