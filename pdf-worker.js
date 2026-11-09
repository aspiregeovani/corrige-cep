const {workerData,parentPort}=require('node:worker_threads');
const {renderReport}=require('./pdf-report');
renderReport(workerData).then(({buffer,pages,records})=>{
 const pdf=new Uint8Array(buffer);parentPort.postMessage({pdf,pages,records},[pdf.buffer]);
}).catch(error=>{parentPort.postMessage({error:error.message});});
