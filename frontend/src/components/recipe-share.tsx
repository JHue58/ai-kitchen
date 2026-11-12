import {useState} from 'react';
import {api} from '../api';

// Start the clipboard operation during the click, before the share request finishes.
// Safari requires that user activation even when the clipboard data arrives later.
async function copyLink(link:Promise<string>):Promise<boolean> {
 if(navigator.clipboard?.write&&typeof ClipboardItem!=='undefined') {
  const content=link.then(text=>new Blob([text],{type:'text/plain'}));
  // Permission can be denied before the browser consumes this promise.
  void content.catch(()=>{});
  try {
   await navigator.clipboard.write([new ClipboardItem({'text/plain':content})]);
   return true;
  } catch { /* Try the text API or the fallback for HTTP/older browsers. */ }
 }
 const text=await link;
 try {await navigator.clipboard.writeText(text);return true} catch {}
 const input=document.createElement('textarea');
 input.value=text;input.readOnly=true;
 input.style.cssText='position:fixed;top:0;left:0;opacity:0;font-size:16px';
 const previous=document.activeElement as HTMLElement|null;
 document.body.append(input);input.focus({preventScroll:true});input.select();input.setSelectionRange(0,text.length);
 try {return document.execCommand('copy')} catch {return false} finally {input.remove();previous?.focus({preventScroll:true})}
}

export function useRecipeShare({id,onMessage}:{id:number;onMessage:(message:string)=>void}) {
 const [link,setLink]=useState(''),[busy,setBusy]=useState(false);
 async function share() {
  if(busy)return;
  setBusy(true);
  const pending=api('/recipes/'+id+'/share','POST').then(result=>{
   const url=new URL(result.url,location.origin).href;setLink(url);return url;
  });
  try {const copied=await copyLink(pending);onMessage(copied?'分享链接已复制':'自动复制失败，请点击“复制分享链接”重试，或手动复制下方链接。')}
  catch(error){onMessage((error as Error).message)}finally{setBusy(false)}
 }
 return {share,busy,result:link&&<div className="share-result" role="status"><input aria-label="分享链接" value={link} readOnly onFocus={e=>e.currentTarget.select()}/><button type="button" className="btn secondary" onClick={async()=>{try{onMessage(await copyLink(Promise.resolve(link))?'分享链接已复制':'复制失败，请长按链接手动复制')}catch(error){onMessage((error as Error).message)}}}>复制分享链接</button></div>};
}
