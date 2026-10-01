/**
 * Leitura dos conjuntos do Data Hub (endpoint público com token).
 *
 * Quatro cuidados que vêm do registro da correção do SLA BKO no Data Hub:
 *  1. O token vai na query string. A URL completa NUNCA vai para log nem para
 *     mensagem de erro — só o slug do conjunto. E o corpo da resposta também é
 *     limpo, porque um proxy que ecoa a URL devolve o token de volta.
 *  2. Colunas BIGINT chegam como TEXTO ("rodadas":"1") para não perder precisão.
 *     Quem soma sem converter recebe concatenação de string, sem erro nenhum.
 *  3. Paginação por limit/offset: o fim é a primeira página vazia (ou o `total`).
 *  4. Num 401/403, o erro diz QUEM recusou — a API ou um proxy no caminho. Ver
 *     `explicar`: é a diferença entre trocar o token e trocar o DATAHUB_URL, e
 *     ela já custou duas investigações inteiras no lado errado.
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

/**
 * O corpo da resposta, sempre sem o token.
 *
 * O token vai na query string, então o servidor pode devolvê-lo de volta (um
 * nginx que ecoa a URL na página de erro faz isso). `split/join` troca TODAS as
 * ocorrências — `String.replace` com texto troca só a primeira.
 */
async function corpoSeguro(res) {
  try {
    const bruto = await res.text();
    const limpo = config.datahub.token ? bruto.split(config.datahub.token).join('***') : bruto;
    return limpo.replace(/\s+/g, ' ').trim().slice(0, 200);
  } catch {
    return '';
  }
}

/**
 * QUEM RECUSOU: a API, ou alguém no caminho até ela?
 *
 * É a única pergunta que importa num 401/403, e a resposta está no formato do
 * corpo. A API do Data Hub responde SEMPRE em JSON (`{"error":"Token inválido ou
 * revogado."}`). Um proxy responde HTML. Então corpo que não é JSON quer dizer
 * que o Data Hub nem foi consultado — e o token está inocente.
 *
 * Isto existe porque a versão anterior lançava `confira DATAHUB_TOKEN` antes de
 * ler o corpo, e jogava fora justamente a prova que separa as duas coisas. Em
 * 14/09/2026 o mesmo sintoma custou uma investigação inteira de credencial no
 * Dashboard_IA: o openresty de `data-hub.sebratel.net.br` bloqueia por ORIGEM,
 * e devolvia 403 para o servidor enquanto a mesma chamada passava de fora.
 */
function explicar(res, motivo) {
  const tipo = (res.headers.get('content-type') || '').toLowerCase();
  const pareceJson = tipo.includes('json') || motivo.startsWith('{') || motivo.startsWith('[');

  if (!pareceJson) {
    return `HTTP ${res.status} com corpo que NÃO é JSON — quem respondeu não foi a API, `
      + 'foi um proxy no caminho. O token não é o problema: confira DATAHUB_URL '
      + '(o nome público bloqueia por origem; de servidor a servidor use o endereço interno) '
      + `e a saída de rede do contêiner.${motivo ? ` Corpo: ${motivo}` : ''}`;
  }
  if (res.status === 401 || res.status === 403) {
    return `recusou o token (HTTP ${res.status}): ${motivo} — confira DATAHUB_TOKEN `
      + 'e se o escopo dele cobre este conjunto.';
  }
  return `respondeu HTTP ${res.status}${motivo ? `: ${motivo}` : ''}`;
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
  if (!res.ok) {
    const motivo = await corpoSeguro(res);
    const erro = new Error(`Data Hub (${slug}) ${explicar(res, motivo)}`);
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
