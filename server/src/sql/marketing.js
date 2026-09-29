/**
 * Consultas do modelo de CAMPANHAS DE MARKETING (réplica do "MKT - Campanhas de
 * Marketing"). As três vivem no MariaDB que o dashboard já abre — nenhuma conexão
 * nova, nenhum segredo novo.
 *
 *   marketing_google_ads -> DB_Marketing      (investimento e cliques do Google)
 *   marketing_meta_ads   -> DB_Marketing      (investimento e alcance do Meta)
 *   db_matrix            -> API_WebDeveloper  (o atendimento que a campanha gerou)
 *
 * AS COLUNAS DO GOOGLE SÃO TEXTO. `Custo`, `CPC méd.`, `CTR`, `Taxa de conv.` e
 * `Conversões` estão gravadas como varchar em português — '142,49', '13,36%'. O
 * Power BI convertia pelo idioma do arquivo; aqui a conversão é explícita, em
 * `numeroBR` (model/campanhas.js). Não dá para somar no SQL sem arriscar: um
 * `CAST` silencioso em MariaDB devolve 142 para '142,49', e o total sai 1/3 menor
 * sem nenhum aviso.
 */

/** Um dia de campanha do Google. Sem recorte: a tabela inteira tem ~760 linhas. */
export const GOOGLE_ADS_SQL = `
  SELECT g.\`Campanha\`                  AS campanha,
         g.\`ID da campanha\`            AS campanha_id,
         g.\`Estado da campanha\`        AS estado,
         g.\`Tipo de campanha\`          AS tipo,
         DATE_FORMAT(g.\`Dia\`, '%Y-%m-%d') AS dia,
         g.\`Cliques\`                   AS cliques,
         g.\`Impr.\`                     AS impressoes,
         g.\`CTR\`                       AS ctr_txt,
         g.\`CPC méd.\`                  AS cpc_txt,
         g.\`Custo\`                     AS custo_txt,
         g.\`Conversões\`                AS conversoes_txt,
         g.\`Taxa de conv.\`             AS taxa_conv_txt,
         g.\`Custo / conv.\`             AS custo_conv_txt
  FROM DB_Marketing.marketing_google_ads AS g
`;

/** Um dia de campanha do Meta. Aqui os números já vêm numéricos de verdade. */
export const META_ADS_SQL = `
  SELECT m.\`Nome da campanha\`          AS campanha,
         m.\`Identificação da campanha\` AS campanha_id,
         DATE_FORMAT(m.\`Dia\`, '%Y-%m-%d') AS dia,
         m.\`Estado de apresentação\`    AS estado,
         m.\`Nível de apresentação\`     AS nivel,
         m.\`Alcance\`                   AS alcance,
         m.\`Impressões\`                AS impressoes,
         m.\`Frequência\`                AS frequencia,
         m.\`Tipo de resultado\`         AS tipo_resultado,
         m.\`Resultados\`                AS resultados,
         m.\`Montante gasto (BRL)\`      AS gasto,
         m.\`Custo por resultado\`       AS custo_resultado,
         DATE_FORMAT(m.\`Começa a\`, '%Y-%m-%d') AS inicio,
         DATE_FORMAT(m.\`Termina a\`, '%Y-%m-%d') AS fim
  FROM DB_Marketing.marketing_meta_ads AS m
`;

/**
 * Atendimentos do Matrix com tag de marketing.
 *
 * O recorte por tag acontece AQUI, e não no Node, por tamanho: a tabela tem 605 mil
 * linhas e só ~14 mil têm tag de marketing. Trazer tudo para filtrar em memória
 * custaria 600 mil objetos para descartar 98% deles.
 *
 * `data_entrada` e as outras datas são VARCHAR no formato 'YYYY-MM-DD HH:MM:SS' —
 * ordenáveis como texto, que é como o resto do modelo já trata data. O parâmetro
 * do recorte, portanto, é comparação de string, e não de data.
 */
export const MATRIX_CAMPANHAS_SQL = `
  SELECT d.\`codigo\`          AS codigo,
         d.\`protocolo\`       AS protocolo,
         d.\`data_entrada\`    AS data_entrada,
         d.\`data_atendimento\` AS data_atendimento,
         d.\`data_finalizacao\` AS data_finalizacao,
         d.\`classificacao\`   AS classificacao,
         d.\`servico\`         AS servico,
         d.\`canal\`           AS canal,
         d.\`ativo_receptivo\` AS ativo_receptivo,
         d.\`atendente\`       AS atendente,
         d.\`cpf\`             AS cpf,
         d.\`contato\`         AS contato,
         d.\`num_telefone\`    AS telefone,
         d.\`tags\`            AS tags
  FROM API_WebDeveloper.db_matrix AS d
  WHERE d.\`tags\` IS NOT NULL
    AND d.\`tags\` <> ''
    AND LOWER(d.\`tags\`) LIKE '%marketing%'
    AND d.\`data_entrada\` >= ?
`;
