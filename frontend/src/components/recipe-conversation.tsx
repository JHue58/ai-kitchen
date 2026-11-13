import {useCallback,useRef,useState,type ReactNode} from 'react';
import {useQueryClient} from '@tanstack/react-query';
import {type Doc} from '../api';
import {GenerationAssistant} from './generation-assistant';
import {RecipeUpdatesProvider,type RecipeUpdate} from './recipe-updates';

export type RecipeChange=(recipe:Doc,changedSections:string[])=>void;

// Both saved recipes and freshly generated results share the same document cache
// and explicit update signal. Background image refreshes never trigger AI effects.
export function RecipeConversation({recipe,kind,assistant=false,children}:{
 recipe:Doc;kind:'recipes'|'dishes';assistant?:boolean;children:(onChange:RecipeChange)=>ReactNode;
}){
 const client=useQueryClient();
 const current=useRef(recipe);current.current=recipe;
 const contentRef=useRef<HTMLDivElement>(null);
 const revision=useRef(0);
 const [update,setUpdate]=useState<RecipeUpdate|null>(null);
 const onChange=useCallback<RecipeChange>((document)=>{
  if(document.id!==current.current.id)return;
  const before=current.current;current.current=document;
  setUpdate({before,after:document,revision:++revision.current});
  client.setQueryData<Doc[]>(['docs',kind],previous=>previous?.map(row=>row.id===document.id?document:row));
  client.setQueryData(['document',kind,String(document.id)],document);
  client.setQueriesData<Doc>({queryKey:['generation-result'],predicate:query=>query.queryKey[2]===kind&&(query.state.data as Doc|undefined)?.id===document.id},()=>document);
  // Menu edits also update the independently collected dish snapshots on the server.
  if(kind==='recipes')void client.invalidateQueries({queryKey:['docs','dishes']});
 },[client,kind]);
 return <RecipeUpdatesProvider update={update}>
  {children(onChange)}
  {assistant&&<GenerationAssistant key={kind+':'+recipe.id} recipe={recipe} kind={kind} onRecipeChange={onChange} completed connecting={false} initialDocked contentRef={contentRef}/>}
 </RecipeUpdatesProvider>;
}
