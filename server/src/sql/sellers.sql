-- Réplica da query "new_sellers" (lado Voalle): usuários do sistema = vendedores
--
-- O `email` existe para CASAR com o RH (Senior), não para exibir. O relacionamento
-- era por NOME, e nome quebra: "JÉSSICA ARAÚJO TEIXEIRA" no Voalle contra "JESSICA
-- ARAUJO TEIXEIRA" no Senior é a mesma pessoa e não casava, então ela ficava sem
-- admissão e caía fora de Rampagem e Premiações. Medido no banco: o e-mail resgata
-- 38 vendedores. O relatório de origem foi corrigido do mesmo jeito.
--
-- O e-mail fica no servidor e nunca vai para o navegador: é chave de junção, não
-- coluna de tela.
SELECT
    u.name                  AS vendedor,
    lower(trim(u.email))    AS email,
    u.created::date         AS admissao
FROM users u
WHERE u.name IS NOT NULL
