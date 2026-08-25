-- Réplica da consulta "Cancelamento" (dsn=dbVoalle) — a PESQUISA de cancelamento.
--
-- Um registro por atendimento de cancelamento cujo checklist final registra a
-- pesquisa ("COM A DECISÃO DESSE CANCELAMENTO"). O checklist é um JSON com uma
-- entrada por pergunta; ele viaja inteiro nesta consulta e é aberto em pergunta ×
-- resposta no modelo (`model/relatorios.js`).
--
-- DIFERENÇAS PROPOSITAIS EM RELAÇÃO AO POWER QUERY
-- 1. Corte por data ($1) sobre a abertura do atendimento. A consulta de origem lê
--    todo o histórico; aqui ela obedece a Janela de dados.
-- 2. As duas colunas sem qualificação do original (`contract_service_tag_id` e
--    `contract_id`) estão qualificadas: a primeira é de `assignment_incidents`,
--    a segunda de `contract_service_tags`. Conferido no catálogo — não há
--    ambiguidade, mas ler o SQL não deveria exigir essa conferência.
-- 3. `numero_protocolo` (o "n°protocolo" da origem) sai pronto: são 7 caracteres a
--    partir da 11ª posição do título do atendimento, que no Power Query é o passo
--    `Text.Middle([protocolo], 10, 7)`.
-- 4. A abertura do JSON e a tradução 0/1 -> Não/Sim ficam no modelo, não aqui: um
--    checklist malformado derrubaria a consulta inteira se fosse `::jsonb` no SQL.
--    No modelo, ele derruba só a própria linha, e a tela informa quantas foram.
SELECT DISTINCT ON (ai.assignment_id)
    a.title                       AS protocolo,
    substring(a.title FROM 11 FOR 7) AS numero_protocolo,
    is2.title                     AS status,
    a.created                     AS criado,
    vu.name                       AS colaborador,
    p2.name                       AS encerrado_por,
    p.name                        AS cliente,
    cst.service_tag               AS etiqueta,
    c.contract_number::text       AS contrato,
    c.cancellation_date::date     AS data_cancelamento,
    c.cancellation_motive         AS motivo_cancelamento,
    p.city                        AS cidade,
    p.street                      AS rua,
    p.number                      AS numero,
    p.neighborhood                AS bairro,
    ai.final_checklist            AS checklist
FROM assignment_incidents ai
LEFT JOIN incident_status is2        ON is2.id = ai.incident_status_id
LEFT JOIN reports r                  ON r.assignment_id = ai.assignment_id
LEFT JOIN assignments a              ON a.id = ai.assignment_id
LEFT JOIN v_users vu                 ON vu.id = r.created_by
LEFT JOIN people p                   ON p.id = ai.client_id
LEFT JOIN contract_service_tags cst  ON cst.id = ai.contract_service_tag_id
LEFT JOIN contracts c                ON c.id = cst.contract_id
LEFT JOIN people p2                  ON p2.id = a.responsible_id
WHERE ai.incident_type_id IN (1021, 1055, 262, 1142, 1143, 1154, 1131)
  AND ai.final_checklist ILIKE '%COM A DECISÃO DESSE CANCELAMENTO%'
  AND a.created >= $1
ORDER BY ai.assignment_id, a.created DESC
