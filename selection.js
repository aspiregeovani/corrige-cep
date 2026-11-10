const {levels,bulkCandidates,keepSpecificCep}=require('./public/review-utils');
const digits=x=>String(x??'').replace(/\D/g,'');
function selectAutomaticCep(result,{highConfidence=false}={}) {
 const recommended=result.cep_sugestoes[0];
 const oldDigits=digits(result.cep_anterior),firstDigits=digits(recommended.cep);
 const protectsSpecific=keepSpecificCep(result.cep_anterior,recommended.cep);
 const previous=oldDigits.length===8&&!oldDigits.endsWith('000')&&oldDigits.slice(0,5)===firstDigits.slice(0,5)
  ? result.cep_sugestoes.find(s=>digits(s.cep)===oldDigits)
  : undefined;
 if(previous){
  result.cep_sugestoes.splice(result.cep_sugestoes.indexOf(previous),1);
  result.cep_sugestoes.unshift(previous);
 }
 const chosen=previous||(protectsSpecific?undefined:recommended);
 for(const suggestion of result.cep_sugestoes)suggestion.selecionado=suggestion===chosen;
 result.cli_cep=chosen?.cep??result.cli_cep;
 result.cep_alterado=oldDigits!==digits(result.cli_cep);
 result.cep_status=protectsSpecific?'CEP anterior mantido':
  highConfidence||result.cep_sugestoes.length>1?'Selecionado automaticamente':'Correspondência única';
 const reason=protectsSpecific
  ? 'CEP específico mantido porque o recomendado termina em -000 e tem a mesma raiz de cinco dígitos. '
  : previous?'CEP anterior encontrado nas sugestões e mantido por compartilhar a raiz de cinco dígitos com o primeiro resultado. ':'';
 result.cep_motivo=reason+(highConfidence
  ? 'Sugestão selecionada automaticamente por alta confiança no CEP, considerando nome e bairro. '
  : 'Logradouro e cidade exatos após normalização. ')+
  'A base não informa faixa de numeração, lado ou trecho.'+
  (oldDigits.length!==8?' CEP anterior inválido preservado para auditoria.':'');
 const source=chosen||recommended;
 result.cep_fonte=source.fonte;
 result.cep_base_versao=source.versao;
 if(highConfidence){
  result.cep_confianca_anterior=result.cep_confianca;
  result.cep_confianca_aplicada=source.confianca||'Alta';
  result.cep_confianca=result.cep_confianca_aplicada;
  result.cep_confianca_logradouro=source.confianca_logradouro;
  result.cep_nome_canonico=source.endereco;
  result.cep_similaridade_nome=source.similaridade_nome??null;
  result.cep_motivos_confianca=source.motivos||[];
  result.cep_aplicado_em=new Date().toISOString();
 }
 return result;
}
function selectHighConfidence(result) {
 if(result.cep_status!=='Revisar endereço'||result.cep_confianca!=='Alta'||
  result.cep_sugestoes?.[0]?.confianca!=='Alta'||digits(result.cep_sugestoes[0].cep).length!==8||
  result.cep_sugestoes.some(s=>s.selecionado)||
  digits(result.cli_cep)!==digits(result.cep_anterior))return result;
 return selectAutomaticCep(structuredClone(result),{highConfidence:true});
}
function applyStoredHighConfidence(db,{beforeUpdate}={}) {
 let aplicados=0;
 db.exec('BEGIN IMMEDIATE');
 try{
  const rows=db.prepare("SELECT id,resultado FROM clientes WHERE json_extract(resultado,'$.cep_status')='Revisar endereço' AND json_extract(resultado,'$.cep_confianca')='Alta'").all();
  const put=db.prepare('UPDATE clientes SET resultado=? WHERE id=?');
  for(const row of rows){
   const original=JSON.parse(row.resultado),selected=selectHighConfidence(original);
   if(selected===original)continue;
   beforeUpdate?.(row.id,row.resultado);
   put.run(JSON.stringify(selected),row.id);
   aplicados++;
  }
  db.exec('COMMIT');
  return {aplicados};
 }catch(error){db.exec('ROLLBACK');throw error;}
}
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
function applyBulk(db,{execucaoId,itens},{beforeUpdate}={}) {
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
   const chosen=chooseSuggestion(r,item.cep,{bulk:true,at});
   beforeUpdate?.(item.id,stored.resultado);
   put.run(JSON.stringify(chosen),item.id);aplicados++;
  }
  db.exec('COMMIT');return {aplicados,ignorados};
 }catch(e){db.exec('ROLLBACK');throw e;}
}
module.exports={chooseSuggestion,applyBulk,selectAutomaticCep,selectHighConfidence,applyStoredHighConfidence};
