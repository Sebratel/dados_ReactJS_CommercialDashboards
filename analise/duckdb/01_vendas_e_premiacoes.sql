-- ============================================================================
-- COM · Gestão Comercial — VENDAS POR VENDEDOR + PREMIAÇÃO   (dialeto DuckDB)
-- ============================================================================
--
-- Uma linha por CONTRATO VENDIDO, com o vendedor, a data de criação do contrato
-- e a premiação daquele vendedor no período.
--
-- ATENÇÃO AO GRÃO: a premiação é atributo do VENDEDOR no período, não da venda.
-- Ela se repete em cada linha de venda da mesma pessoa. Para ler a premiação
-- sozinha, agrupe:
--     SELECT DISTINCT vendedor, grupo_premiacao, qtd_premiavel, faixa,
--            valor_faixa, valor_tempo_de_casa, valor_final
--     FROM (…esta query…) ORDER BY valor_final DESC;
--
-- ---------------------------------------------------------------------------
-- COMO A PREMIAÇÃO FUNCIONA (replicado de server/src/model/measures.js)
--
-- Cada vendedor cai em UM dos dois grupos, pela data de admissão:
--   • ativos   — ainda nos primeiros ~60 dias. Premiado pelas ATIVAÇÕES.
--   • pagantes — já virou. Premiado pelos PRIMEIROS PAGAMENTOS.
-- A virada é `mes_virada` = 1º dia do mês seguinte ao 60º dia de casa. Se ela
-- for depois do fim do mês de referência, a pessoa ainda é "ativos".
--
-- A faixa sai da QUANTIDADE do grupo, cruzada com Interno/Externo. O bônus de
-- tempo de casa só existe para Externo da faixa 4 para cima.
--
-- Só entra quem está em Comercial_Teams com ATIVO = 1 e tem admissão no RH
-- (Senior). Premiação é dinheiro a pagar: desligado não concorre.
-- ---------------------------------------------------------------------------
--
-- DIFERENÇA CONHECIDA em relação ao dashboard: o casamento Voalle × RH aqui usa
-- e-mail, nome exato e nome sem acento. O `store.js` tem ainda um quarto passo
-- difuso (75% dos tokens do nome, distância de 1 letra) que não cabe em SQL —
-- alguns poucos vendedores com grafia muito diferente entre as bases podem sair
-- sem admissão e, portanto, sem premiação. A coluna `via_juncao` denuncia quem
-- casou por qual caminho, e `admissao_senior IS NULL` mostra quem não casou.
-- ============================================================================

INSTALL postgres; LOAD postgres;
INSTALL mysql;    LOAD mysql;

-- Credenciais: as mesmas de dashboard/.env. NÃO versione este arquivo preenchido.
ATTACH 'dbname=<DB_VOALLE_DATABASE> host=<DB_VOALLE_HOST> port=5432 user=<DB_VOALLE_USER> password=<DB_VOALLE_PASSWORD>'
  AS voalle (TYPE postgres, READ_ONLY);
ATTACH 'host=<DB_MARIA_HOST> port=3306 user=<DB_MARIA_USER> password=<DB_MARIA_PASSWORD> database=DB_Applicattion'
  AS maria (TYPE mysql, READ_ONLY);

-- As tabelas do Voalle vivem no schema `erp` (o pagto.sql do dashboard o cita
-- explicitamente; as demais consultas dependem do search_path). Se no seu
-- ambiente for outro, troque `voalle.erp.` por `voalle.<schema>.` abaixo.

WITH params AS (
    SELECT
        DATE '2026-08-01' AS de,     -- início do período analisado
        DATE '2026-08-31' AS ate,    -- fim, e também a DATA DE REFERÊNCIA da premiação
        DATE '2025-01-01' AS since,  -- recorte de carga (a "Janela de dados")
        -- 'TELEFONIA' aplica a regra por aparelho (4,5 interno / 7,5 externo).
        -- NULL usa a tabela de faixas normal. É o equivalente a ter uma única
        -- tecnologia selecionada no filtro da tela.
        CAST(NULL AS VARCHAR) AS tecnologia_premiacao
),

-- ---------------------------------------------------------------- 1) VENDAS
-- Réplica de src/sql/base.sql: 1 linha por contrato (o primeiro atendimento).
vendas AS (
    SELECT
        c.contract_number                    AS contrato,
        ai.protocol                          AS protocolo,
        c.created::DATE                      AS data_criacao_contrato,
        p.name                               AS cliente,
        p.city                               AS cidade,
        p.neighborhood                       AS bairro,
        upper(trim(p2.name))                 AS vendedor,
        rc.city                              AS regiao_vendedor,
        c.v_status                           AS status_contrato,
        c.cancellation_motive                AS status_cancelamento,
        c.cancellation_date::DATE            AS data_cancelado,
        c.amount::DOUBLE                     AS valor,
        isc.title                            AS canal,
        CASE
            WHEN it.id IN ('12','1014','1254','1255','1136') THEN 'FIBRA'
            WHEN it.id IN ('249','1015')                     THEN 'RÁDIO'
            ELSE 'TELEFONIA'
        END                                  AS tecnologia
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
    -- o "ORDENADO = 1" do Power Query: fica o atendimento mais antigo do contrato
    QUALIFY row_number() OVER (PARTITION BY c.contract_number ORDER BY a.created ASC) = 1
),

-- ------------------------------------------------- 2) QUEM É VENDEDOR (RH)
-- Réplica de src/sql/sellers.sql + a junção com o Senior feita no store.js.
usuarios AS (
    SELECT
        upper(trim(u.name))         AS vendedor,
        lower(trim(u.email))        AS email,
        u.created::DATE             AS data_inicio
    FROM voalle.erp.users u
    WHERE u.name IS NOT NULL
    -- mesmo vendedor pode ter mais de um usuário: fica o mais antigo
    QUALIFY row_number() OVER (PARTITION BY upper(trim(u.name)) ORDER BY u.created ASC) = 1
),
rh AS (
    SELECT
        upper(trim(s.name))                  AS nome_senior,
        lower(trim(s.email))                 AS email,
        upper(strip_accents(trim(s.name)))   AS nome_sem_acento,
        s.admission_date::DATE               AS admissao_senior,
        s.position                           AS cargo
    FROM maria.API_WebDeveloper.db_senior_collaborators s
    WHERE s.termination_date IS NULL
      AND s.name IS NOT NULL
    -- mesmo colaborador pode ter mais de um registro: fica a admissão mais antiga
    QUALIFY row_number() OVER (PARTITION BY upper(trim(s.name)) ORDER BY s.admission_date ASC) = 1
),
equipes AS (
    SELECT
        upper(trim(t.VENDEDORES)) AS vendedor,
        t.EQUIPES                 AS equipe,
        t.SITUAÇÃO                AS situacao,
        t.ATIVO                   AS ativo
    FROM maria.DB_Applicattion.Comercial_Teams t
),
-- três vias de casamento, na mesma ordem de precedência do store.js
vendedores AS (
    SELECT
        u.vendedor,
        u.data_inicio,
        e.equipe,
        coalesce(e.situacao, 'Externo')                      AS situacao,
        coalesce(r_mail.admissao_senior,
                 r_nome.admissao_senior,
                 r_sem.admissao_senior)                      AS admissao_senior,
        CASE
            WHEN r_mail.admissao_senior IS NOT NULL THEN 'email'
            WHEN r_nome.admissao_senior IS NOT NULL THEN 'nome'
            WHEN r_sem.admissao_senior  IS NOT NULL THEN 'nome_sem_acento'
        END                                                  AS via_juncao,
        coalesce(r_mail.cargo, r_nome.cargo, r_sem.cargo)    AS cargo
    FROM usuarios u
    JOIN equipes e            ON e.vendedor = u.vendedor
    LEFT JOIN rh r_mail       ON r_mail.email = u.email AND u.email <> ''
    LEFT JOIN rh r_nome       ON r_nome.nome_senior = u.vendedor
    LEFT JOIN rh r_sem        ON r_sem.nome_sem_acento = upper(strip_accents(u.vendedor))
    -- o modelo de origem mantém só quem existe no RH
    WHERE coalesce(r_mail.admissao_senior, r_nome.admissao_senior, r_sem.admissao_senior) IS NOT NULL
      -- premiação é dinheiro a pagar: só quem está ATIVO na Comercial_Teams
      AND e.ativo = 1
),
-- as datas derivadas que decidem o grupo de premiação
vendedor_datas AS (
    SELECT
        v.*,
        v.admissao_senior                                            AS admissao_real,
        v.admissao_senior + INTERVAL 60 DAY                          AS data_60,
        v.admissao_senior + INTERVAL 90 DAY                          AS data_apos_90,
        -- MesViradaPagante: 1º dia do mês seguinte ao 60º dia de casa
        (date_trunc('month', v.admissao_senior + INTERVAL 60 DAY)
            + INTERVAL 1 MONTH)::DATE                                AS mes_virada
    FROM vendedores v
),
vendedor_grupo AS (
    SELECT
        vd.*,
        CASE WHEN vd.mes_virada > last_day((SELECT ate FROM params))
             THEN 'ativos' ELSE 'pagantes' END                       AS grupo_premiacao,
        date_diff('day', vd.admissao_real, (SELECT ate FROM params)) AS dias_de_casa
    FROM vendedor_datas vd
),

-- --------------------------------- 3) O QUE CONTA PARA A PREMIAÇÃO
-- Grupo "pagantes": primeiros pagamentos do período. Réplica de src/sql/pagto.sql.
primeiro_pagamento AS (
    SELECT DISTINCT ON (p.name, co.contract_number)
        p.name                        AS cliente,
        co.contract_number            AS contrato,
        x.client_paid_date::DATE      AS data_pagamento
    FROM voalle.erp.financial_receipt_titles x
    JOIN voalle.erp.financial_receivable_titles fr ON x.financial_receivable_title_id = fr.id
    JOIN voalle.erp.contracts co                   ON co.id = fr.contract_id
    LEFT JOIN voalle.erp.people p                  ON p.id  = x.client_id
    LEFT JOIN voalle.erp.bank_accounts b           ON x.bank_account_id = b.id
    WHERE co.contract_number IS NOT NULL
      AND co.created > (SELECT since FROM params)
      AND (b.description IS NULL OR b.description <> 'Conta Transitória (Baixa/Perda) - YES')
    ORDER BY p.name, co.contract_number, x.client_paid_date ASC NULLS LAST
),
-- Grupo "ativos": ativações do período (fibra/rádio pelo equipamento, telefonia
-- pelo laudo). Réplica de src/sql/aloc.sql + src/sql/phone.sql.
ativacao_fibra AS (
    SELECT contrato, cliente, min(data_ativacao)::DATE AS data_ativacao
    FROM (
        SELECT
            c.contract_number AS contrato,
            p4.name           AS cliente,
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
ativacao_telefonia AS (
    SELECT
        ai.protocol       AS protocolo,
        c.contract_number AS contrato,
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
      AND t.title <> 'Financeiro'   -- réplica literal do BI: NULL não passa, e é proposital
    GROUP BY ai.protocol, c.contract_number
),
-- a venda carrega a sua data de ativação, como o merge do store.js
venda_com_datas AS (
    SELECT
        v.*,
        CASE WHEN v.tecnologia = 'TELEFONIA' THEN atel.data_ativacao
             ELSE afib.data_ativacao END AS data_ativacao,
        pp.data_pagamento
    FROM vendas v
    LEFT JOIN ativacao_fibra afib
           ON afib.contrato = v.contrato AND afib.cliente = v.cliente
    LEFT JOIN ativacao_telefonia atel
           ON atel.contrato = v.contrato AND atel.protocolo = v.protocolo
    LEFT JOIN primeiro_pagamento pp
           ON pp.contrato = v.contrato AND pp.cliente = v.cliente
),

-- ------------------------------ 4) A QUANTIDADE QUE DEFINE A FAIXA
contagem AS (
    SELECT
        vg.vendedor,
        vg.grupo_premiacao,
        CASE vg.grupo_premiacao
            WHEN 'pagantes' THEN count(*) FILTER (
                     WHERE vcd.data_pagamento BETWEEN (SELECT de FROM params) AND (SELECT ate FROM params))
            ELSE                 count(*) FILTER (
                     WHERE vcd.data_ativacao  BETWEEN (SELECT de FROM params) AND (SELECT ate FROM params))
        END AS qtd_premiavel
    FROM vendedor_grupo vg
    LEFT JOIN venda_com_datas vcd ON vcd.vendedor = vg.vendedor
    GROUP BY vg.vendedor, vg.grupo_premiacao
),

-- ------------------------------------------------- 5) FAIXA, BÔNUS E VALOR
-- Em três etapas, para o CASE das faixas não virar um monolito ilegível.
premio_base AS (
    SELECT
        vg.*,
        coalesce(c.qtd_premiavel, 0)        AS qtd_premiavel,
        lower(vg.situacao) = 'interno'      AS eh_interno,
        upper(coalesce((SELECT tecnologia_premiacao FROM params), '')) = 'TELEFONIA' AS por_aparelho
    FROM vendedor_grupo vg
    LEFT JOIN contagem c ON c.vendedor = vg.vendedor
),
premio_faixa AS (
    SELECT
        b.*,
        CASE
            WHEN b.por_aparelho THEN NULL
            WHEN b.eh_interno THEN
                CASE WHEN b.qtd_premiavel > 260 THEN 8
                     WHEN b.qtd_premiavel > 230 THEN 7
                     WHEN b.qtd_premiavel > 210 THEN 6
                     WHEN b.qtd_premiavel > 190 THEN 5
                     WHEN b.qtd_premiavel > 160 THEN 4
                     WHEN b.qtd_premiavel > 130 THEN 3
                     WHEN b.qtd_premiavel > 100 THEN 2
                     ELSE 1 END
            ELSE
                CASE WHEN b.qtd_premiavel > 60 THEN 13
                     WHEN b.qtd_premiavel > 55 THEN 12
                     WHEN b.qtd_premiavel > 50 THEN 11
                     WHEN b.qtd_premiavel > 45 THEN 10
                     WHEN b.qtd_premiavel > 40 THEN 9
                     WHEN b.qtd_premiavel > 35 THEN 8
                     WHEN b.qtd_premiavel > 30 THEN 7
                     WHEN b.qtd_premiavel > 25 THEN 6
                     WHEN b.qtd_premiavel > 20 THEN 5
                     WHEN b.qtd_premiavel > 15 THEN 4
                     WHEN b.qtd_premiavel > 12 THEN 3
                     WHEN b.qtd_premiavel > 10 THEN 2
                     ELSE 1 END
        END AS faixa_numero,
        CASE
            -- TELEFONIA: por aparelho, e o primeiro não paga
            WHEN b.por_aparelho THEN
                CASE WHEN b.qtd_premiavel <= 1 THEN 0
                     ELSE (CASE WHEN b.eh_interno THEN 4.5 ELSE 7.5 END) * b.qtd_premiavel END
            WHEN b.eh_interno THEN
                CASE WHEN b.qtd_premiavel > 260 THEN 3393
                     WHEN b.qtd_premiavel > 230 THEN 3120
                     WHEN b.qtd_premiavel > 210 THEN 2530
                     WHEN b.qtd_premiavel > 190 THEN 2100
                     WHEN b.qtd_premiavel > 160 THEN 1520
                     WHEN b.qtd_premiavel > 130 THEN 1120
                     WHEN b.qtd_premiavel > 100 THEN 780
                     ELSE 0 END
            ELSE
                CASE WHEN b.qtd_premiavel > 60 THEN 2745
                     WHEN b.qtd_premiavel > 55 THEN 2520
                     WHEN b.qtd_premiavel > 50 THEN 2295
                     WHEN b.qtd_premiavel > 45 THEN 2070
                     WHEN b.qtd_premiavel > 40 THEN 1845
                     WHEN b.qtd_premiavel > 35 THEN 1620
                     WHEN b.qtd_premiavel > 30 THEN 1395
                     WHEN b.qtd_premiavel > 25 THEN 1200
                     WHEN b.qtd_premiavel > 20 THEN 1000
                     WHEN b.qtd_premiavel > 15 THEN 600
                     WHEN b.qtd_premiavel > 12 THEN 300
                     WHEN b.qtd_premiavel > 10 THEN 150
                     ELSE 0 END
        END::DOUBLE AS valor_faixa
    FROM premio_base b
),
premiacao AS (
    SELECT
        f.*,
        -- rótulo no formato da tela: "Faixa Externo 7"
        CASE WHEN f.por_aparelho
             THEN 'Faixa Telefonia ' || (CASE WHEN f.eh_interno THEN 'Interno' ELSE 'Externo' END)
             ELSE 'Faixa ' || (CASE WHEN f.eh_interno THEN 'Interno' ELSE 'Externo' END)
                  || ' ' || CAST(f.faixa_numero AS VARCHAR)
        END AS faixa,
        -- bônus de tempo de casa: só Externo, da faixa 4 para cima
        CASE
            WHEN f.eh_interno OR f.faixa_numero IS NULL OR f.faixa_numero < 4 THEN 0
            WHEN trunc(f.dias_de_casa / 30.0) >= 37 THEN 300
            WHEN trunc(f.dias_de_casa / 30.0) >= 25 THEN 200
            WHEN trunc(f.dias_de_casa / 30.0) >= 13 THEN 100
            ELSE 0
        END::DOUBLE AS valor_tempo_de_casa
    FROM premio_faixa f
)

-- ============================== RESULTADO ==================================
SELECT
    -- vendedor
    v.vendedor,
    p.equipe,
    p.situacao,
    p.cargo,
    p.admissao_real,
    p.dias_de_casa,

    -- a venda
    v.data_criacao_contrato,
    v.contrato,
    v.cliente,
    v.cidade,
    v.bairro,
    v.tecnologia,
    v.canal,
    v.valor,
    v.status_contrato,
    v.status_cancelamento,
    v.data_cancelado,
    v.data_ativacao,
    v.data_pagamento,

    -- premiação do vendedor no período (REPETE em cada linha de venda dele)
    p.grupo_premiacao,
    p.qtd_premiavel,
    p.faixa,
    p.valor_faixa,
    p.valor_tempo_de_casa,
    p.valor_faixa + p.valor_tempo_de_casa                           AS valor_final,
    p.mes_virada,
    p.via_juncao

FROM venda_com_datas v
JOIN premiacao p ON p.vendedor = v.vendedor
WHERE v.data_criacao_contrato BETWEEN (SELECT de FROM params) AND (SELECT ate FROM params)
ORDER BY v.vendedor, v.data_criacao_contrato, v.contrato;
