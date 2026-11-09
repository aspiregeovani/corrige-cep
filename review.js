const {buildIndex,semanticRows} = require('./semantic');
const caches = new WeakMap();
function clearReviewCache(db) { caches.delete(db); }
function findReviewRows(db,uf,city,street,neighborhood='') {
 let cache=caches.get(db);
 if(!cache){cache=new Map();caches.set(db,cache);}
 const cityKey=uf+'\0'+city;
 if(!cache.has(cityKey)) {
  const rows=db.prepare('SELECT * FROM enderecos_complementares WHERE uf=? AND cidade=? UNION ALL SELECT * FROM enderecos WHERE uf=? AND cidade=?').all(uf,city,uf,city);
  cache.set(cityKey,buildIndex(rows));
 }
 return semanticRows(cache.get(cityKey),street,neighborhood,city);
}
module.exports={findReviewRows,clearReviewCache};
