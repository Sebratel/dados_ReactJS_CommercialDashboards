-- Ocupação por splitter secundário — réplica de "SPLITTER_(OCUPADA_/_DISPONIVEIS)"
-- e de "SPLITTER_(OCUPACAO)" do Power Query (dsn=dbVoalle).
--
-- No Power BI são duas consultas com o MESMO corpo: uma devolve capacidade e
-- portas, a outra acrescenta percentual e classificação. Aqui é uma só — o
-- percentual e a faixa (OK / ALERTA / CRÍTICO) são calculados em JS, com os
-- mesmos cortes de 70% e 90%. Não faz sentido pagar duas varreduras da mesma
-- tabela para derivar duas colunas.
--
-- São ainda duas outras consultas do modelo original: SPLITTER_(LOTADOS) e
-- SPLITTER_(ZERADOS) diferem desta apenas pelo HAVING (= 100 e = 0). Filtrar
-- isto em memória custa nada e evita mais duas cargas.
--
-- Uma linha por splitter, então o resultado é pequeno (milhares de linhas) —
-- não vale recorte incremental.
SELECT
    s.id                                    AS splitter_id,
    s.title                                 AS splitter,
    s.out_ports                             AS capacidade,
    COUNT(p.authentication_contract_id)     AS ocupadas,
    (s.out_ports - COUNT(p.authentication_contract_id)) AS disponiveis
FROM authentication_splitters s
LEFT JOIN authentication_splitter_ports p
       ON p.authentication_splitter_id = s.id
WHERE s.active IS TRUE
  AND s.deleted IS FALSE
  AND p.deleted IS FALSE
  AND s."type" = 1
GROUP BY s.id, s.title, s.out_ports
ORDER BY s.title
