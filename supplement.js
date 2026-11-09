const {db, norm, digits} = require('./core');

// Importa um retrato público por município sem substituir a base estadual.
function importSupplement(snapshot) {
  const uf = String(snapshot.uf || '').toUpperCase();
  const city = norm(snapshot.cidade);
  const date = new Date(snapshot.obtido_em);
  const validSource = source => {
    try { const url = new URL(source); return url.protocol === 'https:' && !url.username && !url.password; }
    catch { return false; }
  };
  if (!'AC AL AP AM BA CE DF ES GO MA MT MS MG PA PB PR PE PI RJ RN RS RO RR SC SP SE TO'.split(' ').includes(uf) || !city || !Number.isFinite(date.getTime()) ||
      !validSource(snapshot.fonte) || !Array.isArray(snapshot.registros) || !snapshot.registros.length) {
    throw Error('Informe um retrato público válido, com fonte HTTPS, cidade, UF, data e registros.');
  }
  const version = 'consulta-' + date.toISOString();
  const records = new Map();
  for (const r of snapshot.registros) {
    if (r.uf !== uf || norm(r.localidade) !== city || !norm(r.logradouro) || digits(r.cep).length !== 8) {
      throw Error('CEP, cidade, UF ou logradouro inválido no complemento.');
    }
    if (r.fonte && !validSource(r.fonte)) throw Error('Fonte inválida no complemento.');
    const detail = {endereco:r.logradouro, bairro:r.bairro || '', complemento:r.complemento || '',
      cidade:r.localidade, municipio:r.localidade, fonte:r.fonte || snapshot.fonte, versao:r.versao || snapshot.versao || version};
    const record = [uf, city, norm(r.logradouro), norm(r.bairro), digits(r.cep), JSON.stringify(detail)];
    records.set(record.join('\0'), record);
  }
  db.exec('BEGIN IMMEDIATE');
  try {
    db.prepare('DELETE FROM enderecos_complementares WHERE uf=? AND cidade=?').run(uf,city);
    const insert = db.prepare('INSERT INTO enderecos_complementares VALUES(?,?,?,?,?,?)');
    for (const r of records.values()) insert.run(...r);
    db.prepare('INSERT OR REPLACE INTO bases_complementares VALUES(?,?,?,?,?,?)')
      .run(uf,city,snapshot.fonte,version,date.toISOString(),records.size);
    db.exec('COMMIT');
    require('./review').clearReviewCache(db);
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
  return {uf,cidade:city,registros:records.size};
}

module.exports = {importSupplement};
if (require.main === module) {
  const fs = require('node:fs');
  if (!process.argv[2]) throw Error('Uso: node supplement.js arquivo-viacep.json [...]');
  for (const file of process.argv.slice(2)) console.log(importSupplement(JSON.parse(fs.readFileSync(file,'utf8'))));
  db.close();
}
