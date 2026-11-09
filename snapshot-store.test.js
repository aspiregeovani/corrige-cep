const test=require('node:test'),assert=require('node:assert/strict');
const {loadSnapshot,saveSnapshot}=require('./browser/snapshot-store');

function storage(initial=[]){
 let saved=new Map(initial);
 const store={
  writes:0,failAt:Infinity,stall:false,
  keys:()=>[...saved.keys()],
  transaction(){
   const draft=new Map(saved);
   let stopped=false,queued=0;
   function enqueue(action){
    const request={};queued++;
    if(!store.stall)setImmediate(()=>{
     if(stopped)return;
     request.result=action();queued--;request.onsuccess();
     if(!stopped&&!queued){saved=draft;stopped=true;tx.oncomplete();}
    });
    return request;
   }
   const tx={
    abort(){stopped=true;setImmediate(()=>tx.onabort());},
    objectStore:()=>({
     get:key=>enqueue(()=>draft.get(key)),
     delete:key=>enqueue(()=>draft.delete(key)),
     put(value,key){
      if(++store.writes===store.failAt)throw Error('Gravação interrompida');
      if(value instanceof Uint8Array)assert.ok(value.buffer.byteLength<=8*1024*1024);
      return enqueue(()=>draft.set(key,value));
     },
    }),
   };
   return tx;
  },
 };
 return store;
}

test('restaura o formato antigo, grava em blocos e remove os blocos excedentes ao reduzir a base',async()=>{
 const legacy=Uint8Array.of(1,2,3);
 const store=storage([['database',legacy]]);
 assert.deepEqual(await loadSnapshot(store),legacy);
 const large=new Uint8Array(17*1024*1024);large[0]=42;large[8*1024*1024]=63;large[large.length-1]=99;
 await saveSnapshot(store,large);
 assert.equal(store.writes,4);
 assert.ok(!store.keys().includes('database'));
 assert.deepEqual(await loadSnapshot(store),large);
 await saveSnapshot(store,legacy);
 assert.equal(store.keys().length,2);
 assert.deepEqual(await loadSnapshot(store),legacy);
});

test('aborto depois de gravar um bloco preserva a base anterior',async()=>{
 const store=storage(),previous=Uint8Array.of(8,9);
 await saveSnapshot(store,previous);
 store.failAt=store.writes+2;
 await assert.rejects(saveSnapshot(store,new Uint8Array(9*1024*1024)),/Gravação interrompida/);
 assert.deepEqual(await loadSnapshot(store),previous);
});

test('gravação sem resposta é cancelada antes de permitir nova tentativa',async()=>{
 const store=storage();
 store.stall=true;
 await assert.rejects(saveSnapshot(store,Uint8Array.of(1),{timeoutMs:10}),/demorou/);
 assert.deepEqual(store.keys(),[]);
});
