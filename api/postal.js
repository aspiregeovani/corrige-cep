const postal=require('../postal-cloud');
module.exports=async function(req,res){
 if(req.method!=='GET')return res.status(405).json({error:'Método não permitido.'});
 try{
  if(req.query.action!=='city')return res.status(200).setHeader('Cache-Control','public, max-age=300, s-maxage=300').json({bases:await postal.status()});
  const row=await postal.city(String(req.query.uf||'').toUpperCase(),String(req.query.city||''));
  if(!row)return res.status(404).json({error:'Cidade sem endereços na base postal. Confira o cadastro ou importe um complemento.'});
  res.setHeader('ETag','"'+row.etag+'"');res.setHeader('Cache-Control','public, max-age=86400, s-maxage=86400');
  if(req.headers['if-none-match']==='"'+row.etag+'"')return res.status(304).end();
  res.setHeader('Content-Type','application/json; charset=utf-8');res.setHeader('Content-Encoding','gzip');
  return res.status(200).send(Buffer.from(row.payload,'base64'));
 }catch(e){console.error('Base postal:',e.message);return res.status(e.status||503).json({error:e.status?e.message:'Base postal temporariamente indisponível. Os dados já carregados continuam disponíveis.'});}
};
