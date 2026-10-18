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
 * RASTREAMENTO DE POSTS — a base de leads da tela (ver model/rastreamento.js).
 *
 * Tabela NOSSA, alimentada pela importação do CSV do Matrix. `cod` é o código do
 * registro no relatório e é a chave: importar o mesmo período duas vezes atualiza
 * em vez de duplicar. `protocolo` é texto de propósito — 16 dígitos, às vezes com
 * zero à esquerda.
 */
export const RASTREAMENTO_DDL = `
  CREATE TABLE IF NOT EXISTS DB_Marketing.marketing_matrix_rastreamento (
    cod            BIGINT UNSIGNED NOT NULL PRIMARY KEY,
    titulo         VARCHAR(255) NULL,
    tipo           VARCHAR(20)  NULL,
    conta          VARCHAR(120) NULL,
    canal          VARCHAR(40)  NULL,
    contato        VARCHAR(255) NULL,
    telefone       VARCHAR(20)  NULL,
    classificacao  VARCHAR(255) NULL,
    data_acesso    DATETIME     NOT NULL,
    protocolo      VARCHAR(32)  NOT NULL,
    mensagem       TEXT         NULL,
    lote_id        INT UNSIGNED NULL,
    importado_em   DATETIME     NOT NULL,
    KEY idx_protocolo (protocolo),
    KEY idx_data (data_acesso)
  ) DEFAULT CHARSET = utf8mb4
`;

/** Uma linha por importação: quem subiu, quando, qual período e o que entrou. */
export const RASTREAMENTO_LOTES_DDL = `
  CREATE TABLE IF NOT EXISTS DB_Marketing.marketing_matrix_rastreamento_lotes (
    id             INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    arquivo        VARCHAR(255) NULL,
    linhas         INT UNSIGNED NOT NULL,
    novas          INT UNSIGNED NOT NULL,
    existentes     INT UNSIGNED NOT NULL,
    recusadas      INT UNSIGNED NOT NULL,
    periodo_de     DATE NULL,
    periodo_ate    DATE NULL,
    importado_por  VARCHAR(255) NULL,
    importado_em   DATETIME NOT NULL
  ) DEFAULT CHARSET = utf8mb4
`;

/**
 * `lote_id` e `importado_em` NÃO entram no UPDATE: ficam os da primeira vez que a
 * linha chegou, e dizem em que importação cada mensagem entrou.
 */
export const RASTREAMENTO_UPSERT_SQL = `
  INSERT INTO DB_Marketing.marketing_matrix_rastreamento
    (cod, titulo, tipo, conta, canal, contato, telefone, classificacao,
     data_acesso, protocolo, mensagem, lote_id, importado_em)
  VALUES ?
  ON DUPLICATE KEY UPDATE
    titulo = VALUES(titulo), tipo = VALUES(tipo), conta = VALUES(conta),
    canal = VALUES(canal), contato = VALUES(contato), telefone = VALUES(telefone),
    classificacao = VALUES(classificacao), data_acesso = VALUES(data_acesso),
    protocolo = VALUES(protocolo), mensagem = VALUES(mensagem)
`;

export const RASTREAMENTO_SQL = `
  SELECT r.cod,
         r.titulo,
         r.tipo,
         r.contato,
         r.telefone,
         r.classificacao,
         DATE_FORMAT(r.data_acesso, '%Y-%m-%d %H:%i:%s') AS data_acesso,
         r.protocolo,
         r.mensagem
  FROM DB_Marketing.marketing_matrix_rastreamento AS r
`;

export const RASTREAMENTO_LOTES_SQL = `
  SELECT id, arquivo, linhas, novas, existentes, recusadas,
         DATE_FORMAT(periodo_de, '%Y-%m-%d')  AS periodo_de,
         DATE_FORMAT(periodo_ate, '%Y-%m-%d') AS periodo_ate,
         importado_por,
         DATE_FORMAT(importado_em, '%Y-%m-%d %H:%i:%s') AS importado_em
  FROM DB_Marketing.marketing_matrix_rastreamento_lotes
  ORDER BY id DESC
  LIMIT 20
`;

/**
 * O desfecho dos leads no Matrix: as linhas do `db_matrix` dos protocolos que o
 * rastreamento trouxe.
 *
 * UM PROTOCOLO TEM VÁRIAS LINHAS — uma por trecho do atendimento (em set/2026,
 * 46 mil linhas para 31 mil protocolos). Por isso a consulta traz todas e o modelo
 * junta: venda em qualquer trecho conta, e atendente e classificação vêm do
 * último. Olhar uma linha só já produziu conclusão errada nesta tela.
 *
 * O `db_matrix` NÃO TEM o lead que só falou com o robô. Os dois fluxos que o
 * alimentam no n8n gravam só atendimento com atendente (`webhook_matrixgo`) e
 * só os tipos Humano e Misto finalizados (`backup_matrixgo`). Em set/2026, 805
 * dos 2.250 leads de anúncio não existem lá — e não é falha da junção.
 *
 * A coluna `protocolo` do `db_matrix` é bigint e não tem índice. A junção é pelo
 * número (o zero à esquerda do texto some no CAST), e a data limita a varredura.
 */
export const MATRIX_DOS_LEADS_SQL = `
  SELECT d.\`codigo\`           AS codigo,
         CAST(d.\`protocolo\` AS CHAR) AS protocolo,
         d.\`data_entrada\`     AS data_entrada,
         d.\`data_atendimento\` AS data_atendimento,
         d.\`data_finalizacao\` AS data_finalizacao,
         d.\`classificacao\`    AS classificacao,
         d.\`servico\`          AS servico,
         d.\`ativo_receptivo\`  AS ativo_receptivo,
         d.\`atendente\`        AS atendente,
         d.\`cpf\`              AS cpf
  FROM API_WebDeveloper.db_matrix AS d
  JOIN (SELECT DISTINCT CAST(protocolo AS UNSIGNED) AS p
        FROM DB_Marketing.marketing_matrix_rastreamento) AS r
    ON d.\`protocolo\` = r.p
  WHERE d.\`data_entrada\` >= (
    SELECT DATE_FORMAT(MIN(data_acesso) - INTERVAL 2 DAY, '%Y-%m-%d')
    FROM DB_Marketing.marketing_matrix_rastreamento
  )
`;
