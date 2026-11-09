document.querySelector('#estimate-title').textContent=CepDisclaimer.title;document.querySelector('#estimate-body').textContent=CepDisclaimer.body;
﻿const $=s=>document.querySelector(s);let state={rows:[],bases:[],missing:[]},filter='all',page=0,shownId=null,applying=false,generatingPDF=false,actionMessage='',bulkMessage='',statusRequest=null;const confidenceRank={Alta:3,'Média':2,Baixa:1};const esc=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));const ufList='AC AL AP AM BA CE DF ES GO MA MT MS MG PA PB PR PE PI RJ RN RS RO RR SC SP SE TO'.split(' ');$('#ufs').innerHTML=ufList.map(u=>`<option>${u}</option>`).join('');$('#importUf').innerHTML=ufList.map(u=>`<option>${u}</option>`).join('');
const apiFetch=(...args)=>window.CepLocal?window.CepLocal.fetch(...args):fetch(...args);
async function call(url,options){const r=await apiFetch(url,options);const j=await r.json();if(!r.ok)throw Error(j.error||'Falha na operação');return j}function notice(s){$('#notice').className=s?'notice':'';$('#notice').textContent=s||''}function stats(){let r=state.rows;return [['Total de clientes',r.length],['CEP selecionado',r.filter(x=>x.cep_sugestoes.some(s=>s.selecionado)).length],['Aguardando revisão',r.filter(x=>x.cep_status==='Revisar endereço').length],['Alterados',r.filter(x=>x.cep_alterado).length],['Com alternativas',r.filter(x=>x.cep_quantidade_sugestoes>1).length],['Sem resultado / erro',r.filter(x=>['Não encontrado','Dados insuficientes','Erro'].includes(x.cep_status)).length]]}function currentRows(){return CepReview.filteredRows(state.rows,{tab:filter,confidence:$('#review-confidence').value,code:$('#search-code').value,query:$('#search').value});}
function render(){let rows=currentRows();if(filter==='review')rows.sort((a,b)=>(confidenceRank[b.cep_confianca]||1)-(confidenceRank[a.cep_confianca]||1) || String(a.cep_nome_canonico||'').localeCompare(String(b.cep_nome_canonico||'')) || (b.cep_similaridade_nome||0)-(a.cep_similaridade_nome||0));
const eligible=CepReview.bulkCandidates(rows);$('#apply-bulk').textContent=applying?'Aplicando…':'Aplicar sugestões filtradas ('+eligible.length.toLocaleString('pt-BR')+')';$('#apply-bulk').disabled=applying||state.running||state.busy||!eligible.length;$('#bulk-actions').hidden=filter==='changed';$('#bulk-message').textContent=bulkMessage;
const pdfCount=CepReview.pdfRows(state.rows,$('#pdf-confidence').value).length;$('#pdf-confidence').disabled=generatingPDF;$('#pdf-count').textContent=pdfCount.toLocaleString('pt-BR')+(pdfCount===1?' cliente':' clientes');$('#export-pdf').disabled=generatingPDF||!pdfCount;$('#export-pdf').textContent=generatingPDF?'Gerando PDF…':'Alterados · PDF';$('#review-summary').hidden=filter!=='review';$('#metrics').innerHTML=stats().map(([a,b])=>`<div class="metric"><span>${a}</span><strong>${b}</strong></div>`).join('');$('#progress').textContent=state.busy?(state.baseProgress?'Carregando cidades: '+state.baseProgress.completed+' de '+state.baseProgress.total+'. '+state.rows.filter(r=>r.cep_status!=='Pendente').length.toLocaleString('pt-BR')+' de '+state.rows.length.toLocaleString('pt-BR')+' clientes processados.':'Carregando bases de endereços…'):state.running?'Consultando endereços locais…':state.paused?'Processamento pausado.':state.rows.some(x=>x.cep_status==='Pendente')?'Aguardando bases ou continuação.':state.rows.length?'Processamento concluído.':'Nenhum arquivo carregado.';$('#pause').disabled=!state.running;$('#resume').disabled=state.running||state.busy||!state.rows.length;$('#all').className=filter==='all'?'active':'';$('#changed').className=filter==='changed'?'active':'';$('#review').className=filter==='review'?'active':'';page=Math.min(page,Math.max(0,Math.ceil(rows.length/50)-1));$('#rows').innerHTML=rows.slice(page*50,page*50+50).map(r=>`<tr><td><strong>${esc(r.cli_codigo)}</strong></td><td>${esc(r.cli_endereco)}${r.cli_numero?', '+esc(r.cli_numero):''}${r.cep_status==='Revisar endereço'&&r.cep_nome_canonico?`<small class=canonical>Nome sugerido: ${esc(r.cep_nome_canonico)}</small>`:''}</td><td>${esc(r.cli_bairro)}</td><td>${esc(r.cli_cidade)} / ${esc(r.cli_uf||r.uf||r.descricao)}</td><td>${esc(r.cep_anterior)}</td><td><strong>${esc(r.cli_cep)}</strong></td><td><span class="badge">${esc(r.cep_status)}</span>${r.cep_status==='Revisar endereço'&&r.cep_confianca?`<small class=confidence>${esc(r.cep_confianca)} confiança no CEP</small>`:''}${r.cep_quantidade_sugestoes>1?`<small>mais ${r.cep_quantidade_sugestoes-1} sugestões</small>`:''}</td><td>${r.cep_quantidade_sugestoes?`<button class="link" onclick="showSuggestions(${r._rowId})">${r.cep_quantidade_sugestoes} · ver</button>`:'—'}</td></tr>`).join('')||'<tr><td colspan="8">Nenhum cliente nesta visualização.</td></tr>';$('#paging').innerHTML=rows.length?`<button class="link" onclick="changePage(-1)">← Anterior</button> ${page*50+1}–${Math.min(rows.length,(page+1)*50)} de ${rows.length} <button class="link" onclick="changePage(1)">Próxima →</button>`:'';$('#bases').innerHTML=state.bases.length?state.bases.map(b=>`<p><strong>${esc(b.uf)}</strong> · ${b.registros.toLocaleString('pt-BR')} registros · importada em ${new Date(b.baixado_em).toLocaleString('pt-BR')} · versão ${esc(b.versao.slice(0,12))} · ${esc(b.fonte)}</p>`).join(''):'<p>Nenhuma UF instalada.</p>';$('#bases').innerHTML+=(state.supplementalBases||[]).map(b=>`<p><strong>${esc(b.cidade)} / ${esc(b.uf)} · complemento</strong> · ${b.registros.toLocaleString('pt-BR')} registros · consultada em ${new Date(b.baixado_em).toLocaleString('pt-BR')} · ${esc(b.fonte)}</p>`).join('');if(state.error)notice(state.error);else if(state.warning&&!state.busy)notice(state.warning);else if(state.missing.length&&!state.busy)notice('Bases necessárias ainda não instaladas: '+state.missing.join(', ')+'. Abra as configurações para baixá-las.');else if(!state.busy)notice(actionMessage);}
window.changePage=n=>{page=Math.max(0,page+n);render()};window.showSuggestions=id=>{const r=state.rows.find(x=>x._rowId===id);shownId=id;$('#suggestions').innerHTML=(r.cep_sugestoes.some(s=>s.selecionado)?'':`<p>CEP anterior mantido: <strong>${esc(r.cli_cep)}</strong>. ${esc(r.cep_status==='Revisar endereço'?'Confira o nome interpretado, o bairro e as evidências abaixo antes de escolher.':r.cep_motivo)}</p>`)+r.cep_sugestoes.map(s=>`<div class="suggestion"><div><strong>${esc(s.cep)} ${s.selecionado?'· selecionado':''}</strong><p>${esc(s.endereco)} · ${esc(s.bairro)}</p>${s.confianca?`<p class=confidence><strong>Confiança no CEP: ${esc(s.confianca)}</strong> · nome do logradouro: ${esc(s.confianca_logradouro)} · semelhança ${esc(s.similaridade_nome)}/100</p><ul class=evidence>${(s.motivos||[]).map(m=>`<li>${esc(m)}</li>`).join('')}</ul>`:''}<small>${esc(s.complemento)} ${esc(s.fonte)}</small></div><button class="button" onclick="choose('${esc(s.cep)}')">Escolher</button></div>`).join('');$('#dialog').showModal()};window.choose=async cep=>{await call('/api/escolher/'+shownId,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({cep})});$('#dialog').close();await refresh()};$('#close').onclick=()=>$('#dialog').close();$('#all').onclick=()=>{filter='all';page=0;render()};$('#changed').onclick=()=>{filter='changed';page=0;render()};$('#review').onclick=()=>{filter='review';page=0;render()};function refresh(){
 if(statusRequest)return statusRequest;
 statusRequest=(async()=>{
  try{state=await call('/api/status');render();}
  catch(e){notice(e.message);}
  finally{statusRequest=null;}
 })();
 return statusRequest;
}
setInterval(()=>{if(!applying&&!generatingPDF)refresh();},2000);refresh();$('#file').onchange=async e=>{if(!e.target.files[0])return;actionMessage='';const f=new FormData();f.append('file',e.target.files[0]);try{await call('/api/clientes',{method:'POST',body:f});bulkMessage='';await refresh()}catch(e){notice(e.message)}e.target.value=''};$('#pause').onclick=async()=>{await call('/api/pausar',{method:'POST'});refresh()};$('#resume').onclick=async()=>{await call('/api/continuar',{method:'POST'});refresh()};$('#missing').onclick=()=>{for(const o of $('#ufs').options)o.selected=state.missing.includes(o.value)};$('#download').onclick=async()=>{const ufs=[...$('#ufs').selectedOptions].map(x=>x.value);notice('Baixando e importando bases. Isso pode levar alguns minutos…');try{await call('/api/download',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({ufs})});await refresh()}catch(e){notice(e.message)}};$('#import').onsubmit=async e=>{e.preventDefault();notice('Importando arquivos…');try{await call('/api/importar',{method:'POST',body:new FormData(e.target)});await refresh()}catch(e){notice(e.message)}};

function searchNorm(v){return String(v??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim()}
$('#search').addEventListener('input',()=>{page=0;render()});

$('#search-code').addEventListener('input',()=>{page=0;render()});

$('#review-confidence').addEventListener('change',()=>{page=0;render()});

$('#apply-bulk').onclick=async()=>{
 if(applying)return;
 const itens=CepReview.bulkCandidates(currentRows()),execucaoId=state.execucaoId;
 if(!itens.length)return;
 applying=true;bulkMessage='Aplicando '+itens.length.toLocaleString('pt-BR')+' sugestões filtradas…';render();
 try{const result=await call('/api/aplicar-lote',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({execucaoId,itens}),signal:AbortSignal.timeout(45000)});
 bulkMessage=result.aplicados.toLocaleString('pt-BR')+(result.aplicados===1?' sugestão aplicada.':' sugestões aplicadas.')+
  (result.ignorados?' '+result.ignorados.toLocaleString('pt-BR')+' já alteradas ou indisponíveis.':'');
 }catch(e){
  bulkMessage=e.name==='TimeoutError'?'Não foi possível confirmar a aplicação. Atualize a página para conferir os registros salvos.':e.message;
 }finally{
  // Libera o botão mesmo se a atualização da tabela falhar.
  applying=false;
  render();
  void refresh();
 }
};

$('#pdf-confidence').addEventListener('change',render);

$('#export-pdf').onclick=async()=>{
 if(generatingPDF)return;
 const confidence=$('#pdf-confidence').value;
 generatingPDF=true;actionMessage='Gerando o PDF de conferência'+(confidence?' de confiança '+confidence.toLocaleLowerCase('pt-BR'):' de todos os alterados')+'…';render();
 try{const response=await apiFetch('/api/exportar/alterados/pdf?confidence='+encodeURIComponent(confidence));
 if(!response.ok){const error=await response.json().catch(()=>({}));throw Error(error.error||'Falha ao gerar o PDF.');}
 if(!response.headers.get('content-type')?.includes('application/pdf'))throw Error('Resposta inválida ao gerar o PDF.');
 const blob=await response.blob(),url=URL.createObjectURL(blob),link=document.createElement('a');
 link.href=url;link.download=response.headers.get('content-disposition')?.match(/filename="([^"]+)"/)?.[1]||'cep-alterados-conferencia.pdf';
 document.body.appendChild(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
 const count=response.headers.get('x-report-records');actionMessage='PDF de conferência gerado'+(count?' com '+Number(count).toLocaleString('pt-BR')+(Number(count)===1?' cliente.':' clientes.'):'.');
 }catch(e){actionMessage=e.message;}finally{generatingPDF=false;render();}
};
