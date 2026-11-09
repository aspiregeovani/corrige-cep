// Falhas de uma cidade não impedem a carga e o processamento das demais.
async function loadCities(cities,{isCached,load,importSnapshot,onMissing,onReady,onProgress,concurrency=3}) {
 const progress={total:cities.length,completed:0,loaded:0,cached:0,missing:0,failed:0,failures:[]};
 let next=0;
 const notify=()=>onProgress?.({...progress,failures:[...progress.failures]});
 notify();
 async function consume(){
  while(next<cities.length){
   const city=cities[next++];
   try{
    if(isCached(city)){progress.cached++;}
    else{
     const snapshot=await load(city);
     await importSnapshot(city,snapshot);progress.loaded++;
    }
    onReady?.(city);
   }catch(error){
    if(error.status===404){await onMissing(city,error);progress.missing++;onReady?.(city);}
    else{progress.failed++;progress.failures.push({uf:city.uf,city:city.city,message:error.message});}
   }finally{progress.completed++;notify();}
  }
 }
 await Promise.all(Array.from({length:Math.min(concurrency,cities.length)},consume));
 return progress;
}
async function fetchJSON(url,{timeout=20000,...options}={}) {
 const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),timeout);
 try{
  const response=await fetch(url,{...options,signal:controller.signal});
  const data=await response.json();
  if(!response.ok)throw Object.assign(Error(data.error||'Base postal indisponível.'),{status:response.status});
  return data;
 }catch(error){if(controller.signal.aborted)throw Error('Tempo limite ao carregar a base. Use Continuar para tentar novamente.');throw error;}
 finally{clearTimeout(timer);}
}
module.exports={loadCities,fetchJSON};
