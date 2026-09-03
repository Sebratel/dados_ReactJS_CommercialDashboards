-- ============================================================================
-- COM · Gestão Comercial — ATIVAÇÕES POR VENDEDOR E DATA      (dialeto DuckDB)
-- ============================================================================
--
-- Uma linha por CONTRATO ATIVADO, com o vendedor, a data de ativação e a data
-- de criação do contrato (as duas, para medir o tempo entre vender e instalar).
--
-- A data de ativação NÃO é uma coluna só — depende da tecnologia, como no
-- Power Query de origem:
--     TELEFONIA        -> MAX(reports.final_date)      (o laudo do atendimento)
--     FIBRA e RÁDIO    -> saída do equipamento, e NULL quando ele voltou no
--                         mesmo dia, porque aí a instalação não se concretizou
--
-- Contrato vendido e ainda não instalado tem `data_ativacao` nula e fica de
-- fora por causa do filtro do final. Tire o WHERE para ver a fila em aberto.
--
-- BÔNUS: as colunas `peso_dia_util` e `feriado` deixam reproduzir a média por
-- dia útil exatamente como o dashboard passou a calcular em 02/09/2026:
--
--     SELECT vendedor,
--            count(*)                                   AS ativacoes,
--            sum(peso_dia_util)                         AS dias_uteis,
--            count(*) / nullif(sum(peso_dia_util), 0)   AS media_por_dia_util
--     FROM (…esta query…)
--     GROUP BY vendedor ORDER BY ativacoes DESC;
--
--   Repare que `dias_uteis` soma o peso de cada LINHA, não de cada dia. Para a
--   média correta, agrupe por dia antes:
--     WITH por_dia AS (
--       SELECT vendedor, data_ativacao, count(*) AS qtd, any_value(peso_dia_util) AS peso
--       FROM (…esta query…) GROUP BY vendedor, data_ativacao)
--     SELECT vendedor, sum(qtd) AS ativacoes, sum(peso) AS dias_uteis,
--            sum(qtd) / nullif(sum(peso), 0) AS media_por_dia_util
--     FROM por_dia GROUP BY vendedor ORDER BY ativacoes DESC;
-- ============================================================================

INSTALL postgres; LOAD postgres;
INSTALL mysql;    LOAD mysql;

ATTACH 'dbname=<DB_VOALLE_DATABASE> host=<DB_VOALLE_HOST> port=5432 user=<DB_VOALLE_USER> password=<DB_VOALLE_PASSWORD>'
  AS voalle (TYPE postgres, READ_ONLY);
ATTACH 'host=<DB_MARIA_HOST> port=3306 user=<DB_MARIA_USER> password=<DB_MARIA_PASSWORD> database=DB_Applicattion'
  AS maria (TYPE mysql, READ_ONLY);

WITH params AS (
    SELECT
        DATE '2026-08-01' AS de,
        DATE '2026-08-31' AS ate,
        DATE '2025-01-01' AS since
),

-- Feriados nacionais — a mesma tabela de src/model/holidays.js. O modelo do
-- Power BI parava em 2025; 2026 e 2027 entraram para as médias por dia útil
-- continuarem corretas.
feriados(dia, nome) AS (
    VALUES
    (DATE '2024-01-01','Confraternização Universal'), (DATE '2024-02-13','Carnaval'),
    (DATE '2024-03-29','Sexta-feira Santa'),          (DATE '2024-04-21','Tiradentes'),
    (DATE '2024-05-01','Dia do Trabalho'),            (DATE '2024-05-30','Corpus Christi'),
    (DATE '2024-09-07','Independência do Brasil'),    (DATE '2024-10-12','Nossa Senhora Aparecida'),
    (DATE '2024-11-02','Finados'),                    (DATE '2024-11-15','Proclamação da República'),
    (DATE '2024-12-25','Natal'),
    (DATE '2025-01-01','Confraternização Universal'), (DATE '2025-03-04','Carnaval'),
    (DATE '2025-04-18','Sexta-feira Santa'),          (DATE '2025-04-21','Tiradentes'),
    (DATE '2025-05-01','Dia do Trabalho'),            (DATE '2025-06-19','Corpus Christi'),
    (DATE '2025-09-07','Independência do Brasil'),    (DATE '2025-10-12','Nossa Senhora Aparecida'),
    (DATE '2025-11-02','Finados'),                    (DATE '2025-11-15','Proclamação da República'),
    (DATE '2025-12-25','Natal'),
    (DATE '2026-01-01','Confraternização Universal'), (DATE '2026-02-17','Carnaval'),
    (DATE '2026-04-03','Sexta-feira Santa'),          (DATE '2026-04-21','Tiradentes'),
    (DATE '2026-05-01','Dia do Trabalho'),            (DATE '2026-06-04','Corpus Christi'),
    (DATE '2026-09-07','Independência do Brasil'),    (DATE '2026-10-12','Nossa Senhora Aparecida'),
    (DATE '2026-11-02','Finados'),                    (DATE '2026-11-15','Proclamação da República'),
    (DATE '2026-12-25','Natal'),
    (DATE '2027-01-01','Confraternização Universal'), (DATE '2027-02-09','Carnaval'),
    (DATE '2027-03-26','Sexta-feira Santa'),          (DATE '2027-04-21','Tiradentes'),
    (DATE '2027-05-01','Dia do Trabalho'),            (DATE '2027-05-27','Corpus Christi'),
    (DATE '2027-09-07','Independência do Brasil'),    (DATE '2027-10-12','Nossa Senhora Aparecida'),
    (DATE '2027-11-02','Finados'),                    (DATE '2027-11-15','Proclamação da República'),
    (DATE '2027-12-25','Natal')
),

-- ------------------------------------------- o contrato e quem o vendeu
contratos AS (
    SELECT
        c.contract_number       AS contrato,
        ai.protocol             AS protocolo,
        c.created::DATE         AS data_criacao_contrato,
        p.name                  AS cliente,
        p.city                  AS cidade,
        p.neighborhood          AS bairro,
        upper(trim(p2.name))    AS vendedor,
        rc.city                 AS regiao_vendedor,
        c.amount::DOUBLE        AS valor,
        c.v_status              AS status_contrato,
        isc.title               AS canal,
        CASE
            WHEN it.id IN ('12','1014','1254','1255','1136') THEN 'FIBRA'
            WHEN it.id IN ('249','1015')                     THEN 'RÁDIO'
            ELSE 'TELEFONIA'
        END                     AS tecnologia
    FROM voalle.erp.assignments a
    LEFT JOIN voalle.erp.assignment_incidents ai     ON a.id   = ai.assignment_id
    LEFT JOIN voalle.erp.contract_service_tags cst   ON cst.id = ai.contract_service_tag_id
    LEFT JOIN voalle.erp.contracts c                 ON c.id   = cst.contract_id
    LEFT JOIN voalle.erp.incident_types it           ON it.id  = ai.incident_type_id
    LEFT JOIN voalle.erp.people p                    ON p.id   = ai.client_id
    LEFT JOIN voalle.erp.people p2                   ON p2.id  = c.seller_1_id
    LEFT JOIN voalle.erp.people_crm_informations pci ON pci.person_id = p2.id
    LEFT JOIN voalle.erp.industry_sectors isc        ON isc.id = pci.industry_sector_id
    LEFT JOIN voalle.erp.region_cities rc            ON rc.region_id = p2.region_id
    WHERE it.id IN ('12','1254','1255','1014','1136','249','275','1011','1015')
      AND c.created > (SELECT since FROM params)
    QUALIFY row_number() OVER (PARTITION BY c.contract_number ORDER BY a.created ASC) = 1
),

-- ------------------------------------- ativação de FIBRA e RÁDIO (equipamento)
ativacao_fibra AS (
    SELECT contrato, cliente, min(data_ativacao)::DATE AS data_ativacao
    FROM (
        SELECT
            c.contract_number AS contrato,
            p4.name           AS cliente,
            -- equipamento devolvido na mesma data da saída = instalação não concretizada
            CASE WHEN plis.returned_date IS NOT NULL
                  AND plis.returned_date = (CASE WHEN it.id IN ('12','1254','1255','1014','1136','249','1015')
                                                 THEN plis.out_date ELSE a.conclusion_date END)
                 THEN NULL
                 ELSE (CASE WHEN it.id IN ('12','1254','1255','1014','1136','249','1015')
                            THEN plis.out_date ELSE a.conclusion_date END)
            END AS data_ativacao
        FROM voalle.erp.patrimony_packing_list_items plis
        LEFT JOIN voalle.erp.patrimony_packing_lists ppl ON ppl.id = plis.patrimony_packing_list_id
        LEFT JOIN voalle.erp.assignments a               ON a.id   = ppl.assignment_id
        LEFT JOIN voalle.erp.assignment_incidents ai     ON ai.assignment_id = a.id
        LEFT JOIN voalle.erp.incident_types it           ON it.id  = ai.incident_type_id
        LEFT JOIN voalle.erp.people p4                   ON p4.id  = ppl.responsible_id
        LEFT JOIN voalle.erp.contract_service_tags cst   ON cst.id = ppl.contract_service_tag_id
        LEFT JOIN voalle.erp.contracts c                 ON c.id   = cst.contract_id
        WHERE it.id IN ('12','1254','1255','1014','1136','249','275','1011','1015')
          AND plis.out_date > (SELECT since FROM params)
    ) t
    WHERE contrato IS NOT NULL
    GROUP BY contrato, cliente
),

-- ------------------------------------------------ ativação de TELEFONIA (laudo)
ativacao_telefonia AS (
    SELECT
        ai.protocol             AS protocolo,
        c.contract_number       AS contrato,
        max(r.final_date)::DATE AS data_ativacao
    FROM voalle.erp.assignments a
    LEFT JOIN voalle.erp.reports r                 ON r.assignment_id = a.id
    LEFT JOIN voalle.erp.assignment_incidents ai   ON a.id   = ai.assignment_id
    LEFT JOIN voalle.erp.contract_service_tags cst ON cst.id = ai.contract_service_tag_id
    LEFT JOIN voalle.erp.contracts c               ON c.id   = cst.contract_id
    LEFT JOIN voalle.erp.incident_types it         ON it.id  = ai.incident_type_id
    LEFT JOIN voalle.erp.teams t                   ON t.id   = r.team_id
    WHERE it.id IN ('275','1011')
      AND c.created > (SELECT since FROM params)
      -- réplica literal do BI: com LEFT JOIN, atendimento sem time dá NULL e fica
      -- de fora. Trocar por `t.title IS NULL OR …` parece conserto, mas muda a medida.
      AND t.title <> 'Financeiro'
    GROUP BY ai.protocol, c.contract_number
),

-- ----------------------------------------- equipe e situação do vendedor
equipes AS (
    SELECT
        upper(trim(t.VENDEDORES))       AS vendedor,
        t.EQUIPES                       AS equipe,
        coalesce(t.SITUAÇÃO, 'Externo') AS situacao,
        t.ATIVO                         AS ativo
    FROM maria.DB_Applicattion.Comercial_Teams t
),

-- a data de ativação depende da tecnologia — o mesmo merge que o store.js faz
ativado AS (
    SELECT
        c.*,
        CASE WHEN c.tecnologia = 'TELEFONIA' THEN atel.data_ativacao
             ELSE afib.data_ativacao END AS data_ativacao
    FROM contratos c
    LEFT JOIN ativacao_fibra afib
           ON afib.contrato = c.contrato AND afib.cliente = c.cliente
    LEFT JOIN ativacao_telefonia atel
           ON atel.contrato = c.contrato AND atel.protocolo = c.protocolo
)

-- ============================== RESULTADO ==================================
SELECT
    c.vendedor,
    e.equipe,
    e.situacao,
    e.ativo                                     AS vendedor_ativo,

    -- a ativação
    c.data_ativacao,
    date_part('isodow', c.data_ativacao)     AS dia_semana,   -- 1=seg … 7=dom
    CASE
        WHEN f.dia IS NOT NULL                          THEN 0.0   -- feriado
        WHEN date_part('isodow', c.data_ativacao) = 7 THEN 0.0   -- domingo
        WHEN date_part('isodow', c.data_ativacao) = 6 THEN 0.5   -- sábado
        ELSE 1.0
    END                                         AS peso_dia_util,
    f.nome                                      AS feriado,

    -- o contrato de origem
    c.data_criacao_contrato,
    date_diff('day', c.data_criacao_contrato, c.data_ativacao) AS dias_ate_ativar,
    c.contrato,
    c.protocolo,
    c.cliente,
    c.cidade,
    c.bairro,
    c.regiao_vendedor,
    c.tecnologia,
    c.canal,
    c.valor,
    c.status_contrato

FROM ativado c
LEFT JOIN equipes e  ON e.vendedor = c.vendedor
LEFT JOIN feriados f ON f.dia = c.data_ativacao

-- tire este WHERE para enxergar também o que foi vendido e ainda não instalou
WHERE c.data_ativacao BETWEEN (SELECT de FROM params) AND (SELECT ate FROM params)
ORDER BY c.vendedor, c.data_ativacao, c.contrato;
