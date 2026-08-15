-- Réplica da query "new_sellers" (lado Voalle): usuários do sistema = vendedores
SELECT
    u.name           AS vendedor,
    u.created::date  AS admissao
FROM users u
WHERE u.name IS NOT NULL
