import {useState} from 'react';
import {useQuery,useQueryClient} from '@tanstack/react-query';
import {api} from '../api';
import {Button} from './ui/button';

export function SystemGlobalPrompt(){
  const client=useQueryClient();
  const query=useQuery<{global_prompt:string}>({queryKey:['admin','global-prompt'],queryFn:()=>api('/admin/global-prompt')});
  const [message,setMessage]=useState(''),[saving,setSaving]=useState(false);
  return <form className="card form-stack mt" key={query.data?.global_prompt} onSubmit={async e=>{
    e.preventDefault();
    const global_prompt=String(new FormData(e.currentTarget).get('global_prompt')||'');
    setSaving(true);setMessage('');
    try{const saved=await api('/admin/global-prompt','PUT',{global_prompt});client.setQueryData(['admin','global-prompt'],saved);setMessage('系统全局提示词已保存')}catch(e){setMessage((e as Error).message)}finally{setSaving(false)}
  }}>
    <h2>系统全局提示词</h2>
    <label className="field"><span>对所有用户生效的提示词</span><textarea name="global_prompt" defaultValue={query.data?.global_prompt||''} maxLength={10000} rows={6} disabled={query.isPending||query.isError||saving} placeholder="例如：统一使用简体中文，优先推荐容易买到的家常食材。"/></label>
    <p className="hint">保存后自动带入所有用户之后的菜单、单菜生成及自动修正，优先于个人提示词。食品安全、过敏忌口和输出格式等内置规则始终保留。最多 10000 字，留空可取消。</p>
    {(message||query.error)&&<div role="status">{message||query.error?.message}</div>}
    <Button disabled={query.isPending||query.isError||saving}>{saving?'保存中…':'保存系统提示词'}</Button>
  </form>
}
