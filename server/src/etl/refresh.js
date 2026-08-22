import { config } from '../config.js';
import { queryFile } from '../db/pg.js';
import * as maria from '../db/maria.js';
import { SENIOR_SQL, TEAMS_SQL } from '../sql/maria.js';
import { build, mergeSource, setSource, setSourceError } from '../model/store.js';
import {
  construirCondominios, setFonteCondominios, setFonteErroCondominios,
} from '../model/condominios.js';
import { construirLeads, setFonteErroLeads, setFonteLeads } from '../model/leads.js';

/**
 * Quatro cadências:
 *  - hot   : janela dos últimos N dias (consultas leves) -> vendas, ativações e
 *            primeiro pagamento ficam quase em tempo real
 *  - full  : recarga completa desde DATA_SINCE (corrige qualquer alteração
 *            retroativa)
 *  - dims  : equipes, RH e usuários
 *  - cond  : splitters de condomínio e a ocupação das portas (modelo próprio,
 *            em `model/condominios.js`)
 *  - crm   : leads e negociações (modelo próprio, em `model/leads.js`)
 */
function corte() {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - config.incrementalDays);
  const janela = d.toISOString().slice(0, 10);
  // a carga incremental não pode puxar mais histórico do que o recorte permite:
  // desde que o recorte virou configurável, ele pode ser mais estreito que 60 dias
  return janela < config.since ? config.since : janela;
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

  // --- condomínios (modelo próprio) ---
  // Sem recorte por data: a rede de splitters é um retrato do agora, e um
  // splitter instalado em 2019 continua valendo hoje. Recarga completa mesmo.
  splitters: { grupo: 'cond', destino: 'condominios', alvo: 'portas', run: () => queryFile('splitters', []) },
  ocupacao: { grupo: 'cond', destino: 'condominios', alvo: 'ocupacao', run: () => queryFile('splitter_ocupacao', []) },

  // --- CRM: leads e negociações (modelo próprio) ---
  leads: { grupo: 'crm', destino: 'leads', alvo: 'leads', run: () => queryFile('leads', [config.crmSince]) },
  negociacoes: { grupo: 'crm', destino: 'leads', alvo: 'negociacoes', run: () => queryFile('negotiations', [config.crmSince]) },
};

const rodando = new Map();
const rebuildTimers = {};

/**
 * Para onde vai o resultado de cada fonte. Existem dois modelos em memória —
 * o comercial e o de condomínios — e eles não se cruzam; o `destino` diz qual
 * dos dois recebe as linhas e qual deles precisa ser reconstruído.
 */
const DESTINOS = {
  comercial: {
    set: setSource,
    merge: mergeSource,
    erro: setSourceError,
    construir: build,
    resumo: (s) => `${s.facts.length} contratos · ${s.sellersByName.size} vendedores no RH · ${s.teamsByName.size} em equipes`,
  },
  condominios: {
    set: setFonteCondominios,
    erro: setFonteErroCondominios,
    construir: construirCondominios,
    resumo: (s) => `${s.fatos.length} portas em ${s.splitters.length} splitters · ${s.dims.condominios.length} condomínios`,
  },
  leads: {
    set: setFonteLeads,
    erro: setFonteErroLeads,
    construir: construirLeads,
    resumo: (s) => `${s.leads.length} leads · ${s.negociacoes.length} negociações · ${s.vendedores.length} vendedores`,
  },
};

const destinoDe = (src) => DESTINOS[src.destino || 'comercial'];

/**
 * Assinatura do recorte em vigor. Uma consulta de carga completa leva dezenas de
 * segundos; se o recorte mudar nesse meio-tempo, o resultado que chega é de outro
 * recorte e não pode entrar no cache — antes disso, a consulta velha terminava
 * depois da nova e sobrescrevia tudo, com a tela informando sucesso.
 */
const assinaturaJanela = () => `${config.since}|${config.phoneSince}|${config.crmSince}`;

/**
 * Quais modelos recebem recorte de data por parâmetro. Só para estes vale
 * descartar um resultado que chegou depois de o admin mexer na janela — o de
 * condomínios não tem recorte nenhum, e descartar a carga dele por causa disso
 * seria refazer 60 s de consulta por nada.
 */
const SENSIVEL_A_JANELA = new Set(['comercial', 'leads']);

function agendarRebuild(chave) {
  if (rebuildTimers[chave]) return;
  rebuildTimers[chave] = setTimeout(() => {
    rebuildTimers[chave] = null;
    const destino = DESTINOS[chave];
    try {
      const s = destino.construir();
      console.log(`[etl] modelo ${chave} reconstruído: ${destino.resumo(s)} (${s.buildMs}ms, v${s.version ?? s.versao})`);
    } catch (err) {
      console.error(`[etl] falha ao reconstruir o modelo ${chave}:`, err);
    }
  }, 250);
}

/** Uma passada na fonte. Devolve true se o resultado foi descartado e precisa refazer. */
async function executar(nome, src) {
  const chave = src.destino || 'comercial';
  const destino = destinoDe(src);
  const janela = assinaturaJanela();
  try {
    const { rows, ms } = await src.run();
    if (SENSIVEL_A_JANELA.has(chave) && assinaturaJanela() !== janela) {
      console.log(`[etl] ${nome}: resultado descartado — o recorte mudou durante a consulta`);
      return true;
    }
    if (src.incremental) {
      destino.merge(src.alvo, rows, { ms, cutoff: corte() });
      console.log(`[etl] ${nome}: +${rows.length} linhas (janela ${config.incrementalDays}d) em ${ms}ms`);
    } else {
      destino.set(src.alvo, rows, { ms });
      console.log(`[etl] ${nome}: ${rows.length} linhas em ${ms}ms`);
    }
    agendarRebuild(chave);
    return false;
  } catch (err) {
    destino.erro(src.alvo, err);
    console.error(`[etl] ${nome} falhou:`, err.message);
    return false;
  }
}

/**
 * Quem pede uma fonte que já está em execução passa a ESPERAR a que está rodando,
 * em vez de receber um retorno imediato como se tivesse recarregado. Sem isso, uma
 * troca de recorte durante uma carga longa respondia "concluído" na hora e o cache
 * acabava com os dados do recorte anterior.
 */
export async function refreshSource(nome) {
  const src = SOURCES[nome];
  if (!src) return;
  const emCurso = rodando.get(nome);
  if (emCurso) return emCurso;

  const promessa = (async () => {
    // no máximo 3 voltas: protege contra alterações em sequência virarem laço
    for (let volta = 0; volta < 3; volta += 1) {
      if (!await executar(nome, src)) return;
    }
    console.warn(`[etl] ${nome}: recorte mudou 3 vezes seguidas, desistindo desta rodada`);
  })();

  rodando.set(nome, promessa);
  try {
    await promessa;
  } finally {
    rodando.delete(nome);
  }
}

export async function refreshGroup(grupo) {
  const nomes = Object.keys(SOURCES).filter((n) => SOURCES[n].grupo === grupo);
  await Promise.all(nomes.map(refreshSource));
}

/**
 * Carga inicial: completa + cadastros + condomínios + CRM.
 *
 * `dims` primeiro e sozinho: o modelo de leads lê a equipe do vendedor de
 * `teamsByName`, que é construído por ele. Rodando em paralelo, a primeira
 * montagem dos leads sairia sem equipe nenhuma e só se corrigiria no ciclo
 * seguinte — quinze minutos de tela com o filtro de equipe vazio.
 */
export async function refreshAll() {
  await refreshGroup('dims');
  await Promise.all([
    refreshGroup('full'), refreshSource('phone'), refreshGroup('cond'), refreshGroup('crm'),
  ]);
}

export function startScheduler() {
  const grupos = {
    hot: config.refresh.hot,
    full: config.refresh.full,
    dims: config.refresh.dims,
    cond: config.refresh.cond,
    crm: config.refresh.crm,
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
