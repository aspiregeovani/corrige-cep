const {Worker}=require('node:worker_threads');
const path=require('node:path');
const {prepareReport}=require('./pdf-report');
function generatePDF(rows,metadata,{signal}={}) {
 return new Promise((resolve,reject)=>{
  if(signal?.aborted)return reject(Object.assign(Error('Download cancelado.'),{name:'AbortError'}));
  const worker=new Worker(path.join(__dirname,'pdf-worker.js'),{workerData:prepareReport(rows,metadata)});
  let settled=false;
  function finish(error,value){if(settled)return;settled=true;signal?.removeEventListener('abort',abort);error?reject(error):resolve(value);}
  function abort(){worker.terminate();finish(Object.assign(Error('Download cancelado.'),{name:'AbortError'}));}
  signal?.addEventListener('abort',abort,{once:true});
  worker.once('error',error=>finish(error));
  worker.once('message',message=>finish(message.error?Error(message.error):null,message.error?null:{buffer:Buffer.from(message.pdf),pages:message.pages,records:message.records}));
  worker.once('exit',()=>{if(!settled)finish(Error('Não foi possível concluir o PDF.'));});
 });
}
module.exports={generatePDF};
