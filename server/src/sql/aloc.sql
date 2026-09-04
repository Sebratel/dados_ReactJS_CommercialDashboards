-- Réplica da query "ALOCAÇÃO/ATIVAÇÃO" (data de ativação de FIBRA/RÁDIO)
--
-- DATA ATIVAÇÃO = data de saída do equipamento. Se o equipamento voltou na mesma
-- data, a instalação não se concretizou e a data é anulada.
--
-- ... exceto quando algum OUTRO equipamento do contrato ficou com o cliente.
-- Foi a troca de aparelho no mesmo dia: o técnico levou um, ele voltou, e um
-- segundo saiu por outro atendimento (em geral "TEC - Suporte de Retorno
-- Prioritário") e não retornou. O cliente está instalado.
--
-- Sem essa ressalva o contrato sumia da tela de ativações inteiro. Medido em
-- 2026: 35 contratos são anulados pela regra e em 12 deles havia equipamento na
-- casa do cliente — falso negativo. Só em agosto foram 3 (287210, 288453,
-- 288627), a diferença exata para o Power BI de origem.
--
-- O relatório antigo tem a mesma regra escrita, mas ela nunca dispara: o CASE
-- abaixo mistura out_date (date) com conclusion_date (timestamp), o Postgres
-- promove tudo a timestamp, e o `if [RETORNO] = [DATA SAÍDA]` do Power Query
-- compara date com datetime — em M isso é sempre falso. Lá nada é descartado;
-- aqui, só o que de fato não instalou.
WITH ficou_equipamento AS (
    -- contratos com ao menos um equipamento que saiu e não voltou, de QUALQUER
    -- tipo de atendimento: o que decide é o aparelho na casa, não o motivo da visita
    SELECT DISTINCT c.contract_number AS contrato
    FROM patrimony_packing_list_items plis
    LEFT JOIN patrimony_packing_lists ppl ON ppl.id = plis.patrimony_packing_list_id
    LEFT JOIN contract_service_tags cst   ON cst.id = ppl.contract_service_tag_id
    LEFT JOIN contracts c                 ON c.id   = cst.contract_id
    WHERE plis.returned_date IS NULL
      AND plis.out_date > $1
      AND c.contract_number IS NOT NULL
)
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
             AND fe.contrato IS NULL
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
    LEFT JOIN ficou_equipamento fe        ON fe.contrato = c.contract_number
    WHERE it.id IN ('12', '1254', '1255', '1014', '1136', '249', '275', '1011', '1015')
      AND plis.out_date > $1
) t
WHERE contrato IS NOT NULL
GROUP BY contrato, cliente
