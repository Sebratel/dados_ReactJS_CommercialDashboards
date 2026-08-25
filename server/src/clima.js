/**
 * Chuva por cidade e por dia — a única fonte do dashboard que não é banco nosso.
 *
 * Vem da Open-Meteo, como no relatório de origem: dois endpoints públicos, sem chave
 * e sem cadastro. Só latitude e longitude saem daqui; nenhum dado nosso viaja.
 *
 *   archive  — histórico fechado, do começo do ano até ontem
 *   forecast — previsão dos próximos 16 dias
 *
 * Por que a tela de vendas quer isso: instalação de fibra é serviço de rua. Dia de
 * chuva forte derruba ativação, e a matriz de clima ao lado da meta explica um dia
 * ruim sem que ninguém precise procurar a explicação.
 *
 * TRÊS DECISÕES QUE VALE REGISTRAR
 * 1. O histórico começa em 1º de janeiro do ANO CORRENTE. Na origem é a constante
 *    '2026-01-01', que envelhece: em 2027 aquele relatório continuaria trazendo 2026.
 * 2. Uma busca por dia, guardada em disco. Chuva de ontem não muda, e a previsão de
 *    hoje não melhora se pedirmos de dez em dez minutos — seria bater numa API de
 *    terceiro sem ganho nenhum.
 * 3. Falha aqui NÃO derruba tela. Se a Open-Meteo não responder, o modelo fica sem
 *    clima e a matriz diz isso; o resto do Relatório Diário não depende dela.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const arquivo = () => (process.env.CLIMA_PATH
  ? path.resolve(process.env.CLIMA_PATH)
  : path.resolve(__dirname, '../data/clima.json'));

/** As sete cidades do relatório de origem, com as coordenadas de lá. */
export const CIDADES = [
  { nome: 'Porto Alegre', lat: '-30.0346', lon: '-51.2177' },
  { nome: 'Canoas', lat: '-29.9178', lon: '-51.1839' },
  { nome: 'Esteio', lat: '-29.8567', lon: '-51.1758' },
  { nome: 'Sapucaia do Sul', lat: '-29.8333', lon: '-51.1500' },
  { nome: 'São Leopoldo', lat: '-29.7608', lon: '-51.1483' },
  { nome: 'Novo Hamburgo', lat: '-29.6783', lon: '-51.1303' },
  { nome: 'Cachoeirinha', lat: '-29.9533', lon: '-51.0939' },
];

const FUSO = 'America/Sao_Paulo';

/**
 * Faixas de chuva da origem, em milímetros no dia. Os rótulos são texto, não emoji:
 * o relatório usa ☀️/⛅/🌧️/⛈️ e emoji renderiza diferente por sistema e desalinha
 * a linha da tabela. O ícone é desenhado na tela, a partir desta classificação.
 */
export function classificarChuva(mm) {
  if (mm === null || mm === undefined || Number.isNaN(Number(mm))) return 'Sem medida';
  const v = Number(mm);
  if (v === 0) return 'Sem chuva';
  if (v < 5) return 'Fraca';
  if (v < 20) return 'Moderada';
  return 'Forte';
}

const hojeISO = () => new Date().toISOString().slice(0, 10);
const ontemISO = () => {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
};

async function buscarJson(url, timeoutMs = 20000) {
  const parar = AbortSignal.timeout(timeoutMs);
  const res = await fetch(url, { signal: parar, headers: { 'Accept-Encoding': 'identity' } });
  if (!res.ok) throw new Error(`HTTP ${res.status} em ${new URL(url).host}`);
  return res.json();
}

function linhasDe(dados, cidade, tipo) {
  const dias = dados?.daily?.time || [];
  const chuva = dados?.daily?.precipitation_sum || [];
  const prob = dados?.daily?.precipitation_probability_max || [];
  return dias.map((data, i) => ({
    cidade,
    data,
    tipo,
    mm: chuva[i] ?? null,
    probabilidade: prob[i] ?? null,
    classificacao: classificarChuva(chuva[i]),
  }));
}

/**
 * Busca as duas séries das sete cidades e junta.
 *
 * Onde histórico e previsão se sobrepõem, a PREVISÃO ganha — é o que a origem faz, e
 * faz sentido: para o dia de hoje o arquivo histórico ainda não fechou.
 */
export async function buscarClima() {
  const inicio = `${hojeISO().slice(0, 4)}-01-01`;
  const fim = ontemISO();
  const linhas = [];
  const falhas = [];

  for (const c of CIDADES) {
    const comum = `latitude=${c.lat}&longitude=${c.lon}&timezone=${encodeURIComponent(FUSO)}`;
    try {
      const hist = await buscarJson(
        `https://archive-api.open-meteo.com/v1/archive?${comum}&start_date=${inicio}&end_date=${fim}&daily=precipitation_sum`,
      );
      linhas.push(...linhasDe(hist, c.nome, 'Histórico'));
    } catch (err) {
      falhas.push(`${c.nome} (histórico): ${err.message}`);
    }
    try {
      const prev = await buscarJson(
        `https://api.open-meteo.com/v1/forecast?${comum}&daily=precipitation_sum,precipitation_probability_max&forecast_days=16`,
      );
      linhas.push(...linhasDe(prev, c.nome, 'Previsão'));
    } catch (err) {
      falhas.push(`${c.nome} (previsão): ${err.message}`);
    }
  }

  const porChave = new Map();
  for (const l of linhas) {
    const k = `${l.cidade}|${l.data}`;
    // previsão sobrepõe histórico no mesmo dia
    if (!porChave.has(k) || l.tipo === 'Previsão') porChave.set(k, l);
  }
  const resultado = [...porChave.values()].sort((a, b) => (
    a.data.localeCompare(b.data) || a.cidade.localeCompare(b.cidade)));

  if (!resultado.length) throw new Error(falhas[0] || 'a Open-Meteo não devolveu nada');
  return { linhas: resultado, falhas, buscadoEm: new Date().toISOString(), inicio, fim };
}

let cache = null;

function lerDisco() {
  try {
    const p = arquivo();
    if (!fs.existsSync(p)) return null;
    const raw = fs.readFileSync(p, 'utf8').trim();
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function gravarDisco(dados) {
  try {
    const p = arquivo();
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, `${JSON.stringify(dados)}\n`, 'utf8');
  } catch (err) {
    console.warn(`[clima] não foi possível guardar em disco: ${err.message}`);
  }
}

/** O que o modelo lê. Nunca lança: sem clima, a tela mostra a ausência. */
export function clima() {
  if (!cache) cache = lerDisco();
  return cache || { linhas: [], falhas: [], buscadoEm: null, erro: null };
}

/** Uma passada. Só vai à rede se o cache do dia já não estiver em mãos. */
export async function atualizarClima({ forcar = false } = {}) {
  const atual = clima();
  const doDia = atual.buscadoEm && atual.buscadoEm.slice(0, 10) === hojeISO();
  if (doDia && !forcar) return atual;
  try {
    const novo = await buscarClima();
    cache = { ...novo, erro: null };
    gravarDisco(cache);
    const aviso = novo.falhas.length ? ` (${novo.falhas.length} busca(s) falharam)` : '';
    console.log(`[clima] ${novo.linhas.length} dias-cidade de ${novo.inicio} a +16d${aviso}`);
    return cache;
  } catch (err) {
    // mantém o que já havia: clima de ontem é melhor que nenhum
    cache = { ...atual, erro: err.message };
    console.error(`[clima] falhou: ${err.message}`);
    return cache;
  }
}
