-- Réplica da consulta "SPLITTER_(GERAL)" do Power Query (dsn=dbVoalle).
--
-- Grão: uma linha por PORTA de splitter secundário. É o grão do relatório de
-- condomínios — cada porta é um cliente em potencial, ocupada ou livre.
--
-- Cadeia: splitter primário (type=2) -> porta do primário -> splitter secundário
-- (type=1, o que fica no condomínio) -> porta do secundário -> conexão -> contrato
-- -> cliente. O ponto de acesso, o concentrador e o site vêm do primário.
--
-- TRÊS DIFERENÇAS PROPOSITAIS em relação ao Power Query (todas documentadas no
-- README, seção "Condomínios"):
--
-- 1. O recorte de condomínio está AQUI, no WHERE, e não só na coluna DAX
--    SPLITTER_CONDOMINIO + filtro de página. Sem isso a consulta traria todas as
--    portas de todos os splitters da rede para a memória do servidor, quando a
--    tela só mostra as de condomínio. O nome do condomínio continua sendo
--    extraído em JS, com a mesma regra do DAX.
--
-- 2. As portas e os splitters secundários apagados/inativos ficam de fora
--    (`sec.active`, `sec.deleted`, `porta_sec.deleted`, `sec."type" = 1`). O
--    Power Query filtra isso só na consulta de ocupação, não nesta — o efeito é
--    que a contagem de portas da tabela de detalhe fica maior que a capacidade
--    informada ao lado, ou seja, o detalhe contradiz o indicador. Filtrando dos
--    dois lados os dois números fecham.
--
-- 3. Usuário, cidade, rua, bairro e coordenadas do cliente vêm direto de
--    `authentication_contracts` desta linha. O Power Query dá a volta por
--    CONTRATOS_BLOQUEADOS casando por número de contrato — e quando um contrato
--    tem mais de uma conexão essa volta duplica a linha e pode trazer o usuário
--    de outra porta. Direto não tem como errar: a conexão é a desta porta.
SELECT
    prim.id                   AS splitter_primario_id,
    prim.title                AS splitter_primario,
    prim.created::date        AS splitter_primario_criado,
    porta_prim.port           AS porta_primario,

    sec.id                    AS splitter_id,
    sec.title                 AS splitter,
    sec.code                  AS splitter_codigo,
    sec.created::date         AS splitter_criado,
    sec.out_ports             AS splitter_capacidade,
    sec.city                  AS splitter_cidade,
    sec.lat                   AS splitter_lat,
    sec.lng                   AS splitter_lng,

    porta_sec.port            AS porta,

    conc.title                AS concentrador,
    ponto.title               AS ponto_acesso,
    site.title                AS site,

    con.id                    AS conexao_id,
    con."user"                AS usuario,
    con.city                  AS cidade,
    con.street                AS rua,
    con.street_number         AS numero,
    con.neighborhood          AS bairro,
    con.lat                   AS cliente_lat,
    con.lng                   AS cliente_lng,
    con.slot_olt              AS placa,
    con.port_olt              AS pon,

    ctr.contract_number       AS contrato,
    ctr.approval_date::date   AS data_aprovacao,
    ctr.v_status              AS status_contrato,
    -- CONTRATOS (a consulta que o Power Query mescla aqui) só traz aprovado e
    -- não cancelado; fora disso o merge devolve nulo. Este sinalizador reproduz
    -- esse comportamento sem precisar de uma segunda carga da tabela.
    (ctr.v_stage = 'Aprovado' AND ctr.v_status <> 'Cancelado') AS contrato_aprovado,
    pes.name                  AS cliente
FROM authentication_splitters prim
JOIN authentication_splitter_ports porta_prim
     ON porta_prim.authentication_splitter_id = prim.id
JOIN authentication_splitters sec
     ON sec.id = porta_prim.children_authentication_splitter_id
JOIN authentication_splitter_ports porta_sec
     ON porta_sec.authentication_splitter_id = sec.id
LEFT JOIN authentication_contracts con ON con.id = porta_sec.authentication_contract_id
LEFT JOIN contracts ctr                ON ctr.id = con.contract_id
LEFT JOIN people pes                   ON pes.id = ctr.client_id
LEFT JOIN authentication_access_points ponto ON ponto.id = prim.authentication_access_point_id
LEFT JOIN authentication_concentrators conc  ON conc.id = ponto.authentication_concentrator_id
LEFT JOIN authentication_sites site          ON site.id = ponto.authentication_site_id
WHERE prim.active IS TRUE
  AND prim.deleted IS FALSE
  AND prim."type" = 2
  AND porta_prim.deleted IS FALSE
  AND sec.active IS TRUE
  AND sec.deleted IS FALSE
  AND sec."type" = 1
  AND porta_sec.deleted IS FALSE
  -- mesmo teste da coluna DAX SPLITTER_CONDOMINIO (CONTAINSSTRING é insensível a
  -- caixa, ILIKE também; o ponto é literal em LIKE, não curinga)
  AND (sec.title ILIKE '%COND.%' OR sec.title ILIKE '%RES.%' OR sec.title ILIKE '%ED.%')
ORDER BY prim.id, porta_prim.port, porta_sec.port
