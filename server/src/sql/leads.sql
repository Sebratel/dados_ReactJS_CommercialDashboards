-- Réplica da consulta "leads" do Power Query (dsn=dbVoalle).
--
-- Um lead é uma pessoa (`people`) com as informações de CRM anexadas. A coluna
-- `classificacao_lead` é o coração do relatório: sete estados, decididos na ordem
-- em que aparecem no CASE — quem tem negociação ganha é "Ganho" mesmo que esteja
-- deletado, e por isso a ordem das cláusulas importa e foi mantida.
--
-- DIFERENÇAS PROPOSITAIS em relação ao Power Query:
--
-- 1. O corte de data é parâmetro ($1), não a constante '2026-01-01' escrita na
--    consulta. O padrão continua sendo 2026-01-01 (`CRM_SINCE`), mas quem
--    administra pode mexer sem editar SQL.
--
-- 2. Os rótulos de `situation`, `tipo_documento`, `genero` e `deletado` saem
--    prontos daqui. No Power Query são 16 passos de `Table.ReplaceValue` em
--    sequência, e sequência de substituição de TEXTO é frágil: basta um valor
--    novo no banco conter o dígito de outro para trocar o rótulo errado. Em CASE
--    o mapeamento é explícito e o que não estiver previsto aparece como
--    "(não mapeado: X)" em vez de virar o número cru.
--
-- 3. Fica de fora o passo que troca um `#datetime(2026,7,7,16,45,15.095458)` por
--    um segundo antes. É um conserto manual de uma linha específica; replicá-lo
--    seria carregar para cá um remendo de um dia só.
SELECT
    p.id                                AS lead_id,
    p.name                              AS nome,
    CASE p.type_tx_id::text
        WHEN '1' THEN 'Pessoa Jurídica'
        WHEN '2' THEN 'Pessoa Física'
        WHEN '3' THEN 'Estrangeira'
        WHEN ''  THEN NULL
        WHEN NULL THEN NULL
        ELSE '(não mapeado: ' || p.type_tx_id::text || ')'
    END                                 AS tipo_documento,
    p.tx_id                             AS cpf_cnpj,
    CASE p.gender::text
        WHEN '1' THEN 'Masculino'
        WHEN '2' THEN 'Feminino'
        WHEN ''  THEN NULL
        ELSE NULL
    END                                 AS genero,
    p.email                             AS email,
    p.birth_date::date                  AS data_nascimento,
    p.created                           AS data_cadastro_lead,
    p.modified                          AS data_modificacao,
    CASE WHEN p.deleted = TRUE THEN p.modified END AS data_descarte,
    u.name                              AS criado_por,
    u2.name                             AS modificado_por,
    p.phone                             AS telefone,
    p.cell_phone_1                      AS celular,
    p2.name                             AS proprietario_venda,
    cco.title                           AS origem_lead,
    cf.title                            AS origem_lead_form,
    pci.probability_closing_date_sale::date AS data_provavel_venda,
    cor.title                           AS motivo_oportunidade,
    pci.assignment_id                   AS protocolo,
    t.title                             AS time_proprietario,
    p.lat,
    p.lng,
    pa.postal_code,
    pa.street,
    pa."number",
    pa.neighborhood,
    pa.city,
    CASE p.situation::text
        WHEN '1' THEN 'Contato'
        WHEN '2' THEN 'Prospect'
        WHEN '3' THEN 'Efetivo'
        WHEN '4' THEN 'Lead'
        WHEN '5' THEN 'Prospect'
        WHEN '6' THEN 'Contato de Leads'
        WHEN '7' THEN 'Suspect'
        WHEN '8' THEN 'Descartado'
        ELSE NULL
    END                                 AS situacao,
    CASE WHEN p.deleted = TRUE THEN 'Deletado' ELSE 'Não' END AS deletado,
    -- A ordem das cláusulas É a regra: "Ganho" vence "Descartado", que vence
    -- "Em Andamento", e assim por diante.
    CASE
        WHEN EXISTS (
            SELECT 1 FROM crm_consult_selling_steps ccss
            LEFT JOIN crm_opportunity_reasons cor2 ON cor2.id = ccss.crm_opportunity_reasons_id
            WHERE ccss.person_id = p.id AND cor2.type = 1 AND ccss.deleted IS DISTINCT FROM TRUE
        ) THEN 'Ganho'
        WHEN p.deleted = TRUE THEN 'Descartado'
        WHEN EXISTS (
            SELECT 1 FROM crm_consult_selling_steps ccss
            LEFT JOIN crm_opportunity_reasons cor2 ON cor2.id = ccss.crm_opportunity_reasons_id
            WHERE ccss.person_id = p.id AND (cor2.type IS NULL OR cor2.type NOT IN (0, 1)) AND ccss.deleted IS DISTINCT FROM TRUE
        ) THEN 'Em Andamento'
        WHEN EXISTS (
            SELECT 1 FROM crm_consult_selling_steps ccss
            LEFT JOIN crm_opportunity_reasons cor2 ON cor2.id = ccss.crm_opportunity_reasons_id
            WHERE ccss.person_id = p.id AND cor2.type = 0 AND ccss.deleted IS DISTINCT FROM TRUE
        ) THEN 'Perda'
        WHEN p.situation::text = '4'
             AND (p.tx_id IS NOT NULL AND p.tx_id <> '')
             AND (u.name IS DISTINCT FROM 'UMOV ME TECNOLOGIA') THEN 'Qualificado'
        WHEN p.situation::text = '4'
             AND (u.name IS DISTINCT FROM 'UMOV ME TECNOLOGIA') THEN 'Disponível'
        ELSE 'Outros'
    END                                 AS classificacao_lead
FROM people p
LEFT JOIN people_crm_informations pci ON pci.person_id = p.id
LEFT JOIN people p2                   ON p2.id = pci.proprietary_id
LEFT JOIN crm_contact_origins cco     ON cco.id = pci.crm_contact_origin_id
LEFT JOIN crm_forms cf                ON cf.id = pci.crm_form_id
LEFT JOIN crm_opportunity_reasons cor ON cor.id = pci.crm_opportunity_reason_id
LEFT JOIN users u                     ON u.id = p.created_by
LEFT JOIN users u2                    ON u2.id = p.modified_by
LEFT JOIN teams t                     ON t.id = pci.proprietary_team_id
LEFT JOIN people_addresses pa         ON pa.id = p.people_address_main_id
WHERE p.created >= $1
ORDER BY p.created DESC
