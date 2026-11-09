// Contingência administrativa por cidade. Não há consulta externa por cliente.
const {neon}=require('@neondatabase/serverless');
const {gzipSync,gunzipSync}=require('node:zlib');
const {createHash}=require('node:crypto');
const {clean}=require('../semantic');
try{process.loadEnvFile('.env.local');}catch{}
const decode=s=>s.replace(/<[^>]*>/g,'').replace(/&#(\d+);/g,(_,n)=>String.fromCodePoint(+n))
 .replace(/&(amp|quot|apos|lt|gt|nbsp);/g,(_,x)=>({amp:'&',quot:'"',apos:"'",lt:'<',gt:'>',nbsp:' '}[x])).trim();
async function main(){
 const uf=String(process.argv[2]||'').toUpperCase(),name=process.argv[3],city=clean(name),force=process.argv.includes('--force');
 if(!/^[A-Z]{2}$/.test(uf)||!city||!process.env.DATABASE_URL)throw Error('Uso: node scripts/cache-city.cjs SP "Bariri" [--force], com DATABASE_URL configurada.');
 const sql=neon(process.env.DATABASE_URL);if(!(await sql`SELECT 1 FROM postal_ufs WHERE uf=${uf}`).length)throw Error('UF ainda não importada.');
 const [stored]=await sql`SELECT * FROM postal_cidades WHERE uf=${uf} AND cidade=${city}`;
 const old=stored?JSON.parse(gunzipSync(Buffer.from(stored.payload,'base64'))):{uf,cidade:city,registros:[]};
 if(!force&&old.registros.some(r=>JSON.parse(r.original).fonte?.includes('cepbusca.com.br'))){console.log('Contingência já salva. Reutilizando o banco, sem consultar o site.');return;}
 const prefix=`https://www.cepbusca.com.br/cep/${uf.toLowerCase()}/${city.toLowerCase().replace(/ /g,'-')}`;
 let url=prefix;const records=[],visited=new Set();
 while(url){
  if(visited.has(url)||visited.size>=60)throw Error('Listagem excedeu o limite seguro de páginas; a base anterior foi preservada.');visited.add(url);
  const response=await fetch(url,{signal:AbortSignal.timeout(30000)});if(!response.ok)throw Error('Contingência indisponível: HTTP '+response.status);
  const html=await response.text();
  for(const match of html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)){
   const td=[...match[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map(v=>decode(v[1]));
   if(!/^\d{5}-\d{3}$/.test(td[0]||'')||!td[1])continue;
   const detail={endereco:td[1],bairro:td[2]||'',complemento:td[3]===td[1]?'':td[3]||'',cidade:name,municipio:name,fonte:prefix,versao:'consulta-'+new Date().toISOString()};
   records.push({rua:clean(td[1]),bairro:clean(td[2]),cep:td[0].replace(/\D/g,''),original:JSON.stringify(detail)});
  }
  const next=html.match(/<link[^>]*rel="next"[^>]*href="([^"]+)"/i)?.[1];
  url=next?new URL(next,prefix).href:null;if(url&&(!url.startsWith(prefix+'/pagina/')||new URL(url).hostname!=='www.cepbusca.com.br'))throw Error('Paginação inesperada.');
  if(url)await new Promise(resolve=>setTimeout(resolve,1000));
 }
 if(!records.length)throw Error('Nenhum endereço público válido; o banco anterior foi preservado.');
 const retained=old.registros.filter(r=>!JSON.parse(r.original).fonte?.includes('cepbusca.com.br'));
 const verified=new Map(retained.filter(r=>JSON.parse(r.original).fonte?.includes('viacep.com.br')).map(r=>[r.cep+'|'+r.bairro,r]));
 const merged=new Map();for(const row of [...records.map(r=>verified.get(r.cep+'|'+r.bairro)||r),...retained])merged.set([row.rua,row.bairro,row.cep].join('|'),row);
 const version=(old.versao||'')+'+cache-'+new Date().toISOString(),snapshot={uf,cidade:city,versao:version,registros:[...merged.values()]};
 const raw=JSON.stringify(snapshot),payload=gzipSync(raw,{level:9}).toString('base64'),etag=createHash('sha256').update(raw).digest('hex');
 await sql.transaction([
  sql`INSERT INTO postal_cidades VALUES(${uf},${city},${payload},${etag},${merged.size},${version}) ON CONFLICT(uf,cidade) DO UPDATE SET payload=excluded.payload,etag=excluded.etag,registros=excluded.registros,versao=excluded.versao`,
  sql`UPDATE postal_ufs SET registros=registros+${merged.size-(stored?.registros||0)} WHERE uf=${uf}`,
 ]);
 console.log(JSON.stringify({uf,cidade:city,paginas:visited.size,registrosPublicos:records.length,registrosEmCache:merged.size,fonte:prefix}));
}
main().catch(e=>{console.error(e.message);process.exitCode=1;});
