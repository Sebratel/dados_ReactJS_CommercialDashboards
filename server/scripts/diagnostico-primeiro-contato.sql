-- ============================================================================
-- Diagnóstico do 1º contato do BKO  ·  rodar no DBeaver (somente leitura)
--
-- Pergunta: existe um relato do BKO ANTES do relato de agendamento que sirva
-- como "1º contato"? Hoje, na consulta SLA_BKO_Base, o 1º contato é uma cópia
-- do agendamento (mesma data, mesmo atendente).
--
-- Recorte: vendas criadas a partir de 01/08/2026 (para ser leve).
-- Como rodar: clique dentro de UMA consulta e aperte Ctrl+Enter.
-- As três consultas repetem o mesmo começo (WITH ...) de propósito, para
-- cada uma rodar sozinha.
-- ============================================================================


-- ----------------------------------------------------------------------------
-- CONSULTA 1 — números por canal
-- ----------------------------------------------------------------------------
WITH vendas AS (
    SELECT DISTINCT ON (c.contract_number)
        a.id      AS assignment_id,
        c.created AS cadastro,
        COALESCE(isc.title, '(sem canal)') AS canal
    FROM assignments a
    JOIN assignment_incidents ai     ON ai.assignment_id = a.id
    JOIN contract_service_tags cst   ON cst.id = ai.contract_service_tag_id
    JOIN contracts c                 ON c.id = cst.contract_id
    LEFT JOIN people_crm_informations pci ON pci.person_id = c.seller_1_id
    LEFT JOIN industry_sectors isc   ON isc.id = pci.industry_sector_id
    WHERE ai.incident_type_id IN (12,1254,1255,1014,1136,249,275,1011,1015)
      AND c.created >= '2026-08-01'
    ORDER BY c.contract_number, a.created ASC, (ai.protocol IS NULL) ASC, ai.protocol DESC
),
relatos AS (
    SELECT r.assignment_id, r.beginning_date AS quando, r.person_id, r.description
    FROM reports r
    WHERE r.assignment_id IN (SELECT assignment_id FROM vendas)
),
agendamento AS (
    SELECT DISTINCT ON (assignment_id) assignment_id, quando, person_id
    FROM relatos
    WHERE (description ILIKE '%agendad%' OR description ILIKE '%agendamento%')
      AND (description ILIKE '%turno%' OR description ILIKE '%agendad%para%' OR description ILIKE '%agendamento%para%')
    ORDER BY assignment_id, quando
),
equipe_bko AS (
    SELECT DISTINCT person_id FROM agendamento WHERE person_id IS NOT NULL
),
primeiro_relato_bko AS (
    SELECT DISTINCT ON (r.assignment_id) r.assignment_id, r.quando, r.description
    FROM relatos r
    JOIN equipe_bko b ON b.person_id = r.person_id
    ORDER BY r.assignment_id, r.quando
),
validacao AS (
    SELECT DISTINCT ON (assignment_id) assignment_id, quando
    FROM relatos
    WHERE description ILIKE '%valida%ok%' AND description ILIKE '%data%' AND description ILIKE '%hora%'
    ORDER BY assignment_id, quando
)
SELECT
    v.canal,
    COUNT(*)                                            AS vendas,
    COUNT(ag.quando)                                    AS com_agendamento,
    COUNT(pr.quando)                                    AS com_relato_bko,
    COUNT(va.quando)                                    AS com_validacao_tel,
    COUNT(*) FILTER (WHERE pr.quando < ag.quando)       AS relato_antes_do_agendamento,
    ROUND((PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (ag.quando - pr.quando)) / 3600)
           FILTER (WHERE pr.quando < ag.quando))::numeric, 1) AS mediana_horas_antes,
    COUNT(*) FILTER (WHERE va.quando < ag.quando)       AS validacao_antes_do_agendamento,
    COUNT(*) FILTER (WHERE pr.quando < v.cadastro)      AS relato_antes_do_cadastro
FROM vendas v
LEFT JOIN agendamento ag         ON ag.assignment_id = v.assignment_id
LEFT JOIN primeiro_relato_bko pr ON pr.assignment_id = v.assignment_id
LEFT JOIN validacao va           ON va.assignment_id = v.assignment_id
GROUP BY v.canal
ORDER BY vendas DESC;


-- ----------------------------------------------------------------------------
-- CONSULTA 2 — o que diz o relato do BKO que vem ANTES do agendamento
-- (só o começo do texto, agrupado; confira se não há dado de cliente antes de mandar)
-- ----------------------------------------------------------------------------
WITH vendas AS (
    SELECT DISTINCT ON (c.contract_number)
        a.id AS assignment_id
    FROM assignments a
    JOIN assignment_incidents ai     ON ai.assignment_id = a.id
    JOIN contract_service_tags cst   ON cst.id = ai.contract_service_tag_id
    JOIN contracts c                 ON c.id = cst.contract_id
    WHERE ai.incident_type_id IN (12,1254,1255,1014,1136,249,275,1011,1015)
      AND c.created >= '2026-08-01'
    ORDER BY c.contract_number, a.created ASC, (ai.protocol IS NULL) ASC, ai.protocol DESC
),
relatos AS (
    SELECT r.assignment_id, r.beginning_date AS quando, r.person_id, r.description
    FROM reports r
    WHERE r.assignment_id IN (SELECT assignment_id FROM vendas)
),
agendamento AS (
    SELECT DISTINCT ON (assignment_id) assignment_id, quando, person_id
    FROM relatos
    WHERE (description ILIKE '%agendad%' OR description ILIKE '%agendamento%')
      AND (description ILIKE '%turno%' OR description ILIKE '%agendad%para%' OR description ILIKE '%agendamento%para%')
    ORDER BY assignment_id, quando
),
equipe_bko AS (
    SELECT DISTINCT person_id FROM agendamento WHERE person_id IS NOT NULL
),
primeiro_relato_bko AS (
    SELECT DISTINCT ON (r.assignment_id) r.assignment_id, r.quando, r.description
    FROM relatos r
    JOIN equipe_bko b ON b.person_id = r.person_id
    ORDER BY r.assignment_id, r.quando
)
SELECT
    LEFT(REGEXP_REPLACE(pr.description, '\s+', ' ', 'g'), 50) AS inicio_do_relato,
    COUNT(*) AS vezes
FROM primeiro_relato_bko pr
JOIN agendamento ag ON ag.assignment_id = pr.assignment_id
WHERE pr.quando < ag.quando
GROUP BY 1
ORDER BY vezes DESC
LIMIT 30;


-- ----------------------------------------------------------------------------
-- CONSULTA 3 — quem escreve os relatos de agendamento
-- (confirma se a "equipe BKO" usada acima é mesmo o BKO)
-- ----------------------------------------------------------------------------
WITH vendas AS (
    SELECT DISTINCT ON (c.contract_number)
        a.id AS assignment_id
    FROM assignments a
    JOIN assignment_incidents ai     ON ai.assignment_id = a.id
    JOIN contract_service_tags cst   ON cst.id = ai.contract_service_tag_id
    JOIN contracts c                 ON c.id = cst.contract_id
    WHERE ai.incident_type_id IN (12,1254,1255,1014,1136,249,275,1011,1015)
      AND c.created >= '2026-08-01'
    ORDER BY c.contract_number, a.created ASC, (ai.protocol IS NULL) ASC, ai.protocol DESC
),
agendamento AS (
    SELECT DISTINCT ON (r.assignment_id) r.assignment_id, r.person_id
    FROM reports r
    WHERE r.assignment_id IN (SELECT assignment_id FROM vendas)
      AND (r.description ILIKE '%agendad%' OR r.description ILIKE '%agendamento%')
      AND (r.description ILIKE '%turno%' OR r.description ILIKE '%agendad%para%' OR r.description ILIKE '%agendamento%para%')
    ORDER BY r.assignment_id, r.beginning_date
)
SELECT p.name AS atendente, COUNT(*) AS agendamentos
FROM agendamento ag
LEFT JOIN people p ON p.id = ag.person_id
GROUP BY p.name
ORDER BY agendamentos DESC;
