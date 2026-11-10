const $ = selector => document.querySelector(selector);
const number = value => Number(value).toLocaleString('pt-BR');
const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, char =>
  ({'&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'}[char]));
const ufList = 'AC AL AP AM BA CE DF ES GO MA MT MS MG PA PB PR PE PI RJ RN RS RO RR SC SP SE TO'.split(' ');
const confidenceRank = {Alta:3, 'Média':2, Baixa:1};
const statusLabels = {
  all:'Todos os clientes', review:'Aguardando revisão', changed:'CEPs alterados',
  alternatives:'Com alternativas', 'not-found':'Não encontrados', pending:'Aguardando processamento',
  problems:'Dados incompletos ou erro', selected:'CEP selecionado ou mantido'
};
const statusHints = {
  all:'Use a situação, a confiança ou a busca para encontrar os clientes que deseja conferir.',
  review:'Sugestões que aguardam escolha. As de alta confiança são selecionadas automaticamente. Confira nome, bairro e confiança nos demais casos.',
  changed:'O CEP para exportar tem dígitos diferentes do CEP da carga.',
  alternatives:'Há mais de um CEP sugerido para o endereço. Confira a opção escolhida e as alternativas.',
  'not-found':'A base consultada não encontrou um CEP para estes endereços. Abra a conferência para ver o motivo.',
  pending:'Estes clientes ainda aguardam a base de endereços ou o processamento.',
  problems:'O cadastro tem dados insuficientes ou houve um erro de consulta. Abra a conferência para ver o motivo.',
  selected:'Clientes com CEP selecionado ou preservado pelas regras da ferramenta.'
};
const metricTypes = [
  ['all','Total de clientes','Toda a carga'], ['review','Aguardando revisão','Sugestões para conferir'],
  ['changed','CEPs alterados','Entram na exportação SQL'], ['alternatives','Com alternativas','Mais de um CEP sugerido'],
  ['not-found','Não encontrados','Confira o cadastro'], ['pending','Aguardando processamento','Base ou consulta pendente']
];

let state = {rows:[], bases:[], missing:[]};
let filter = 'all', page = 0, shownId = null, fileName = '';
let applying = false, generatingPDF = false, importing = false, choosing = false;
let actionMessage = '', bulkMessage = '', pdfMessage = '', statusRequest = null;
let lastRowsMarkup = '', lastPagingMarkup = '';

$('#estimate-title').textContent = CepDisclaimer.title;
$('#estimate-body').textContent = CepDisclaimer.body;
$('#ufs').innerHTML = ufList.map(uf => '<option>'+uf+'</option>').join('');
$('#importUf').innerHTML = $('#ufs').innerHTML;
$('#metrics').innerHTML = metricTypes.map(([key,label,hint]) =>
  '<button type="button" class="metric" data-filter="'+key+'" aria-pressed="false">'+
  '<span>'+label+'</span><strong data-count>0</strong><small>'+hint+'</small></button>').join('');

const apiFetch = (...args) => window.CepLocal ? window.CepLocal.fetch(...args) : fetch(...args);

async function call(url, options) {
  const response = await apiFetch(url, options);
  const result = await response.json();
  if (!response.ok) throw Error(result.error || 'Falha na operação.');
  return result;
}
function notice(message) {
  $('#notice').className = message ? 'notice' : '';
  $('#notice').textContent = message || '';
}
function currentRows() {
  return CepReview.filteredRows(state.rows, {
    tab:filter, confidence:$('#review-confidence').value,
    code:$('#search-code').value, query:$('#search').value
  });
}
function hasFilters() {
  return filter !== 'all' || $('#review-confidence').value || $('#search-code').value || $('#search').value;
}
function selectFilter(value) {
  filter = value;
  $('#result-filter').value = value;
  page = 0;
  render();
}
function resetFilters() {
  filter = 'all';
  page = 0;
  $('#result-filter').value = 'all';
  $('#review-confidence').value = '';
  $('#search-code').value = '';
  $('#search').value = '';
}

function renderOverview() {
  for (const button of $('#metrics').querySelectorAll('[data-filter]')) {
    const key = button.dataset.filter;
    const count = state.rows.filter(row => CepReview.matchesStatus(row, key)).length;
    button.querySelector('[data-count]').textContent = number(count);
    button.classList.toggle('active', filter === key);
    button.setAttribute('aria-pressed', String(filter === key));
  }
  $('#clear-filters').disabled = !hasFilters();
  const total = state.rows.length;
  const processed = state.rows.filter(row => row.cep_status !== 'Pendente').length;
  const pending = total - processed;
  let progressText = total ? 'Processamento concluído.' : 'Carregue um JSON para começar.';
  if (importing) progressText = 'Abrindo o novo arquivo e reiniciando a execução…';
  else if (state.busy) {
    progressText = state.baseProgress
      ? 'Recarregando cidades · '+number(state.baseProgress.completed)+' de '+number(state.baseProgress.total)
      : 'Carregando a base de endereços…';
  } else if (state.paused && pending) progressText = 'Processamento pausado. Use Continuar para retomar.';
  else if (state.running) progressText = 'Consultando os endereços da carga…';
  else if (pending) progressText = 'Há clientes aguardando dados. Use Continuar para tentar novamente.';
  $('#progress').textContent = progressText;
  $('#processing').hidden = !total || (!pending && !state.busy);
  $('#processing-progress').value = total ? processed * 100 / total : 0;
  $('#processing-count').textContent = number(processed)+' de '+number(total)+' clientes processados';
  $('#pause').disabled = !state.running;
  $('#resume').disabled = importing || state.running || state.busy || !pending;
  $('#resume').textContent = state.paused ? 'Retomar consulta' : 'Continuar';
  $('#select-file').disabled = importing || applying || generatingPDF || state.busy || state.running;
  $('#select-file').textContent = importing ? 'Carregando…' : total ? 'Carregar outro JSON' : 'Selecionar JSON';
  $('#file-summary').textContent = total
    ? (fileName ? fileName+' · ' : 'Carga salva neste navegador · ')+number(total)+' clientes'
    : fileName ? fileName+' · arquivo sem clientes' : 'Ainda não há clientes carregados.';
}

function badgeClass(row) {
  if (row.cep_status === 'Revisar endereço') return 'review';
  if (row.cep_alterado) return 'changed';
  if (['Não encontrado','Dados insuficientes','Erro'].includes(row.cep_status)) return 'problem';
  if (row.cep_status === 'Pendente') return 'pending';
  return '';
}
function renderRow(row) {
  const confidence = CepReview.confidenceOf(row);
  const confidenceClass = {Alta:'high', 'Média':'medium', Baixa:'low'}[confidence];
  const suggestions = row.cep_quantidade_sugestoes || 0;
  const status = {'Revisar endereço':'Aguardando revisão', 'Dados insuficientes':'Dados incompletos',
    'Aplicado em lote pelo usuário':'Aplicado em massa'}[row.cep_status] || row.cep_status;
  const canonical = CepReview.levels.includes(CepReview.confidenceOf(row)) && row.cep_nome_canonico
    ? '<small class="canonical">Nome sugerido · '+escapeHtml(row.cep_nome_canonico)+'</small>' : '';
  const alternatives = suggestions > 1 ? '<small>'+number(suggestions-1)+' alternativa(s)</small>' : '';
  const reason = ['Não encontrado','Dados insuficientes','Erro'].includes(row.cep_status)
    ? '<small>'+escapeHtml(row.cep_motivo || 'Confira os dados do cadastro.')+'</small>' : '';
  return '<tr>'+
    '<td><strong>'+escapeHtml(row.cli_codigo)+'</strong></td>'+
    '<td>'+escapeHtml(row.cli_endereco)+(row.cli_numero?', '+escapeHtml(row.cli_numero):'')+canonical+'</td>'+
    '<td>'+escapeHtml(row.cli_bairro)+'</td>'+
    '<td>'+escapeHtml(row.cli_cidade)+' / '+escapeHtml(row.cli_uf || row.uf || row.descricao)+'</td>'+
    '<td>'+escapeHtml(row.cep_anterior)+'</td>'+
    '<td><strong>'+escapeHtml(row.cli_cep)+'</strong>'+(row.cep_alterado?'<small>CEP alterado</small>':'')+'</td>'+
    '<td><span class="badge '+badgeClass(row)+'">'+escapeHtml(status)+'</span>'+
    (confidenceClass?'<small class="confidence-'+confidenceClass+'">Confiança '+escapeHtml(confidence.toLowerCase())+'</small>':'')+alternatives+reason+'</td>'+
    '<td><button class="link" data-confer="'+row._rowId+'" aria-label="Conferir cliente '+escapeHtml(row.cli_codigo)+'">Conferir →</button></td></tr>';
}

function renderResults() {
  const rows = currentRows();
  if (filter === 'review') rows.sort((a,b) =>
    (confidenceRank[b.cep_confianca] || 0) - (confidenceRank[a.cep_confianca] || 0) ||
    String(a.cep_nome_canonico || '').localeCompare(String(b.cep_nome_canonico || ''), 'pt-BR'));
  const pageSize = Number($('#page-size').value);
  const pages = Math.max(1, Math.ceil(rows.length/pageSize));
  page = Math.min(page, pages-1);
  $('#result-count').textContent = number(rows.length)+' de '+number(state.rows.length)+' clientes · '+statusLabels[filter];
  $('#filter-description').textContent = statusHints[filter];
  const rowsMarkup = rows.length ? rows.slice(page*pageSize, (page+1)*pageSize).map(renderRow).join('')
    : '<tr><td colspan="8" class="empty-row"><strong>'+(state.rows.length?'Nenhum cliente com estes filtros':'Sua lista de clientes aparece aqui')+
      '</strong><p>'+(state.rows.length?'Tente outra situação ou use Limpar filtros.':'Selecione um JSON para consultar os endereços.')+'</p></td></tr>';
  if (lastRowsMarkup !== rowsMarkup) {
    $('#rows').innerHTML = rowsMarkup;
    lastRowsMarkup = rowsMarkup;
  }
  const pagingMarkup = '<span>'+(rows.length
    ? number(page*pageSize+1)+'–'+number(Math.min(rows.length,(page+1)*pageSize))+' de '+number(rows.length)
    : '0 clientes')+'</span><div><button class="button" data-page="-1" '+(page===0?'disabled':'')+
    '>← Anterior</button><button class="button" data-page="1" '+(page>=pages-1?'disabled':'')+'>Próxima →</button></div>';
  if (lastPagingMarkup !== pagingMarkup) {
    $('#paging').innerHTML = pagingMarkup;
    lastPagingMarkup = pagingMarkup;
  }

  const eligible = CepReview.bulkCandidates(rows);
  $('#apply-bulk').textContent = applying ? 'Aplicando…' : 'Aplicar sugestões ('+number(eligible.length)+')';
  $('#apply-bulk').disabled = importing || applying || state.running || state.busy || !eligible.length;
  $('#bulk-help').textContent = eligible.length
    ? number(eligible.length)+(eligible.length===1?' sugestão elegível':' sugestões elegíveis')+' em todas as páginas desta lista. A primeira sugestão será aplicada. Confira a confiança antes de continuar.'
    : 'Esta lista não possui sugestões elegíveis para aplicação em massa. Use Conferir para ver cada endereço.';
  $('#bulk-message').textContent = bulkMessage;
  $('#review-summary').hidden = filter !== 'review';
}

function renderExports() {
  const confidence = $('#pdf-confidence').value;
  const count = CepReview.pdfRows(state.rows, confidence).length;
  $('#pdf-confidence').disabled = generatingPDF;
  $('#pdf-count').textContent = number(count)+(count===1?' cliente':' clientes');
  $('#export-pdf').disabled = generatingPDF || importing || !count;
  $('#export-pdf').textContent = generatingPDF ? 'Gerando PDF…' : 'Baixar PDF · '+(confidence || 'Todos');
  $('#pdf-message').textContent = pdfMessage;
  const changed = state.rows.filter(row => row.cep_alterado).length;
  $('#export-changed-count').textContent = number(changed);
  for (const link of $('#exports').querySelectorAll('a[href^="/api/exportar/"]')) {
    const hasRows = link.getAttribute('href').includes('/alterados/') ? changed : state.rows.length;
    link.setAttribute('aria-disabled', String(!hasRows || importing));
  }
}
function renderBases() {
  const bases = state.bases.map(base =>
    '<p><strong>'+escapeHtml(base.uf)+'</strong> · '+number(base.registros)+' registros · importada em '+
    new Date(base.baixado_em).toLocaleString('pt-BR')+' · '+escapeHtml(base.fonte)+'</p>');
  for (const base of state.supplementalBases || []) {
    bases.push('<p><strong>'+escapeHtml(base.cidade)+' / '+escapeHtml(base.uf)+'</strong> · complemento · '+
      number(base.registros)+' registros · '+escapeHtml(base.fonte)+'</p>');
  }
  $('#bases').innerHTML = bases.join('') || '<p>Nenhuma base instalada.</p>';
  $('#download').disabled = state.busy || state.running || importing;
}
function render() {
  renderOverview();
  renderResults();
  renderExports();
  renderBases();
  if (importing) notice(actionMessage);
  else if (state.error) notice(state.error);
  else if (state.warning && !state.busy) notice(state.warning);
  else if (state.missing.length && !state.busy) notice('Há dados de cidades pendentes nas UFs '+state.missing.join(', ')+'. Use Continuar para retomar a consulta.');
  else notice(actionMessage);
}

function refresh() {
  if (statusRequest) return statusRequest;
  statusRequest = (async()=>{
    try {
      state = await call('/api/status');
      render();
    } catch (error) { notice(error.message); }
    finally { statusRequest = null; }
  })();
  return statusRequest;
}
setInterval(()=>{if (!applying && !generatingPDF && !importing) void refresh();}, 2000);

$('#metrics').addEventListener('click', event=>{
  const button = event.target.closest('[data-filter]');
  if (button) selectFilter(button.dataset.filter);
});
$('#result-filter').addEventListener('change', event=>selectFilter(event.target.value));
$('#clear-filters').onclick = ()=>{resetFilters(); render();};
for (const id of ['search','search-code']) $('#'+id).addEventListener('input', ()=>{page=0; render();});
$('#review-confidence').addEventListener('change', ()=>{page=0; render();});
$('#page-size').addEventListener('change', ()=>{page=0; renderResults();});
$('#paging').addEventListener('click', event=>{
  const button = event.target.closest('[data-page]');
  if (!button || button.disabled) return;
  page = Math.max(0, page+Number(button.dataset.page));
  renderResults();
  $('.table-wrap').scrollTop = 0;
});
$('#rows').addEventListener('click', event=>{
  const button = event.target.closest('[data-confer]');
  if (button) showSuggestions(Number(button.dataset.confer));
});

function showSuggestions(id) {
  const row = state.rows.find(item => item._rowId === id);
  if (!row) return;
  shownId = id;
  $('#dialog-title').textContent = 'Cliente '+row.cli_codigo;
  $('#dialog-message').textContent = '';
  const protectedCep = row.cep_status === 'Revisar endereço' &&
    CepReview.keepSpecificCep(row.cli_cep,row.cep_sugestoes[0]?.cep);
  const explanation = protectedCep
    ? 'O CEP específico foi mantido porque a primeira sugestão termina em -000 e tem a mesma raiz. Você pode escolher manualmente após conferir.'
    : row.cep_motivo || 'Confira o endereço e o CEP antes de escolher.';
  $('#suggestions').innerHTML = '<div class="client-detail"><strong>'+escapeHtml(row.cli_endereco)+
    (row.cli_numero?', '+escapeHtml(row.cli_numero):'')+'</strong><p>'+escapeHtml(row.cli_bairro)+' · '+
    escapeHtml(row.cli_cidade)+' / '+escapeHtml(row.cli_uf||row.uf||row.descricao)+
    '</p><p>CEP da carga <strong>'+escapeHtml(row.cep_anterior)+'</strong> CEP para exportar <strong>'+
    escapeHtml(row.cli_cep)+'</strong></p><p>'+escapeHtml(explanation)+'</p></div>'+
    (row.cep_sugestoes.length ? row.cep_sugestoes.map(suggestion=>
      '<div class="suggestion '+(suggestion.selecionado?'chosen':'')+'"><div class="suggestion-head"><strong>'+
      escapeHtml(suggestion.cep)+'</strong><button class="button '+(suggestion.selecionado?'':'primary')+
      '" data-choose="'+escapeHtml(suggestion.cep)+'" '+(suggestion.selecionado?'disabled':'')+'>'+
      (suggestion.selecionado?'CEP selecionado':'Usar este CEP')+'</button></div><p>'+escapeHtml(suggestion.endereco)+
      ' · '+escapeHtml(suggestion.bairro)+'</p>'+
      (suggestion.confianca?'<p><strong>Confiança '+escapeHtml(suggestion.confianca.toLowerCase())+'</strong> · Semelhança do nome '+escapeHtml(suggestion.similaridade_nome)+'/100</p>':'<p>Nome exato na base de endereços.</p>')+
      '<details><summary>Ver critérios e origem</summary>'+
      (suggestion.confianca?'<p>Confiança no nome da rua · '+escapeHtml(suggestion.confianca_logradouro)+'</p>':'')+
      '<ul class="evidence">'+(suggestion.motivos||[]).map(reason=>'<li>'+escapeHtml(reason)+'</li>').join('')+'</ul>'+
      '<small>'+escapeHtml(suggestion.complemento)+' '+escapeHtml(suggestion.fonte)+'</small></details></div>').join('')
    : '<p>Não há sugestões disponíveis. Confira o endereço, a cidade e a UF no cadastro de origem.</p>');
  $('#dialog').showModal();
}
$('#close').onclick = ()=>$('#dialog').close();
$('#suggestions').addEventListener('click', async event=>{
  const button = event.target.closest('[data-choose]');
  if (!button || choosing) return;
  choosing = true;
  button.disabled = true;
  button.textContent = 'Salvando…';
  try {
    await call('/api/escolher/'+shownId, {
      method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({cep:button.dataset.choose})
    });
    $('#dialog').close();
    await refresh();
  } catch (error) {
    $('#dialog-message').textContent = error.message;
    button.disabled = false;
    button.textContent = 'Usar este CEP';
  } finally { choosing = false; }
});

$('#select-file').onclick = ()=>$('#file').click();
$('#file').onchange = async event=>{
  const file = event.target.files[0];
  if (!file) return;
  importing = true;
  actionMessage = 'Carregando o novo JSON e recarregando os dados das cidades…';
  bulkMessage = '';
  pdfMessage = '';
  render();
  try {
    const form = new FormData();
    form.append('file', file);
    const result = await call('/api/clientes', {method:'POST',body:form});
    fileName = file.name;
    resetFilters();
    $('#pdf-confidence').value = '';
    actionMessage = number(result.total)+' clientes carregados. A base das cidades será recarregada para esta execução.';
    await refresh();
  } catch (error) { actionMessage = error.message; }
  finally {
    importing = false;
    event.target.value = '';
    render();
  }
};
async function controlProcessing(url) {
  try { await call(url,{method:'POST'}); await refresh(); }
  catch (error) { notice(error.message); }
}
$('#pause').onclick = ()=>controlProcessing('/api/pausar');
$('#resume').onclick = ()=>controlProcessing('/api/continuar');

$('#apply-bulk').onclick = async()=>{
  if (applying) return;
  const itens = CepReview.bulkCandidates(currentRows()), execucaoId = state.execucaoId;
  if (!itens.length) return;
  applying = true;
  bulkMessage = 'Aplicando '+number(itens.length)+' sugestões desta lista…';
  render();
  try {
    const result = await call('/api/aplicar-lote', {
      method:'POST', headers:{'Content-Type':'application/json'},
      body:JSON.stringify({execucaoId,itens}), signal:AbortSignal.timeout(45000)
    });
    bulkMessage = number(result.aplicados)+(result.aplicados===1?' sugestão aplicada.':' sugestões aplicadas.')+
      (result.ignorados?' '+number(result.ignorados)+' registros já alterados ou indisponíveis.':'');
  } catch (error) {
    bulkMessage = error.name==='TimeoutError'
      ? 'Não foi possível confirmar a aplicação. Atualize a página para conferir os registros salvos.'
      : error.message;
  } finally { applying=false; render(); void refresh(); }
};

$('#pdf-confidence').addEventListener('change', renderExports);
$('#export-pdf').onclick = async()=>{
  if (generatingPDF) return;
  const confidence = $('#pdf-confidence').value;
  generatingPDF = true;
  pdfMessage = 'Gerando PDF · '+(confidence?'confiança '+confidence.toLowerCase():'todos os alterados')+'…';
  render();
  try {
    const response = await apiFetch('/api/exportar/alterados/pdf?confidence='+encodeURIComponent(confidence));
    if (!response.ok) {
      const error = await response.json().catch(()=>({}));
      throw Error(error.error || 'Falha ao gerar o PDF.');
    }
    if (!response.headers.get('content-type')?.includes('application/pdf')) throw Error('Resposta inválida ao gerar o PDF.');
    const url = URL.createObjectURL(await response.blob()), link = document.createElement('a');
    link.href = url;
    link.download = response.headers.get('content-disposition')?.match(/filename="([^"]+)"/)?.[1] || 'cep-alterados-conferencia.pdf';
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(()=>URL.revokeObjectURL(url),1000);
    const count = response.headers.get('x-report-records');
    pdfMessage = 'PDF gerado'+(count?' com '+number(count)+(Number(count)===1?' cliente.':' clientes.'):'.');
  } catch (error) { pdfMessage = error.message; }
  finally { generatingPDF=false; render(); }
};

document.addEventListener('click', event=>{
  if (event.target.closest('a[aria-disabled="true"]')) {
    event.preventDefault();
    event.stopImmediatePropagation();
  }
},true);
$('#missing').onclick = ()=>{
  for (const option of $('#ufs').options) option.selected = state.missing.includes(option.value);
};
$('#download').onclick = async()=>{
  const ufs = [...$('#ufs').selectedOptions].map(option=>option.value);
  if (!ufs.length) { notice('Selecione uma ou mais UFs para recarregar.'); return; }
  try {
    actionMessage = 'Recarregando a base das UFs selecionadas…';
    notice(actionMessage);
    await call('/api/download',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({ufs})});
    await refresh();
  } catch (error) { notice(error.message); }
};
$('#import').onsubmit = async event=>{
  event.preventDefault();
  try {
    notice('Importando arquivos da base…');
    await call('/api/importar',{method:'POST',body:new FormData(event.target)});
    actionMessage = 'Arquivos da base importados.';
    await refresh();
  } catch (error) { notice(error.message); }
};

render();
void refresh();
