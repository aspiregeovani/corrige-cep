const test=require('node:test'),assert=require('node:assert/strict');
const {stored}=require('./browser/snapshot-store');

test('gravação só confirma após concluir a transação e propaga aborto mesmo sem evento de erro',async()=>{
 const request={result:'resultado'};
 const tx={objectStore:()=>({put:()=>request})};
 const store={transaction:()=>tx};
 const pending=stored(store,'readwrite',s=>s.put());
 let confirmed=false;
 pending.then(()=>{confirmed=true;});
 request.onsuccess();
 await Promise.resolve();
 assert.equal(confirmed,false);
 tx.oncomplete();
 assert.equal(await pending,'resultado');

 const failed=stored(store,'readwrite',s=>s.put());
 tx.error=new DOMException('Gravação cancelada','AbortError');
 tx.onabort();
 await assert.rejects(failed,{name:'AbortError'});
});

test('gravação sem resposta é cancelada antes de permitir nova tentativa',async()=>{
 let aborted=false;
 const tx={objectStore:()=>({put:()=>({})}),abort(){aborted=true;}};
 await assert.rejects(stored({transaction:()=>tx},'readwrite',s=>s.put(),{timeoutMs:10}),/demorou/);
 assert.equal(aborted,true);
});
