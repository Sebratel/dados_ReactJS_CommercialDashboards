WITH hist_rank AS (
    SELECT
        h.tsk_id,
        hv.acf_id,
        NULLIF(TRIM(hv.htv_externalvalue), '') AS valor,
        ROW_NUMBER() OVER (PARTITION BY h.tsk_id, hv.acf_id ORDER BY h.hty_id DESC) AS rn
    FROM umovme_history_temp_investigacao_sla_bko h
    JOIN umovme_historyvalue_temp_investigacao_sla_bko hv ON hv.hty_id = h.hty_id
    WHERE hv.acf_id IN (18757003, 17480167, 17480330, 17489262)
      AND NULLIF(TRIM(hv.htv_externalvalue), '') IS NOT NULL
),
hist AS (
    SELECT
        tsk_id,
        MAX(CASE WHEN acf_id = 18757003 THEN valor END) AS nome_cliente,
        MAX(CASE WHEN acf_id = 17480167 THEN valor END) AS tipo_pessoa,
        MAX(CASE WHEN acf_id = 17480330 THEN valor END) AS cpf_cnpj,
        MAX(CASE WHEN acf_id = 17489262 THEN valor END) AS telefone
    FROM hist_rank
    WHERE rn = 1
    GROUP BY tsk_id
),
-- Envios da tarefa a partir do history (primeiro, último e quantidade).
-- SEM ajuste de fuso: desde a recarga geral do Misael (29/09/2026) a conexão com o
-- uMov já entrega as datas no horário de Brasília — inclusive o histórico.
envios AS (
    SELECT
        tsk_id,
        MIN(TRY_CAST(hty_finaldatehour AS TIMESTAMP)) AS primeiro_envio,
        MAX(TRY_CAST(hty_finaldatehour AS TIMESTAMP)) AS ultimo_envio,
        COUNT(TRY_CAST(hty_finaldatehour AS TIMESTAMP))                 AS qtd_envios
    FROM umovme_history_temp_investigacao_sla_bko
    WHERE hty_finaldatehour IS NOT NULL
    GROUP BY tsk_id
),
campos AS (
    SELECT
        cfv_registerid AS tsk_id,
        MAX(CASE WHEN cfd_id = 1435984 THEN cfv_internalvalue END) AS aprovado_por_user_id,
        MAX(CASE WHEN cfd_id = 1435985 THEN cfv_internalvalue END) AS aprovado_em,
        MAX(CASE WHEN cfd_id = 1435986 THEN cfv_internalvalue END) AS motivo_reprovacao,
        MAX(CASE WHEN cfd_id = 1631844 THEN cfv_internalvalue END) AS json_legado
    FROM umovme_customfieldvalue_temp_investigacao_sla_bko
    WHERE cfd_id IN (1435984, 1435985, 1435986, 1631844)
    GROUP BY cfv_registerid
),
bruto AS (
    SELECT
        t.tsk_id,
        t.tsk_realfinaldatehour AS data_hora,
        a.age_name              AS vendedor,
        COALESCE(hi.nome_cliente, CASE WHEN json_valid(c.json_legado) THEN NULLIF(TRIM(json_extract_string(c.json_legado, '$.personalData.name')), '') END)     AS nome_cliente,
        COALESCE(hi.tipo_pessoa,  CASE WHEN json_valid(c.json_legado) THEN NULLIF(TRIM(json_extract_string(c.json_legado, '$.personalData.typeTxId')), '') END) AS tipo_pessoa_bruto,
        COALESCE(hi.cpf_cnpj,     CASE WHEN json_valid(c.json_legado) THEN NULLIF(TRIM(json_extract_string(c.json_legado, '$.personalData.txId')), '') END)     AS cpf_cnpj,
        COALESCE(hi.telefone,     CASE WHEN json_valid(c.json_legado) THEN NULLIF(TRIM(json_extract_string(c.json_legado, '$.contact.cellPhone')), '') END)     AS telefone,
        c.aprovado_por_user_id,
        an.age_name             AS analista,
        c.aprovado_em,
        c.motivo_reprovacao,
        e.primeiro_envio,
        e.ultimo_envio,
        e.qtd_envios
    FROM umovme_task_temp_investigacao_sla_bko t
    LEFT JOIN umovme_agent_temp_investigacao_sla_bko a ON a.age_id = t.age_id_insert
    LEFT JOIN hist    hi ON hi.tsk_id = t.tsk_id
    LEFT JOIN campos  c  ON c.tsk_id  = t.tsk_id
    LEFT JOIN envios  e  ON e.tsk_id  = t.tsk_id
    LEFT JOIN umovme_agent_temp_investigacao_sla_bko an
           ON CAST(an.age_id AS BIGINT) = TRY_CAST(c.aprovado_por_user_id AS BIGINT)
)
SELECT
    tsk_id AS id_tarefa,
    data_hora,
    vendedor,
    nome_cliente,
    CASE
        WHEN tipo_pessoa_bruto IN ('Pessoa Física',   'F', 'CPF', '2') THEN 'Pessoa Física'
        WHEN tipo_pessoa_bruto IN ('Pessoa Jurídica', 'J', 'CNPJ', '1') THEN 'Pessoa Jurídica'
        ELSE tipo_pessoa_bruto
    END AS tipo_pessoa,
    cpf_cnpj,
    telefone,
    aprovado_por_user_id,
    analista,
    aprovado_em,
    motivo_reprovacao,
    primeiro_envio,   -- horário de Brasília
    ultimo_envio,     -- horário de Brasília
    qtd_envios
FROM bruto
ORDER BY data_hora DESC
