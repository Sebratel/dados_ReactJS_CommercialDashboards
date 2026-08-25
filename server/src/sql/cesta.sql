-- Réplica da consulta "Cesta de Produtos" (dsn=dbVoalle)
-- Um registro por ITEM de contrato (produto ou serviço avulso) que tenha produto
-- definido. O grão não é o contrato: um contrato com internet + ponto adicional +
-- telefone aparece em três linhas, e é justamente isso que a tela mostra.
--
-- DIFERENÇAS PROPOSITAIS EM RELAÇÃO AO POWER QUERY
-- 1. Corte por data ($1). A consulta de origem lê a tabela inteira: 452.630 linhas,
--    com contratos datados de 1000-01-01. Aqui ela obedece a Janela de dados, como
--    todas as outras — 219.861 linhas no recorte de 2024.
-- 2. `situacao_item` sai pronto ('Removido' / 'Em vigência') em vez dos dois passos
--    de substituição de texto que o Power Query faz sobre a coluna booleana.
-- 3. Os nomes das colunas vêm em snake_case; no Power Query eles são rótulos com
--    acento e espaço, que o ODBC devolve em minúsculas de todo modo.
SELECT
    c.contract_number::text AS contrato,
    ct.title                AS tipo_contrato,
    c.amount::float8        AS valor_plano,
    c.v_stage               AS estagio_contrato,
    c.v_status              AS status_contrato,
    cst.service_tag         AS etiqueta,
    cst.title               AS descricao_etiqueta,
    sp.title                AS servico_principal,
    sp.code                 AS codigo_servico_principal,
    ci.units::float8        AS unidades,
    ci.unit_amount::float8  AS valor,
    ci.created::date        AS adicionado_em,
    CASE WHEN ci.deleted THEN 'Removido' ELSE 'Em vigência' END AS situacao_item
FROM contracts c
LEFT JOIN contract_types ct         ON ct.id = c.contract_type_id
LEFT JOIN contract_service_tags cst ON cst.contract_id = c.id
LEFT JOIN service_products sp       ON sp.id = cst.service_product_id
LEFT JOIN contract_items ci         ON ci.contract_service_tag_id = cst.id
WHERE ci.service_product_id IS NOT NULL
  AND c.created >= $1
