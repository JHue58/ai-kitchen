import {useEffect,useRef,useState} from 'react';
import {Pause,Play} from 'lucide-react';
import {decorativePhotos,neutralPhoto,type DecorativePhotoItem} from '../resources';
import '../decorative-photo.css';

// Each surface walks its own shuffled deck, using every original before repeating.
function shufflePhotos() {
 const deck=[...decorativePhotos];
 for(let i=deck.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[deck[i],deck[j]]=[deck[j],deck[i]]}
 return deck;
}
const emptyPhoto:DecorativePhotoItem={id:'neutral',src:neutralPhoto,name:'餐桌灵感',description:'温暖的餐桌意象'};

export function DecorativePhoto({className='',controls=true,onPhotoChange}:{className?:string;controls?:boolean;onPhotoChange?:(photo:DecorativePhotoItem)=>void}) {
 const deck=useRef<DecorativePhotoItem[]>([]),failed=useRef(new Set<string>());
 const nextPhoto=(previous?:string)=>{
  if(!deck.current.length){deck.current=shufflePhotos();if(deck.current[0]?.id===previous)deck.current.push(deck.current.shift()!)}
  while(deck.current.length){const next=deck.current.shift()!;if(!failed.current.has(next.id)&&next.id!==previous)return next}
  return emptyPhoto;
 };
 const [frame,setFrame]=useState<{current:DecorativePhotoItem;previous?:DecorativePhotoItem}>(()=>({current:nextPhoto()}));
 const [paused,setPaused]=useState(false),[visible,setVisible]=useState(false);
 const [reduced,setReduced]=useState(()=>matchMedia('(prefers-reduced-motion: reduce)').matches);
 const [hidden,setHidden]=useState(()=>document.hidden);
 const host=useRef<HTMLDivElement>(null),change=useRef(onPhotoChange);change.current=onPhotoChange;
 const interval=useRef(12000+Math.random()*6000);

 useEffect(()=>{change.current?.(frame.current)},[frame.current]);
 useEffect(()=>{
  const media=matchMedia('(prefers-reduced-motion: reduce)');
  const motion=()=>setReduced(media.matches),visibility=()=>setHidden(document.hidden);
  media.addEventListener('change',motion);document.addEventListener('visibilitychange',visibility);
  const observer=new IntersectionObserver(entries=>setVisible(entries[0]?.isIntersecting??false));
  if(host.current)observer.observe(host.current);
  return()=>{media.removeEventListener('change',motion);document.removeEventListener('visibilitychange',visibility);observer.disconnect()};
 },[]);
 useEffect(()=>{
  if(!frame.previous)return;
  const timer=setTimeout(()=>setFrame(value=>({current:value.current})),reduced?0:1200);
  return()=>clearTimeout(timer);
 },[frame.current,!!frame.previous,reduced]);
 useEffect(()=>{
  if(paused||!visible||reduced||hidden)return;
  let active=true,loading=false;
  // Read the actual interaction state at each turn so entering/leaving a child
  // control cannot leave the slideshow stuck in an outdated hover state.
  const interacting=()=>{
   const element=host.current,parent=element?.closest('button,a');
   return !!element&&((matchMedia('(any-hover: hover)').matches&&element.matches(':hover'))
    ||element.contains(document.activeElement)||!!parent?.contains(document.activeElement));
  };
  const timer=setInterval(async()=>{
   if(loading||interacting())return;
   loading=true;
   try{
    // Decode only the next photo, keeping the current one visible on a slow network.
    for(let tries=0;tries<decorativePhotos.length;tries++){
     const next=nextPhoto(frame.current.id);if(next.id===frame.current.id)return;
     const preload=new Image();preload.src=next.src;
     try{await preload.decode()}catch{failed.current.add(next.id);if(!active)return;continue}
     if(active&&!interacting())setFrame({current:next,previous:frame.current});
     return;
    }
   }finally{loading=false}
  },interval.current);
  return()=>{active=false;clearInterval(timer)};
 },[frame.current,paused,visible,reduced,hidden]);

 return <div ref={host} className={'decorative-photo '+className} data-photo-id={frame.current.id}>
  {frame.previous&&<img className="decorative-photo-layer" src={frame.previous.src} alt="" aria-hidden="true"/>}
  <img key={frame.current.id} className={'decorative-photo-layer'+(frame.previous?' is-arriving':'')} src={frame.current.src} alt="" decoding="async" loading="lazy" onError={()=>{
   failed.current.add(frame.current.id);setFrame({current:nextPhoto(frame.current.id)});
  }}/>
  {controls&&!reduced&&<button type="button" className="decorative-photo-toggle" onClick={()=>setPaused(value=>!value)} aria-label={paused?'播放餐桌图片':'暂停餐桌图片'} aria-pressed={paused} title={paused?'播放餐桌图片':'暂停餐桌图片'}>{paused?<Play size={12}/>:<Pause size={12}/>}</button>}
 </div>;
}
