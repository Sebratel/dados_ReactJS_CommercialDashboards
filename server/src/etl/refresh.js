import { config } from '../config.js';
import { queryFile } from '../db/pg.js';
import * as maria from '../db/maria.js';
import { SENIOR_SQL, TEAMS_SQL } from '../sql/maria.js';
import { build, mergeSource, setSource, setSourceError } from '../model/store.js';

/**
 * Três cadências:
 *  - hot   : janela dos últimos N dias (consultas leves) -> vendas, ativações e
 *            primeiro pagamento ficam quase em tempo real
 *  - full  : recarga completa desde DATA_SINCE (corrige qualquer alteração
 *            retroativa)
 *  - dims  : equipes, RH e usuários
 */
function corte() {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - config.incrementalDays);
  return d.toISOString().slice(0, 10);
}

const SOURCES = {
  // --- recarga completa ---
  base: { grupo: 'full', alvo: 'base', run: () => queryFile('base', [config.since]) },
  aloc: { grupo: 'full', alvo: 'aloc', run: () => queryFile('aloc', [config.since]) },
  pagto: { grupo: 'full', alvo: 'pagto', run: () => queryFile('pagto', [config.since]) },

  // --- janela incremental (rápida) ---
  baseInc: { grupo: 'hot', alvo: 'base', incremental: true, run: () => queryFile('base', [corte()]) },
  alocInc: { grupo: 'hot', alvo: 'aloc', incremental: true, run: () => queryFile('aloc', [corte()]) },
  pagtoInc: { grupo: 'hot', alvo: 'pagto', incremental: true, run: () => queryFile('pagto', [corte()]) },
  phone: { grupo: 'hot', alvo: 'phone', run: () => queryFile('phone', [config.phoneSince]) },

  // --- cadastros ---
  sellers: { grupo: 'dims', alvo: 'sellers', run: () => queryFile('sellers', []) },
  teams: { grupo: 'dims', alvo: 'teams', run: () => maria.query(TEAMS_SQL) },
  senior: { grupo: 'dims', alvo: 'senior', run: () => maria.query(SENIOR_SQL) },
};

const rodando = new Set();
let rebuildTimer = null;

function agendarRebuild() {
  if (rebuildTimer) return;
  rebuildTimer = setTimeout(() => {
    rebuildTimer = null;
    try {
      const s = build();
      console.log(`[etl] modelo reconstruído: ${s.facts.length} contratos · ${s.sellersByName.size} vendedores no RH · ${s.teamsByName.size} em equipes (${s.buildMs}ms, v${s.version})`);
    } catch (err) {
      console.error('[etl] falha ao reconstruir o modelo:', err);
    }
  }, 250);
}

export async function refreshSource(nome) {
  const src = SOURCES[nome];
  if (!src || rodando.has(nome)) return;
  rodando.add(nome);
  try {
    const { rows, ms } = await src.run();
    if (src.incremental) {
      mergeSource(src.alvo, rows, { ms, cutoff: corte() });
      console.log(`[etl] ${nome}: +${rows.length} linhas (janela ${config.incrementalDays}d) em ${ms}ms`);
    } else {
      setSource(src.alvo, rows, { ms });
      console.log(`[etl] ${nome}: ${rows.length} linhas em ${ms}ms`);
    }
    agendarRebuild();
  } catch (err) {
    setSourceError(src.alvo, err);
    console.error(`[etl] ${nome} falhou:`, err.message);
  } finally {
    rodando.delete(nome);
  }
}

export async function refreshGroup(grupo) {
  const nomes = Object.keys(SOURCES).filter((n) => SOURCES[n].grupo === grupo);
  await Promise.all(nomes.map(refreshSource));
}

/** Carga inicial: completa + cadastros. */
export async function refreshAll() {
  await Promise.all([refreshGroup('dims'), refreshGroup('full'), refreshSource('phone')]);
}

export function startScheduler() {
  const grupos = {
    hot: config.refresh.hot,
    full: config.refresh.full,
    dims: config.refresh.dims,
  };
  for (const [grupo, intervalo] of Object.entries(grupos)) {
    if (!intervalo || intervalo <= 0) continue;
    const t = setInterval(() => {
      refreshGroup(grupo).catch((err) => console.error(`[etl] grupo ${grupo}:`, err.message));
    }, intervalo);
    t.unref?.();
    console.log(`[etl] grupo "${grupo}" atualiza a cada ${Math.round(intervalo / 1000)}s`);
  }
}
