import { Router } from 'express';
import { getState, isReady } from '../model/store.js';
import {
  DATE_FIELD, groupCount, matriz, mediaPonderada, parseFilters, parseGranularidade,
  porVendedor, premiacoes, rampagem, rows, serie, serieDiaria, serieDiariaPorTecnologia,
  serieMensal, soma,
} from '../model/measures.js';
import { monthKey, today } from '../model/dates.js';
import { refreshAll, refreshGroup } from '../etl/refresh.js';
import { config } from '../config.js';
import { exigirAuth } from '../auth/middleware.js';
import { podeVerTela } from '../auth/access.js';
import { CONJUNTOS, gerarCSV, listarConjuntos } from '../model/exportar.js';

export const api = Router();

// Autenticação por tela: cada endpoint respeita o ACL da tela que ele alimenta.
const auth = (tela) => exigirAuth(tela ? { tela } : {});

/** /historico/:dataset atende duas telas diferentes. */
const authHistorico = (req, res, next) => {
  const tela = req.params.dataset === 'vendas' ? 'vendas-historico' : 'ativacoes-historico';
  return exigirAuth({ tela })(req, res, next);
};

api.use((req, res, next) => {
  if (req.path === '/health' || req.path === '/meta') return next();
  if (!isReady()) {
    // sem detalhes das fontes: quem ainda não autenticou não precisa saber
    return res.status(503).json({ error: 'Carregando dados do Voalle/MariaDB…', carregando: true });
  }
  return next();
});

function meta() {
  const s = getState();
  return {
    version: s.version,
    builtAt: s.builtAt,
    buildMs: s.buildMs ?? null,
    contratos: s.facts.length,
    sources: s.sources,
    refresh: config.refresh,
    since: config.since,
    ready: isReady(),
  };
}

const withMeta = (payload) => ({ ...payload, meta: meta() });

// público (healthcheck do Docker) — sem detalhes internos
api.get('/health', (req, res) => {
  res.json({ ok: isReady(), ready: isReady() });
});

api.get('/meta', auth(), (req, res) => res.json(meta()));

api.get('/filters', auth(), (req, res) => {
  const s = getState();
  let min = null;
  let max = null;
  for (const f of s.facts) {
    if (f.dtVenda) {
      if (!min || f.dtVenda < min) min = f.dtVenda;
      if (!max || f.dtVenda > max) max = f.dtVenda;
    }
  }
  res.json(withMeta({ ...s.dims, periodo: { min, max, hoje: today() } }));
});

// --------------------------------------------------------------- DIRETORIA
api.get('/diretoria', auth('diretoria'), (req, res) => {
  const flt = parseFilters(req.query);
  const g = parseGranularidade(req.query);
  const vendas = rows('vendas', flt);
  const ativos = rows('ativos', flt);
  const pagantes = rows('pagantes', flt);

  const meses = new Map();
  const put = (list, field, campo) => {
    for (const m of serie(list, field, g)) {
      const cur = meses.get(m.periodo) || { periodo: m.periodo, vendas: 0, pagantes: 0, ativacoes: 0 };
      cur[campo] = m.qtd;
      meses.set(m.periodo, cur);
    }
  };
  put(vendas, 'dtVenda', 'vendas');
  put(pagantes, 'dtPagto', 'pagantes');
  put(ativos, 'dtAtiv', 'ativacoes');

  res.json(withMeta({
    kpis: {
      totalAtivos: ativos.length,
      mediaAtivos: mediaPonderada(ativos, 'dtAtiv'),
      totalVendas: vendas.length,
      valorTicket: soma(vendas),
      mediaVendas: mediaPonderada(vendas, 'dtVenda'),
      totalPagantes: pagantes.length,
      valorPagantes: soma(pagantes),
    },
    granularidade: g,
    serie: [...meses.values()].sort((a, b) => a.periodo.localeCompare(b.periodo)),
  }));
});

// ------------------------------------------------------------------ VENDAS
api.get('/vendas', auth('vendas'), (req, res) => {
  const flt = parseFilters(req.query);
  const g = parseGranularidade(req.query);
  const vendas = rows('vendas', flt);
  const ativos = rows('ativos', flt);

  // combo "TOTAL DE VENDAS / MÊS (ou DIA)": colunas = vendas, linha = ativações
  const meses = new Map();
  for (const m of serie(vendas, 'dtVenda', g)) {
    meses.set(m.periodo, { periodo: m.periodo, vendas: m.qtd, ativacoes: 0, valor: m.valor });
  }
  for (const m of serie(ativos, 'dtAtiv', g)) {
    const cur = meses.get(m.periodo) || { periodo: m.periodo, vendas: 0, ativacoes: 0, valor: 0 };
    cur.ativacoes = m.qtd;
    meses.set(m.periodo, cur);
  }

  // "TOTAL DE VENDAS / DIA (MÊS ATUAL)" — último mês do período filtrado
  const mesAtual = monthKey(flt.ate || today());
  const doMes = vendas.filter((f) => monthKey(f.dtVenda) === mesAtual);

  res.json(withMeta({
    kpis: {
      totalVendas: vendas.length,
      valorTicket: soma(vendas),
      mediaVendas: mediaPonderada(vendas, 'dtVenda'),
      totalAtivos: ativos.length,
    },
    granularidade: g,
    serie: [...meses.values()].sort((a, b) => a.periodo.localeCompare(b.periodo)),
    porCidade: groupCount(vendas, (f) => f.cidade, { limit: 15 }),
    porVendedor: porVendedor(vendas, 'dtVenda'),
    mesAtual,
    porDia: serieDiariaPorTecnologia(doMes, 'dtVenda'),
  }));
});

// --------------------------------------------------------------- ATIVAÇÕES
api.get('/ativacoes', auth('ativacoes'), (req, res) => {
  const flt = parseFilters(req.query);
  const g = parseGranularidade(req.query);
  const ativos = rows('ativos', flt);

  res.json(withMeta({
    kpis: {
      totalAtivos: ativos.length,
      mediaAtivos: mediaPonderada(ativos, 'dtAtiv'),
      valor: soma(ativos),
    },
    granularidade: g,
    serie: serie(ativos, 'dtAtiv', g).map((m) => ({ periodo: m.periodo, ativacoes: m.qtd, valor: m.valor })),
    porCanal: groupCount(ativos, (f) => f.canal || '(sem canal)', { limit: 12 }),
    porCidade: groupCount(ativos, (f) => f.cidade, { limit: 15 }),
    porVendedor: porVendedor(ativos, 'dtAtiv'),
    porDia: serieDiaria(ativos, 'dtAtiv'),
  }));
});

// ------------------------------------------------------- PRIMEIRO PAGAMENTO
api.get('/primeiro-pagamento', auth('primeiro-pagamento'), (req, res) => {
  const flt = parseFilters(req.query);
  const g = parseGranularidade(req.query);
  const limit = Math.min(Number(req.query.limit) || 1500, 20000);
  const pagantes = rows('pagantes', flt);

  // "Planos mais vendidos": agrupado pelo valor do plano
  const planos = new Map();
  for (const f of pagantes) {
    const key = `${f.plano || '(sem plano)'}|${(Number(f.valor) || 0).toFixed(2)}`;
    const cur = planos.get(key) || { plano: f.plano || '(sem plano)', valorPadrao: Number(f.valor) || 0, qtd: 0, valorTotal: 0 };
    cur.qtd += 1;
    cur.valorTotal += Number(f.valor) || 0;
    planos.set(key, cur);
  }

  const detalhe = pagantes
    .slice()
    .sort((a, b) => (b.dtPagto || '').localeCompare(a.dtPagto || ''))
    .slice(0, limit)
    .map((f) => ({
      vendedor: f.vendedor,
      cliente: f.cliente,
      dtPagto: f.dtPagto,
      plano: f.plano,
      tecnologia: f.tecnologia,
      valor: f.valor,
      contrato: f.contrato,
    }));

  res.json(withMeta({
    kpis: {
      totalPagantes: pagantes.length,
      valor: soma(pagantes),
      media: mediaPonderada(pagantes, 'dtPagto'),
    },
    granularidade: g,
    serie: serie(pagantes, 'dtPagto', g).map((m) => ({ periodo: m.periodo, pagantes: m.qtd, valor: m.valor })),
    planos: [...planos.values()].sort((a, b) => b.qtd - a.qtd).slice(0, 40),
    porVendedor: porVendedor(pagantes, 'dtPagto'),
    detalhe,
    detalheTotal: pagantes.length,
  }));
});

// -------------------------------------------------------------- HISTÓRICOS
api.get('/historico/:dataset', authHistorico, (req, res) => {
  const dataset = req.params.dataset === 'vendas' ? 'vendas' : 'ativos';
  const flt = parseFilters(req.query);
  const list = rows(dataset, flt);

  // acima de ~2 meses a matriz passa a ser mensal (senão vira uma tabela ilegível)
  let granularidade = req.query.por;
  if (granularidade !== 'dia' && granularidade !== 'mes') {
    const dias = flt.de && flt.ate
      ? Math.round((new Date(flt.ate) - new Date(flt.de)) / 86400000)
      : 999;
    granularidade = dias > 62 ? 'mes' : 'dia';
  }
  res.json(withMeta({ granularidade, ...matriz(list, DATE_FIELD[dataset], granularidade) }));
});

// ---------------------------------------------------------------- RAMPAGEM
api.get('/rampagem', auth('rampagem'), (req, res) => {
  res.json(withMeta(rampagem(parseFilters(req.query), parseGranularidade(req.query))));
});

// -------------------------------------------------------------- PREMIAÇÕES
api.get('/premiacoes', auth('premiacoes'), (req, res) => {
  res.json(withMeta(premiacoes(parseFilters(req.query))));
});

// -------------------------------------------------------------- EXPORTAÇÕES
/** Conjuntos que o usuário pode exportar (respeita o acesso por tela). */
api.get('/exportacoes', auth(), (req, res) => {
  const podeVer = (tela) => podeVerTela(req.usuario, tela);
  res.json(withMeta({ conjuntos: listarConjuntos(podeVer) }));
});

/** CSV completo do conjunto, com os filtros da tela aplicados. */
api.get('/exportar/:id', auth(), (req, res) => {
  const conjunto = CONJUNTOS[req.params.id];
  if (!conjunto) return res.status(404).json({ error: 'Conjunto de dados desconhecido.' });
  if (!podeVerTela(req.usuario, conjunto.tela)) {
    return res.status(403).json({ error: 'Você não tem acesso a estes dados.' });
  }

  try {
    const flt = parseFilters(req.query);
    const { csv, arquivo, linhas } = gerarCSV(req.params.id, flt);
    const sufixo = [flt.de, flt.ate].filter(Boolean).join('_a_') || 'completo';
    const nome = `${arquivo}_${sufixo}.csv`;
    console.log(`[export] ${req.usuario.email} baixou ${req.params.id}: ${linhas} linhas`);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${nome}"`);
    res.setHeader('X-Linhas', String(linhas));
    return res.send(csv);
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
});

// ----------------------------------------------------------------- REFRESH
api.post('/refresh', auth(), async (req, res) => {
  const group = req.query.group;
  try {
    if (group) await refreshGroup(String(group));
    else await refreshAll();
    res.json(withMeta({ ok: true }));
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});
