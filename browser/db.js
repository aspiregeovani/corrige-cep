let active;
function activate(native){
 const prepared=new Map();
 const db={native,exec(sql){native.run(sql.replace('PRAGMA journal_mode=WAL;','PRAGMA journal_mode=MEMORY;'));},
  prepare(sql){if(prepared.has(sql))return prepared.get(sql);let statement;
   const get=()=>statement||=native.prepare(sql);
   const wrapper={run(...params){const s=get();s.reset();try{s.bind(params);s.step();}finally{s.reset();}},
    all(...params){const s=get(),rows=[];s.reset();try{s.bind(params);while(s.step())rows.push(s.getAsObject());return rows;}finally{s.reset();}},
    get(...params){return this.all(...params)[0];},free(){statement?.free();statement=null;}};
   prepared.set(sql,wrapper);return wrapper;},
  export(){for(const s of prepared.values())s.free();return native.export();},
  close(){for(const s of prepared.values())s.free();native.close();}};
 active=db;return db;
}
class DatabaseSync{constructor(){if(!active)throw Error('Banco local não inicializado.');return active;}}
module.exports={activate,DatabaseSync};
