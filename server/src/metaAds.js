/**
 * Carga automática do META ADS (Marketing API) para `DB_Marketing.marketing_meta_ads`.
 *
 * Substitui a exportação manual do Gerenciador de Anúncios. Lê as contas de
 * `META_AD_ACCOUNT_ID` com o token de USUÁRIO DO SISTEMA de `META_ACCESS_TOKEN`
 * (app campanhas-marketing-sebratel, permissão ads_read, sem expiração) e grava
 * por campanha + dia, sem duplicar — a chave da tabela é exatamente essa.
 *
 * SÓ CONEXÃO DE SAÍDA. O dashboard busca no graph.facebook.com; nada de fora
 * precisa entrar, então o proxy não é obstáculo.
 *
 * CADÊNCIA. A cada `REFRESH_META_MS` (padrão 3 h) reenvia os últimos
 * `META_DIAS` dias (padrão 7): o Meta revisa gasto, alcance e resultado de dias
 * recentes, e regravar a janela corrige isso. O histórico entra uma vez, pelo
 * botão/rota de sincronização com período.
 *
 * Sem token ou sem conta, nada roda e a tabela fica com a carga manual.
 */
import { config } from './config.js';
import * as maria from './db/maria.js';
import { janelas, linhaDaTabela } from './model/metaAds.js';

const CAMPOS_INSIGHTS = [
  'campaign_id', 'campaign_name', 'date_start', 'date_stop', 'reach', 'impressions',
  'frequency', 'spend', 'results', 'cost_per_result', 'attribution_setting',
].join(',');

export const metaConfigurado = () => Boolean(config.meta.token && config.meta.contas.length);

/** Uma chamada à Graph API, seguindo a paginação até o fim. */
async function graph(caminho, params) {
  const out = [];
  let url = new URL(`https://graph.facebook.com/${config.meta.versao}/${caminho}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, typeof v === 'string' ? v : JSON.stringify(v));
  for (let pagina = 0; pagina < 200 && url; pagina += 1) {
    // o token vai no cabeçalho, não na URL: URL acaba em log de proxy
    const r = await fetch(url, {
      headers: { Authorization: `Bearer ${config.meta.token}` },
      signal: AbortSignal.timeout(120000),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) {
      const e = j.error || {};
      throw new Error(`Meta API ${r.status} em ${caminho}: ${e.message || 'sem detalhe'} (code ${e.code ?? '?'}${e.error_subcode ? `/${e.error_subcode}` : ''})`);
    }
    out.push(...(j.data || []));
    url = j.paging?.next ? new URL(j.paging.next) : null;
  }
  return out;
}

/**
 * Estado, início e fim de cada campanha — os insights não trazem.
 *
 * A lista de estados é explícita porque, sem ela, a API omite as campanhas
 * ARQUIVADAS — e campanha arquivada é justamente a que tem histórico.
 */
async function campanhasDaConta(conta) {
  const lista = await graph(`${conta}/campaigns`, {
    fields: 'id,effective_status,start_time,stop_time',
    effective_status: ['ACTIVE', 'PAUSED', 'ARCHIVED', 'IN_PROCESS', 'WITH_ISSUES'],
    limit: 500,
  });
  return new Map(lista.map((c) => [String(c.id), c]));
}

/** As linhas da tabela de uma conta num período, já traduzidas. */
export async function buscarMeta(conta, de, ate) {
  const campanhas = await campanhasDaConta(conta);
  const linhas = [];
  for (const j of janelas(de, ate)) {
    const insights = await graph(`${conta}/insights`, {
      level: 'campaign',
      time_increment: 1,
      time_range: j,
      fields: CAMPOS_INSIGHTS,
      limit: 500,
    });
    for (const i of insights) linhas.push(linhaDaTabela(i, campanhas.get(String(i.campaign_id))));
  }
  return linhas;
}

const UPSERT = `
  INSERT INTO DB_Marketing.marketing_meta_ads
    (\`Nome da campanha\`, \`Identificação da campanha\`, \`Dia\`, \`Estado de apresentação\`,
     \`Nível de apresentação\`, \`Alcance\`, \`Impressões\`, \`Frequência\`, \`Definição de atribuição\`,
     \`Tipo de resultado\`, \`Resultados\`, \`Montante gasto (BRL)\`, \`Custo por resultado\`,
     \`Começa a\`, \`Termina a\`, \`Início dos relatórios\`, \`Fim dos relatórios\`, \`Resultados (iniciais)\`)
  VALUES ?
  ON DUPLICATE KEY UPDATE
    \`Nome da campanha\` = VALUES(\`Nome da campanha\`),
    \`Estado de apresentação\` = COALESCE(VALUES(\`Estado de apresentação\`), \`Estado de apresentação\`),
    \`Nível de apresentação\` = VALUES(\`Nível de apresentação\`),
    \`Alcance\` = VALUES(\`Alcance\`),
    \`Impressões\` = VALUES(\`Impressões\`),
    \`Frequência\` = VALUES(\`Frequência\`),
    \`Definição de atribuição\` = VALUES(\`Definição de atribuição\`),
    \`Tipo de resultado\` = VALUES(\`Tipo de resultado\`),
    \`Resultados\` = VALUES(\`Resultados\`),
    \`Montante gasto (BRL)\` = VALUES(\`Montante gasto (BRL)\`),
    \`Custo por resultado\` = VALUES(\`Custo por resultado\`),
    \`Começa a\` = COALESCE(VALUES(\`Começa a\`), \`Começa a\`),
    \`Termina a\` = COALESCE(VALUES(\`Termina a\`), \`Termina a\`),
    \`Início dos relatórios\` = VALUES(\`Início dos relatórios\`),
    \`Fim dos relatórios\` = VALUES(\`Fim dos relatórios\`)
`;

/** Grava em blocos de 500, por campanha + dia. Devolve quantas eram novas. */
export async function gravarMeta(linhas) {
  let novas = 0;
  for (let i = 0; i < linhas.length; i += 500) {
    const valores = linhas.slice(i, i + 500).map((l) => [
      l.nome, l.id, l.dia, l.estado, l.nivel, l.alcance, l.impressoes, l.frequencia, l.atribuicao,
      l.tipoResultado, l.resultados, l.gasto, l.custoPorResultado, l.inicio, l.fim,
      l.inicioRelatorio, l.fimRelatorio, '',
    ]);
    const { rows } = await maria.query(UPSERT, [valores]);
    const dup = Number(String(rows.info || '').match(/Duplicates:\s*(\d+)/i)?.[1] ?? 0);
    novas += valores.length - dup;
  }
  return { linhas: linhas.length, novas, existentes: linhas.length - novas };
}

const ontem = () => new Date(Date.now() - 864e5 - 3 * 3600e3).toISOString().slice(0, 10);
const diasAtras = (n) => new Date(Date.now() - n * 864e5 - 3 * 3600e3).toISOString().slice(0, 10);

/**
 * Sincroniza um período (padrão: os últimos `META_DIAS` dias, sem hoje).
 * Hoje fica de fora porque o dia corrente está incompleto e entraria com gasto
 * parcial até a próxima rodada.
 */
export async function sincronizarMeta({ de = null, ate = null } = {}) {
  if (!metaConfigurado()) return { pulado: 'META_ACCESS_TOKEN ou META_AD_ACCOUNT_ID ausente' };
  const fim = ate || ontem();
  const inicio = de || diasAtras(config.meta.dias);
  const t0 = Date.now();
  const porConta = {};
  let todas = [];
  for (const conta of config.meta.contas) {
    const linhas = await buscarMeta(conta, inicio, fim);
    porConta[conta] = { linhas: linhas.length, gasto: Math.round(linhas.reduce((s, l) => s + (l.gasto || 0), 0) * 100) / 100 };
    todas = todas.concat(linhas);
  }
  const gravado = todas.length ? await gravarMeta(todas) : { linhas: 0, novas: 0, existentes: 0 };
  return { de: inicio, ate: fim, ...gravado, porConta, ms: Date.now() - t0 };
}
