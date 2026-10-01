/**
 * Motor de horas úteis do SLA do BKO.
 *
 * REGRA (escopo técnico do SLA BKO, expediente/plantão do Backoffice):
 *   segunda a sexta ... 08:00–21:00  (13 h)
 *   sábado ............ 08:00–17:00  (9 h)
 *   feriado ........... 08:00–17:00  (9 h, plantão — o tempo NÃO pausa)
 *   domingo ........... não conta    (inclusive domingo que cai em feriado)
 *
 * É a mesma régua da tabela `Calendario` do Power BI. Feriado vem de `feriados.js`
 * (calculados + cadastrados pelo admin em Configurações → Feriados).
 *
 * TEMPO É "PAREDE", SEM FUSO. As datas chegam como texto 'YYYY-MM-DD HH:MM:SS' no
 * horário de Brasília (Voalle via to_char, Data Hub já vem assim). Aqui elas viram
 * minutos de um relógio fictício em UTC, que só serve para subtrair: nada passa por
 * `new Date(texto local)`, então o fuso da máquina (Windows do analista ou o
 * container) não mexe no resultado.
 */
import { conjuntoFeriados } from '../feriados.js';

const RE = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?/;
// o `aprovado_em` do uMov vem no formato brasileiro: '21/09/2026 20:50'
const RE_BR = /^(\d{2})\/(\d{2})\/(\d{4})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?/;

/** Qualquer um dos dois formatos → 'YYYY-MM-DD HH:MM:SS'. `null` se não for data. */
export function normalizarData(texto) {
  if (!texto) return null;
  const t = String(texto).trim();
  let m = RE.exec(t);
  if (m) {
    const [, a, me, d, h = '00', mi = '00', s = '00'] = m;
    return `${a}-${me}-${d} ${h}:${mi}:${s}`;
  }
  m = RE_BR.exec(t);
  if (m) {
    const [, d, me, a, h = '00', mi = '00', s = '00'] = m;
    return `${a}-${me}-${d} ${h}:${mi}:${s}`;
  }
  return null;
}

/** Texto local → minutos (relógio fictício). `null` se não for data. */
export function paraMinutos(texto) {
  const n = normalizarData(texto);
  if (!n) return null;
  const m = RE.exec(n);
  const [, a, me, d, h = '0', mi = '0', s = '0'] = m;
  const ms = Date.UTC(+a, +me - 1, +d, +h, +mi, +s);
  return Number.isNaN(ms) ? null : ms / 60000;
}

/** Minutos → texto 'YYYY-MM-DD HH:MM:SS' no mesmo relógio. */
export function deMinutos(min) {
  return new Date(min * 60000).toISOString().slice(0, 19).replace('T', ' ');
}

/** "Agora" no horário de Brasília, como texto — o fim de quem ainda está em aberto. */
export function agoraLocal(agora = new Date()) {
  const partes = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  }).formatToParts(agora).reduce((o, p) => ({ ...o, [p.type]: p.value }), {});
  return `${partes.year}-${partes.month}-${partes.day} ${partes.hour}:${partes.minute}:${partes.second}`;
}

const DIA = 1440;

/** Cache de feriados por ano: o cálculo roda dezenas de milhares de vezes por carga. */
let cacheFeriados = { chave: null, conjunto: new Set() };
function feriadosEntre(anoDe, anoAte) {
  const chave = `${anoDe}-${anoAte}`;
  if (cacheFeriados.chave !== chave) {
    cacheFeriados = { chave, conjunto: conjuntoFeriados(`${anoDe}-01-01`, `${anoAte}-12-31`) };
  }
  return cacheFeriados.conjunto;
}
/** Chamado a cada reconstrução do modelo, para pegar feriado cadastrado há pouco. */
export function esquecerFeriados() { cacheFeriados = { chave: null, conjunto: new Set() }; }

/**
 * Janela de expediente de um dia, em minutos a partir da meia-noite.
 * `semana`: 0 = domingo … 6 = sábado.
 */
export function janelaDoDia(isoData, semana, feriados) {
  if (semana === 0) return null;                       // domingo: pausa, vence o feriado
  if (feriados.has(isoData)) return [8 * 60, 17 * 60]; // plantão
  if (semana === 6) return [8 * 60, 17 * 60];          // sábado
  return [8 * 60, 21 * 60];                            // segunda a sexta
}

/**
 * Horas úteis entre dois instantes (texto local). Devolve `null` se faltar uma das
 * pontas ou se o fim vier antes do início — um intervalo negativo é dado
 * inconsistente, e zerá-lo esconderia o problema dentro da média.
 */
export function horasUteis(inicio, fim, { feriados = null } = {}) {
  const a = paraMinutos(inicio);
  const b = paraMinutos(fim);
  if (a === null || b === null || b < a) return null;
  if (a === b) return 0;
  const conj = feriados || feriadosEntre(
    new Date(a * 60000).getUTCFullYear(), new Date(b * 60000).getUTCFullYear(),
  );

  let total = 0;
  for (let dia = Math.floor(a / DIA) * DIA; dia < b; dia += DIA) {
    const d = new Date(dia * 60000);
    const janela = janelaDoDia(d.toISOString().slice(0, 10), d.getUTCDay(), conj);
    if (!janela) continue;
    const ini = Math.max(a, dia + janela[0]);
    const fi = Math.min(b, dia + janela[1]);
    if (fi > ini) total += fi - ini;
  }
  // 6 casas: o CSV mostra hh:mm:ss, e 3 casas (3,6 s) erravam o segundo
  return Math.round((total / 60) * 1e6) / 1e6;
}

/** Horas de relógio (sem expediente) — usado só para conferência e diagnóstico. */
export function horasCorridas(inicio, fim) {
  const a = paraMinutos(inicio);
  const b = paraMinutos(fim);
  if (a === null || b === null) return null;
  return Math.round(((b - a) / 60) * 1000) / 1000;
}
