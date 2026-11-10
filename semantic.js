// Resolução conservadora de nomes. Pontuações são semelhança, não probabilidade.
// A política de seleção de CEP fica em selection.js.
const clean = value => String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g,'')
  .toUpperCase().replace(/[^A-Z0-9]+/g,' ').trim();
const types = new Map(Object.entries({R:'RUA',RUA:'RUA',AV:'AVENIDA',AVENIDA:'AVENIDA',PC:'PRACA',PRACA:'PRACA',
  TV:'TRAVESSA',TRAVESSA:'TRAVESSA',AL:'ALAMEDA',ALAMEDA:'ALAMEDA',ROD:'RODOVIA',RODOVIA:'RODOVIA',EST:'ESTRADA',ESTRADA:'ESTRADA'}));
const titles = new Set('DR DRA DOUTOR DOUTORA PROF PROFA PROFESSOR PROFESSORA PRES PRESIDENTE VER VEREADOR PREF PREFEITO MAL MARECHAL CEL CORONEL TEN TENENTE'.split(' '));
const stops = new Set('DE DA DO DAS DOS E'.split(' '));
const variants = {LUIZ:'LUIS',MANOEL:'MANUEL',SOUZA:'SOUSA',OZORIO:'OSORIO',THIAGO:'TIAGO'};
const placeholder = /^(S|S E|S N|SN|SEM ENDERECO|SEM CADASTRO|CADASTRO|CADASTRAR|ATUALIZAR|ENDERECO|NAO INFORMADO|NAO INFORMADA|NAO CONSTA|BAIRRO|CIDADE|0+)$/;
function canonicalToken(token) { return (variants[token] || token).replace(/([BCDFGHJKLMNPQRSTVWXYZ])\1+/g,'$1'); }
function describeStreet(value) {
  let text = clean(value);
  const words = text.split(' '), type = types.get(words[0]) || '';
  if (type) words.shift();
  text = words.join(' ').replace(/\b(7|VII) DE SETEMBRO\b/g,'SETE DE SETEMBRO')
    .replace(/\b(15|XV) DE NOVEMBRO\b/g,'QUINZE DE NOVEMBRO')
    .replace(/\b(16|XVI) DE JUNHO\b/g,'DEZESSEIS DE JUNHO')
    .replace(/\b(9|IX) DE JULHO\b/g,'NOVE DE JULHO')
    .replace(/\b(1|I) DE MAIO\b/g,'PRIMEIRO DE MAIO');
  const tokens = [...new Set(text.split(' ').filter(t=>t && !stops.has(t) && !titles.has(t)))];
  const informative = tokens.filter(t=>t.length>=3 && /[A-Z]/.test(t));
  return {text:clean(value),type,tokens,numbers:tokens.filter(t=>/^\d+$/.test(t)),
    valid:!placeholder.test(text) && informative.length>0 && text.length>=6,
    rural:/\b(SITIO|FAZENDA|CHACARA|RURAL)\b/.test(text)};
}
function neighborhoodKey(value,city='') {
  let s=clean(value);
  if (!s || s===clean(city) || placeholder.test(s) || !/[A-Z]{3}/.test(s)) return '';
  s=s.replace(/^BAIRRO /,'').replace(/\b(JD|JADIM)\b/g,'JARDIM').replace(/\bVL\b/g,'VILA')
    .replace(/\bPQ\b/g,'PARQUE').replace(/\bRES\b/g,'RESIDENCIAL').replace(/\bCJ\b/g,'CONJUNTO')
    .replace(/\bHAB\b/g,'HABITACIONAL');
  const romans={I:'1',II:'2',III:'3',IV:'4',V:'5'};
  return s.split(' ').filter(t=>!stops.has(t) && !['JARDIM','VILA','RESIDENCIAL','CONJUNTO','HABITACIONAL','PARQUE'].includes(t))
    .map(t=>romans[t] || canonicalToken(t)).join(' ');
}
function sameNeighborhood(a,b,city) {
  const key=neighborhoodKey(a,city);
  if(!key||key!==neighborhoodKey(b,city))return false;
  const type=value=>clean(value).replace(/^BAIRRO /,'').replace(/^(JD|JADIM) /,'JARDIM ')
    .replace(/^VL /,'VILA ').replace(/^PQ /,'PARQUE ').replace(/^RES /,'RESIDENCIAL ').replace(/^CJ /,'CONJUNTO ')
    .match(/^(JARDIM|VILA|PARQUE|RESIDENCIAL|CONJUNTO)\b/)?.[1] || '';
  const left=type(a),right=type(b);
  return !left||!right||left===right;
}
function editDistance(a,b) {
  const d=Array.from({length:a.length+1},()=>Array(b.length+1).fill(0));
  for(let i=0;i<=a.length;i++)d[i][0]=i;
  for(let j=0;j<=b.length;j++)d[0][j]=j;
  for(let i=1;i<=a.length;i++)for(let j=1;j<=b.length;j++) {
    d[i][j]=Math.min(d[i-1][j]+1,d[i][j-1]+1,d[i-1][j-1]+Number(a[i-1]!==b[j-1]));
    if(i>1&&j>1&&a[i-1]===b[j-2]&&a[i-2]===b[j-1])d[i][j]=Math.min(d[i][j],d[i-2][j-2]+1);
  }
  return d[a.length][b.length];
}
function tokenSimilarity(a,b) {
  if(a===b)return 1;
  if(/^\d+$/.test(a)||/^\d+$/.test(b))return 0;
  if(canonicalToken(a)===canonicalToken(b))return .97;
  if(a.length===1||b.length===1)return a[0]===b[0]?.65:0;
  if(Math.min(a.length,b.length)<4||Math.abs(a.length-b.length)>2)return 0;
  const distance=editDistance(a,b),limit=Math.max(a.length,b.length)>=8?2:1;
  return distance<=limit ? 1-distance/Math.max(a.length,b.length) : 0;
}
function grams(token) {
  const result=new Set();for(let i=0;i<token.length-2;i++)result.add(token.slice(i,i+3));return result;
}
function buildIndex(rows) {
  const roads=new Map(),lexicon=new Map(),trigrams=new Map();
  for(const row of rows) {
    if(!roads.has(row.rua))roads.set(row.rua,{street:row.rua,desc:describeStreet(row.rua),rows:[]});
    roads.get(row.rua).rows.push(row.detail?row:{...row,detail:JSON.parse(row.original)});
  }
  for(const road of roads.values())for(const token of road.desc.tokens) {
    if(!lexicon.has(token))lexicon.set(token,new Set());lexicon.get(token).add(road);
  }
  for(const token of lexicon.keys())for(const gram of grams(token)) {
    if(!trigrams.has(gram))trigrams.set(gram,new Set());trigrams.get(gram).add(token);
  }
  return {roads,lexicon,trigrams,matches:new Map()};
}
function nameMatch(a,b,weight) {
  if(a.numbers.join('|')!==b.numbers.join('|'))return null;
  if(a.rural!==b.rural)return null;
  const pairs=[];
  for(let i=0;i<a.tokens.length;i++)for(let j=0;j<b.tokens.length;j++) {
    const similarity=tokenSimilarity(a.tokens[i],b.tokens[j]);
    if(similarity>=.65)pairs.push({i,j,similarity,value:similarity*(weight(a.tokens[i])+weight(b.tokens[j]))});
  }
  pairs.sort((x,y)=>y.value-x.value);const usedA=new Set(),usedB=new Set(),matched=[];let total=0;
  for(const p of pairs)if(!usedA.has(p.i)&&!usedB.has(p.j)) {
    usedA.add(p.i);usedB.add(p.j);matched.push(p);total+=p.value;
  }
  const denominator=a.tokens.reduce((n,t)=>n+weight(t),0)+b.tokens.reduce((n,t)=>n+weight(t),0);
  const score=denominator?total/denominator:0;
  const anchors=matched.filter(p=>p.similarity>=.8&&a.tokens[p.i].length>=3&&b.tokens[p.j].length>=3).length;
  const edits=matched.filter(p=>a.tokens[p.i]!==b.tokens[p.j]).map(p=>`${a.tokens[p.i]} → ${b.tokens[p.j]}`);
  const missingWords=b.tokens.filter((t,i)=>!usedB.has(i));
  const unexplained=a.tokens.filter((t,i)=>!usedA.has(i));
  const omittedName=anchors>=3 && missingWords.length===1 && !unexplained.length &&
    matched.every(p=>p.similarity>=.95) && score>=.7;
  return {score,anchors,edits,missingWords,unexplained,omittedName,
    omissions:usedA.size!==a.tokens.length||usedB.size!==b.tokens.length};
}
function rankNames(index,street) {
  if(index.matches.has(street))return index.matches.get(street);
  const query=describeStreet(street);
  if(!query.valid)return [];
  const weight=t=>Math.min(4,1+Math.log(1+index.roads.size/(index.lexicon.get(t)?.size||1)));
  const candidates=new Map();
  for(const token of query.tokens) {
    const near=new Set(index.lexicon.has(token)?[token]:[]);
    for(const gram of grams(token))for(const term of index.trigrams.get(gram)||[]) {
      if(Math.abs(term.length-token.length)<=2)near.add(term);
    }
    for(const variant of near)if(tokenSimilarity(token,variant)>=.75)for(const road of index.lexicon.get(variant)||[]) {
      candidates.set(road,(candidates.get(road)||0)+weight(token));
    }
  }
  const matches=[];
  for(const [road] of [...candidates].sort((a,b)=>b[1]-a[1]).slice(0,200)) {
    const match=nameMatch(query,road.desc,weight);
    if(!match||match.score<.55)continue;
    matches.push({...match,road,typeConflict:!!query.type&&!!road.desc.type&&query.type!==road.desc.type,
      missingType:!query.type,rural:query.rural});
  }
  matches.sort((a,b)=>b.score-a.score||a.road.street.localeCompare(b.road.street));
  const eligible=matches.filter(m=>m.omittedName || (m.score>=.86 && (m.anchors>=2 || (query.tokens.length===1&&query.tokens[0].length>=8))));
  const result=eligible.slice(0,3).map(m=>({...m,gap:m===matches[0]?m.score-(matches[1]?.score ?? .55):0,truncated:candidates.size>200}));
  index.matches.set(street,result);return result;
}
function semanticRows(index,street,neighborhood,city) {
  const matches=rankNames(index,street),key=neighborhoodKey(neighborhood,city),result=[];
  for(const [position,match] of matches.entries()) {
    const neighborhoodCeps=new Set(match.road.rows.filter(r=>sameNeighborhood(neighborhood,r.bairro,city)).map(r=>r.cep));
    const streetCeps=new Set(match.road.rows.map(r=>r.cep));
    for(const row of match.road.rows) {
      const neighborhoodMatches=sameNeighborhood(neighborhood,row.bairro,city);
      const unambiguous=neighborhoodMatches?neighborhoodCeps.size===1:streetCeps.size===1;
      const clearName=position===0 && match.gap>=.08 && !match.truncated;
      const highName=match.score>=.94 && match.anchors>=2 && !match.omissions && clearName && !match.typeConflict && !match.missingType && !match.rural;
      const contextualOmission=match.omittedName && clearName && neighborhoodMatches && unambiguous &&
        !match.typeConflict && !match.missingType && !match.rural;
      // Uma palavra significativa ausente exige o bairro como confirmação adicional.
      if(match.omittedName&&!contextualOmission)continue;
      const confidence=highName&&unambiguous&&(neighborhoodMatches||(!key&&streetCeps.size===1))?'Alta':
        contextualOmission || (match.score>=.9&&position===0&&match.gap>=.04&&!match.omissions)?'Média':'Baixa';
      const reasons=[`Nome com semelhança ${Math.round(match.score*100)}/100 na mesma cidade e UF.`];
      if(match.edits.length)reasons.push('Variações: '+match.edits.join('; ')+'.');
      if(neighborhoodMatches)reasons.push('Bairro compatível após normalizar abreviações.');
      else reasons.push(key?'Bairro diferente do cadastro.':'Bairro ausente ou genérico; não usado como evidência.');
      if(!unambiguous)reasons.push('Mais de um CEP possível; o número não resolve o trecho nesta base.');
      if(match.typeConflict)reasons.push('Tipo de via divergente (por exemplo, rua/avenida).');
      if(match.missingType)reasons.push('Tipo de via não informado no cadastro.');
      if(match.missingWords.length)reasons.push('Palavra omitida no cadastro: '+match.missingWords.join(', ')+'.');
      if(match.unexplained.length)reasons.push('Palavra do cadastro sem correspondência: '+match.unexplained.join(', ')+'.');
      if(!clearName)reasons.push('Há outro logradouro com nome próximo ou evidência insuficiente para distinguir.');
      if(match.score===1)reasons.push('Nome coincide após interpretar títulos, tipo da via ou datas.');
      result.push({...row,review:{confianca:confidence,confianca_logradouro:highName?'Alta':match.score>=.9?'Média':'Baixa',
        similaridade_nome:Math.round(match.score*100),margem_nome:Math.round(match.gap*100),
        motivos:reasons,metodo:'semantica-local-v1',mesmo_bairro:neighborhoodMatches,cep_ambiguo:!unambiguous,
        ordem:position*10+(neighborhoodMatches?0:1)}});
    }
  }
  return result;
}
module.exports={clean,describeStreet,neighborhoodKey,tokenSimilarity,buildIndex,rankNames,semanticRows};
