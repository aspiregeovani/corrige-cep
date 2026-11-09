// Importa SOMENTE tabelas de endereços públicos. Nunca consulta ou envia clientes.
const {DatabaseSync}=require('node:sqlite');
const {gzipSync}=require('node:zlib');
const {createHash}=require('node:crypto');
const {neon}=require('@neondatabase/serverless');
try{process.loadEnvFile('.env.local');}catch{}
async function main(){
 if(!process.env.DATABASE_URL)throw Error('Defina DATABASE_URL.');
 const cloud=neon(process.env.DATABASE_URL);
 await cloud`CREATE TABLE IF NOT EXISTS postal_ufs(uf text PRIMARY KEY,fonte text NOT NULL,versao text NOT NULL,baixado_em timestamptz NOT NULL,registros integer NOT NULL)`;
 await cloud`CREATE TABLE IF NOT EXISTS postal_cidades(uf text NOT NULL,cidade text NOT NULL,payload text NOT NULL,etag text NOT NULL,registros integer NOT NULL,versao text NOT NULL,PRIMARY KEY(uf,cidade))`;
 const local=new DatabaseSync(process.argv[2]||'data/cep.sqlite',{readOnly:true});
 const cities=local.prepare('SELECT DISTINCT cidade FROM enderecos WHERE uf=? UNION SELECT DISTINCT cidade FROM enderecos_complementares WHERE uf=? ORDER BY cidade');
 const addresses=local.prepare('SELECT rua,bairro,cep,original FROM enderecos_complementares WHERE uf=? AND cidade=? UNION ALL SELECT rua,bairro,cep,original FROM enderecos WHERE uf=? AND cidade=?');
 const existing=await cloud`SELECT uf,cidade,etag FROM postal_cidades`;
 const known=new Map(existing.map(r=>[r.uf+'|'+r.cidade,r.etag]));
 let total=0,bytes=0,uploaded=0;let batch=[];
 async function flush(){if(!batch.length)return;const data=JSON.stringify(batch);await cloud`INSERT INTO postal_cidades(uf,cidade,payload,etag,registros,versao)
 SELECT uf,cidade,payload,etag,registros,versao FROM jsonb_to_recordset(${data}::jsonb) AS x(uf text,cidade text,payload text,etag text,registros integer,versao text)
 ON CONFLICT(uf,cidade) DO UPDATE SET payload=excluded.payload,etag=excluded.etag,registros=excluded.registros,versao=excluded.versao`;batch=[];}
 for(const base of local.prepare('SELECT * FROM bases ORDER BY uf').all()){
  let count=0;const version=base.versao;
  for(const {cidade} of cities.all(base.uf,base.uf)){
   const rows=addresses.all(base.uf,cidade,base.uf,cidade).map(r=>{const d=JSON.parse(r.original);return {...r,original:JSON.stringify({...d,fonte:d.fonte||base.fonte,versao:d.versao||version})};});
   const raw=JSON.stringify({uf:base.uf,cidade,versao:version,registros:rows});
   const etag=createHash('sha256').update(raw).digest('hex'),zip=gzipSync(raw,{level:9});
   count+=rows.length;total+=rows.length;bytes+=zip.length;
   if(known.get(base.uf+'|'+cidade)!==etag){batch.push({uf:base.uf,cidade,payload:zip.toString('base64'),etag,registros:rows.length,versao:version});uploaded++;}
   if(batch.length>=25)await flush();
  }
  await flush();
  await cloud`INSERT INTO postal_ufs VALUES(${base.uf},${base.fonte},${version},${base.baixado_em},${count})
   ON CONFLICT(uf) DO UPDATE SET fonte=excluded.fonte,versao=excluded.versao,baixado_em=excluded.baixado_em,registros=excluded.registros`;
  console.log(JSON.stringify({uf:base.uf,registros:count,total,municipiosGravados:uploaded,MBcompactados:Math.round(bytes/1e6)}));
 }
 local.close();const [size]=await cloud`SELECT pg_size_pretty(pg_database_size(current_database())) tamanho`;
 console.log(JSON.stringify({complete:true,total,uploaded,bytes,databaseSize:size.tamanho}));
}
main().catch(e=>{console.error('Falha na importação postal:',e.message);process.exitCode=1;});
