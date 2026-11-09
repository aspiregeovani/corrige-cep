const test=require('node:test'),assert=require('node:assert/strict'),fs=require('fs'),os=require('os'),path=require('path');const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'cep-test-'));process.chdir(tmp);const {db,norm,mask,digits,processClient}=require(path.join(__dirname,'core.js'));
test('normalização e CEPs preservam zeros',()=>{assert.equal(norm('Av. São João'),norm('AVENIDA SAO JOAO'));assert.equal(mask('01001000'),'01.001-000');assert.equal(mask('123'),'123');assert.equal(digits('01.001-000'),'01001000')});
test('seleção ordenada, agrupamento e comparação de dígitos',()=>{db.prepare('INSERT INTO bases VALUES(?,?,?,?,?)').run('SP','teste','v1','data',3);const insert=db.prepare('INSERT INTO enderecos VALUES(?,?,?,?,?,?)');const detail=JSON.stringify({endereco:'Avenida São João',bairro:'Centro',complemento:''});for(const cep of ['01002000','01001000','01001000'])insert.run('SP','SAO PAULO','AVENIDA SAO JOAO','CENTRO',cep,detail);let r=processClient({cli_codigo:1,cli_endereco:'Av. São João',cli_cidade:'São Paulo',descricao:'SP',cli_bairro:'Centro',cli_cep:'01001000'});assert.equal(r.cli_cep,'01.001-000');assert.equal(r.cep_status,'Selecionado automaticamente');assert.equal(r.cep_quantidade_sugestoes,2);assert.equal(r.cep_sugestoes[0].detalhes.length,2);assert.equal(r.cep_alterado,false);assert.equal(r.cep_anterior,'01001000');r=processClient({cli_endereco:'Rua inexistente',cli_cidade:'São Paulo',descricao:'SP',cli_cep:'123'});assert.equal(r.cep_status,'Não encontrado');assert.equal(r.cli_cep,'123');assert.equal(processClient({}).cep_status,'Dados insuficientes')});
test('mantém o CEP anterior somente se encontrado nas sugestões',()=>{const insert=db.prepare('INSERT INTO enderecos VALUES(?,?,?,?,?,?)');const detail=JSON.stringify({endereco:'Avenida Hideo Takada',bairro:'Parque',complemento:''});for(const cep of ['14177170','14177200'])insert.run('SP','SERTAOZINHO','AVENIDA HIDEO TAKADA','PARQUE',cep,detail);const c={cli_endereco:'Avenida Hideo Takada',cli_cidade:'Sertãozinho',descricao:'SP',cli_bairro:'Parque',cli_cep:'14.177-200'};let r=processClient(c);assert.equal(r.cli_cep,'14.177-200');assert.equal(r.cep_alterado,false);assert.equal(r.cep_sugestoes[0].cep,'14.177-200');assert.equal(r.cep_sugestoes[0].selecionado,true);r=processClient({...c,cli_cep:'14.177-999'});assert.equal(r.cli_cep,'14.177-170');assert.equal(r.cep_alterado,true);assert.equal(r.cep_sugestoes[0].selecionado,true);r=processClient({...c,cli_cep:'14.178-999'});assert.equal(r.cli_cep,'14.177-170');assert.equal(r.cep_alterado,true)});

test('CEP anterior terminado em 000 utiliza o resultado recomendado',()=>{const r=processClient({cli_endereco:'Avenida Hideo Takada',cli_cidade:'Sertaozinho',descricao:'SP',cli_bairro:'Parque',cli_cep:'14.177-000'});assert.equal(r.cli_cep,'14.177-170');assert.equal(r.cep_alterado,true);assert.equal(r.cep_sugestoes[0].selecionado,true)});

test('complemento municipal preserva a base estadual e registra a fonte da sugestão',()=>{
 const {importSupplement}=require('./supplement');
 const snapshot={uf:'SP',cidade:'Bariri',fonte:'https://viacep.com.br/',obtido_em:'2026-11-09T12:00:00.000Z',registros:[
  {uf:'SP',localidade:'Bariri',logradouro:'Avenida Centenário',bairro:'Centro',cep:'17250-001',complemento:''},
  {uf:'SP',localidade:'Bariri',logradouro:'Avenida Centenário',bairro:'Centro',cep:'17250-001',complemento:''}
 ]};
 const originalCount=db.prepare('SELECT count(*) n FROM enderecos').get().n;
 assert.equal(importSupplement(snapshot).registros,1);
 const client={descricao:'SP',cli_cidade:'BARIRI',cli_endereco:'AV. CENTENARIO',cli_bairro:'CENTRO',cli_cep:'17250000'};
 const r=processClient(client);
 assert.equal(r.cli_cep,'17.250-001');assert.equal(r.cep_alterado,true);
 assert.equal(r.cep_fonte,snapshot.fonte);assert.equal(r.cep_sugestoes[0].fonte,snapshot.fonte);
 assert.equal(r.cep_base_versao,'consulta-'+snapshot.obtido_em);
 assert.equal(db.prepare('SELECT count(*) n FROM enderecos').get().n,originalCount);
 importSupplement(snapshot);assert.equal(db.prepare('SELECT count(*) n FROM enderecos_complementares').get().n,1);
 assert.equal(processClient({...client,cli_endereco:'Avenida Centenario Inexistente'}).cep_status,'Não encontrado');
 assert.throws(()=>importSupplement({...snapshot,registros:[{...snapshot.registros[0],localidade:'Itaju'}]}));
 assert.equal(processClient(client).cli_cep,'17.250-001');
 assert.throws(()=>importSupplement({...snapshot,registros:[]}));
});

test('nomes aproximados exigem revisão e não entram como CEP alterado',()=>{
 const {importSupplement}=require('./supplement');
 importSupplement({uf:'SP',cidade:'Itaju',fonte:'https://www.cepbusca.com.br/cep/sp/itaju',versao:'listagem',obtido_em:'2026-11-09T12:00:00Z',registros:[
  {uf:'SP',localidade:'Itaju',logradouro:'Rua Sete de Setembro',bairro:'Centro',cep:'17260-101'},
  {uf:'SP',localidade:'Itaju',logradouro:'Avenida Doutor Antonio Galizia',bairro:'Centro',cep:'17260-103'}
 ]});
 const client={descricao:'SP',cli_cidade:'Itaju',cli_endereco:'RUA 7 DE SETEMBRO',cli_cep:'17.260-000'};
 let r=processClient(client);assert.equal(r.cep_status,'Revisar endereço');assert.equal(r.cli_cep,'17.260-000');
 assert.equal(r.cep_alterado,false);assert.equal(r.cep_sugestoes.length,1);assert.equal(r.cep_sugestoes[0].selecionado,false);
 assert.equal(require('./sql').gerarUpdates([r]),'');
 assert.equal(r.cep_sugestoes[0].cep,'17.260-101');
 r=processClient({...client,cli_endereco:'AV DR ANTONIO GALIZIA'});assert.equal(r.cep_status,'Revisar endereço');assert.equal(r.cep_alterado,false);
 assert.equal(processClient({...client,cli_cidade:'Outra cidade'}).cep_status,'Não encontrado');
 assert.equal(processClient({...client,cli_endereco:'S / E'}).cep_status,'Não encontrado');
 importSupplement({uf:'SP',cidade:'Itaju',fonte:'https://www.cepbusca.com.br/cep/sp/itaju',obtido_em:'2026-11-09T12:01:00Z',registros:[
  {uf:'SP',localidade:'Itaju',logradouro:'Rua Outra',bairro:'Centro',cep:'17260-105'}
 ]});
 assert.equal(processClient(client).cep_status,'Não encontrado');
});
