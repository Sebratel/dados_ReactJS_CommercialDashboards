-- Réplica das consultas "Consulta1" e "backlog" (dsn=dbVoalle) numa só.
--
-- É a fila de instalações em aberto: atendimento de instalação de fibra (12) ou
-- rádio (249) que não está cancelado nem encerrado e cujo equipamento ainda não
-- saiu do estoque (`plis.out_date IS NULL`).
--
-- POR QUE UMA CONSULTA NO LUGAR DE DUAS
-- No modelo de origem `backlog` é esta mesma consulta com COUNT + GROUP BY por tipo,
-- equipe e cidade, e `Consulta1` é o detalhe linha a linha. A diferença entre as duas
-- era só a agregação — que aqui é feita no modelo — MAIS uma divergência de verdade:
-- a lista de equipes de `backlog` inclui 'Equipe Field Service' e a de `Consulta1`
-- não. Em vez de escolher por nós, a coluna `no_detalhe` marca quais linhas o
-- detalhe da origem enxergava, e cada visual usa a base que o relatório usava.
--
-- SEM RECORTE DE DATA, DE PROPÓSITO
-- Fila em aberto é retrato do agora: um protocolo de 2019 que nunca foi instalado é
-- exatamente o que se quer ver numa tela de backlog. Cortar por Janela de dados o
-- esconderia e faria a fila parecer menor do que é. O piso de 2018 é o da origem.
--
-- CUIDADO COM O GRÃO
-- O `LEFT JOIN` em patrimony_packing_list_items multiplica a linha quando o
-- atendimento tem mais de um item de patrimônio, e o COUNT(a.title) da origem conta
-- essas repetições. O modelo conta as duas coisas — linhas e protocolos distintos —
-- e a tela diz qual está mostrando.
SELECT
    ai.protocol   AS protocolo,
    -- o id, e não só o título: fibra é 12 e rádio é 249. Separar as tabelas por
    -- expressão regular no rótulo funcionava até alguém renomear o tipo de
    -- atendimento no Voalle — e aí a tabela de rádio esvaziaria sem aviso.
    ai.incident_type_id AS tipo_id,
    it.title      AS tipo_protocolo,
    t.title       AS equipe,
    p.city        AS cidade,
    is2.title     AS status,
    a.created     AS criado,
    (t.title <> 'Equipe Field Service') AS no_detalhe
FROM assignment_incidents ai
LEFT JOIN assignments a                        ON a.id = ai.assignment_id
LEFT JOIN patrimony_packing_lists ppl          ON ppl.assignment_id = a.id
LEFT JOIN patrimony_packing_list_items plis    ON plis.patrimony_packing_list_id = ppl.id
LEFT JOIN incident_types it                    ON it.id = ai.incident_type_id
LEFT JOIN incident_status is2                  ON is2.id = ai.incident_status_id
LEFT JOIN teams t                              ON t.id = ai.team_id
LEFT JOIN people p                             ON p.id = ai.client_id
WHERE t.title IN (
        'Operacional Fibra – Instalações',
        'Instalação [SLE/SPS/NHO/EIO/CAN]',
        'Ativações - Fibra',
        'Operacional Radio',
        'Instalação [Nova Santa Rita, Esteio]',
        'Instalação [Triunfo]',
        'Validação de dados - BKO',
        'Equipe Field Service'
    )
  AND a.created >= '2018-01-01'
  AND ai.incident_type_id IN (12, 249)
  AND is2.title NOT IN ('Cancelado', 'Encerrado')
  AND plis.out_date IS NULL
