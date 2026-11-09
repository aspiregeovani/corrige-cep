const test=require('node:test'),assert=require('node:assert/strict');
const init=require('sql.js');const {activate}=require('./browser/db');
test('SQLite do navegador preserva transações, exportação e consultas preparadas',async()=>{
 const SQL=await init(),db=activate(new SQL.Database());
 db.exec('CREATE TABLE itens(id INTEGER PRIMARY KEY,valor TEXT)');
 const put=db.prepare('INSERT INTO itens VALUES(?,?)'),get=db.prepare('SELECT * FROM itens WHERE id=?');
 put.run(1,'inicial');db.exec('BEGIN');db.prepare('UPDATE itens SET valor=? WHERE id=?').run('incorreto',1);db.exec('ROLLBACK');
 assert.equal(get.get(1).valor,'inicial');const saved=db.export();assert.equal(get.get(1).valor,'inicial');
 put.run(2,'depois de exportar');assert.equal(get.get(2).valor,'depois de exportar');
 const restored=activate(new SQL.Database(saved));assert.equal(restored.prepare('SELECT count(*) n FROM itens').get().n,1);
 db.close();restored.close();
});
