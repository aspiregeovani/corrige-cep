(function(root,factory){
 if(typeof module==='object'&&module.exports)module.exports=factory();
 else root.CepReview=factory();
})(typeof globalThis!=='undefined'?globalThis:this,function(){
 const levels=['Alta','Média','Baixa'];
 const searchNorm=v=>String(v??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim();
 const confidenceOf=r=>r.cep_confianca_aplicada||r.cep_confianca_anterior||r.cep_confianca;
 const digits=v=>String(v??'').replace(/\D/g,'');
 function keepSpecificCep(current,recommended) {
  const old=digits(current),next=digits(recommended);
  return old.length===8&&next.length===8&&!old.endsWith('000')&&next.endsWith('000')&&old.slice(0,5)===next.slice(0,5);
 }
 function pdfConfidenceOf(row) {
  const suggestions=row.cep_sugestoes||[],sameCep=s=>digits(s.cep)===digits(row.cli_cep);
  const selected=suggestions.find(s=>s.selecionado&&sameCep(s))||suggestions.find(sameCep)||{};
  return [selected.confianca,row.cep_confianca_aplicada,row.cep_confianca_anterior,row.cep_confianca]
   .find(c=>levels.includes(c))||null;
 }
 function pdfRows(rows,confidence='') {
  if(confidence!==''&&!levels.includes(confidence))throw Error('Confiança do PDF inválida.');
  return rows.filter(r=>r.cep_alterado&&digits(r.cep_anterior)!==digits(r.cli_cep)&&
   (!confidence||pdfConfidenceOf(r)===confidence));
 }
 function filteredRows(rows,{tab='all',confidence='',code='',query=''}={}) {
  let result=rows.filter(r=>tab==='review'?r.cep_status==='Revisar endereço':tab==='changed'?r.cep_alterado:true);
  if(levels.includes(confidence))result=result.filter(r=>confidenceOf(r)===confidence);
  const c=searchNorm(code),q=searchNorm(query);
  if(c)result=result.filter(r=>searchNorm(r.cli_codigo)===c);
  if(q)result=result.filter(r=>[r.cli_endereco,r.cli_numero,r.cli_bairro,r.cli_cidade,r.cli_uf,r.uf,r.descricao,r.cep_anterior,r.cli_cep,r.cep_nome_canonico]
   .some(v=>searchNorm(v).includes(q)) || (/^\d{3,8}$/.test(q)&&[r.cep_anterior,r.cli_cep].some(v=>String(v??'').replace(/\D/g,'').includes(q))));
  return result;
 }
 function bulkCandidates(rows) {
  return rows.filter(r=>r.cep_status==='Revisar endereço'&&levels.includes(r.cep_confianca)&&
   r.cep_sugestoes?.length&&!r.cep_sugestoes.some(s=>s.selecionado)&&
   r.cep_sugestoes[0].confianca===r.cep_confianca&&digits(r.cep_sugestoes[0].cep).length===8&&
   !keepSpecificCep(r.cli_cep,r.cep_sugestoes[0].cep))
   .map(r=>({id:r._rowId,cep:r.cep_sugestoes[0].cep,confianca:r.cep_confianca}));
 }
 return {levels,searchNorm,confidenceOf,filteredRows,bulkCandidates,keepSpecificCep,pdfConfidenceOf,pdfRows};
});
