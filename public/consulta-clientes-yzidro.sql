SELECT cli_codigo, cli_endereco, cli_numero, cli_cidade, cli_bairro, cli_complemento, e.descricao, cli_cep
FROM clientes c
INNER JOIN estado e ON e.es_codigo = c.es_codigo
-- WHERE c.cli_bloqueio = 'N'
ORDER BY e.descricao, cli_cidade, cli_bairro, cli_endereco;
