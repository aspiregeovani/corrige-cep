const {PDFDocument}=require('pdfkit');
const notice=require('./public/disclaimer');
const {pdfConfidenceOf,pdfRows}=require('./public/review-utils');

const digits=value=>String(value??'').replace(/\D/g,'');
const text=value=>String(value??'').replace(/[\u2010-\u2015]/g,'-').replace(/→/g,' para ')
 .replace(/[\x00-\x08\x0b-\x1f]/g,' ');
const sections=[
 ['low','Baixa confiança','#AA4941'],['medium','Média confiança','#A96B1E'],
 ['high','Alta confiança','#357454'],['exactMany','Nome exato - múltiplos CEPs','#607C87'],
 ['exactOne','Nome exato - opção única','#5E7468'],
];
function selectedSuggestion(row) {
 const sameCep=s=>digits(s.cep)===digits(row.cli_cep);
 return (row.cep_sugestoes||[]).find(s=>s.selecionado&&sameCep(s)) ||
  (row.cep_sugestoes||[]).find(sameCep) || {};
}
function prepareReport(rows,{totalClients=rows.length,createdAt=new Date().toISOString(),partial=false,confidence=''}={}) {
 const collator=new Intl.Collator('pt-BR',{numeric:true,sensitivity:'base'});
 const records=pdfRows(rows,confidence).map(r=>{
  const s=selectedSuggestion(r);
  const confidence=pdfConfidenceOf(r);
  const count=(r.cep_sugestoes||[]).length;
  const group=({Alta:'high','Média':'medium',Baixa:'low'})[confidence] || (count>1?'exactMany':'exactOne');
  const notes=confidence?(s.motivos||r.cep_motivos_confianca||[]):[
   `Nome exato; ${count>1?`escolha entre ${count} CEPs`:'opção única'}.`,
   'Confiança semântica não calculada.',
  ];
  return {code:text(r.cli_codigo),city:text(r.cli_cidade),uf:text(r.cli_uf||r.uf||r.descricao),
   originalStreet:text(r.cli_endereco),number:text(r.cli_numero),originalNeighborhood:text(r.cli_bairro),
   originalComplement:text(r.cli_complemento),street:text(s.endereco||r.cep_nome_canonico||r.cli_endereco),
   neighborhood:text(s.bairro),complement:text(s.complemento),oldCep:text(r.cep_anterior),newCep:text(r.cli_cep),
   confidence:confidence||null,streetConfidence:text(s.confianca_logradouro||r.cep_confianca_logradouro),
   similarity:s.similaridade_nome??r.cep_similaridade_nome??null,alternatives:Math.max(0,count-1),
   reasons:notes.map(text),source:text(s.fonte||r.cep_fonte),group};
 });
 const groups=sections.filter(([key])=>!confidence||key===({Alta:'high','Média':'medium',Baixa:'low'})[confidence])
  .map(([key,title,color])=>({key,title,color,records:records.filter(r=>r.group===key)
  .sort((a,b)=>collator.compare(a.uf,b.uf)||collator.compare(a.city,b.city)||collator.compare(a.street,b.street)||
   collator.compare(a.newCep,b.newCep)||collator.compare(a.code,b.code))}));
 return {totalClients,createdAt,partial,confidence,records,groups};
}
function reportFilename({confidence='',partial=false}={}) {
 const suffix=({Alta:'alta',Média:'media',Baixa:'baixa'})[confidence];
 return 'cep-alterados-conferencia'+(suffix?'-'+suffix:'')+(partial?'-parcial':'')+'.pdf';
}

function sourceCode(source) {
 if(source.includes('cepbusca.com.br'))return 'C';
 if(source.includes('welyab/cep'))return 'W';
 if(source.includes('viacep.com.br'))return 'V';
 return source||'Não informada';
}
function compactReasons(record) {
 return record.reasons.filter(r=>!r.startsWith('Nome com semelhança')&&!r.startsWith('Nome coincide após'))
  .map(r=>r.replace('Bairro compatível após normalizar abreviações.','Bairro compatível.')
   .replace('Bairro ausente ou genérico; não usado como evidência.','Bairro ausente ou genérico.')
   .replace('Mais de um CEP possível; o número não resolve o trecho nesta base.','CEP ambíguo; trecho não confirmado.')
   .replace('Tipo de via divergente (por exemplo, rua/avenida).','Tipo da via divergente.')
   .replace('Tipo de via não informado no cadastro.','Tipo da via ausente.')
   .replace('Há outro logradouro com nome próximo ou evidência insuficiente para distinguir.','Outro nome próximo ou distinção insuficiente.')
   .replace('Palavra omitida no cadastro:','Omitida:').replace('Variações:','Grafia:'))
  .concat('Base: '+sourceCode(record.source)+'.').join(' ');
}

// Funciona somente com Node e as fontes internas do PDFKit; não depende de Python ou fontes do Windows.
async function renderReport(report,{compress=true}={}) {
 const doc=new PDFDocument({size:'A4',layout:'landscape',margin:0,autoFirstPage:false,bufferPages:true,compress,
  info:{Title:'Conferência das alterações de CEP',Author:'CEP em dia'}});
 const chunks=[];
 const completed=new Promise((resolve,reject)=>{doc.on('data',chunk=>chunks.push(chunk));doc.on('error',reject);
  doc.on('end',()=>{const size=chunks.reduce((n,c)=>n+c.byteLength,0),bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}resolve(bytes);});});
 const W=841.89,H=595.28,M=34,cols=[34,51,155,155,61,61,61,30,141,24];
 const x0=(W-cols.reduce((a,b)=>a+b,0))/2,top=111,bottom=H-39;
 const ink='#244236',muted='#61776B',line='#D9E3DC';
 const stamp=new Intl.DateTimeFormat('pt-BR',{timeZone:'America/Sao_Paulo',dateStyle:'short',timeStyle:'short'})
  .format(new Date(report.createdAt));
 function wrap(value,width,font='Helvetica',size=7.6) {
  doc.font(font).fontSize(size);
  const lines=[];
  for(const paragraph of text(value).split('\n')) {
   let current='';
   for(let word of paragraph.trim().split(/\s+/).filter(Boolean)) {
    if(current&&doc.widthOfString(current+' '+word)>width){lines.push(current);current='';}
    while(doc.widthOfString(word)>width) {
     let part='';for(const ch of word){if(part&&doc.widthOfString(part+ch)>width)break;part+=ch;}
     if(current){lines.push(current);current='';}lines.push(part);word=word.slice(part.length);
    }
    current=current?current+' '+word:word;
   }
   lines.push(current);
  }
  return {lines,font,size,leading:size+1.6};
 }
 function drawLines(cell,x,y) {
  doc.font(cell.font).fontSize(cell.size).fillColor(ink);
  cell.lines.forEach((s,i)=>doc.text(s,x,y+i*cell.leading,{lineBreak:false}));
 }
 function cellRow(r) {
  const conf=r.confidence?[r.confidence,r.similarity!==null?'Nome: '+r.similarity+'/100':'',r.streetConfidence?'Rua: '+r.streetConfidence:''].filter(Boolean).join('\n'):'Sem nota\nNome exato';
  const values=[r.code,r.city+'\n'+r.uf,[r.originalStreet+(r.number?', '+r.number:''),r.originalNeighborhood,r.originalComplement].filter(Boolean).join('\n'),
   [r.street,r.neighborhood,r.complement].filter(Boolean).join('\n'),r.oldCep,r.newCep,conf,String(r.alternatives),compactReasons(r),''];
  const cells=values.map((s,i)=>wrap(s,cols[i]-7,[0,4,5,7].includes(i)?'Courier-Bold':'Helvetica',
   [0,4,5,7].includes(i)?7.8:[1,6,8].includes(i)?7.0:7.6));
  return {record:r,cells,height:Math.max(...cells.map(c=>c.lines.length*c.leading))+8};
 }
 const pages=[],ranges={};
 for(const group of report.groups) {
  if(!group.records.length)continue;
  const start=pages.length+2;let current=[],used=0;
  for(const r of group.records) {
   const row=cellRow(r);
   // Divisão de linhas muito longas, repetindo código e CEPs nas continuações.
   if(row.height>bottom-top) {
    const lineLimit=Math.floor((bottom-top-8)/Math.max(...row.cells.map(c=>c.leading)));
    const length=Math.max(...row.cells.map(c=>c.lines.length));
    if(current.length){pages.push({group,rows:current});current=[];used=0;}
    for(let offset=0;offset<length;offset+=lineLimit) {
     const cells=row.cells.map((c,i)=>({...c,lines:[0,4,5,6,7].includes(i)?c.lines:c.lines.slice(offset,offset+lineLimit)}));
     pages.push({group,rows:[{...row,cells,continuation:offset>0,height:Math.max(...cells.map(c=>c.lines.length*c.leading))+8}]});
    }
    continue;
   }
   if(current.length&&used+row.height>bottom-top){pages.push({group,rows:current});current=[];used=0;}
   current.push(row);used+=row.height;
  }
  if(current.length)pages.push({group,rows:current});
  ranges[group.key]={first:start,last:pages.length+1};
 }
 const totalPages=pages.length+1;
 function addPage(){doc.addPage({size:'A4',layout:'landscape',margin:0});}
 function heading(value,x,y,size=10,color=ink){doc.font('Helvetica-Bold').fontSize(size).fillColor(color).text(value,x,y,{lineBreak:false});}
 function paragraph(value,y,size=9){const cell=wrap(value,W-2*M,'Helvetica',size);drawLines(cell,M,y);return y+cell.lines.length*cell.leading;}
 addPage();doc.addNamedDestination('cover','Fit');doc.outline.addItem('Resumo e índice');
 doc.rect(0,0,W,8).fill(ink);heading('CEP EM DIA / CONFERÊNCIA',M,26);
 heading('Alterações propostas de CEP',M,52,25);
 let y=paragraph(`${report.records.length.toLocaleString('pt-BR')} ${report.records.length===1?'cliente':'clientes'} para conferir | Gerado em ${stamp} (São Paulo)${report.partial?' | RELATÓRIO PARCIAL':''}`,87,10)+18;
 if(report.confidence){y=paragraph('Filtro do PDF: confiança '+report.confidence.toLocaleLowerCase('pt-BR')+'.',y,10)+10;}
 heading(notice.title,M,y,9,'#A96B1E');y+=16;y=paragraph(notice.body,y,8.5)+12;
 y=paragraph('Inclui os registros cujos dígitos do CEP selecionado diferem dos originais. Gerado com os dados atuais da aplicação; conferir antes de atualizar o ERP.',y)+16;
 heading('ÍNDICE E QUANTIDADES',M,y,9);y+=20;
 for(const group of report.groups) {
  const count=group.records.length;
  doc.roundedRect(M,y,W-2*M,27,3).fill('#F4F8F5');doc.rect(M,y,4,27).fill(group.color);
  heading(group.title,M+13,y+8,9,group.color);
  const qty=count.toLocaleString('pt-BR')+(count===1?' cliente':' clientes');heading(qty,W-250,y+8,9);
  const range=ranges[group.key];heading(range?`Páginas ${range.first} a ${range.last}`:'Sem registros',W-156,y+8,8);
  if(range)doc.goTo(M,y,W-2*M,27,group.key);
  y+=32;
 }
 y+=8;
 y=paragraph('Conferência: compare cadastro, logradouro e bairro da base, CEP anterior e proposto. Marque OK após conferir. Alt. informa outros CEPs sugeridos, excluindo o escolhido.',y,8.5)+8;
 y=paragraph('Alta, Média e Baixa são classificações semânticas. A nota do nome mede semelhança, não probabilidade. A confiança na rua é separada da confiança no CEP; a base não confirma número ou trecho.',y,8.5)+8;
 y=paragraph('Sem nota: correspondência exata sem classificação semântica, separada em opção única ou múltiplos CEPs. Não é convertida em confiança Alta.',y,8.5)+8;
 y=paragraph('Fontes: C = CEPBusca (Bariri/Itaju); W = github.com/welyab/cep; V = ViaCEP (respostas salvas). Dados processados localmente; nenhuma informação de clientes é enviada para gerar o PDF.',y,8)+8;
 paragraph(`Universo da carga: ${report.totalClients.toLocaleString('pt-BR')} clientes. ${report.partial?'Há processamento ou pendências; este é um retrato parcial.':'O relatório é um retrato do momento do download.'}`,y,8);
 const headers=['Código','Cidade / UF','Cadastro original / bairro','Logradouro da base / bairro','CEP anterior','CEP proposto','Confiança','Alt.','Critério / observações','OK'];
 for(const [i,page] of pages.entries()) {
  addPage();const pageNumber=i+2;
  if(pageNumber===ranges[page.group.key].first){doc.addNamedDestination(page.group.key,'Fit');doc.outline.addItem(page.group.title);}
  heading('CEP EM DIA / ALTERAÇÕES PARA CONFERÊNCIA',M,24,9);
  heading(page.group.title,M,43,15,page.group.color);
  heading(page.group.records.length.toLocaleString('pt-BR')+(page.group.records.length===1?' cliente nesta seção':' clientes nesta seção'),W-200,48,8,muted);
  paragraph('Comparar cadastro, bairro, CEP escolhido e alternativas. O visto é reservado à conferência.',64,8);
  doc.rect(x0,86,cols.reduce((a,b)=>a+b,0),25).fill(ink);
  let x=x0;
  headers.forEach((s,j)=>{const h=wrap(s,cols[j]-7,'Helvetica-Bold',7);doc.font(h.font).fontSize(h.size).fillColor('#FFFFFF');h.lines.forEach((v,k)=>doc.text(v,x+3.5,91+k*h.leading,{lineBreak:false}));x+=cols[j];});
  let topY=top;
  for(const [j,row] of page.rows.entries()) {
   if(j%2)doc.rect(x0,topY,cols.reduce((a,b)=>a+b,0),row.height).fill('#F4F8F5');
   x=x0;
   row.cells.forEach((cell,k)=>{if(k===cols.length-1)doc.rect(x+(cols[k]-8)/2,topY+5,8,8).lineWidth(.5).stroke(muted);
    else drawLines(cell,x+3.5,topY+4);x+=cols[k];});
   topY+=row.height;doc.moveTo(x0,topY).lineTo(x0+cols.reduce((a,b)=>a+b,0),topY).lineWidth(.35).stroke(line);
  }
 }
 for(let i=0;i<totalPages;i++) {
  doc.switchToPage(i);doc.moveTo(M,H-34).lineTo(W-M,H-34).lineWidth(.5).stroke(line);
  doc.font('Helvetica-Bold').fontSize(6.8).fillColor('#8D5A22').text(notice.footer,M,H-29,{lineBreak:false});
  doc.font('Helvetica').fontSize(6.5).fillColor(muted).text(`Gerado em ${stamp} - São Paulo | CEP em dia${report.partial?' | Parcial':''}`,M,H-17,{lineBreak:false});
  doc.text(`Página ${i+1} de ${totalPages}`,W-130,H-17,{lineBreak:false});
 }
 doc.end();
 return {buffer:await completed,pages:totalPages,records:report.records.length};
}
module.exports={prepareReport,renderReport,reportFilename};
