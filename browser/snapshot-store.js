function stored(store,mode,callback,{timeoutMs=15000}={}) {
 return new Promise((resolve,reject)=>{
  const tx=store.transaction('snapshots',mode);
  let timer,value,settled=false;
  function finish(error){
   if(settled)return;
   settled=true;
   clearTimeout(timer);
   if(error)reject(error);
   else resolve(value);
  }
  tx.oncomplete=()=>finish();
  tx.onabort=()=>finish(tx.error||Error('O navegador cancelou a gravação local.'));
  try{
   const request=callback(tx.objectStore('snapshots'));
   request.onsuccess=()=>{value=request.result;};
  }catch(error){
   tx.abort();
   finish(error);
   return;
  }
  timer=setTimeout(()=>{
   try{
    tx.abort();
    finish(Error('O navegador demorou para responder ao armazenamento local.'));
   }catch(error){
    // Uma transação já concluída pode ter sua notificação aguardando na fila.
    if(error.name!=='InvalidStateError')finish(error);
   }
  },timeoutMs);
 });
}
module.exports={stored};
