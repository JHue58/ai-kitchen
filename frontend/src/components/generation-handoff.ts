import '../generation-handoff.css';

type Handoff={
 layer:HTMLDivElement;group:HTMLDivElement;button:HTMLElement;source:DOMRect;
 animations:Animation[];timers:ReturnType<typeof setTimeout>[];startedAt:number;
 landed:boolean;settle:(()=>void)|null;finish:()=>void;
};
type Idea={label:string;rect?:DOMRect;tone:number};
let active:Handoff|null=null;
export const generationIsEntering=()=>!!active;
const reduced=()=>matchMedia('(prefers-reduced-motion: reduce)').matches;
const ease='cubic-bezier(.22,1,.36,1)';
const smooth=(t:number)=>t*t*(3-2*t);
const clamp=(n:number,min:number,max:number)=>Math.min(max,Math.max(min,n));
const seedLift=52,seedDuration=900,morphAt=460,morphDuration=760;

function play(state:Handoff,element:Element,frames:Keyframe[],duration:number,delay=0,easing=ease){
 const animation=element.animate(frames,{duration:reduced()?0:duration,delay:reduced()?0:delay,easing,fill:'both'});
 state.animations.push(animation);return animation;
}
function later(state:Handoff,callback:()=>void,delay:number){
 const timer=setTimeout(()=>{if(active===state)callback()},delay);state.timers.push(timer);
}
// The spring accepts the seed's current velocity. Expanding the surface never
// stops its upward motion before starting a second animation from rest.
function springValue(from:number,to:number,velocity:number,t:number){
 const a=9.6,b=8.2,displacement=from-to;
 return to+Math.exp(-a*t)*(displacement*Math.cos(b*t)+(velocity+a*displacement)/b*Math.sin(b*t));
}
function gatherIdeas(form:HTMLFormElement,request:Record<string,any>):Idea[]{
 // Read every origin before adding layers/animations: no read/write layout loop.
 const origins=new Map<string,DOMRect>();
 for(const element of form.querySelectorAll<HTMLElement>('.ingredient-tokens button,.tag-chips button.active,.servings-picker output')){
  const rect=element.getBoundingClientRect();
  if(rect.bottom>80&&rect.top<innerHeight-90)origins.set(element.textContent?.replace(/\s*×\s*$/,'').trim()||'',rect);
 }
 const inputs:Idea[]=[...(request.ingredients||[]).map((label:string)=>({label,rect:origins.get(label),tone:0})),
  {label:`${request.servings} 人用餐`,rect:origins.get(`${request.servings} 人`),tone:1},
  ...(request.tags||[]).map((label:string)=>({label,rect:origins.get(label),tone:2})),
  ...(request.minutes?[{label:`${request.minutes} 分钟`,tone:1}]:[]),
  ...(request.budget?[{label:`预算 ${request.budget} 元`,tone:2}]:[]),
  ...(request.equipment_ids?.length?[{label:`${request.equipment_ids.length} 件顺手炊具`,tone:1}]:[]),
  ...(request.description?[{label:'你的用餐心意',tone:2}]:[])];
 if(inputs.length===1)inputs.unshift({label:request.target==='dish'?'一道好菜':'一桌好味',tone:0});
 return inputs.length>16?[...inputs.slice(0,15),{label:`还有 ${inputs.length-15} 份灵感`,tone:2}]:inputs;
}
function addIdeas(state:Handoff,ideas:Idea[]){
 const {source,group}=state,end={x:source.width/2,y:source.height/2};
 ideas.forEach((idea,index)=>{
  const token=document.createElement('span');token.className='generation-handoff-idea';token.dataset.tone=String(idea.tone);
  const dot=document.createElement('i');token.append(dot,document.createTextNode(idea.label));group.append(token);
  const column=index%3,row=Math.floor(index/3)%2;
  const start=idea.rect?{x:idea.rect.left+idea.rect.width/2-source.left,y:idea.rect.top+idea.rect.height/2-source.top}:{x:source.width*(.17+column*.33),y:-66-row*45};
  // Keep fallback inspiration inside the visible canvas, including short phones.
  start.y=Math.max(26-source.top,start.y);start.x=clamp(start.x,42-source.left,innerWidth-source.left-42);
  const side=start.x<end.x?-1:1;
  const control1={x:start.x+side*24,y:start.y-24-index%3*5};
  const control2={x:end.x+side*Math.min(42,source.width*.12),y:end.y-35};
  const frames:Keyframe[]=Array.from({length:46},(_,frame)=>{
   const t=frame/45,p=smooth(t),q=1-p;
   const x=q*q*q*start.x+3*q*q*p*control1.x+3*q*p*p*control2.x+p*p*p*end.x;
   const y=q*q*q*start.y+3*q*q*p*control1.y+3*q*p*p*control2.y+p*p*p*end.y;
   const absorbed=smooth(clamp((t-.62)/.38,0,1));
   const scale=(.94+Math.sin(Math.PI*p)*.075)*(1-absorbed*.84);
   return {offset:t,opacity:Math.min(1,t/.13)*(1-absorbed),transform:`translate3d(${x}px,${y}px,0) translate(-50%,-50%) rotate(${side*(-5+12*p)}deg) scale(${scale})`};
  });
  // Every chip keeps moving. Staggered arrivals feed the button's fluid pulse.
  play(state,token,frames,490,index*15,'linear');
 });
}

export async function gatherGeneration(form:HTMLFormElement,request:Record<string,any>,navigate:()=>void){
 if(active)return;
 if(reduced()){navigate();return}
 const source=form.querySelector<HTMLElement>('.generate-button');if(!source){navigate();return}
 if(document.activeElement instanceof HTMLElement)document.activeElement.blur();
 const measured=source.getBoundingClientRect(),ideas=gatherIdeas(form,request);
 const sourceRect=new DOMRect(measured.left,clamp(measured.top,84,Math.max(84,innerHeight-(innerWidth<=700?100:24)-measured.height)),measured.width,measured.height);
 const route=document.querySelector<HTMLElement>('.route-view');
 const layer=document.createElement('div');layer.className='generation-handoff';layer.setAttribute('aria-hidden','true');
 const group=document.createElement('div');group.className='generation-handoff-seed';
 Object.assign(group.style,{left:sourceRect.left+'px',top:sourceRect.top+'px',width:sourceRect.width+'px',height:sourceRect.height+'px'});
 const aura=document.createElement('div');aura.className='generation-handoff-aura';group.append(aura);
 const button=source.cloneNode(true) as HTMLElement;button.className='generation-handoff-button';button.inert=true;
 const buttonCopy=document.createElement('span');buttonCopy.className='generation-handoff-button-copy';buttonCopy.append(...Array.from(button.childNodes));button.append(buttonCopy);group.append(button);layer.append(group);
 const shell=document.querySelector<HTMLElement>('.shell'),wasInert=shell?.inert||false;
 const prevent=(event:Event)=>event.preventDefault();
 const keyboard=(event:KeyboardEvent)=>{if([' ','ArrowDown','ArrowUp','PageDown','PageUp','Home','End'].includes(event.key))event.preventDefault()};
 const media=matchMedia('(prefers-reduced-motion: reduce)');
 let resolveNavigation=()=>{};
 const preference=()=>{if(media.matches){state.animations.forEach(animation=>{try{animation.finish()}catch{}});state.settle?.()}};
 const leave=()=>state.finish();
 const state:Handoff={layer,group,button,source:sourceRect,animations:[],timers:[],startedAt:performance.now(),landed:false,settle:null,finish:()=>{
  if(active!==state)return;
  active=null;state.timers.forEach(clearTimeout);resolveNavigation();state.animations.forEach(animation=>animation.cancel());layer.remove();source.style.visibility='';
  document.documentElement.classList.remove('generation-is-entering');
  document.removeEventListener('wheel',prevent);document.removeEventListener('touchmove',prevent);document.removeEventListener('keydown',keyboard);
  media.removeEventListener('change',preference);window.removeEventListener('popstate',leave);
  if(shell)shell.inert=wasInert;
  window.dispatchEvent(new Event('generation-entry-finished'));
 }};
 active=state;document.body.append(layer);if(shell)shell.inert=true;source.style.visibility='hidden';
 document.addEventListener('wheel',prevent,{passive:false});document.addEventListener('touchmove',prevent,{passive:false});document.addEventListener('keydown',keyboard);
 media.addEventListener('change',preference);window.addEventListener('popstate',leave);document.documentElement.classList.add('generation-is-entering');
 // One compositor fade replaces full-form scaling and animated subtree blur.
 if(route)play(state,route,[{opacity:1},{opacity:0}],260,0,'cubic-bezier(.4,0,.3,1)');
 addIdeas(state,ideas);
 play(state,group,Array.from({length:61},(_,index)=>({offset:index/60,transform:`translate3d(0,${-seedLift*smooth(index/60)}px,0)`})),seedDuration,0,'linear');
 play(state,button,[{transform:'scale(1)'},{transform:'scale(.973,.95)',offset:.13},{transform:'scale(1.018,1.055)',offset:.56},{transform:'scale(1)'}],690,0,'cubic-bezier(.35,0,.25,1)');
 play(state,aura,[{opacity:0,transform:'scale(.7)'},{opacity:.8,transform:'scale(1.08)',offset:.42},{opacity:0,transform:'scale(1.22)'}],840);
 for(let index=0;index<3;index++){
  const ring=document.createElement('span');ring.className='generation-handoff-ripple';group.prepend(ring);
  play(state,ring,[{opacity:0,transform:'scale(.88,.72)'},{opacity:.55,offset:.18},{opacity:0,transform:'scale(1.1,1.65)'}],430,180+index*110);
 }
 // Mount the destination while the independent compositor flight is underway.
 // No awaited pulse, stationary hold, or route-commit pause between phases.
 await new Promise<void>((resolve,reject)=>{
  resolveNavigation=resolve;
  const timer=setTimeout(()=>{if(active===state){try{navigate()}catch(error){reject(error);state.finish();return}}resolve()},220);
  state.timers.push(timer);
 });
}

export function landGeneration(root:HTMLElement){
 const state=active;if(!state||state.landed)return;state.landed=true;
 const destination=root.querySelector<HTMLElement>('.generation-assistant-inline .chef-progress');
 if(!destination){state.finish();return}
 window.scrollTo({top:0,behavior:'instant'});
 const to=destination.getBoundingClientRect();
 const surface=document.createElement('div');surface.className='generation-handoff-surface';
 Object.assign(surface.style,{left:to.left+'px',top:to.top+'px',width:to.width+'px',height:to.height+'px',opacity:'0'});
 const copy=destination.cloneNode(true) as HTMLElement;copy.inert=true;copy.classList.add('generation-handoff-record');surface.append(copy);state.layer.prepend(surface);
 let began=false;
 const begin=()=>{
  if(began||active!==state)return;began=true;
  const elapsed=performance.now()-state.startedAt;
  const from=state.group.getBoundingClientRect(),u=clamp(elapsed/seedDuration,0,1);
  const velocity=-seedLift*6*u*(1-u)/(seedDuration/1000);
  state.group.getAnimations().forEach(animation=>animation.cancel());
  const geometry:Keyframe[]=[],lift:Keyframe[]=[];
  for(let index=0;index<=60;index++){
   const t=index/60*morphDuration/1000,last=index===60;
   const x=last?to.left:springValue(from.left,to.left,0,t),y=last?to.top:springValue(from.top,to.top,velocity,t);
   const sx=last?1:springValue(from.width/to.width,1,0,t),sy=last?1:springValue(from.height/to.height,1,0,t);
   geometry.push({offset:index/60,transform:`translate3d(${x-to.left}px,${y-to.top}px,0) scale(${sx},${sy})`});
   lift.push({offset:index/60,transform:`translate3d(${x-state.source.left}px,${y-state.source.top}px,0)`});
  }
  // Both surfaces share position and velocity while their material crossfades.
  play(state,state.group,lift,morphDuration,0,'linear');
  const flight=play(state,surface,geometry,morphDuration,0,'linear');
  play(state,surface,[{opacity:0},{opacity:1,offset:.24},{opacity:1}],morphDuration);
  const buttonCopy=state.button.querySelector('.generation-handoff-button-copy');
  if(buttonCopy)play(state,buttonCopy,[{opacity:1},{opacity:0}],100);
  play(state,state.button,[{opacity:1},{opacity:0}],180,0,'cubic-bezier(.4,0,.2,1)');
  play(state,copy,[{opacity:0},{opacity:0,offset:.2,easing:ease},{opacity:1,offset:.7},{opacity:1}],morphDuration,0,'linear');
  void flight.finished.catch(()=>{}).then(()=>{
   if(active!==state)return;
   document.documentElement.classList.remove('generation-is-entering');
   const dissolve=play(state,surface,[{opacity:1},{opacity:0}],100);
   void dissolve.finished.catch(()=>{}).then(()=>{state.finish();root.querySelector<HTMLElement>('h1')?.focus({preventScroll:true})});
  });
 };
 state.settle=begin;
 if(reduced())begin();else later(state,begin,Math.max(0,morphAt-(performance.now()-state.startedAt)));
}
