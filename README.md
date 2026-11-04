# CEP em dia

Aplicativo local em JavaScript (Node.js 24 ou superior) e SQLite. Não envia clientes para a internet. O serviço escuta apenas `127.0.0.1:3000`.

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

O CEP anterior é mantido se tiver a mesma raiz de cinco dígitos do primeiro resultado e constar entre as sugestões. Se terminar em -000 ou não constar nas sugestões, o primeiro resultado é usado. Uma escolha manual continua disponível.
