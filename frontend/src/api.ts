export let csrf='';
export async function api<T=any>(path:string,method='GET',body?:unknown,options?:Pick<RequestInit,'signal'|'keepalive'>):Promise<T>{const form=body instanceof FormData;const res=await fetch('/api/v1'+path,{...options,method,credentials:'same-origin',headers:{...(body&&!form?{'Content-Type':'application/json'}:{}),'X-CSRF-Token':csrf},body:body?form?body:JSON.stringify(body):undefined});const data=await res.json();if(!res.ok)throw new Error(data.error||'请求失败');if(data.csrf)csrf=data.csrf;return data;}
export type Doc={id:number;[key:string]:any};
export const split=(s:string)=>s.split(/[,，、\n]/).map(x=>x.trim()).filter(Boolean);
