const test=require('node:test'),assert=require('node:assert/strict');
const {DatabaseSync}=require('node:sqlite');
const {chooseSuggestion,applyBulk}=require('./selection');
const {filteredRows,bulkCandidates}=require('./public/review-utils');
const {gerarUpdates}=require('./sql');
function result(id,confidence='Média') {
 const cep='17.250-'+String(id).padStart(3,'0');
 return {cli_codigo:id,cli_cidade:'BARIRI',cli_endereco:'RUA ORIGINAL',cli_bairro:'CENTRO',
  cli_cep:'17.250-000',cep_anterior:'17.250-000',cep_alterado:false,cep_status:'Revisar endereço',
  cep_confianca:confidence,cep_nome_canonico:'Rua Canônica',cep_sugestoes:[
   {cep,endereco:'Rua Canônica',bairro:'Centro',fonte:'fonte-local',versao:'v1',confianca:confidence,confianca_logradouro:'Alta',selecionado:false},
   {cep:'17.259-999',endereco:'Outra rua',confianca:'Baixa',selecionado:false}
  ]};
}
function setup() {
 const db=new DatabaseSync(':memory:');
 db.exec("CREATE TABLE estado(chave TEXT PRIMARY KEY,valor TEXT);CREATE TABLE clientes(id INTEGER PRIMARY KEY,original TEXT,resultado TEXT);INSERT INTO estado VALUES('execucao_id','run-1');");
 const put=db.prepare('INSERT INTO clientes VALUES(?,?,?)');
 for(const [i,level] of ['Alta','Média','Baixa'].entries())put.run(i+1,'original-'+(i+1),JSON.stringify(result(i+1,level)));
 return db;
}
const read=db=>db.prepare('SELECT id,resultado FROM clientes ORDER BY id').all().map(r=>({...JSON.parse(r.resultado),_rowId:r.id}));
test('filtros de confiança são exatos e a busca limita a aplicação em todas as páginas',()=>{
 const rows=Array.from({length:121},(_,i)=>({...result(i+1,i%2?'Alta':'Média'),_rowId:i+1}));
 const medium=filteredRows(rows,{tab:'review',confidence:'Média'});
 assert.equal(medium.length,61);assert.equal(bulkCandidates(medium).length,61);
 assert.ok(medium.every(r=>r.cep_confianca==='Média'));
 assert.equal(filteredRows(rows,{confidence:'Baixa'}).length,0);
 assert.equal(filteredRows(rows,{confidence:'Média',code:'1'}).length,1);
 assert.equal(filteredRows(rows,{confidence:'Média',code:'12'}).length,0);
 assert.equal(filteredRows(rows,{confidence:'Média',query:'CANONICA'}).length,61);
});
test('cada nível pode ser aplicado em massa preservando original e exportação SQL',()=>{
 for(const level of ['Alta','Média','Baixa']) {
  const db=setup(),items=bulkCandidates(filteredRows(read(db),{confidence:level}));
  assert.deepEqual(applyBulk(db,{execucaoId:'run-1',itens:items}),{aplicados:1,ignorados:0});
  const rows=read(db),r=rows.find(x=>x.cep_confianca_aplicada===level);
  assert.equal(r.cli_cep,r.cep_sugestoes[0].cep);assert.equal(r.cep_status,'Aplicado em lote pelo usuário');
  assert.equal(r.cep_anterior,'17.250-000');assert.equal(r.cep_confianca,level);assert.equal(r.cep_alterado,true);
  assert.equal(r.cep_sugestoes.filter(s=>s.selecionado).length,1);
  assert.equal(rows.filter(x=>x.cep_status==='Revisar endereço').length,2);
  assert.ok(gerarUpdates(rows).includes(r.cli_cep));
  assert.equal(db.prepare('SELECT original FROM clientes WHERE id=?').get(r._rowId).original,'original-'+r._rowId);
  assert.deepEqual(applyBulk(db,{execucaoId:'run-1',itens:items}),{aplicados:0,ignorados:1});
  assert.equal(filteredRows(read(db),{confidence:level}).length,1);
  db.close();
 }
});
test('outra carga, confiança modificada e sugestão trocada não são aplicadas',()=>{
 const db=setup(),items=bulkCandidates(read(db));
 assert.throws(()=>applyBulk(db,{execucaoId:'outra-carga',itens:items}),e=>e.status===409);
 assert.deepEqual(applyBulk(db,{execucaoId:'run-1',itens:[{...items[0],confianca:'Baixa'},{...items[1],cep:'17.259-999'}]}),{aplicados:0,ignorados:2});
 assert.ok(read(db).every(r=>!r.cep_alterado));db.close();
});
test('lote preserva CEP específico diante de recomendação 000 da mesma raiz, com escolha manual disponível',()=>{
 const db=setup(),review=result(1,'Alta');
 review.cli_cep=review.cep_anterior='17.250-101';
 review.cep_sugestoes[0].cep='17.250-000';
 db.prepare('UPDATE clientes SET resultado=? WHERE id=1').run(JSON.stringify(review));
 assert.ok(!bulkCandidates(read(db)).some(item=>item.id===1));
 assert.deepEqual(applyBulk(db,{execucaoId:'run-1',itens:[{id:1,cep:'17.250-000',confianca:'Alta'}]}),
  {aplicados:0,ignorados:1});
 const [kept]=read(db);
 assert.equal(kept.cli_cep,'17.250-101');
 assert.equal(gerarUpdates([kept]),'');
 assert.equal(chooseSuggestion(kept,'17.250-000').cli_cep,'17.250-000');
 db.close();
});
test('aplicação não substitui escolha manual e faz rollback se um registro falhar',()=>{
 const db=setup(),items=bulkCandidates(read(db));
 const manual=chooseSuggestion(result(1,'Alta'),'17.259-999');
 db.prepare('UPDATE clientes SET resultado=? WHERE id=1').run(JSON.stringify(manual));
 assert.deepEqual(applyBulk(db,{execucaoId:'run-1',itens:[items[0]]}),{aplicados:0,ignorados:1});
 assert.equal(read(db)[0].cli_cep,'17.259-999');
 db.prepare('UPDATE clientes SET resultado=? WHERE id=3').run('JSON inválido');
 assert.throws(()=>applyBulk(db,{execucaoId:'run-1',itens:items.slice(1)}));
 assert.equal(JSON.parse(db.prepare('SELECT resultado FROM clientes WHERE id=2').get().resultado).cep_status,'Revisar endereço');
 db.close();
});
test('IDs repetidos e entradas inválidas não alteram clientes',()=>{
 const db=setup(),items=bulkCandidates(read(db));
 for(const value of [[],[items[0],items[0]],[{...items[0],id:-1}],[{...items[0],confianca:'Desconhecida'}]])
  assert.throws(()=>applyBulk(db,{execucaoId:'run-1',itens:value}),e=>e.status===400);
 assert.ok(read(db).every(r=>!r.cep_alterado));db.close();
});
