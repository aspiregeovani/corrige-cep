const { DatabaseSync } = require('node:sqlite');
const fs = require('node:fs');
const path = require('node:path');
const {findReviewRows} = require('./review');
const {keepSpecificCep} = require('./public/review-utils');
fs.mkdirSync('data', {recursive:true});
const db = new DatabaseSync('data/cep.sqlite');
db.exec(`PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS bases(uf TEXT PRIMARY KEY, fonte TEXT, versao TEXT, baixado_em TEXT, registros INTEGER); CREATE TABLE IF NOT EXISTS enderecos(uf TEXT,cidade TEXT,rua TEXT,bairro TEXT,cep TEXT,original TEXT); CREATE INDEX IF NOT EXISTS endereco_busca ON enderecos(uf,cidade,rua,bairro); CREATE TABLE IF NOT EXISTS clientes(id INTEGER PRIMARY KEY, original TEXT NOT NULL, resultado TEXT NOT NULL); CREATE TABLE IF NOT EXISTS estado(chave TEXT PRIMARY KEY, valor TEXT);`);
db.exec(`CREATE TABLE IF NOT EXISTS bases_complementares(uf TEXT,cidade TEXT,fonte TEXT,versao TEXT,baixado_em TEXT,registros INTEGER,PRIMARY KEY(uf,cidade)); CREATE TABLE IF NOT EXISTS enderecos_complementares(uf TEXT,cidade TEXT,rua TEXT,bairro TEXT,cep TEXT,original TEXT); CREATE INDEX IF NOT EXISTS complemento_busca ON enderecos_complementares(uf,cidade,rua,bairro);`);
const norm = s => String(s ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toUpperCase().replace(/[^A-Z0-9]+/g,' ').trim().replace(/\s+/g,' ').replace(/^(R|RUA) /,'RUA ').replace(/^(AV|AVENIDA) /,'AVENIDA ').replace(/^(TV|TRAVESSA) /,'TRAVESSA ').replace(/^(AL|ALAMEDA) /,'ALAMEDA ').replace(/^(ROD|RODOVIA) /,'RODOVIA ');
const digits = x => String(x ?? '').replace(/\D/g,'');
const mask = x => { const d=digits(x); return d.length===8 ? `${d.slice(0,2)}.${d.slice(2,5)}-${d.slice(5)}` : x; };
const getUf = x => String(x.cli_uf || x.uf || x.descricao || '').trim().toUpperCase();
const getState = key => db.prepare('SELECT valor FROM estado WHERE chave=?').get(key)?.valor;
const setState = (key,val) => db.prepare('INSERT OR REPLACE INTO estado VALUES(?,?)').run(key,String(val));
const lookup = db.prepare('SELECT * FROM enderecos_complementares WHERE uf=? AND cidade=? AND rua=? UNION ALL SELECT * FROM enderecos WHERE uf=? AND cidade=? AND rua=? ORDER BY cep');
function processClient(original) {
 const uf=getUf(original), city=norm(original.cli_cidade), street=norm(original.cli_endereco), old=original.cli_cep ?? '';
 const base=db.prepare('SELECT * FROM bases WHERE uf=?').get(uf) || db.prepare('SELECT * FROM bases_complementares WHERE uf=? AND cidade=?').get(uf,city);
 const out={...original,cli_cep:mask(old),cep_anterior:old,cep_alterado:false,cep_status:'Pendente',cep_motivo:'',cep_fonte:base?.fonte || '',cep_base_versao:base?.versao || '',cep_consultado_em:new Date().toISOString(),cep_quantidade_sugestoes:0,cep_sugestoes:[],cep_confianca:'',cep_confianca_logradouro:'',cep_nome_canonico:'',cep_similaridade_nome:null,cep_motivos_confianca:[]};
 if(!'AC AL AP AM BA CE DF ES GO MA MT MS MG PA PB PR PE PI RJ RN RS RO RR SC SP SE TO'.split(' ').includes(uf) || !city || !street) {out.cep_status='Dados insuficientes';out.cep_motivo='UF, cidade e logradouro são necessários.';return out;}
 if(!base) {out.cep_status='Pendente';out.cep_motivo=`Base ${uf} não instalada.`;return out;}
 let rows=lookup.all(uf,city,street,uf,city,street).map(r=>({...r,detail:JSON.parse(r.original)}));
 const needsReview=!rows.length;
 if(needsReview)rows=findReviewRows(db,uf,city,street,original.cli_bairro);
 const neighborhood=norm(original.cli_bairro);
 const level={Alta:3,'Média':2,Baixa:1};
 rows.sort((a,b)=>(needsReview?(level[b.review?.confianca]||0)-(level[a.review?.confianca]||0) || (a.review?.ordem||0)-(b.review?.ordem||0):0) || Number(b.bairro===neighborhood && !!neighborhood)-Number(a.bairro===neighborhood && !!neighborhood) || a.cep.localeCompare(b.cep));
 const groups=new Map(); for(const r of rows) { if(digits(r.cep).length!==8) continue; const k=digits(r.cep); if(!groups.has(k)) groups.set(k,{cep:mask(k),endereco:r.detail.endereco,bairro:r.detail.bairro,complemento:r.detail.complemento || '',fonte:r.detail.fonte || base.fonte,versao:r.detail.versao || base.versao,detalhes:[],selecionado:false,...(r.review||{})}); groups.get(k).detalhes.push(r.detail); }
 out.cep_sugestoes=[...groups.values()];out.cep_quantidade_sugestoes=groups.size;
 if(!groups.size){out.cep_status='Não encontrado';out.cep_motivo='Nenhum logradouro exato encontrado nesta cidade e UF.';return out;}
 if(needsReview){out.cep_status='Revisar endereço';out.cep_confianca=out.cep_sugestoes[0].confianca;out.cep_confianca_logradouro=out.cep_sugestoes[0].confianca_logradouro;out.cep_nome_canonico=out.cep_sugestoes[0].endereco;out.cep_similaridade_nome=out.cep_sugestoes[0].similaridade_nome;out.cep_motivos_confianca=out.cep_sugestoes[0].motivos;out.cep_motivo='Sugestão por interpretação de grafia e contexto. Confiança '+out.cep_confianca+'. '+out.cep_motivos_confianca.join(' ')+' O CEP original foi mantido; confirme antes de escolher.';out.cep_fonte=[...new Set(out.cep_sugestoes.map(s=>s.fonte))].join(' | ');out.cep_base_versao=[...new Set(out.cep_sugestoes.map(s=>s.versao))].join(' | ');return out;}
 const recommended=out.cep_sugestoes[0],oldDigits=digits(old),firstDigits=digits(recommended.cep);
 const protectsSpecific=keepSpecificCep(old,recommended.cep);
 const previous=oldDigits.length===8&&!oldDigits.endsWith('000')&&oldDigits.slice(0,5)===firstDigits.slice(0,5)
  ? out.cep_sugestoes.find(s=>digits(s.cep)===oldDigits)
  : undefined;
 if(previous){
  out.cep_sugestoes.splice(out.cep_sugestoes.indexOf(previous),1);
  out.cep_sugestoes.unshift(previous);
 }
 const chosen=previous||(protectsSpecific?undefined:recommended);
 if(chosen)chosen.selecionado=true;
 out.cli_cep=chosen?.cep??mask(old);
 out.cep_alterado=oldDigits!==digits(out.cli_cep);
 out.cep_status=protectsSpecific?'CEP anterior mantido':groups.size>1?'Selecionado automaticamente':'Correspondência única';
 const reason=protectsSpecific
  ? 'CEP específico mantido porque o recomendado termina em -000 e tem a mesma raiz de cinco dígitos. '
  : previous?'CEP anterior encontrado nas sugestões e mantido por compartilhar a raiz de cinco dígitos com o primeiro resultado. ':'';
 out.cep_motivo=reason+'Logradouro e cidade exatos após normalização. A base não informa faixa de numeração, lado ou trecho.'+
  (oldDigits.length!==8?' CEP anterior inválido preservado para auditoria.':'');
 const source=chosen||recommended;
 out.cep_fonte=source.fonte;
 out.cep_base_versao=source.versao;
 return out;
}
module.exports={db,norm,digits,mask,getUf,getState,setState,processClient};
