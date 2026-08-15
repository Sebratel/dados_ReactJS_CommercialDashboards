-- Réplica da query "PAGAMENTO": primeiro pagamento do cliente por contrato.
-- No Power Query: ROW_NUMBER() OVER (PARTITION BY p.name, co.contract_number
--                                    ORDER BY x.client_paid_date ASC) <= 1
-- Aqui usamos DISTINCT ON (equivalente e muito mais barato) e restringimos aos
-- contratos criados a partir de $1 (mesmo recorte da tabela "general").
SELECT DISTINCT ON (p.name, co.contract_number)
    p.name                                                AS nome,
    co.contract_number                                    AS contrato,
    to_char(co.created, 'YYYY-MM-DD HH24:MI:SS.US')       AS created_key,
    x.client_paid_date::date                              AS pagamento_cliente,
    fr.expiration_date::date                              AS data_vencimento,
    sp.title                                              AS plano
FROM erp.financial_receipt_titles x
JOIN erp.financial_receivable_titles fr   ON x.financial_receivable_title_id = fr.id
JOIN erp.contracts co                     ON co.id = fr.contract_id
LEFT JOIN erp.people p                    ON p.id  = x.client_id
LEFT JOIN erp.authentication_contracts ac ON ac.contract_id = co.id
LEFT JOIN erp.service_products sp         ON ac.service_product_id = sp.id
LEFT JOIN erp.bank_accounts b             ON x.bank_account_id = b.id
WHERE co.contract_number IS NOT NULL
  AND co.created > $1
  AND (b.description IS NULL OR b.description <> 'Conta Transitória (Baixa/Perda) - YES')
ORDER BY p.name, co.contract_number, x.client_paid_date ASC NULLS LAST
