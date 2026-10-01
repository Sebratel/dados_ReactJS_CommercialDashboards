-- Réplica da consulta "SLA_BKO_Base" (dsn=dbVoalle) do Power BI de SLA do BKO,
-- na versão de 24/09/2026 (ver claude/sla_bko_consolidado_2026-09-24.md no projeto).
--
-- UMA LINHA POR CONTRATO, com os marcos que o Elleven registra:
--   criado_em       c.created — B1 na venda interna, A2 na externa. No Power BI a
--                   coluna se chama DATA_VALIDACAO_BKO, mas não é ação do BKO: é a
--                   criação do contrato.
--   contato_em      1º relato do atendimento, QUALQUER texto — é o 1º contato (A3/B2).
--                   Regra autorizada pela área em 25/09/2026: os relatos variam demais
--                   (validação telefônica, aceite digital, "Falta de Contato 1"…) para
--                   haver padrão de texto; vale o horário do primeiro relato.
--   agendamento_em  1º relato de agendamento (A4/B3)
--   cancelado_em    data de cancelamento do contrato
--
-- AS REGRAS DE TEXTO SÃO AS DA ORIGEM, sem retoque. O filtro de agendamento usa a
-- raiz "agendad" (pega agendado e agendada) e não olha título, porque só em um dia
-- apareceram três títulos diferentes. Risco conhecido e ainda não medido:
-- negação ("não foi possível agendamento para hoje") casa com o padrão.
--
-- Datas saem como TEXTO local (to_char): o motor de horas úteis trabalha em horário
-- de parede, e deixar o driver converter para Date traria o fuso da máquina junto.
-- O CPF sai só com dígitos, que é a chave do cruzamento com o uMov.me.
WITH tipos_fibra AS (
    -- Escopo definido pela área em 28/09/2026: só instalação de FIBRA residencial.
    -- Ficam de fora Cortesia, CORPORATIVO, Rádio e Telefonia (com ou sem portabilidade).
    -- Título exato (TRIM) e dentro da lista original de tipos, para não puxar tipo novo
    -- que alguém cadastre com o mesmo nome.
    SELECT id
    FROM incident_types
    WHERE id IN (12, 1254, 1255, 1014, 1136, 249, 275, 1011, 1015)
      AND TRIM(title) IN ('#HR - TEC - Instalação de Fibra', 'TEC - Instalação de Fibra')
),
assignments_filtradas AS (
    SELECT DISTINCT ai.assignment_id
    FROM assignment_incidents ai
    JOIN contract_service_tags cst ON cst.id = ai.contract_service_tag_id
    JOIN contracts c ON c.id = cst.contract_id
    WHERE ai.incident_type_id IN (SELECT id FROM tipos_fibra)
      AND c.created >= $1::date
),
agendamento_bko AS (
    SELECT DISTINCT ON (r.assignment_id)
        r.assignment_id,
        r.beginning_date AS data_agendamento,
        p3.name          AS atendente_agendamento
    FROM reports r
    LEFT JOIN people p3 ON p3.id = r.person_id
    WHERE r.assignment_id IN (SELECT assignment_id FROM assignments_filtradas)
      AND (r.description ILIKE '%agendad%' OR r.description ILIKE '%agendamento%')
      AND (
          r.description ILIKE '%turno%'
          OR r.description ILIKE '%agendad%para%'
          OR r.description ILIKE '%agendamento%para%'
      )
    ORDER BY r.assignment_id, r.beginning_date ASC
),
primeiro_relato AS (
    SELECT DISTINCT ON (r.assignment_id)
        r.assignment_id,
        r.beginning_date AS data_contato,
        p3.name          AS atendente_contato
    FROM reports r
    LEFT JOIN people p3 ON p3.id = r.person_id
    WHERE r.assignment_id IN (SELECT assignment_id FROM assignments_filtradas)
    ORDER BY r.assignment_id, r.beginning_date ASC
),
personalizado AS (
    SELECT
        ai.protocol                  AS protocolo,
        c.contract_number            AS contrato,
        regexp_replace(COALESCE(p.tx_id, ''), '\D', '', 'g') AS cpf_digitos,
        p.name                       AS cliente,
        p2.name                      AS vendedor,
        isc.title                    AS canal,
        it.title                     AS tipo_solicitacao,
        is2.title                    AS status_protocolo,
        te.title                     AS equipe,
        to_char(c.created,           'YYYY-MM-DD HH24:MI:SS') AS criado_em,
        to_char(pr.data_contato,     'YYYY-MM-DD HH24:MI:SS') AS contato_em,
        pr.atendente_contato         AS atendente_contato,
        to_char(ab.data_agendamento, 'YYYY-MM-DD HH24:MI:SS') AS agendamento_em,
        ab.atendente_agendamento     AS atendente_agendamento,
        to_char(c.cancellation_date, 'YYYY-MM-DD HH24:MI:SS') AS cancelado_em,
        ROW_NUMBER() OVER (
            PARTITION BY c.contract_number
            ORDER BY a.created ASC, (ai.protocol IS NULL) ASC, ai.protocol DESC
        ) AS ordenado
    FROM assignments a
    LEFT JOIN assignment_incidents ai       ON a.id = ai.assignment_id
    LEFT JOIN contract_service_tags cst     ON cst.id = ai.contract_service_tag_id
    LEFT JOIN contracts c                   ON c.id = cst.contract_id
    LEFT JOIN incident_types it             ON it.id = ai.incident_type_id
    LEFT JOIN incident_status is2           ON ai.incident_status_id = is2.id
    LEFT JOIN teams te                      ON te.id = ai.team_id
    LEFT JOIN people p                      ON p.id = ai.client_id
    LEFT JOIN people p2                     ON p2.id = c.seller_1_id
    LEFT JOIN people_crm_informations pci   ON pci.person_id = p2.id
    LEFT JOIN industry_sectors isc          ON isc.id = pci.industry_sector_id
    LEFT JOIN agendamento_bko ab            ON ab.assignment_id = a.id
    LEFT JOIN primeiro_relato pr            ON pr.assignment_id = a.id
    WHERE it.id IN (SELECT id FROM tipos_fibra)
      AND c.created >= $1::date
)
SELECT
    protocolo, contrato, cpf_digitos, cliente, vendedor, canal, tipo_solicitacao,
    status_protocolo, equipe, criado_em, contato_em, atendente_contato,
    agendamento_em, atendente_agendamento, cancelado_em
FROM personalizado
WHERE ordenado = 1;
