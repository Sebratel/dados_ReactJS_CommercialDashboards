-- Réplica da query "ALOCAÇÃO/ATIVAÇÃO" (data de ativação de FIBRA/RÁDIO)
-- DATA ATIVAÇÃO = data de saída do equipamento, exceto quando o equipamento
-- retornou na mesma data (nesse caso a instalação não se concretizou -> null).
SELECT
    contrato,
    cliente,
    MIN(data_ativacao)::date AS data_ativacao
FROM (
    SELECT
        c.contract_number AS contrato,
        p4.name           AS cliente,
        CASE
            WHEN plis.returned_date IS NOT NULL
             AND plis.returned_date = (CASE WHEN it.id IN ('12', '1254', '1255', '1014', '1136', '249', '1015')
                                            THEN plis.out_date ELSE a.conclusion_date END)
            THEN NULL
            ELSE (CASE WHEN it.id IN ('12', '1254', '1255', '1014', '1136', '249', '1015')
                       THEN plis.out_date ELSE a.conclusion_date END)
        END AS data_ativacao
    FROM patrimony_packing_list_items plis
    LEFT JOIN patrimony_packing_lists ppl ON ppl.id  = plis.patrimony_packing_list_id
    LEFT JOIN assignments a               ON a.id    = ppl.assignment_id
    LEFT JOIN assignment_incidents ai     ON ai.assignment_id = a.id
    LEFT JOIN incident_types it           ON it.id   = ai.incident_type_id
    LEFT JOIN people p4                   ON p4.id   = ppl.responsible_id
    LEFT JOIN contract_service_tags cst   ON cst.id  = ppl.contract_service_tag_id
    LEFT JOIN contracts c                 ON c.id    = cst.contract_id
    WHERE it.id IN ('12', '1254', '1255', '1014', '1136', '249', '275', '1011', '1015')
      AND plis.out_date > $1
) t
WHERE contrato IS NOT NULL
GROUP BY contrato, cliente
