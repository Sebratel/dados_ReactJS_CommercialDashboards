// Queries do MariaDB (dsn=dbMaria no Power BI)

// tabela "teams" -> DB_Applicattion.Comercial_Teams
export const TEAMS_SQL = `
  SELECT ct.VENDEDORES AS vendedores,
         ct.EQUIPES    AS equipes,
         ct.SITUAÇÃO   AS situacao,
         ct.ATIVO      AS ativo
  FROM DB_Applicattion.Comercial_Teams AS ct
`;

/**
 * tabela "General_Commercial" -> a ponte histórica de vendas.
 *
 * O relatório de Relatórios Comercial ANEXA esta tabela ao `general` do Voalle
 * (`Table.Combine`), e é a única das cinco réplicas que faz isso. São 55.198 linhas
 * de 2022 a 2024 — venda registrada fora do Voalle, que termina no fim de 2024.
 *
 * Ela não tem contrato, protocolo, bairro, canal nem região: só cliente, cidade,
 * vendedor, valor, tecnologia e as datas. Por isso as linhas entram no modelo
 * marcadas com a origem, e a tela diz quais colunas não existem para elas — em vez
 * de mostrar célula vazia e parecer defeito.
 *
 * O recorte por data fica no `WHERE` com parâmetro, para obedecer a Janela de dados
 * como o resto: sem isso ela traria 2022 e 2023 para telas que começam em 2024.
 */
export const GENERAL_COMMERCIAL_SQL = `
  SELECT gc.\`DATA CRIAÇÃO CONTRATO\` AS data_criacao_contrato,
         gc.\`CADASTRO CLIENTE\`      AS cadastro_cliente,
         gc.CLIENTES                  AS clientes,
         gc.CIDADE                    AS cidade,
         gc.\`STATUS CANCELAMENTO\`   AS status_cancelamento,
         gc.VENDEDOR                  AS vendedor,
         gc.VALOR                     AS valor,
         gc.TECNOLOGIA                AS tecnologia,
         gc.\`DATA ATIVAÇÃO\`         AS data_ativacao
  FROM DB_Applicattion.General_Commercial AS gc
  WHERE gc.\`DATA CRIAÇÃO CONTRATO\` >= ?
`;

/**
 * tabela "senior_admitted" -> colaboradores ativos no Senior (RH)
 *
 * O `email` é a chave de junção com os usuários do Voalle. Ver o cabeçalho de
 * `sellers.sql`: o relacionamento por nome perdia quem tivesse acento grafado
 * diferente nas duas bases, e a pessoa ficava sem admissão — logo, fora de Rampagem
 * e de Premiações, que são exatamente as telas que dependem dela.
 */
export const SENIOR_SQL = `
  SELECT dsc.name             AS seller,
         lower(trim(dsc.email)) AS email,
         dsc.admission_date   AS admission_date,
         dsc.position         AS position
  FROM API_WebDeveloper.db_senior_collaborators AS dsc
  WHERE dsc.termination_date IS NULL
`;
