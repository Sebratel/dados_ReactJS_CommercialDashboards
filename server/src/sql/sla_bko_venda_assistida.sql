-- Solicitações de "Venda Assistida" (tipo 1054, antiga Venda Consultiva) — usadas só pelo card
-- "Pendentes de cadastro agora" da tela SLAs Backoffice.
--
-- Por quê: quando o BKO aprova um pedido no uMov, a integração abre no Elleven uma Venda
-- Assistida para o cliente. Se a negociação se perde, o BKO CANCELA essa solicitação e nenhum
-- contrato é criado — sem esta consulta, o pedido aprovado ficaria "pendente de cadastro" para
-- sempre (caso Vera Regina Bitencourt da Costa: tarefa uMov 701784007, aprovada 17/09/2026
-- 16:02, protocolo 1819251 cancelado em 23/09 por Perda da Negociação).
--
-- Uma linha por solicitação. Status 8 = Cancelado (tabela incident_status). Datas em TEXTO
-- local, CPF só com dígitos — o mesmo formato de sla_bko.sql.
-- $1 = data de corte (o servidor passa ~45 dias atrás; o card olha 30).
SELECT
    ai.protocol                                              AS protocolo,
    regexp_replace(COALESCE(p.tx_id, ''), '\D', '', 'g')     AS cpf_digitos,
    to_char(a.created, 'YYYY-MM-DD HH24:MI:SS')              AS aberto_em,
    ai.incident_status_id                                    AS status_id,
    is2.title                                                AS status
FROM assignment_incidents ai
JOIN assignments a            ON a.id = ai.assignment_id
LEFT JOIN people p            ON p.id = ai.client_id
LEFT JOIN incident_status is2 ON is2.id = ai.incident_status_id
WHERE ai.incident_type_id = 1054
  AND a.created >= $1::date;
