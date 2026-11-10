# CEP em dia

Ferramenta de auxílio à conferência de CEPs em JavaScript. **Os resultados são ESTIMATIVAS, podem conter erros e não são uma correção definitiva. O cliente deve conferir endereços e CEPs antes de utilizá-los, inclusive nos casos de alta confiança.**

A versão local usa Node.js 24 ou superior e SQLite, escutando apenas `127.0.0.1:3000`. A versão hospedada na Vercel processa os clientes e gera o PDF no navegador, com persistência local em IndexedDB. O Neon armazena somente a base pública de endereços; não recebe o JSON dos clientes.

## Windows

1. Instale Node.js 24 ou superior a partir de https://nodejs.org/.
2. Execute `instalar.bat` uma vez, com acesso à internet.
3. Execute `iniciar.bat` e abra http://127.0.0.1:3000. Mantenha a janela do servidor aberta.
4. Carregue o JSON. Em **Configurações da base**, selecione e baixe as UFs faltantes ou importe os três arquivos CSV da fonte. O processamento inicia automaticamente quando as bases estão disponíveis.
5. Baixe Todos ou Alterados em JSON ou CSV. Arquivos parciais têm `-parcial` no nome. Pausar preserva o trabalho; ao reiniciar, o processamento continua salvo se não estiver pausado.

Uma nova carga de clientes substitui a execução anterior. Faça exportações antes de carregar outro arquivo. O campo `cep_anterior` guarda o valor original; sugestões distintas são agrupadas por CEP. A escolha automática é uma sugestão, não confirmação postal. Você pode escolher outra opção na tabela.

## Base e limitações

Fonte: https://github.com/welyab/cep. O repositório declara que a compilação é independente, baseada em fontes públicas e não é o e-DNE. Não apresenta um arquivo de licença explícita; verifique as condições declaradas pelo responsável antes de usos que exijam direitos de redistribuição. Não há garantia de atualidade ou cobertura. O download registra o commit e a data da obtenção, que não é a data dos endereços.

A fonte contém município, localidade, UF, tipo e nome de logradouro, bairro e CEP, mas não informa faixa de número, lado da rua ou trecho. A aplicação exige igualdade normalizada de cidade/município, UF e logradouro; prioriza bairro e depois CEP crescente. Não usa o CEP anterior como evidência e não faz busca aproximada. A base não permite confirmar se o CEP escolhido corresponde a um número específico. CEPs de localidades sem logradouros associados não são inferidos. Importação local aceita os três CSVs no formato dessa fonte, não e-DNE. Alteração de máscara sozinha não é alteração de CEP.

Dados persistentes e temporários ficam em `data/`, excluídos do Git: `cep.sqlite` contém base e execução, e `tmp/` arquivos temporários de upload. As importações são transacionais: falhas mantêm a base anterior. Para remover dados, encerre o servidor e apague `data/` manualmente. Não compartilhe essa pasta, pois contém dados dos clientes.

## Desenvolvimento e testes

`npm test` executa testes automatizados; `npm start` inicia o servidor. JSON exportado contém os campos originais e os metadados da consulta; CSV usa ponto e vírgula e UTF-8 com BOM. A contagem de sugestões inclui o CEP escolhido. A interface mostra o número de alternativas, que o exclui.


A opção **Alterados · SQL** gera um UPDATE por registro alterado, com CEP em texto e máscara. O arquivo não é executado pelo aplicativo. Códigos ausentes ou inválidos impedem a exportação; confira códigos duplicados antes de executar.

Se a primeira recomendação termina em -000 e tem a mesma raiz de cinco dígitos de um CEP específico já cadastrado, a seleção automática e a aplicação em massa preservam o CEP do cadastro, mesmo sem encontrá-lo na lista de sugestões. Nos outros casos de correspondência exata, o CEP anterior é mantido se for específico, tiver a mesma raiz e constar entre as sugestões. Caso contrário, aplica-se a primeira recomendação. A escolha manual continua disponível.

## Complementos municipais

A base estadual pode ter lacunas: a versão consultada em 09/11/2026 contém apenas um endereço de Bariri e um de Itaju. Repetir o download da mesma versão não acrescenta os CEPs por logradouro dessas cidades.

`node supplement.js arquivo-base.json` importa um retrato de uma listagem pública por município. O JSON deve conter `fonte` (URL HTTPS), `obtido_em` (data ISO da obtenção), `uf`, `cidade` e `registros` (objetos com `cep`, `logradouro`, `bairro`, `complemento`, `localidade`, `uf`). `versao` é opcional; cada registro também pode informar sua própria fonte e versão. A importação valida cidade, UF e CEP, é transacional e substitui somente o complemento daquela cidade. Os complementos ficam no mesmo SQLite, separados da base estadual, e sobrevivem a novos downloads de UF. As configurações mostram origem, data de obtenção e quantidade de registros; essa data não representa a atualização oficial dos Correios.

Nesta instalação, foram obtidas as listagens públicas de [Bariri](https://www.cepbusca.com.br/cep/sp/bariri) (774 CEPs) e [Itaju](https://www.cepbusca.com.br/cep/sp/itaju) (121 CEPs). Dez divergências de grafia da listagem de Bariri foram resolvidas com respostas do ViaCEP já salvas localmente, com a fonte registrada por endereço. O processamento não faz consultas externas. O pacote OpenCEP 2.0.1 também foi examinado, mas não foi importado por conter menos registros nessas cidades.

As sugestões e exportações identificam a fonte efetivamente usada. A seleção automática continua exigindo cidade, UF e logradouro iguais após a normalização original. Sem igualdade, uma comparação adicional de títulos, tipo da via e algumas datas escritas com números ou por extenso pode gerar sugestões na aba **Revisar endereços**. Esses casos mantêm o CEP original, não ficam como alterados e só mudam após escolha manual. Não há correção automática de erros de digitação. Endereços incompletos e áreas rurais podem continuar sem resultado. A seleção automática continua sendo uma sugestão, especialmente quando há vários CEPs para a mesma rua.

## Interpretação dos cadastros e confiança

A revisão também compara pequenas trocas, omissões e transposições de letras, consoantes duplicadas e variantes como Luis/Luiz e Manoel/Manuel. Nomes comuns pesam menos que palavras distintivas. A busca fica restrita à mesma cidade e UF; não usa o CEP antigo para justificar uma sugestão. Números diferentes no nome da rua bloqueiam a aproximação. Placeholders como `S/E`, `CADASTRO` e `ATUALIZAR` não são usados para inventar endereços. Repetições da mesma grafia ajudam no agrupamento, mas não aumentam a confiança.

**Alta** exige semelhança do nome de pelo menos 94/100, pelo menos duas palavras informativas correspondentes, todas as palavras cobertas, margem de pelo menos oito pontos sobre a outra rua mais próxima, tipo de via informado e compatível, e CEP único no bairro compatível. Sem bairro utilizável, a rua precisa ter apenas um CEP na base. Divergências entre rua/avenida, nomes rurais, omissões relevantes, excesso de candidatos e ambiguidades reduzem a classificação. Bairros com etapas I/II/III são tratados separadamente. **Média** e **Baixa** indicam evidência mais fraca ou CEP ainda ambíguo. O nível do logradouro é informado separadamente do nível do CEP.

A tela oferece os filtros exatos **Todas**, **Alta**, **Média** e **Baixa**, combinados com código e busca geral. Os nomes interpretados, a pontuação de semelhança e os motivos aparecem na tabela e no detalhe da sugestão. Os campos `cep_confianca`, `cep_confianca_logradouro`, `cep_nome_canonico`, `cep_similaridade_nome` e `cep_motivos_confianca` acompanham a exportação. A pontuação é uma medida de semelhança, não uma probabilidade calibrada de acerto nem uma confirmação postal. As sugestões de alta confiança são selecionadas automaticamente conforme as regras de preservação do CEP. Média e baixa confiança mantêm o CEP original até a escolha individual ou a aplicação em massa.

Uma palavra significativa omitida também pode gerar uma sugestão **Média**: pelo menos três palavras informativas devem corresponder, o bairro deve ser compatível, o CEP deve ser único nesse bairro e não pode haver outra rua próxima concorrente. Por exemplo, o cadastro `RUA PROFESSOR JOSE FRANCISCO DE TOLEDO`, bairro `BRASIL 500`, pode sugerir `Rua Professor José Francisco Barbieri de Toledo`, explicando a omissão de `BARBIERI`. Sem bairro compatível ou com outro candidato parecido, essa aproximação não é oferecida.

## Aplicação em massa

O botão **Aplicar sugestões filtradas** mostra a quantidade de clientes pendentes e aplica a primeira sugestão de cada um, respeitando aba, confiança, código e busca geral em todas as páginas. Ele aplica as sugestões que ainda aguardam revisão, respeitando o nível de confiança filtrado; em **Todas**, considera todos os níveis pendentes. Não substitui escolhas individuais ou registros já aplicados. A aplicação é transacional e valida que a carga, a confiança e a primeira sugestão continuam iguais às mostradas; registros modificados são ignorados e outra carga interrompe a operação.

Os registros aplicados recebem o status `Aplicado em lote pelo usuário`, mantêm `cep_anterior`, registram `cep_aplicado_em` e `cep_confianca_aplicada`, e entram em **Alterados** e no SQL somente se os dígitos do CEP mudaram. A confiança original permanece disponível para filtrar também os resultados já aplicados. Instalar ou atualizar a funcionalidade não aplica as sugestões; a aplicação ocorre ao clicar no botão.

## PDF no site

O botão **Baixar PDF** gera um relatório novo a cada clique, com os clientes alterados na confiança escolhida em **Confiança do PDF**: Baixa, Média, Alta ou Todos, independentemente dos filtros da tabela. A opção Todos também inclui as correspondências exatas sem nota semântica. O número de clientes elegíveis aparece ao lado do botão; a capa e o nome do arquivo identificam o filtro escolhido. Inclui CEP anterior/proposto, endereço original e da base, confiança, alternativas, motivos e espaço de conferência. Há aviso explícito de estimativa na capa e em todas as páginas. A exportação não executa SQL nem modifica clientes. No servidor local, a geração usa um Worker Node; na versão hospedada, ocorre no Worker do navegador. Não requer Python.

## Vercel e Neon

`npm run build` prepara `dist/` e o Worker do navegador. `npm run preview` testa a versão hospedada em `127.0.0.1:3001`. Configure `DATABASE_URL` somente no ambiente do servidor/Vercel; nunca no JavaScript público. O endpoint `/api/postal` atende somente leituras da base postal. Cada cidade é armazenada no Neon como um retrato JSON compactado com gzip, indexado por UF e cidade; as buscas exatas e semânticas usam esse retrato no navegador. O resultado é reutilizado e persistido localmente. Recarregar uma UF busca o banco central novamente.

`npm run postal:seed` importa exclusivamente as tabelas públicas `bases`, `enderecos` e `enderecos_complementares` do SQLite para o Neon. A importação é retomável: retratos com o mesmo hash não são regravados. Nenhuma tabela de clientes é consultada ou enviada. Nesta instalação foram importadas as 27 UFs, 5.673 cidades/localidades e 1.610.087 registros, incluindo os complementos já obtidos de Bariri e Itaju.

A contingência é alimentada por `node scripts/cache-city.cjs SP "Bariri"`. Se o município já tiver a listagem complementar salva, o script reutiliza o Neon e não consulta o site externo. `--force` faz uma atualização explícita, por município, com pausa entre páginas, validação e limite de páginas. Os resultados são salvos no banco para reutilização. Não existe consulta externa por cliente nem acesso público de escrita à contingência. Para cidades muito grandes, prefira atualizar a UF pela fonte principal em vez de varrer a contingência.

`DATABASE_URL` pode ser carregada de `.env.local` para os comandos administrativos. `.env*`, `data/`, arquivos SQLite, `dist/` e `.vercel/` ficam fora do Git. A publicação contém código e assets; dados dos clientes e bancos locais não são publicados. Ao usar a versão hospedada, carregue o JSON naquele navegador. Limpar os dados do navegador remove o histórico local; exporte seus resultados antes.

A versão hospedada carrega até três cidades do Neon por vez, prioriza as que concentram mais clientes e processa cada cidade assim que fica disponível. O acompanhamento mostra cidades carregadas e clientes processados. Uma cidade ausente (HTTP 404) é registrada localmente e seus clientes ficam como Não encontrado, preservando o CEP original e a UF. Falhas temporárias têm limite de 20 segundos por requisição, não impedem as demais cidades e podem ser tentadas novamente em Continuar. Ao atualizar a página, pendências são retomadas sem substituir escolhas já feitas.

A interface organiza o trabalho em carregar, revisar e exportar. Os cartões e o seletor de situação filtram os não encontrados, alterados, com alternativas, aguardando revisão, pendentes e dados incompletos. A confiança e a busca combinam com esses filtros; o lote usa a lista filtrada em todas as páginas. O PDF possui seleção própria e as exportações de dados mantêm seu alcance identificado. Na versão hospedada, selecionar um novo JSON invalida o cache das cidades da nova carga, consulta novamente o Neon e recalcula todos os clientes, inclusive ao selecionar o mesmo arquivo.

Sugestões por interpretação com alta confiança no CEP são selecionadas automaticamente, inclusive ao reabrir uma carga salva que ainda as tinha aguardando revisão. A seleção preserva os CEPs específicos diante de recomendação -000 da mesma raiz e os CEPs anteriores específicos que constam nas sugestões com a mesma raiz do primeiro resultado. Escolhas manuais são preservadas. Média e baixa confiança continuam disponíveis para revisão. A confiança, os motivos e o CEP anterior acompanham os registros nas exportações.
