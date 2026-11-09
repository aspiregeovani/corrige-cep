// Somente esta ponte é ativada no build hospedado. Dados dos clientes vão para um Worker local.
(function(){
 const worker=new Worker('/client-worker.js',{type:'module'});let next=0,workerError;const pending=new Map();
 let readyResolve,readyReject;const ready=new Promise((resolve,reject)=>{readyResolve=resolve;readyReject=reject;});
 const readyTimeout=setTimeout(()=>failWorker(Error('O processamento local não iniciou. Atualize a página.')),30000);
 function failWorker(error){
  workerError=error;clearTimeout(readyTimeout);worker.terminate();readyReject(error);
  for(const task of pending.values()){clearTimeout(task.timer);task.reject(error);}
  pending.clear();
 }
 worker.onmessage=({data})=>{
  if(data.ready){clearTimeout(readyTimeout);readyResolve();return;}
  if(data.initError){failWorker(Error(data.initError));return;}
  const task=pending.get(data.id);if(!task)return;
  pending.delete(data.id);clearTimeout(task.timer);
  if(data.error)task.reject(Error(data.error));else task.resolve(data.result);
 };
 worker.onerror=event=>{console.error('Worker local:',event.message);failWorker(Error('O processamento local foi interrompido. Atualize a página.'));};
 worker.onmessageerror=()=>failWorker(Error('O navegador não recebeu a resposta do processamento local. Atualize a página.'));
 window.CepLocal={async fetch(url,options={}){
  await ready;if(workerError)throw workerError;let body=options.body;
  if(body instanceof FormData){const fields={},files={};for(const [key,value] of body){if(value instanceof File)files[key]={name:value.name,text:await value.text()};else fields[key]=value;}body={fields,files};}
  else if(typeof body==='string')body=JSON.parse(body);
  const id=++next;
  const result=await new Promise((resolve,reject)=>{
   if(workerError){reject(workerError);return;}
   const task={resolve,reject};pending.set(id,task);
   if(url==='/api/aplicar-lote')task.timer=setTimeout(()=>{
    failWorker(Error('Não foi possível confirmar a aplicação. Atualize a página para conferir os registros salvos antes de tentar novamente.'));
   },45000);
   if(url==='/api/status')task.timer=setTimeout(()=>{
    pending.delete(id);reject(Error('O navegador demorou para atualizar os resultados.'));
   },30000);
   try{worker.postMessage({id,url,method:options.method||'GET',body});}
   catch(error){clearTimeout(task.timer);pending.delete(id);reject(error);}
  });
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
