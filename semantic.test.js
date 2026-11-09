const test=require('node:test'),assert=require('node:assert/strict');
const {buildIndex,semanticRows,neighborhoodKey}=require('./semantic');
const row=(street,bairro,cep)=>({uf:'SP',cidade:'BARIRI',rua:street,bairro,cep,
 detail:{endereco:street,bairro,complemento:'',cidade:'Bariri',municipio:'Bariri'}});
const find=(rows,street,bairro)=>semanticRows(buildIndex(rows),street,bairro,'BARIRI');

test('interpreta nome e bairro sem confundir as etapas I e II',()=>{
 const rows=[row('RUA MANUEL SALINA','JARDIM YANG II','17253024'),row('RUA MANUEL SALINA','JARDIM YANG I','17253102')];
 const r=find(rows,'RUA MANOEL SALINA','JADIM YANG 1');
 assert.deepEqual(r.filter(x=>x.review.confianca==='Alta').map(x=>x.cep),['17253102']);
 assert.equal(r.find(x=>x.cep==='17253102').review.mesmo_bairro,true);
 assert.equal(find(rows,'RUA MANOEL SALINA','JARDIM YANG').some(x=>x.review.confianca==='Alta'),false);
 assert.equal(find(rows,'RUA MANOEL SALINA','VILA YANG I').some(x=>x.review.confianca==='Alta'),false);
});
test('reconhece consoante duplicada e variação LUIS/LUIZ, exigindo bairro para separar CEPs',()=>{
 const rows=[row('RUA LUIZ FURLANETO','JARDIM DOMINGOS AQUILANTE','17255270'),row('RUA LUIZ FURLANETO','JARDIM ROMERO','17255734')];
 const r=find(rows,'RUA LUIS FURLANETTO','DOMINGOS AQUILANTE');
 assert.equal(r.find(x=>x.cep==='17255270').review.confianca,'Alta');
 assert.equal(find(rows,'RUA LUIS FURLANETTO','BAIRRO').some(x=>x.review.confianca==='Alta'),false);
});
test('reconhece letra omitida e explica a alteração',()=>{
 const r=find([row('RUA JOSE EDGARD ROSSI','JARDIM SANTA CLARA','17255212')],'RUA JOSE EDGAR ROSSI','JD SANTA CLARA');
 assert.equal(r[0].review.confianca,'Alta');
 assert.ok(r[0].review.motivos.some(m=>m.includes('EDGAR → EDGARD')));
});
test('semelhança de rua não transforma vários CEPs do mesmo bairro em alta confiança',()=>{
 const r=find([row('RUA CAMPOS SALLES','CENTRO','17250063'),row('RUA CAMPOS SALLES','CENTRO','17250065')],'RUA CAMPOS SALES','CENTRO');
 assert.equal(r.length,2);assert.ok(r.every(x=>x.review.confianca!=='Alta'&&x.review.cep_ambiguo));
});
test('tipo de via divergente e tipo ausente reduzem a confiança',()=>{
 const rows=[row('AVENIDA RODOLFO LUIZ GALIZIA','JARDIM MARIA LUIZA I','17253140')];
 for(const input of ['RUA RODOLFO LUIS GALIZIA','RODOLFO LUIS GALIZIA']) {
  const r=find(rows,input,'JD MARIA LUIZA 1');assert.ok(r.length);assert.notEqual(r[0].review.confianca,'Alta');
 }
});
test('logradouro concorrente impede alta confiança mesmo com normalização idêntica',()=>{
 const r=find([row('RUA LUIZ FANTON','CENTRO','17250001'),row('RUA LUIS FANTON','CENTRO','17250003')],'RUA LUIS FANTON','CENTRO');
 assert.ok(r.length);assert.ok(r.every(x=>x.review.confianca!=='Alta'));assert.ok(r[0].review.margem_nome<8);
});
test('não inventa endereço a partir de placeholders, sobrenome incompleto ou número diferente',()=>{
 const rows=[row('RUA JOSE SILVA','CENTRO','17250001'),row('RUA 21 DE ABRIL','CENTRO','17250003')];
 for(const s of ['S / E','CADASTRO','RUA CADASTRO','ATUALIZAR','RUA JOSE','RUA JOAO SILVA','RUA 22 DE ABRIL'])assert.equal(find(rows,s,'CENTRO').length,0,s);
});
test('endereço rural não é aproximado para rua urbana',()=>{
 assert.equal(find([row('RUA ANTONIO SILVA','CENTRO','17250001')],'FAZENDA ANTONIO SILVA','CENTRO').length,0);
});
test('bairro igual à cidade ou genérico não reforça a confiança',()=>{
 assert.equal(neighborhoodKey('BARIRI','BARIRI'),'');assert.equal(neighborhoodKey('CADASTRO'),'');
 assert.equal(neighborhoodKey('JD MARIA LUIZA III'),neighborhoodKey('JARDIM MARIA LUIZA 3'));
});
test('sobrenome omitido exige demais palavras, bairro e candidato distintos: caso 4820',()=>{
 const rows=[row('RUA PROFESSOR JOSE FRANCISCO BARBIERI DE TOLEDO','JARDIM BRASIL 500','17255282')];
 const r=find(rows,'RUA PROFESSOR JOSE FRANCISCO DE TOLEDO','BRASIL 500');
 assert.equal(r.length,1);assert.equal(r[0].cep,'17255282');assert.equal(r[0].review.confianca,'Média');
 assert.ok(r[0].review.motivos.some(m=>m.includes('BARBIERI')));
 assert.equal(find(rows,'RUA PROFESSOR JOSE FRANCISCO DE TOLEDO','CENTRO').length,0);
 assert.equal(find(rows,'RUA PROFESSOR JOSE FRANCISCO DE TOLEDO','BAIRRO').length,0);
 assert.equal(find(rows,'RUA PROFESSOR JOSE FRANCISCO','BRASIL 500').length,0);
 const ambiguous=[...rows,row('RUA PROFESSOR JOSE FRANCISCO GOMES DE TOLEDO','JARDIM BRASIL 500','17255284')];
 assert.equal(find(ambiguous,'RUA PROFESSOR JOSE FRANCISCO DE TOLEDO','BRASIL 500').length,0);
});
