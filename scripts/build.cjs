const fs=require('node:fs'),path=require('node:path'),esbuild=require('esbuild');
async function main(){
 fs.mkdirSync('dist',{recursive:true});fs.cpSync('public','dist',{recursive:true});
 fs.copyFileSync('node_modules/sql.js/dist/sql-wasm.wasm','dist/sql-wasm.wasm');
 fs.copyFileSync('browser/hosted-bridge.js','dist/hosted-bridge.js');
 const html=fs.readFileSync('public/index.html','utf8').replace('<script src="app.js"></script>','<script src="hosted-bridge.js"></script><script src="app.js"></script>')
  .replace('Baixe apenas as UFs necessárias. Os dados são obtidos do repositório público welyab/cep; os clientes não são enviados.',
   'As 27 UFs estão armazenadas no banco postal Neon. Os endereços são carregados desse banco e reutilizados localmente; o JSON dos clientes é processado e salvo neste navegador.')
  .replace('Baixar selecionadas','Recarregar selecionadas');
 fs.writeFileSync('dist/index.html',html);
 await esbuild.build({entryPoints:['browser/worker.js'],outfile:'dist/client-worker.js',bundle:true,format:'esm',platform:'browser',target:'es2022',minify:true,
  alias:{'node:sqlite':path.resolve('browser/db.js'),'node:fs':path.resolve('browser/fs.js'),'node:path':path.resolve('browser/path.js'),fs:path.resolve('browser/fs.js'),path:path.resolve('browser/path.js')},
  define:{global:'globalThis'},logLevel:'info'});
 console.log('Build hospedado pronto. Clientes e PDFs são processados no navegador; somente a base postal usa o Neon.');
}
main().catch(e=>{console.error(e.message);process.exitCode=1});
