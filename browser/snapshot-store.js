const chunkBytes=8*1024*1024;
const manifestKey='database-manifest-v1';
const legacyKey='database';
const chunkKey=index=>'database-chunk-'+index;

function snapshotTransaction(store,mode,run,{timeoutMs=30000}={}) {
 return new Promise((resolve,reject)=>{
  const tx=store.transaction('snapshots',mode);
  const table=tx.objectStore('snapshots');
  let result,failure;
  const timer=setTimeout(()=>abort(Error('O navegador demorou para responder ao armazenamento local.')),timeoutMs);
  function abort(error){
   try{
    tx.abort();
    failure=error;
   }catch(e){
    // Se já concluiu, aguarda a notificação da transação.
    if(e.name!=='InvalidStateError'){clearTimeout(timer);reject(error);}
   }
  }
  tx.oncomplete=()=>{clearTimeout(timer);resolve(result);};
  tx.onabort=()=>{clearTimeout(timer);reject(failure||tx.error||Error('O navegador cancelou a operação de armazenamento local.'));};
  function request(action,next){
   try{
    const pending=action(table);
    pending.onsuccess=()=>{
     try{next(pending.result);}
     catch(error){abort(error);}
    };
   }catch(error){abort(error);}
  }
  try{run(request,value=>{result=value;});}
  catch(error){abort(error);}
 });
}

function chunkCount(manifest){
 if(!Number.isSafeInteger(manifest.size)||manifest.size<=0)throw Error('O tamanho da base salva no navegador é inválido.');
 return Math.ceil(manifest.size/chunkBytes);
}

function loadSnapshot(store,options){
 return snapshotTransaction(store,'readonly',(request,done)=>{
  request(table=>table.get(manifestKey),manifest=>{
   if(!manifest){request(table=>table.get(legacyKey),done);return;}
   const count=chunkCount(manifest),snapshot=new Uint8Array(manifest.size);
   function read(index){
    if(index===count){done(snapshot);return;}
    const offset=index*chunkBytes;
    request(table=>table.get(chunkKey(index)),chunk=>{
     if(!(chunk instanceof Uint8Array)||chunk.byteLength!==Math.min(chunkBytes,snapshot.byteLength-offset))
      throw Error('A base salva no navegador está incompleta.');
     snapshot.set(chunk,offset);
     read(index+1);
    });
   }
   read(0);
  });
 },options);
}

function saveSnapshot(store,snapshot,options){
 const manifest={size:snapshot.byteLength},count=chunkCount(manifest);
 return snapshotTransaction(store,'readwrite',request=>{
  request(table=>table.get(manifestKey),previous=>{
   const oldCount=previous?chunkCount(previous):0;
   function removeStale(index){
    if(index<oldCount){request(table=>table.delete(chunkKey(index)),()=>removeStale(index+1));return;}
    request(table=>table.put(manifest,manifestKey),()=>{
     if(!previous)request(table=>table.delete(legacyKey),()=>{});
    });
   }
   function write(index){
    if(index===count){removeStale(index);return;}
    const offset=index*chunkBytes;
    // slice copia só este bloco. subarray serializaria também o buffer inteiro.
    request(table=>table.put(snapshot.slice(offset,offset+chunkBytes),chunkKey(index)),()=>write(index+1));
   }
   write(0);
  });
 },options);
}

module.exports={loadSnapshot,saveSnapshot};
