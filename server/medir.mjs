/**
 * Onde está a memória. Roda a carga inteira e mede cada balde: contagem de linhas e
 * tamanho aproximado em bytes (JSON, que é uma boa proxy para comparar entre si).
 *
 * Uso: node --expose-gc medir.mjs
 */
import { refreshAll } from './src/etl/refresh.js';
import { getState } from './src/model/store.js';
import { getEstadoCondominios } from './src/model/condominios.js';
import { getEstadoLeads } from './src/model/leads.js';
import { getEstadoRelatorios } from './src/model/relatorios.js';

const mb = (n) => `${(n / 1024 / 1024).toFixed(1)} MB`;

/** Tamanho aproximado: JSON do balde. Serializa em blocos para não estourar string. */
function tamanho(arr) {
  if (!Array.isArray(arr) || !arr.length) return 0;
  let total = 0;
  const passo = 5000;
  for (let i = 0; i < arr.length; i += passo) {
    total += JSON.stringify(arr.slice(i, i + passo)).length;
  }
  return total;
}

console.log('carregando tudo…');
await refreshAll();
await new Promise((r) => setTimeout(r, 1500));

const s = getState();
const c = getEstadoCondominios();
const l = getEstadoLeads();
const r = getEstadoRelatorios();

const baldes = [
  ['store.raw.base', s.raw.base],
  ['store.raw.aloc', s.raw.aloc],
  ['store.raw.pagto', s.raw.pagto],
  ['store.raw.phone', s.raw.phone],
  ['store.raw.sellers', s.raw.sellers],
  ['store.raw.teams', s.raw.teams],
  ['store.raw.senior', s.raw.senior],
  ['store.facts (derivado)', s.facts],
  ['condominios.fatos', c.fatos],
  ['condominios.splitters', c.splitters],
  ['leads.leads', l.leads],
  ['leads.negociacoes', l.negociacoes],
  // NAO entra na soma: aponta para os mesmos objetos de store.facts
  // ['relatorios.fatos', r.fatos],
  ['relatorios.cesta', r.cesta],
  ['relatorios.pesquisa', r.pesquisa],
  ['relatorios.base', r.base],
  ['relatorios.fila', r.fila],
  ['relatorios.clima', r.clima],
  ['leads.RAW.leads', l.raw?.leads],
  // `raw.negociacoes` e `negociacoes` sao o MESMO array agora: nao soma
  // agora `raw.portas` E `fatos` sao o MESMO array, e ocupacao virou Map: nao soma
];

let soma = 0;
console.log('\nbalde                          linhas        tamanho');
console.log('-'.repeat(58));
for (const [nome, arr] of baldes) {
  const t = tamanho(arr);
  soma += t;
  const n = Array.isArray(arr) ? arr.length : 0;
  console.log(`${nome.padEnd(30)} ${String(n).padStart(7)}  ${mb(t).padStart(12)}`);
}
console.log('-'.repeat(58));
console.log(`${'soma dos baldes'.padEnd(30)} ${''.padStart(7)}  ${mb(soma).padStart(12)}`);

// forca a coleta antes de medir: sem isso o numero varia com o humor do GC
if (global.gc) { global.gc(); await new Promise((r) => setTimeout(r, 300)); global.gc(); }
const m = process.memoryUsage();
console.log(`\nheap usado: ${mb(m.heapUsed)} | heap total: ${mb(m.heapTotal)} | residente: ${mb(m.rss)}`);

// as fontes brutas dos outros tres modelos nao sao expostas; conta pelo relatorio
console.log('\nlinhas por fonte, como o ETL informou:');
for (const [nome, info] of Object.entries({ ...s.sources, ...c.fontes, ...l.fontes, ...r.fontes })) {
  console.log(`  ${nome.padEnd(16)} ${String(info.rows ?? '?').padStart(7)} linhas  ${info.ms ?? '?'}ms`);
}
process.exit(0);
