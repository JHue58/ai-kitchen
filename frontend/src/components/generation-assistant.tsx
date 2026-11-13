import {useEffect,useId,useLayoutEffect,useRef,useState,type ComponentProps} from 'react';
import {createPortal} from 'react-dom';
import {Check,ChevronDown,Sparkles} from 'lucide-react';
import {GenerationProgress} from './kitchen-experience';
import '../generation-assistant.css';

type Mode='inline'|'docked'|'expanded';
type Props=ComponentProps<typeof GenerationProgress>&{completed:boolean};
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

export function GenerationAssistant({completed,...progress}:Props){
 const recordId=useId();
 const [mode,setMode]=useState<Mode>('inline');
 const slot=useRef<HTMLDivElement>(null),inline=useRef<HTMLDivElement>(null),floating=useRef<HTMLDivElement>(null);
 const capsule=useRef<HTMLButtonElement>(null),close=useRef<HTMLButtonElement>(null);
 const detail=useRef<HTMLDivElement>(null),capsuleCopy=useRef<HTMLButtonElement>(null);
 const previous=useRef<{rect:DOMRect;slotHeight:number;slotMargin:string;mode:Mode;focus:boolean}|null>(null);
 const animations=useRef<Animation[]>([]);
 const currentMode=useRef(mode);currentMode.current=mode;

 function finishMotion(){
  animations.current.forEach(animation=>animation.cancel());animations.current=[];
  floating.current?.classList.remove('is-morphing','is-from-inline');
  for(const content of [detail.current,capsuleCopy.current])if(content){content.style.width='';content.style.height='';content.style.transformOrigin=''}
 }
 function move(next:Mode,focus=true){
  if(currentMode.current===next)return;
  const source=currentMode.current==='inline'?inline.current:floating.current;
  if(source)previous.current={rect:source.getBoundingClientRect(),slotHeight:slot.current?.getBoundingClientRect().height||0,slotMargin:slot.current?getComputedStyle(slot.current).marginBottom:'0px',mode:currentMode.current,focus};
  finishMotion();setMode(next);
 }

 useEffect(()=>{
  if(!completed||progress.error||progress.job?.status==='failed'){
   if(currentMode.current!=='inline'){finishMotion();previous.current=null;setMode('inline')}
   return;
  }
  if(mode!=='inline')return;
  let timer:ReturnType<typeof setTimeout>;
  const dock=()=>{
   // Don't take away a record while someone is using its keyboard controls.
   if(inline.current?.contains(document.activeElement)){timer=setTimeout(dock,900);return}
   move('docked',false);
  };
  timer=setTimeout(dock,reducedMotion()?0:900);
  return()=>clearTimeout(timer);
 },[completed,mode,progress.error,progress.job?.status]);

 useLayoutEffect(()=>{
  const source=previous.current;previous.current=null;
  if(mode==='inline'||!source||!floating.current)return;
  const target=floating.current.getBoundingClientRect();
  const panel=floating.current;
  if(source.focus){if(mode==='expanded')close.current?.focus({preventScroll:true});else capsule.current?.focus({preventScroll:true})}
  if(reducedMotion())return;
  panel.classList.add('is-morphing');
  if(source.mode==='inline')panel.classList.add('is-from-inline');
  const geometry=panel.animate(springFrames(source.rect,target),{duration:860,fill:'both'});
  animations.current.push(geometry);
  if(source.mode==='inline'&&slot.current){
   animations.current.push(slot.current.animate([{height:source.slotHeight+'px',marginBottom:source.slotMargin},{height:'0px',marginBottom:'0px'}],{duration:790,easing:'cubic-bezier(.22,1,.36,1)'}));
  }
  if(detail.current){
   detail.current.style.width=(mode==='docked'?source.rect.width:target.width)+'px';detail.current.style.transformOrigin='top left';
   animations.current.push(detail.current.animate(springFrames(source.rect,target,true),{duration:860,fill:'both'}));
   animations.current.push(detail.current.animate(mode==='docked'?[{opacity:1},{opacity:0,offset:.22},{opacity:0}]:[{opacity:0},{opacity:0,offset:.16},{opacity:1,offset:.66},{opacity:1}],{duration:720,easing:'cubic-bezier(.22,1,.36,1)'}));
  }
  if(capsuleCopy.current){
   capsuleCopy.current.style.width=(mode==='expanded'?source.rect.width:target.width)+'px';capsuleCopy.current.style.height=(mode==='expanded'?source.rect.height:target.height)+'px';capsuleCopy.current.style.transformOrigin='top left';
   animations.current.push(capsuleCopy.current.animate(springFrames(source.rect,target,true),{duration:860,fill:'both'}));
   animations.current.push(capsuleCopy.current.animate(mode==='docked'?[{opacity:0},{opacity:0,offset:.48},{opacity:1}]:[{opacity:1},{opacity:0,offset:.2},{opacity:0}],{duration:720,easing:'cubic-bezier(.22,1,.36,1)'}));
  }
  void geometry.finished.then(()=>finishMotion(),()=>{});
 },[mode]);

 useEffect(()=>{
  const resize=()=>finishMotion();
  const media=matchMedia('(prefers-reduced-motion: reduce)');
  const preference=()=>{if(media.matches)finishMotion()};
  window.addEventListener('resize',resize);window.visualViewport?.addEventListener('resize',resize);media.addEventListener('change',preference);
  return()=>{window.removeEventListener('resize',resize);window.visualViewport?.removeEventListener('resize',resize);media.removeEventListener('change',preference);finishMotion()};
 },[]);

 useEffect(()=>{
  if(mode!=='expanded')return;
  const outside=(event:PointerEvent)=>{if(event.target instanceof Node&&!floating.current?.contains(event.target))move('docked',false)};
  const key=(event:KeyboardEvent)=>{if(event.key==='Escape'){event.preventDefault();move('docked')}};
  document.addEventListener('pointerdown',outside);document.addEventListener('keydown',key);
  return()=>{document.removeEventListener('pointerdown',outside);document.removeEventListener('keydown',key)};
 },[mode]);

 const record=<GenerationProgress {...progress}/>;
 return <>
  <div ref={slot} className={'generation-assistant-slot'+(mode==='inline'?'':' is-vacated')}>
   {mode==='inline'&&<div ref={inline} className="generation-assistant-inline">{record}</div>}
  </div>
  {mode!=='inline'&&createPortal(<div ref={floating} className="generation-assistant-float" data-mode={mode}>
   <div id={recordId} ref={detail} className="generation-assistant-detail" role={mode==='expanded'?'dialog':undefined} aria-label="AI 制作记录" aria-hidden={mode!=='expanded'} inert={mode!=='expanded'}>
    <div className="generation-assistant-tools"><span><Sparkles size={14}/>这一餐的制作记录</span><button ref={close} type="button" aria-label="收起 AI 制作记录" onClick={()=>move('docked')}><ChevronDown size={17}/><span>收起</span></button></div>
    <div className="generation-assistant-scroll">{record}</div>
   </div>
   <button ref={element=>{capsule.current=element;capsuleCopy.current=element}} type="button" className="generation-assistant-capsule" aria-label="展开 AI 制作记录" aria-expanded={mode==='expanded'} aria-controls={recordId} aria-haspopup="dialog" aria-hidden={mode!=='docked'} tabIndex={mode==='docked'?0:-1} onClick={()=>move('expanded')}><span className="assistant-mini-orb"><Sparkles size={17}/><i><Check size={8}/></i></span><span>AI · 已完成</span></button>
  </div>,document.body)}
 </>;
}
