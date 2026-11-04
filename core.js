const { DatabaseSync } = require('node:sqlite');
const fs = require('node:fs');
const path = require('node:path');
fs.mkdirSync('data', {recursive:true});
const db = new DatabaseSync('data/cep.sqlite');
db.exec(`PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS bases(uf TEXT PRIMARY KEY, fonte TEXT, versao TEXT, baixado_em TEXT, registros INTEGER); CREATE TABLE IF NOT EXISTS enderecos(uf TEXT,cidade TEXT,rua TEXT,bairro TEXT,cep TEXT,original TEXT); CREATE INDEX IF NOT EXISTS endereco_busca ON enderecos(uf,cidade,rua,bairro); CREATE TABLE IF NOT EXISTS clientes(id INTEGER PRIMARY KEY, original TEXT NOT NULL, resultado TEXT NOT NULL); CREATE TABLE IF NOT EXISTS estado(chave TEXT PRIMARY KEY, valor TEXT);`);
const norm = s => String(s ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toUpperCase().replace(/[^A-Z0-9]+/g,' ').trim().replace(/\s+/g,' ').replace(/^(R|RUA) /,'RUA ').replace(/^(AV|AVENIDA) /,'AVENIDA ').replace(/^(TV|TRAVESSA) /,'TRAVESSA ').replace(/^(AL|ALAMEDA) /,'ALAMEDA ').replace(/^(ROD|RODOVIA) /,'RODOVIA ');
const digits = x => String(x ?? '').replace(/\D/g,'');
const mask = x => { const d=digits(x); return d.length===8 ? `${d.slice(0,2)}.${d.slice(2,5)}-${d.slice(5)}` : x; };
const getUf = x => String(x.cli_uf || x.uf || x.descricao || '').trim().toUpperCase();
const getState = key => db.prepare('SELECT valor FROM estado WHERE chave=?').get(key)?.valor;
const setState = (key,val) => db.prepare('INSERT OR REPLACE INTO estado VALUES(?,?)').run(key,String(val));
const lookup = db.prepare('SELECT * FROM enderecos WHERE uf=? AND cidade=? AND rua=? ORDER BY cep');
function processClient(original) {
 const uf=getUf(original), city=norm(original.cli_cidade), street=norm(original.cli_endereco), old=original.cli_cep ?? '';
 const base=db.prepare('SELECT * FROM bases WHERE uf=?').get(uf);
 const out={...original,cli_cep:mask(old),cep_anterior:old,cep_alterado:false,cep_status:'Pendente',cep_motivo:'',cep_fonte:base?.fonte || '',cep_base_versao:base?.versao || '',cep_consultado_em:new Date().toISOString(),cep_quantidade_sugestoes:0,cep_sugestoes:[]};
 if(!'AC AL AP AM BA CE DF ES GO MA MT MS MG PA PB PR PE PI RJ RN RS RO RR SC SP SE TO'.split(' ').includes(uf) || !city || !street) {out.cep_status='Dados insuficientes';out.cep_motivo='UF, cidade e logradouro são necessários.';return out;}
 if(!base) {out.cep_status='Pendente';out.cep_motivo=`Base ${uf} não instalada.`;return out;}
 const rows=lookup.all(uf,city,street).map(r=>({...r,detail:JSON.parse(r.original)}));
 const neighborhood=norm(original.cli_bairro);
 rows.sort((a,b)=>Number(b.bairro===neighborhood && !!neighborhood)-Number(a.bairro===neighborhood && !!neighborhood) || a.cep.localeCompare(b.cep));
 const groups=new Map(); for(const r of rows) { if(digits(r.cep).length!==8) continue; const k=digits(r.cep); if(!groups.has(k)) groups.set(k,{cep:mask(k),endereco:r.detail.endereco,bairro:r.detail.bairro,complemento:r.detail.complemento || '',fonte:base.fonte,detalhes:[],selecionado:false}); groups.get(k).detalhes.push(r.detail); }
 out.cep_sugestoes=[...groups.values()];out.cep_quantidade_sugestoes=groups.size;
 if(!groups.size){out.cep_status='Não encontrado';out.cep_motivo='Nenhum logradouro exato encontrado nesta cidade e UF.';return out;}
 const oldDigits=digits(old), firstDigits=digits(out.cep_sugestoes[0].cep);const keepOld=oldDigits.length===8 && !oldDigits.endsWith('000') && oldDigits.slice(0,5)===firstDigits.slice(0,5) && out.cep_sugestoes.some(s=>digits(s.cep)===oldDigits);const previous=keepOld ? out.cep_sugestoes.find(s=>digits(s.cep)===oldDigits) : null;if(previous){out.cep_sugestoes.splice(out.cep_sugestoes.indexOf(previous),1);out.cep_sugestoes.unshift(previous);}if(!keepOld || previous)out.cep_sugestoes[0].selecionado=true;out.cli_cep=keepOld?mask(old):out.cep_sugestoes[0].cep;out.cep_alterado=digits(old)!==digits(out.cli_cep);out.cep_status=groups.size>1?'Selecionado automaticamente':'Correspondência única';out.cep_motivo=(keepOld?'CEP anterior encontrado nas sugestões e mantido por compartilhar a raiz de cinco dígitos com o primeiro resultado. ':'')+'Logradouro e cidade exatos após normalização. A base não informa faixa de numeração, lado ou trecho.'+(digits(old).length!==8?' CEP anterior inválido preservado para auditoria.':'');return out;
}
module.exports={db,norm,digits,mask,getUf,getState,setState,processClient};
