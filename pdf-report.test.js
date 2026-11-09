const test=require('node:test'),assert=require('node:assert/strict');
const {prepareReport,renderReport}=require('./pdf-report');
const notice=require('./public/disclaimer');
const fixture=(code,confidence)=>({cli_codigo:code,cli_cidade:'Bariri',descricao:'SP',cli_endereco:'RUA ORIGINAL',cli_bairro:'Centro',
 cli_cep:'17.255-282',cep_anterior:'17.250-000',cep_alterado:true,cep_confianca_aplicada:confidence,
 cep_sugestoes:[{cep:'17.255-280',endereco:'Outra rua',confianca:'Alta'},
  {cep:'17.255-282',endereco:'Rua Professor José Francisco Barbieri de Toledo',bairro:'Jardim Brasil 500',selecionado:true,confianca:confidence,motivos:['Omitida: BARBIERI.']} ]});
test('relatório usa o CEP escolhido e separa exatas sem inventar confiança',()=>{
 const exact=fixture(2);delete exact.cep_confianca_aplicada;delete exact.cep_sugestoes[1].confianca;
 const unchanged={...fixture(3,'Alta'),cep_anterior:'17255282'};
 const input=[fixture(1,'Média'),exact,unchanged,{...fixture(4,'Baixa'),cep_alterado:false}],original=JSON.stringify(input);
 const report=prepareReport(input,{createdAt:'2026-11-09T12:00:00Z'});
 assert.equal(report.records.length,2);assert.equal(report.records[0].confidence,'Média');
 assert.equal(report.records[0].street,'Rua Professor José Francisco Barbieri de Toledo');
 assert.equal(report.records[1].confidence,null);assert.equal(report.records[1].group,'exactMany');
 assert.equal(JSON.stringify(input),original);
});
test('grau do candidato escolhido prevalece sobre a classificação anterior',()=>{
 const row=fixture(1,'Baixa');row.cep_confianca_aplicada='Alta';assert.equal(prepareReport([row]).records[0].confidence,'Baixa');
});
test('PDF válido é gerado para consulta vazia e para linhas muito longas',async()=>{
 const empty=await renderReport(prepareReport([],{createdAt:'2026-11-09T12:00:00Z'}));
 assert.equal(empty.pages,1);assert.equal(Buffer.from(empty.buffer).subarray(0,5).toString(),'%PDF-');
 const long=fixture(99,'Média');long.cli_complemento='Complemento longo para conferir. '.repeat(250);
 const report=await renderReport(prepareReport([long],{createdAt:'2026-11-09T12:00:00Z',partial:true}));
 assert.equal(report.records,1);assert.ok(report.pages>2);assert.ok(report.buffer.length>empty.buffer.length);
});
test('aviso explícito exige conferência, admite erros e não apresenta correção definitiva',()=>{
 assert.match(notice.title,/ESTIMATIVA/);assert.match(notice.body,/Podem conter erros/);
 assert.match(notice.body,/não de correção definitiva/);assert.match(notice.body,/cliente deve conferir/);
});
