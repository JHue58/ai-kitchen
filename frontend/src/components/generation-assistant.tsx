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
const flightDuration=1100;
const panelOpenDuration=720,panelCloseDuration=620;
type Presentation={rect:DOMRect;visible:boolean;contentTop?:number;snapshot?:HTMLElement;snapshotOpacity?:number;snapshotWidth?:number;snapshotHeight?:number;mode:Mode;focus:boolean;interrupted:boolean;detailOpacity:number;capsuleOpacity:number;detailWidth:number;detailHeight:number;capsuleWidth:number;capsuleHeight:number};
function springFrames(from:DOMRect,to:DOMRect,counterScale=false,manual=false):Keyframe[]{
 const dx=from.left-to.left,dy=from.top-to.top;
 const sx=from.width/to.width,sy=from.height/to.height;
 // Give the hand-operated surface a visible settling breath. Bound that
 // breath to the available viewport and the small capsule's final dimensions.
 let rebound=.055;
 if(manual){
  for(const [start,end] of [[from.width,to.width],[from.height,to.height]])if(start>end)rebound=Math.min(rebound,end*.1/(start-end));
  if(dx>0)rebound=Math.min(rebound,Math.max(0,to.left-8)/dx);
  if(dy>0)rebound=Math.min(rebound,Math.max(0,to.top-8)/dy);
 }
 return Array.from({length:61},(_,index)=>{
  const t=index/60*(manual ? .72 : 1.1);
  let progress=index===60?1:manual?1-Math.exp(-7.8*t)*(Math.cos(10*t)+.78*Math.sin(10*t)):1-Math.exp(-5.4*t)*(Math.cos(4.6*t)+5.4/4.6*Math.sin(4.6*t));
  if(manual&&progress>1)progress=1+(rebound>0?rebound*Math.tanh((progress-1)/rebound):0);
  const arc=Math.sin(Math.PI*Math.min(1,Math.max(0,progress)))*Math.min(28,Math.hypot(dx,dy)*.04);
  // Very tall, expanded records must not invert when the spring overshoots.
  const scaleX=Math.max(Math.min(.8,sx),sx+(1-sx)*progress),scaleY=Math.max(Math.min(.8,sy),sy+(1-sy)*progress);
  return {offset:index/60,transform:counterScale?`scale(${1/scaleX},${1/scaleY})`:`translate3d(${dx*(1-progress)}px,${dy*(1-progress)-arc}px,0) scale(${scaleX},${scaleY})`};
 });
}

export function GenerationAssistant({completed,contentRef,recipe,kind='recipes',initialDocked=false,onRecipeChange,...progress}:Props){
 const recordId=useId();
 const [mode,setMode]=useState<Mode>(initialDocked?'docked':'inline');
 const [motion,setMotion]=useState<'inline'|'panel'|null>(null);
 const [view,setView]=useState<'chat'|'record'>('chat'),[chatBusy,setChatBusy]=useState(false);
 const slot=useRef<HTMLDivElement>(null),inline=useRef<HTMLDivElement>(null),floating=useRef<HTMLDivElement>(null);
 const capsule=useRef<HTMLButtonElement>(null),close=useRef<HTMLButtonElement>(null);
 const detail=useRef<HTMLDivElement>(null),capsuleCopy=useRef<HTMLButtonElement>(null);
 const previous=useRef<Presentation|null>(null);
 const snapshot=useRef<HTMLElement|null>(null);
 const animations=useRef<Animation[]>([]);
 const locked=useRef(false);
 const restingBottom=useRef(22);
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
  const bottom=parseFloat(getComputedStyle(panel).bottom);
  if(!locked.current&&Number.isFinite(bottom))restingBottom.current=Math.max(12,bottom-keyboardOffset);
  panel.style.setProperty('--assistant-viewport-bottom',restingBottom.current+'px');
  const chrome=Array.from(panel.querySelectorAll<HTMLElement>('.generation-assistant-tools,.generation-assistant-tabs')).reduce((height,element)=>height+element.offsetHeight,24);
  panel.style.setProperty('--assistant-chrome-height',chrome+'px');
 }

 // Keep the flight in viewport coordinates. Mobile browser chrome can resize
 // visualViewport while the page scrolls; that must not change its trajectory.
 function lockPanel(rect:DOMRect){
  const panel=floating.current;if(!panel)return;
  Object.assign(panel.style,{left:rect.left+'px',top:rect.top+'px',right:'auto',bottom:'auto',width:rect.width+'px',height:rect.height+'px',maxWidth:'none'});
  locked.current=true;
 }
 function unlockPanel(){
  const panel=floating.current;if(!panel||!locked.current)return;
  for(const property of ['left','top','right','bottom','width','height','max-width'])panel.style.removeProperty(property);
  locked.current=false;
 }
 function finishMotion(updateState=true){
  animations.current.forEach(animation=>animation.cancel());animations.current=[];
  floating.current?.classList.remove('is-morphing','is-from-inline');
  snapshot.current?.remove();snapshot.current=null;
  unlockPanel();
  for(const content of [detail.current,capsuleCopy.current])if(content){content.style.width='';content.style.height='';content.style.transformOrigin=''}
  if(updateState)setMotion(null);
 }
 function completeMotion(){
  const panel=floating.current;
  // Landing has almost zero velocity. If browser chrome changed the destination
  // during flight, cover the remaining distance with a short, soft settling arc.
  const before=panel?.getBoundingClientRect();
  finishMotion();fitViewport();
  const after=panel?.getBoundingClientRect();
  if(panel&&before&&after&&!reducedMotion()&&Math.max(Math.abs(before.left-after.left),Math.abs(before.top-after.top),Math.abs(before.width-after.width),Math.abs(before.height-after.height))>2){
   lockPanel(after);setMotion('panel');panel.classList.add('is-morphing');
   const settle=panel.animate(springFrames(before,after),{duration:440,fill:'both'});
   animations.current.push(settle);
   void settle.finished.then(()=>{if(animations.current.includes(settle))completeMotion()},()=>{});
   return;
  }
 }
 function move(next:Mode,focus=true){
  if(currentMode.current===next)return;
  // Capture the *presented* geometry and crossfade before cancelling. A new
  // gesture retargets this same surface immediately, including mid-rebound.
  const source=currentMode.current==='inline'?inline.current:floating.current;
  if(source){
   const rect=source.getBoundingClientRect(),viewport=window.visualViewport;
   const top=viewport?.offsetTop||0,bottom=top+(viewport?.height||innerHeight);
   const visible=rect.bottom>top&&rect.top<bottom&&rect.right>0&&rect.left<innerWidth;
   const interrupted=animations.current.length>0;
   const retained=visible&&!reducedMotion()?(currentMode.current==='inline'?source:snapshot.current):null;
   previous.current={rect,visible,contentTop:contentRef.current?.getBoundingClientRect().top,snapshot:retained?retained.cloneNode(true) as HTMLElement:undefined,snapshotOpacity:retained?Number(getComputedStyle(retained).opacity):undefined,snapshotWidth:retained?.offsetWidth,snapshotHeight:retained?.offsetHeight,mode:currentMode.current,focus,interrupted,detailOpacity:detail.current?Number(getComputedStyle(detail.current).opacity):0,capsuleOpacity:capsuleCopy.current?Number(getComputedStyle(capsuleCopy.current).opacity):0,detailWidth:detail.current?.offsetWidth||0,detailHeight:detail.current?.offsetHeight||0,capsuleWidth:capsuleCopy.current?.offsetWidth||0,capsuleHeight:capsuleCopy.current?.offsetHeight||0};
  }
  finishMotion();currentMode.current=next;setMode(next);
  if(next==='expanded')setView('chat');
 }

 useLayoutEffect(()=>{
  if(!completed||progress.error||progress.job?.status==='failed'){
   if(currentMode.current!=='inline'){finishMotion();previous.current=null;currentMode.current='inline';setMode('inline')}
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
  lockPanel(target);setMotion(source.mode==='inline'&&source.visible?'inline':'panel');
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
   void arrival.finished.then(()=>{if(animations.current.includes(arrival))completeMotion()},()=>{});
   return;
  }
  if(source.mode==='inline')panel.classList.add('is-from-inline');
  const baseDuration=mode==='expanded'?panelOpenDuration:panelCloseDuration;
  const distance=Math.max(Math.abs(source.rect.width-target.width)/Math.max(source.rect.width,target.width),Math.abs(source.rect.height-target.height)/Math.max(source.rect.height,target.height));
  const duration=source.mode==='inline'?flightDuration:source.interrupted?Math.max(340,baseDuration*(.6+.4*Math.sqrt(Math.min(1,distance)))):baseDuration;
  const geometry=panel.animate(springFrames(source.rect,target,false,source.mode!=='inline'),{duration,fill:'both'});geometry.id='assistant-geometry';
  animations.current.push(geometry);
  if(source.mode==='inline'&&contentRef.current&&source.contentTop!==undefined){
   // Collapse layout once, then move the recipe on the compositor while it reveals.
   const dy=source.contentTop-contentRef.current.getBoundingClientRect().top;
   animations.current.push(contentRef.current.animate([{transform:`translate3d(0,${dy}px,0)`},{transform:'translate3d(0,0,0)'}],{duration:900,easing:'cubic-bezier(.22,1,.36,1)'}));
  }
  if(source.snapshot){
   // Keep the exact inline layout during takeoff. Scaling this frozen layer avoids
   // reflowing and counter-scaling the entire detailed record on every frame.
   const copy=source.snapshot;snapshot.current=copy;
   copy.className='generation-assistant-snapshot';copy.setAttribute('aria-hidden','true');copy.inert=true;
   const width=source.snapshotWidth||source.rect.width,height=source.snapshotHeight||source.rect.height;
   Object.assign(copy.style,{width:width+'px',height:height+'px',transform:`scale(${target.width/width},${target.height/height})`});
   panel.append(copy);
   const opacity=source.snapshotOpacity??1;
   animations.current.push(copy.animate(source.mode==='inline'?[{opacity},{opacity,offset:.22,easing:'cubic-bezier(.4,0,.2,1)'},{opacity:0,offset:.72},{opacity:0}]:[{opacity},{opacity:0,easing:'cubic-bezier(.22,1,.36,1)'}],{duration,fill:'both'}));
  }
  if(detail.current&&source.mode!=='inline'){
   // Keep a full-size content canvas as the clipping surface changes. Carry its
   // current dimensions across reversals, avoiding a text reflow or scale jump.
   detail.current.style.width=(mode==='expanded'?target.width:source.detailWidth||source.rect.width)+'px';
   detail.current.style.height=(mode==='expanded'?target.height:source.detailHeight||source.rect.height)+'px';
   detail.current.style.transformOrigin='top left';
   animations.current.push(detail.current.animate(springFrames(source.rect,target,true,true),{duration,fill:'both'}));
   animations.current.push(detail.current.animate([{opacity:source.detailOpacity},{opacity:mode==='expanded'?1:0}],{duration:Math.min(280,duration*.65),easing:'cubic-bezier(.22,1,.36,1)',fill:'both'}));
  }
  if(capsuleCopy.current){
   capsuleCopy.current.style.width=(source.mode==='inline'?target.width:source.capsuleOpacity>.001?source.capsuleWidth:mode==='docked'?target.width:source.rect.width)+'px';
   capsuleCopy.current.style.height=(source.mode==='inline'?target.height:source.capsuleOpacity>.001?source.capsuleHeight:mode==='docked'?target.height:source.rect.height)+'px';
   capsuleCopy.current.style.transformOrigin='top left';
   animations.current.push(capsuleCopy.current.animate(springFrames(source.rect,target,true,source.mode!=='inline'),{duration,fill:'both'}));
   animations.current.push(capsuleCopy.current.animate(source.mode==='inline'?[{opacity:0},{opacity:0,offset:.34,easing:'cubic-bezier(.4,0,.2,1)'},{opacity:1,offset:.82},{opacity:1}]:[{opacity:source.capsuleOpacity},{opacity:mode==='docked'?1:0}],{duration:source.mode==='inline'?duration:Math.min(280,duration*.65),easing:source.mode==='inline'?'linear':'cubic-bezier(.22,1,.36,1)',fill:'both'}));
  }
  void geometry.finished.then(()=>{if(animations.current.includes(geometry))completeMotion()},()=>{});
 },[mode]);

 // A result may arrive while the user has already opened the preparation
 // record. The outer panel keeps its bounds; only its inner scroll area changes.
 useLayoutEffect(()=>{if(mode!=='inline')fitViewport()},[recipe?.id,view]);

 useEffect(()=>{
  // Toolbar, keyboard and orientation changes update the next resting bounds.
  // The fixed flight anchor stays intact until landing; scrolling never cancels.
  const resize=()=>fitViewport();
  const viewportScroll=()=>fitViewport();
  const media=matchMedia('(prefers-reduced-motion: reduce)');
  const preference=()=>{if(media.matches){finishMotion();fitViewport()}};
  window.addEventListener('resize',resize);window.visualViewport?.addEventListener('resize',resize);window.visualViewport?.addEventListener('scroll',viewportScroll);media.addEventListener('change',preference);
  return()=>{window.removeEventListener('resize',resize);window.visualViewport?.removeEventListener('resize',resize);window.visualViewport?.removeEventListener('scroll',viewportScroll);media.removeEventListener('change',preference);
   // React StrictMode replays effects on the same connected DOM. Only actual
   // removal owns cancellation; replay must not erase a newly started flight.
   queueMicrotask(()=>{if(!floating.current?.isConnected)finishMotion(false)})};
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
  {mode!=='inline'&&createPortal(<div ref={floating} className={'generation-assistant-float'+(chatBusy?' is-chat-busy':'')+(motion?' is-morphing':'')+(motion==='inline'?' is-from-inline':'')} data-mode={mode} data-chat={!!recipe?.id} onClick={()=>{if(currentMode.current==='docked'&&animations.current.length)move('expanded')}}>
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
