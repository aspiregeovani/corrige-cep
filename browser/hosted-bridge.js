// Somente esta ponte é ativada no build hospedado. Dados dos clientes vão para um Worker local.
(function(){
 const worker=new Worker('/client-worker.js',{type:'module'});let next=0;const pending=new Map();
 let readyResolve,readyReject;const ready=new Promise((resolve,reject)=>{readyResolve=resolve;readyReject=reject;});
 worker.onmessage=({data})=>{if(data.ready){readyResolve();return;}if(data.initError){readyReject(Error(data.initError));return;}
  const task=pending.get(data.id);if(!task)return;pending.delete(data.id);data.error?task.reject(Error(data.error)):task.resolve(data.result);};
 worker.onerror=event=>{console.error('Worker local:',event.message);const e=Error(event.message||'Não foi possível iniciar o processamento local. Atualize a página.');readyReject(e);for(const p of pending.values())p.reject(e);pending.clear();};
 window.CepLocal={async fetch(url,options={}){
  await ready;let body=options.body;
  if(body instanceof FormData){const fields={},files={};for(const [key,value] of body){if(value instanceof File)files[key]={name:value.name,text:await value.text()};else fields[key]=value;}body={fields,files};}
  else if(typeof body==='string')body=JSON.parse(body);
  const id=++next;const result=await new Promise((resolve,reject)=>{pending.set(id,{resolve,reject});worker.postMessage({id,url,method:options.method||'GET',body});});
  return new Response(result.binary||JSON.stringify(result.data??null),{status:result.status||200,headers:result.headers||{'Content-Type':'application/json'}});
 }};
 document.addEventListener('click',async event=>{
  const link=event.target.closest('a[href^="/api/exportar/"]');if(!link)return;event.preventDefault();
  try{const r=await window.CepLocal.fetch(link.getAttribute('href'));if(!r.ok)throw Error((await r.json()).error||'Não foi possível exportar.');
   const url=URL.createObjectURL(await r.blob()),a=document.createElement('a');a.href=url;a.download=r.headers.get('Content-Disposition')?.match(/filename="([^"]+)"/)?.[1]||'ceps.json';
   document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
  }catch(e){const notice=document.querySelector('#notice');notice.textContent=e.message;notice.className='notice';}
 });
})();
