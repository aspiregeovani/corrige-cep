import initSqlJs from 'sql.js';
import {registerStdFonts} from 'pdfkit';
import Helvetica from 'pdfkit/standard-fonts/Helvetica';
import HelveticaBold from 'pdfkit/standard-fonts/HelveticaBold';
import CourierBold from 'pdfkit/standard-fonts/CourierBold';
registerStdFonts(Helvetica,HelveticaBold,CourierBold);
let db,core,store,queue=Promise.resolve(),running=false,busy=false,lastError='';
const ufList='AC AL AP AM BA CE DF ES GO MA MT MS MG PA PB PR PE PI RJ RN RS RO RR SC SP SE TO'.split(' ');
function openStore(){return new Promise((resolve,reject)=>{const r=indexedDB.open('cep-em-dia',1);r.onupgradeneeded=()=>r.result.createObjectStore('snapshots');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});}
const {loadSnapshot,saveSnapshot}=require('./snapshot-store');
let saving=Promise.resolve();
function save(){
 const task=saving.then(()=>saveSnapshot(store,db.export()));
 saving=task.catch(()=>{});
 return task;
}
async function applyBulkAndSave(body){
 const previous=[];
 const result=require('../selection').applyBulk(db,body,{beforeUpdate:(id,original)=>previous.push([original,id])});
 if(!result.aplicados)return result;
 try{
  await save();
  return result;
 }catch(error){
  const restore=db.prepare('UPDATE clientes SET resultado=? WHERE id=?');
  db.exec('BEGIN');
  try{
   for(const record of previous)restore.run(...record);
   db.exec('COMMIT');
  }catch(rollbackError){
   db.exec('ROLLBACK');
   throw rollbackError;
  }
  throw Error('Não foi possível salvar o lote no navegador. '+error.message);
 }
}
function rows(){return db.prepare('SELECT id,resultado FROM clientes ORDER BY id').all().map(r=>({...JSON.parse(r.resultado),_rowId:r.id}));}
function originals(){return db.prepare('SELECT original FROM clientes').all().map(r=>JSON.parse(r.original));}
const {loadCities,fetchJSON}=require('./postal-loader');
let baseProgress=null;
const unavailable=(uf,city)=>db.prepare('SELECT motivo FROM cidades_ausentes WHERE uf=? AND cidade=?').get(uf,city);
async function cloudStatus(force=false){return (await fetchJSON('/api/postal',{cache:force?'reload':'default'})).bases;}
async function loadBases(ufs,force=false){
 if(busy)throw Error('Outra importação está em andamento.');busy=true;lastError='';
 const cities=new Map();for(const c of originals()){const uf=core.getUf(c),city=core.norm(c.cli_cidade);if(ufs.includes(uf)&&city){const key=uf+'|'+city;const item=cities.get(key)||{uf,city,count:0};item.count++;cities.set(key,item);}}
 baseProgress={total:cities.size,completed:0};
 if(core.getState('pausado')!=='1')start();
 try{
  const bases=await cloudStatus(force),baseByUf=new Map(bases.map(b=>[b.uf,b]));
  for(const base of bases)db.prepare('INSERT OR REPLACE INTO bases VALUES(?,?,?,?,?)').run(base.uf,base.fonte,base.versao,base.baixado_em,base.registros);
  const result=await loadCities([...cities.values()].sort((a,b)=>b.count-a.count),{
   isCached:({uf,city})=>!force&&(db.prepare('SELECT 1 FROM cidades_carregadas WHERE uf=? AND cidade=?').get(uf,city)||unavailable(uf,city)),
   load:async({uf,city})=>{
    if(!baseByUf.has(uf))throw Error('UF não disponível na base central.');
    const snapshot=await fetchJSON('/api/postal?action=city&uf='+encodeURIComponent(uf)+'&city='+encodeURIComponent(city),{cache:force?'reload':'default'});
    if(!Array.isArray(snapshot.registros))throw Error('Resposta inválida da base postal.');
    if(!snapshot.registros.length)throw Object.assign(Error('Cidade sem endereços na base postal.'),{status:404});
    return snapshot;
   },
   importSnapshot:({uf,city},snapshot)=>{
    db.exec('BEGIN');try{
     db.prepare('DELETE FROM enderecos WHERE uf=? AND cidade=?').run(uf,city);
     const put=db.prepare('INSERT INTO enderecos VALUES(?,?,?,?,?,?)');
     for(const r of snapshot.registros)put.run(uf,city,r.rua,r.bairro,r.cep,r.original);
     db.prepare('INSERT OR REPLACE INTO cidades_carregadas VALUES(?,?)').run(uf,city);
     db.prepare('DELETE FROM cidades_ausentes WHERE uf=? AND cidade=?').run(uf,city);db.exec('COMMIT');
    }catch(e){db.exec('ROLLBACK');throw e;}
    require('../review').clearReviewCache(db);
   },
   onMissing:({uf,city},error)=>{
    // Uma recarga malsucedida nunca invalida endereços já salvos.
    if(!db.prepare('SELECT 1 FROM cidades_carregadas WHERE uf=? AND cidade=?').get(uf,city))
     db.prepare('INSERT OR REPLACE INTO cidades_ausentes VALUES(?,?,?,?)').run(uf,city,error.message,new Date().toISOString());
   },
   onReady:()=>{if(core.getState('pausado')!=='1')start();},
   onProgress:p=>{baseProgress=p;},
  });
  if(result.failed)lastError=result.failed+' cidade(s) não carregada(s): '+result.failures.map(f=>f.city+' / '+f.uf).join(', ')+'. As demais continuam sendo processadas. Use Continuar para tentar novamente.';
 }catch(e){lastError=e.message;}finally{busy=false;await save();}
 return {ok:!lastError};
}
function start(){if(running)return;running=true;core.setState('pausado','0');setTimeout(tick,0);}
function tick(){if(!running)return;const pending=db.prepare("SELECT id,original FROM clientes WHERE json_extract(resultado,'$.cep_status')='Pendente' ORDER BY id").all();
 const ready=pending.filter(r=>{const c=JSON.parse(r.original),uf=core.getUf(c),city=core.norm(c.cli_cidade);return !ufList.includes(uf)||!city||!core.norm(c.cli_endereco)||db.prepare('SELECT 1 FROM cidades_carregadas WHERE uf=? AND cidade=?').get(uf,city)||unavailable(uf,city);}).slice(0,100);
 if(!ready.length){running=false;if(!busy)save().catch(e=>lastError=e.message);return;}
 db.exec('BEGIN');try{const put=db.prepare('UPDATE clientes SET resultado=? WHERE id=?');for(const row of ready){const original=JSON.parse(row.original),result=core.processClient(original);if(unavailable(core.getUf(original),core.norm(original.cli_cidade))){result.cep_status='Não encontrado';result.cep_motivo='Cidade '+original.cli_cidade+' / '+core.getUf(original)+' sem endereços na base postal. Confira a cidade e a UF ou importe um complemento. O CEP original foi mantido.';}put.run(JSON.stringify(result),row.id);}db.exec('COMMIT');}
 catch(e){db.exec('ROLLBACK');running=false;lastError=e.message;return;}setTimeout(tick,0);
}
async function handle({url,method,body}){
 const requestUrl=new URL(url,'https://cep.local');url=requestUrl.pathname;
 if(url==='/api/status'){
  const list=rows(),needed=[...new Set(list.map(core.getUf).filter(u=>ufList.includes(u)))].sort();
  const missing=[...new Set(originals().filter(c=>!db.prepare('SELECT 1 FROM cidades_carregadas WHERE uf=? AND cidade=?').get(core.getUf(c),core.norm(c.cli_cidade))&&!unavailable(core.getUf(c),core.norm(c.cli_cidade))).map(core.getUf).filter(u=>ufList.includes(u)))];
  const absent=[...new Set(originals().filter(c=>unavailable(core.getUf(c),core.norm(c.cli_cidade))).map(c=>core.norm(c.cli_cidade)+' / '+core.getUf(c)))];
  return {data:{baseProgress,warning:absent.length?'Cidade(s) sem endereços na base: '+absent.join(', ')+'. Esses clientes ficam como Não encontrado; confira a cidade e a UF.':'',rows:list,bases:db.prepare('SELECT * FROM bases ORDER BY uf').all(),supplementalBases:[],needed,missing,running,busy,paused:core.getState('pausado')==='1',execucaoId:core.getState('execucao_id'),error:lastError}};
 }
 if(url==='/api/clientes'){
  if(busy)return {status:409,data:{error:'Aguarde o carregamento das bases terminar.'}};
  const value=JSON.parse(body.files.file.text.replace(/^\uFEFF/,'')),arrays=Array.isArray(value)?[value]:Object.values(value).filter(Array.isArray),list=arrays.length===1?arrays[0]:null;
  if(!list||list.some(c=>!c||typeof c!=='object'||Array.isArray(c)))throw Error('O JSON deve conter uma lista de clientes.');
  running=false;lastError='';baseProgress=null;
  db.exec('BEGIN');try{db.exec('DELETE FROM clientes');const put=db.prepare('INSERT INTO clientes(original,resultado) VALUES(?,?)');
   for(const c of list)put.run(JSON.stringify(c),JSON.stringify({...c,cli_cep:core.mask(c.cli_cep??''),cep_anterior:c.cli_cep??'',cep_status:'Pendente',cep_alterado:false,cep_quantidade_sugestoes:0,cep_sugestoes:[]}));
   const cities=new Set();
   for(const c of list){
    const uf=core.getUf(c),city=core.norm(c.cli_cidade),key=uf+'|'+city;
    if(cities.has(key))continue;
    cities.add(key);
    db.prepare('DELETE FROM cidades_carregadas WHERE uf=? AND cidade=?').run(uf,city);
    db.prepare('DELETE FROM cidades_ausentes WHERE uf=? AND cidade=?').run(uf,city);
    db.prepare('DELETE FROM enderecos WHERE uf=? AND cidade=?').run(uf,city);
   }
   core.setState('execucao_id',crypto.randomUUID());core.setState('pausado','0');db.exec('COMMIT');
  }catch(e){db.exec('ROLLBACK');throw e;}
  require('../review').clearReviewCache(db);
  await save();loadBases([...new Set(list.map(core.getUf))],true).catch(e=>lastError=e.message);return {data:{total:list.length}};
 }
 if(url==='/api/download'){
  if(busy)return {status:409,data:{error:'Outra importação está em andamento.'}};
  loadBases(body.ufs,true).catch(e=>lastError=e.message);return {data:{ok:true}};
 }
 if(url==='/api/pausar'){running=false;core.setState('pausado','1');await save();return {data:{ok:true}};}
 if(url==='/api/continuar'){core.setState('pausado','0');if(!busy)loadBases(ufList).catch(()=>{});return {data:{ok:true}};}
 if(url==='/api/aplicar-lote'){
  if(busy||running)return {status:409,data:{error:'Aguarde o processamento terminar.'}};
  return {data:await applyBulkAndSave(body)};
 }
 if(url.startsWith('/api/escolher/')){const id=Number(url.split('/').pop()),row=db.prepare('SELECT resultado FROM clientes WHERE id=?').get(id);if(!row)return {status:404,data:{error:'Cliente não encontrado.'}};
  const r=require('../selection').chooseSuggestion(JSON.parse(row.resultado),body.cep);db.prepare('UPDATE clientes SET resultado=? WHERE id=?').run(JSON.stringify(r),id);await save();return {data:r};}
 if(url.startsWith('/api/exportar/')){
  const [, , ,kind,format]=url.split('/');let list=rows();const totalClients=list.length,partial=running||busy||list.some(r=>r.cep_status==='Pendente');
  if(kind==='alterados')list=list.filter(r=>r.cep_alterado);else if(kind!=='todos')return {status:404,data:{error:'Exportação inválida.'}};
  const name='cep-'+kind+(partial?'-parcial':'');
  if(format==='pdf'){
   const confidence=requestUrl.searchParams.get('confidence')||'';
   if(confidence!==''&&!['Alta','Média','Baixa'].includes(confidence))return {status:400,data:{error:'Confiança do PDF inválida.'}};
   const {prepareReport,renderReport,reportFilename}=require('../pdf-report');const r=await renderReport(prepareReport(list,{totalClients,partial,confidence}));
   return {binary:r.buffer,headers:{'Content-Type':'application/pdf','Content-Disposition':'attachment; filename="'+reportFilename({confidence,partial})+'"','X-Report-Records':String(r.records),'X-Report-Pages':String(r.pages)}};
  }
  let content,type;if(format==='json'){content=JSON.stringify(list.map(({_rowId,...r})=>r));type='application/json';}
  else if(format==='sql'&&kind==='alterados'){content=require('../sql').gerarUpdates(list);type='application/sql';}
  else if(format==='csv'){const keys=[...new Set(list.flatMap(r=>Object.keys(r).filter(k=>k!=='_rowId')))];const quote=x=>'"'+(typeof x==='object'&&x!==null?JSON.stringify(x):String(x??'')).replace(/"/g,'""')+'"';content='\ufeff'+keys.map(quote).join(';')+'\r\n'+list.map(r=>keys.map(k=>quote(r[k])).join(';')).join('\r\n');type='text/csv';}
  else throw Error('Formato de exportação inválido.');
  return {binary:new TextEncoder().encode(content),headers:{'Content-Type':type+'; charset=utf-8','Content-Disposition':'attachment; filename="'+name+'.'+format+'"'}};
 }
 if(url==='/api/importar'){
  if(busy)return {status:409,data:{error:'Outra importação está em andamento.'}};
  const uf=String(body.fields.uf||'').toUpperCase();if(!ufList.includes(uf))throw Error('UF inválida.');
  const {parse}=require('csv-parse/sync');
  const read=key=>{if(!body.files[key])throw Error('Informe os três arquivos CSV.');return parse(body.files[key].text,{columns:true,bom:true,skip_empty_lines:true});};
  const municipalities=new Map(read('municipios').map(r=>[r.id,r])),cities=new Map(read('cidades').map(r=>[r.id,r])),addresses=read('cep');
  busy=true;running=false;db.exec('BEGIN');try{
   db.prepare('DELETE FROM enderecos WHERE uf=?').run(uf);db.prepare('DELETE FROM cidades_carregadas WHERE uf=?').run(uf);
   const put=db.prepare('INSERT INTO enderecos VALUES(?,?,?,?,?,?)'),loaded=new Set();
   for(const r of addresses){const city=cities.get(r.id_city),municipality=city&&municipalities.get(city.id_municipality);
    if(!city||!municipality||r.id_federative_unit.toUpperCase()!==uf||municipality.id_federative_unit.toUpperCase()!==uf)throw Error('Relação de cidade ou UF inválida.');
    const type=core.norm(r.type),name=core.norm(r.name),street=type&&(name===type||name.startsWith(type+' '))?r.name:[r.type,r.name].filter(Boolean).join(' ');
    const detail={endereco:street,bairro:r.neighborhood,complemento:r.complement||r.complemento||'',cidade:city.name,municipio:municipality.name};
    for(const key of new Set([core.norm(city.name),core.norm(municipality.name)])){put.run(uf,key,core.norm(street),core.norm(r.neighborhood),r.cep,JSON.stringify(detail));loaded.add(key);}
   }
   if(!addresses.length)throw Error('CSV vazio.');
   db.prepare('INSERT OR REPLACE INTO bases VALUES(?,?,?,?,?)').run(uf,'Importação local','Arquivo local',new Date().toISOString(),addresses.length);
   for(const city of loaded){db.prepare('INSERT OR REPLACE INTO cidades_carregadas VALUES(?,?)').run(uf,city);db.prepare('DELETE FROM cidades_ausentes WHERE uf=? AND cidade=?').run(uf,city);}
   db.exec('COMMIT');require('../review').clearReviewCache(db);await save();return {data:{count:addresses.length}};
  }catch(e){try{db.exec('ROLLBACK');}catch{}throw e;}finally{busy=false;if(core.getState('pausado')!=='1')start();}
 }
 throw Error('Operação não encontrada.');
}
async function boot(){store=await openStore();const bytes=await loadSnapshot(store);const SQL=await initSqlJs({locateFile:()=>'/sql-wasm.wasm'});
 db=require('./db').activate(new SQL.Database(bytes));core=require('../core');db.exec('CREATE TABLE IF NOT EXISTS cidades_carregadas(uf TEXT,cidade TEXT,PRIMARY KEY(uf,cidade));CREATE TABLE IF NOT EXISTS cidades_ausentes(uf TEXT,cidade TEXT,motivo TEXT,consultado_em TEXT,PRIMARY KEY(uf,cidade));');
 if(!core.getState('execucao_id'))core.setState('execucao_id',crypto.randomUUID());
 postMessage({ready:true});if(core.getState('pausado')!=='1'&&db.prepare("SELECT 1 FROM clientes WHERE json_extract(resultado,'$.cep_status')='Pendente' LIMIT 1").get())loadBases(ufList).catch(e=>lastError=e.message);
}
onmessage=event=>{queue=queue.then(async()=>{try{const result=await handle(event.data);if(result.binary)postMessage({id:event.data.id,result},[result.binary.buffer]);else postMessage({id:event.data.id,result});}
 catch(e){postMessage({id:event.data.id,result:{status:e.status||400,data:{error:e.message}}});}});};
boot().catch(e=>postMessage({initError:e.message}));
