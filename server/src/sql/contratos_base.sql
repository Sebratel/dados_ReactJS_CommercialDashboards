-- Réplica da consulta "authentication_contracts" (dsn=dbVoalle) — a BASE de clientes.
--
-- Um registro por contrato com ponto de autenticação, que é o que caracteriza cliente
-- conectado. A tela usa isto para a base acumulada por cidade, bairro e tecnologia.
--
-- DIFERENÇAS PROPOSITAIS EM RELAÇÃO AO POWER QUERY
-- 1. Corte por data ($1) sobre a criação do contrato, obedecendo a Janela de dados.
--    A origem lê o histórico inteiro.
-- 2. `tecnologia` sai pronta do SQL. No modelo de origem ela é uma coluna DAX com
--    vinte comparações de LEFT() sobre o título do ponto de acesso. Duas
--    observações sobre aquela regra, que esta réplica preserva:
--      - a ORDEM é o que faz a regra funcionar: 'ST_NH' precisa ser testado antes de
--        'ST_N', 'ST_BCRCE_O' antes de 'ST_B', 'ST_TNFLT_O' antes de 'ST_T' e
--        'RTR_01_S'/'RTR_02_S' antes de 'RTR_0'. Inverter troca fibra por rádio.
--      - o DAX declara `VAR accessPoint = UPPER(title)` e depois NUNCA usa a
--        variável: todas as comparações são sobre o título cru. Como comparação de
--        texto em DAX ignora caixa, o efeito prático é comparar sem caixa — que é o
--        que o ILIKE faz aqui. A variável era para isso e ficou pelo caminho.
-- 3. O ponto de acesso cujo título começa com espaço (' ST') existe de verdade na
--    base; o LIKE preserva o espaço em vez de "consertar" o dado.
SELECT
    c.contract_number::text AS contrato,
    c.created               AS criado,
    c.created::date         AS data,
    c.description           AS descricao,
    ac."user"               AS usuario,
    ac.city                 AS cidade,
    ac.neighborhood         AS bairro,
    aap.title               AS ponto_acesso,
    c.amount::float8        AS valor,
    CASE
        WHEN aap.title ILIKE 'OLT%'        OR aap.title ILIKE 'ST\_S%'
          OR aap.title ILIKE 'ST\_NH%'     OR aap.title ILIKE 'ST\_C%'
          OR aap.title ILIKE 'ST\_E%'      OR aap.title ILIKE 'ST\_L%'
          OR aap.title ILIKE 'ST\_BCRCE\_O%' OR aap.title ILIKE ' ST%'
          OR aap.title ILIKE 'NHO%'        OR aap.title ILIKE 'BNG%'
          OR aap.title ILIKE 'RTR\_01\_S%' OR aap.title ILIKE 'RTR\_02\_S%'
          OR aap.title ILIKE 'ST\_TNFLT\_O%' OR aap.title ILIKE 'AUT%'
            THEN 'Fibra'
        WHEN aap.title ILIKE 'AP\_%'       OR aap.title ILIKE 'ST\_B%'
          OR aap.title ILIKE 'ST\_N%'      OR aap.title ILIKE 'RTR\_0%'
          OR aap.title ILIKE 'SW\_0%'      OR aap.title ILIKE 'ST\_T%'
            THEN 'Rádio'
        ELSE NULL
    END AS tecnologia
FROM authentication_contracts ac
LEFT JOIN contracts c ON c.id = ac.contract_id
LEFT JOIN authentication_access_points aap ON aap.id = ac.authentication_access_point_id
WHERE c.created >= $1
