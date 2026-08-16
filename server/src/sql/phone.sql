-- Réplica da query "phone activation": data de ativação da TELEFONIA
SELECT
    ai.protocol             AS protocolo,
    c.contract_number       AS contrato,
    MAX(r.final_date)::date AS ativacao
FROM assignments a
LEFT JOIN reports r                 ON r.assignment_id = a.id
LEFT JOIN assignment_incidents ai   ON a.id   = ai.assignment_id
LEFT JOIN contract_service_tags cst ON cst.id = ai.contract_service_tag_id
LEFT JOIN contracts c               ON c.id   = cst.contract_id
LEFT JOIN incident_types it         ON it.id  = ai.incident_type_id
LEFT JOIN teams t                   ON t.id   = r.team_id
WHERE it.id IN ('275', '1011')
  AND c.created > $1
  -- Réplica literal do BI: `t.title <> 'Financeiro'`. Como t vem de LEFT JOIN,
  -- a comparação é NULL (não verdadeira) quando o atendimento não tem time, e
  -- essas linhas ficam de fora. Escrever `t.title IS NULL OR ...` pareceria o
  -- conserto de um descuido de lógica ternária, mas muda a medida: passa a
  -- contar ativações de telefonia que o relatório de referência não conta.
  AND t.title <> 'Financeiro'
GROUP BY ai.protocol, c.contract_number
