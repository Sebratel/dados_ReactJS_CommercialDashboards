-- Réplica da query "general" do Power Query (dsn=dbVoalle)
-- 1 linha por contrato (ORDENADO = 1), contratos criados a partir de $1
SELECT
    protocolo,
    to_char(data_hora_criacao_contrato, 'YYYY-MM-DD HH24:MI:SS.US') AS created_key,
    to_char(data_hora_criacao_contrato, 'HH24:MI')                  AS hora_criacao,
    data_hora_criacao_contrato::date AS data_criacao_contrato,
    cadastro_cliente::date           AS cadastro_cliente,
    clientes,
    cidade,
    vendedor,
    regiao_vendedor,
    status_contrato,
    status_cancelamento,
    contrato,
    valor::float8                    AS valor,
    canal,
    tecnologia
FROM (
    SELECT
        ai.protocol            AS protocolo,
        c.created              AS data_hora_criacao_contrato,
        p.created              AS cadastro_cliente,
        p.name                 AS clientes,
        p.city                 AS cidade,
        p2.name                AS vendedor,
        rc.city                AS regiao_vendedor,
        c.v_status             AS status_contrato,
        c.contract_number      AS contrato,
        c.amount               AS valor,
        c.cancellation_motive  AS status_cancelamento,
        isc.title              AS canal,
        CASE
            WHEN it.id IN ('12', '1014', '1254', '1255', '1136') THEN 'FIBRA'
            WHEN it.id IN ('249', '1015')                        THEN 'RÁDIO'
            ELSE 'TELEFONIA'
        END                    AS tecnologia,
        ROW_NUMBER() OVER (PARTITION BY c.contract_number ORDER BY a.created ASC) AS ordenado
    FROM assignments a
    LEFT JOIN assignment_incidents ai     ON a.id   = ai.assignment_id
    LEFT JOIN contract_service_tags cst   ON cst.id = ai.contract_service_tag_id
    LEFT JOIN contracts c                 ON c.id   = cst.contract_id
    LEFT JOIN incident_types it           ON it.id  = ai.incident_type_id
    LEFT JOIN people p                    ON p.id   = ai.client_id
    LEFT JOIN people p2                   ON p2.id  = c.seller_1_id
    LEFT JOIN people_crm_informations pci ON pci.person_id = p2.id
    LEFT JOIN industry_sectors isc        ON isc.id = pci.industry_sector_id
    LEFT JOIN region_cities rc            ON rc.region_id = p2.region_id
    WHERE it.id IN ('12', '1254', '1255', '1014', '1136', '249', '275', '1011', '1015')
      AND c.created > $1
) t
WHERE ordenado = 1
