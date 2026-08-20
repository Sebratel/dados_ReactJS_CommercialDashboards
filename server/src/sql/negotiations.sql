-- Réplica da consulta "negotiations" do Power Query (dsn=dbVoalle).
--
-- Uma negociação é uma etapa de venda do CRM (`crm_consult_selling_steps`), com
-- o motivo do desfecho, a fase do funil, o serviço negociado e o protocolo. O
-- status sai do `type` do motivo: 1 = Ganho, 0 = Perda, qualquer outra coisa
-- (inclusive nulo) = Em Andamento.
--
-- O GROUP BY existe por causa do `MIN`/`MAX` sobre `reports`: uma negociação pode
-- ter vários relatórios técnicos, e o início e o fim dela são o primeiro e o
-- último deles. Todas as outras colunas entram no agrupamento — é o que a
-- consulta de origem faz.
--
-- DIFERENÇA PROPOSITAL: o corte de data é parâmetro ($1) em vez da constante
-- '2026-01-01' escrita na consulta. O padrão continua 2026-01-01 (`CRM_SINCE`).
SELECT
    ccss.id                             AS negociacao_id,
    ccss.person_id                      AS lead_id,
    p.name                              AS nome,
    cc.title                            AS campanha,
    cco.title                           AS origem,
    p2.name                             AS responsavel,
    cor.title                           AS motivo,
    cor.type                            AS tipo_motivo,
    CASE
        WHEN cor.type = 1 THEN 'Ganho'
        WHEN cor.type = 0 THEN 'Perda'
        ELSE 'Em Andamento'
    END                                 AS status_negociacao,
    cfp.title                           AS fase_funil,
    ccss.probability_sale               AS probabilidade_venda,
    ccss.probability_closing_date_sale::date AS data_provavel_fechamento,
    ccss.status                         AS status_negociacao_raw,
    ccss.created                        AS data_criacao_negociacao,
    ccss.modified                       AS data_modificacao_negociacao,
    ccss.date_change_status             AS data_mudanca_status,
    ccss.deleted                        AS deletado,
    r.title                             AS regiao,
    c.contract_number                   AS contrato,
    ct.title                            AS tipo_contrato,
    ccss.title                          AS titulo_negociacao,
    MAX(a.title)                        AS titulo_protocolo,
    ccss.person_team_id                 AS time_id,
    t.title                             AS time_descricao,
    u.name                              AS lead_criado_por,
    cf.title                            AS forma,
    sp.title                            AS servico,
    ccsssp.unit_amount                  AS valor_servico,
    u2.name                             AS protocolo_criado_por,
    ai.protocol                         AS protocolo,
    MIN(rs.created)                     AS data_inicio_negociacao,
    MAX(rs.created)                     AS data_fim_negociacao
FROM crm_consult_selling_steps ccss
LEFT JOIN people p                      ON p.id = ccss.person_id
LEFT JOIN people p2                     ON p2.id = ccss.responsible_id
LEFT JOIN crm_opportunity_reasons cor   ON cor.id = ccss.crm_opportunity_reasons_id
LEFT JOIN crm_funnel_phases cfp         ON cfp.id = ccss.crm_funnel_phase_id
LEFT JOIN regions r                     ON r.id = ccss.region_id
LEFT JOIN contracts c                   ON c.id = ccss.generated_contract_id
LEFT JOIN assignment_incidents ai       ON ai.assignment_id = ccss.protocol
LEFT JOIN crm_forms cf                  ON cf.id = ccss.crm_form_id
LEFT JOIN crm_campaigns cc              ON cc.id = ccss.crm_campaign_id
LEFT JOIN crm_contact_origins cco       ON cco.id = ccss.crm_contact_origin_id
LEFT JOIN crm_consult_selling_step_service_products ccsssp
       ON ccsssp.crm_consult_selling_step_id = ccss.id
LEFT JOIN service_products sp           ON sp.id = ccsssp.service_product_id
LEFT JOIN crm_consult_selling_step_events ccsse
       ON ccsse.crm_consult_selling_step_id = ccss.id
LEFT JOIN assignments a                 ON a.id = ccsse.assignment_id
LEFT JOIN reports rs                    ON rs.assignment_id = a.id
LEFT JOIN teams t                       ON t.id = ccss.person_team_id
LEFT JOIN users u                       ON u.id = ccss.created_by
LEFT JOIN users u2                      ON u2.id = a.created_by
LEFT JOIN contract_types ct             ON ct.id = c.contract_type_id
WHERE ccss.created >= $1
GROUP BY
    ccss.id, ccss.person_id, p.name, cc.title, cco.title, p2.name, cor.title,
    cor.type, cfp.title, ccss.probability_sale, ccss.probability_closing_date_sale,
    ccss.status, ccss.created, ccss.modified, ccss.date_change_status, ccss.deleted,
    r.title, c.contract_number, ct.title, ccss.title, ccss.person_team_id, t.title,
    ccss.created_by, u.name, cf.title, sp.title, ccsssp.unit_amount, u2.name,
    ai.protocol
