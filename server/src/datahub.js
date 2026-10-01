/**
 * Leitura dos conjuntos do Data Hub (endpoint público com token).
 *
 * Três cuidados que vêm do registro da correção do SLA BKO no Data Hub:
 *  1. O token vai na query string. A URL completa NUNCA vai para log nem para
 *     mensagem de erro — só o slug do conjunto.
 *  2. Colunas BIGINT chegam como TEXTO ("rodadas":"1") para não perder precisão.
 *     Quem soma sem converter recebe concatenação de string, sem erro nenhum.
 *  3. Paginação por limit/offset: o fim é a primeira página vazia (ou o `total`).
 */
import { config } from './config.js';

const PAGINA = 5000;
const TIMEOUT_MS = 60000;

/** Campos BIGINT de cada conjunto, que chegam como texto. */
const NUMERICOS = {
  'umovme-ciclos-bko': ['rodadas', 'reenvios', 'devolucoes', 'qtd_vendedores', 'qtd_analistas'],
  'umuvme-sls-bko': ['qtd_envios'],
};

function numerar(slug, linha) {
  for (const c of NUMERICOS[slug] || []) {
    if (linha[c] !== null && linha[c] !== undefined && linha[c] !== '') linha[c] = Number(linha[c]);
  }
  return linha;
}

async function pagina(slug, offset) {
  const url = `${config.datahub.url}/${slug}/rows?limit=${PAGINA}&offset=${offset}`
    + `&token=${encodeURIComponent(config.datahub.token)}`;
  let res;
  try {
    res = await fetch(url, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch (err) {
    const causa = err.cause?.code || err.cause?.message || err.name;
    throw new Error(`Data Hub (${slug}) inacessível: ${causa}`);
  }
  if (res.status === 401 || res.status === 403) {
    throw new Error(`Data Hub (${slug}) recusou o token (HTTP ${res.status}) — confira DATAHUB_TOKEN`);
  }
  if (!res.ok) {
    // o corpo da resposta diz o motivo (ex.: conjunto sendo re-materializado); o token
    // nunca aparece na mensagem, nem que o servidor o devolva
    let motivo = '';
    try { motivo = (await res.text()).replace(config.datahub.token || '\u0000', '***').replace(/\s+/g, ' ').slice(0, 200); } catch { /* sem corpo */ }
    const erro = new Error(`Data Hub (${slug}) respondeu HTTP ${res.status}${motivo ? `: ${motivo}` : ''}`);
    erro.status = res.status;
    throw erro;
  }
  return res.json();
}

/** Uma nova tentativa, 15 s depois, para erro passageiro (re-materialização em curso). */
async function paginaComRetentativa(slug, offset) {
  try {
    return await pagina(slug, offset);
  } catch (err) {
    if (!err.status || err.status === 401 || err.status === 403) throw err;
    await new Promise((r) => setTimeout(r, 15000));
    return pagina(slug, offset);
  }
}

/** Conjunto inteiro, já com os numéricos convertidos. */
export async function lerConjunto(slug) {
  if (!config.datahub.token) throw new Error('DATAHUB_TOKEN não configurado no .env');
  const inicio = Date.now();
  const linhas = [];
  let total = null;
  for (let offset = 0; ; offset += PAGINA) {
    const corpo = await paginaComRetentativa(slug, offset);
    const rows = Array.isArray(corpo) ? corpo : (corpo.rows || []);
    if (total === null && Number.isFinite(Number(corpo.total))) total = Number(corpo.total);
    for (const r of rows) linhas.push(numerar(slug, r));
    if (rows.length < PAGINA) break;
    if (total !== null && linhas.length >= total) break;
  }
  return { rows: linhas, ms: Date.now() - inicio, total };
}
