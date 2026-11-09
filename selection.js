const {levels,bulkCandidates}=require('./public/review-utils');
const digits=x=>String(x??'').replace(/\D/g,'');
function chooseSuggestion(result,cep,{bulk=false,at=new Date().toISOString()}={}) {
 const r=structuredClone(result),selected=r.cep_sugestoes.find(s=>digits(s.cep)===digits(cep));
 if(!selected)throw Error('Sugestão inválida.');
 const originalConfidence=r.cep_confianca_anterior||r.cep_confianca;
 r.cep_sugestoes.forEach(s=>s.selecionado=s===selected);
 r.cli_cep=selected.cep;r.cep_fonte=selected.fonte;r.cep_base_versao=selected.versao||r.cep_base_versao;
 r.cep_alterado=digits(r.cep_anterior)!==digits(r.cli_cep);
 r.cep_status=bulk?'Aplicado em lote pelo usuário':'Selecionado pelo usuário';
 r.cep_confianca_anterior=originalConfidence;
 r.cep_confianca=bulk?originalConfidence:'Confirmada pelo usuário';
 r.cep_confianca_logradouro=bulk?selected.confianca_logradouro:'Confirmada pelo usuário';
 r.cep_nome_canonico=selected.endereco;r.cep_similaridade_nome=selected.similaridade_nome??null;
 r.cep_motivos_confianca=selected.motivos||[];r.cep_aplicado_em=at;
 if(bulk)r.cep_confianca_aplicada=originalConfidence;
 r.cep_motivo=bulk?`Primeira sugestão de confiança ${originalConfidence} aplicada em lote pelo usuário.`:'Sugestão escolhida manualmente pelo usuário.';
 return r;
}
function applyBulk(db,{execucaoId,itens}) {
 if(typeof execucaoId!=='string'||!execucaoId||!Array.isArray(itens)||!itens.length||itens.length>100000)
  throw Object.assign(Error('Informe a execução e os clientes filtrados.'),{status:400});
 const ids=new Set();
 for(const item of itens) {
  if(!item||!Number.isSafeInteger(item.id)||item.id<1||ids.has(item.id)||!levels.includes(item.confianca)||digits(item.cep).length!==8)
   throw Object.assign(Error('Lista de sugestões inválida.'),{status:400});
  ids.add(item.id);
 }
 const get=db.prepare('SELECT resultado FROM clientes WHERE id=?');
 const put=db.prepare('UPDATE clientes SET resultado=? WHERE id=?');
 let aplicados=0,ignorados=0;const at=new Date().toISOString();
 db.exec('BEGIN IMMEDIATE');
 try {
  if(db.prepare("SELECT valor FROM estado WHERE chave='execucao_id'").get()?.valor!==execucaoId)
   throw Object.assign(Error('A carga de clientes mudou. Atualize a tela antes de aplicar.'),{status:409});
  for(const item of itens) {
   const stored=get.get(item.id),r=stored?JSON.parse(stored.resultado):null;
   const current=r?bulkCandidates([{...r,_rowId:item.id}])[0]:null;
   if(!current||current.confianca!==item.confianca||digits(current.cep)!==digits(item.cep)){ignorados++;continue;}
   put.run(JSON.stringify(chooseSuggestion(r,item.cep,{bulk:true,at})),item.id);aplicados++;
  }
  db.exec('COMMIT');return {aplicados,ignorados};
 }catch(e){db.exec('ROLLBACK');throw e;}
}
module.exports={chooseSuggestion,applyBulk};
