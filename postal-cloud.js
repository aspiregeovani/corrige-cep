const {neon}=require('@neondatabase/serverless');
const {clean}=require('./semantic');
let connection;
function sql(){if(!process.env.DATABASE_URL)throw Error('Base postal central ainda não configurada.');return connection||=neon(process.env.DATABASE_URL);}
async function status(){return sql()`SELECT uf,fonte,versao,baixado_em,registros FROM postal_ufs ORDER BY uf`;}
async function city(uf,name){
 if(!/^[A-Z]{2}$/.test(uf)||!name||name.length>150)throw Object.assign(Error('Informe UF e cidade válidas.'),{status:400});
 const [row]=await sql()`SELECT payload,etag,registros,versao FROM postal_cidades WHERE uf=${uf} AND cidade=${clean(name)}`;
 return row;
}
module.exports={status,city};
