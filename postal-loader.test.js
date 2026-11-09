const test=require('node:test'),assert=require('node:assert/strict');
const {loadCities,fetchJSON}=require('./browser/postal-loader');
test('carga continua após cidade ausente e falha transitória, usando o cache e liberando cada cidade',async()=>{
 const cities=['CACHE','BARIRI','SOUSA','FALHA','ITAJU'].map(city=>({uf:'SP',city}));
 const requested=[],imported=[],ready=[],missing=[],updates=[];
 const result=await loadCities(cities,{
  isCached:c=>c.city==='CACHE',
  load:async c=>{requested.push(c.city);if(c.city==='SOUSA')throw Object.assign(Error('Ausente'),{status:404});if(c.city==='FALHA')throw Object.assign(Error('Indisponível'),{status:503});return {cidade:c.city};},
  importSnapshot:(c,s)=>{assert.equal(c.city,s.cidade);imported.push(c.city);},
  onMissing:c=>missing.push(c.city),onReady:c=>ready.push(c.city),onProgress:p=>updates.push(p),
 });
 assert.deepEqual(requested.sort(),['BARIRI','FALHA','ITAJU','SOUSA']);assert.deepEqual(imported.sort(),['BARIRI','ITAJU']);
 assert.deepEqual(missing,['SOUSA']);assert.deepEqual(ready.sort(),['BARIRI','CACHE','ITAJU','SOUSA']);
 assert.equal(result.completed,5);assert.equal(result.loaded,2);assert.equal(result.cached,1);assert.equal(result.missing,1);assert.equal(result.failed,1);
 assert.equal(updates[0].completed,0);assert.equal(updates.at(-1).completed,5);assert.equal(result.failures[0].city,'FALHA');
});
test('uma cidade lenta não impede processar as já carregadas e a concorrência é limitada',async()=>{
 let release;const blocked=new Promise(resolve=>release=resolve);const ready=[];let active=0,maxActive=0;
 const loading=loadCities(['LENTA','BARIRI','ITAJU'].map(city=>({city})),{
  concurrency:2,isCached:()=>false,load:async c=>{active++;maxActive=Math.max(maxActive,active);if(c.city==='LENTA')await blocked;active--;return {};},
  importSnapshot:()=>{},onMissing:()=>{},onReady:c=>ready.push(c.city),
 });
 await new Promise(resolve=>setImmediate(resolve));assert.deepEqual(ready,['BARIRI','ITAJU']);assert.equal(maxActive,2);
 release();const result=await loading;assert.equal(result.completed,3);assert.equal(ready.at(-1),'LENTA');
});
test('download tem limite de tempo e preserva HTTP 404 para distinguir ausência de falha temporária',async()=>{
 const original=global.fetch;
 try{
  global.fetch=async()=>({ok:false,status:404,json:async()=>({error:'Cidade ausente'})});
  await assert.rejects(fetchJSON('/cidade'),e=>e.status===404);
  global.fetch=(_url,{signal})=>new Promise((_resolve,reject)=>signal.addEventListener('abort',()=>reject(Error('aborted'))));
  await assert.rejects(fetchJSON('/lenta',{timeout:10}),/Tempo limite/);
 }finally{global.fetch=original;}
});
