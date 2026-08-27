import { Router } from 'express';
import { getState, isReady } from '../model/store.js';
import { comCache, estatisticasCache, limparCache } from '../model/cache.js';
import { parseFilters, parseGranularidade, premiacoes, rampagem } from '../model/measures.js';
import {
  granularidadeHistorico, painelAtivacoes, painelCanceladas, painelDiretoria,
  painelHistorico, painelPrimeiroPagamento, painelVendas,
} from '../model/paineis.js';
import { today } from '../model/dates.js';
import { refreshAll, refreshGroup } from '../etl/refresh.js';
import { config } from '../config.js';
import { exigirAuth } from '../auth/middleware.js';
import { podeVerTela } from '../auth/access.js';
import {
  CONJUNTOS, filtrosDoConjunto, gerarAmostra, gerarCSV, listarConjuntos,
} from '../model/exportar.js';
import { analisar } from '../model/preditivo.js';
import { gerarInsights, gerarInsightsVisual, iaConfigurada } from '../ia/insights.js';
import { VISUAIS, listarVisuais } from '../ia/visuais.js';
import {
  condominiosPronto, filtrosCondominios, getEstadoCondominios,
  painelCondominios, parseFiltrosCondominios,
} from '../model/condominios.js';
import {
  filtrosBase, filtrosClima, filtrosDiario, filtrosEquipes, filtrosGeral,
  filtrosPesquisa, filtrosResumo,
  getEstadoRelatorios, painelBase, painelClima, painelDiario, painelEquipes,
  painelGeral, painelPesquisa, painelResumo,
  parseFiltrosBase, parseFiltrosClima, parseFiltrosDiario, parseFiltrosEquipes,
  parseFiltrosGeral, parseFiltrosPesquisa, parseFiltrosResumo,
  relatoriosPronto,
} from '../model/relatorios.js';
import {
  erroNegociacoes, filtrosDesempenho, filtrosLeads, filtrosNegociacoes,
  getEstadoLeads, leadsPronto, negociacoesPronto, painelDesempenho, painelLeads,
  painelNegociacoes, parseFiltrosDesempenho, parseFiltrosLeads,
  parseFiltrosNegociacoes,
} from '../model/leads.js';

export const api = Router();

// Autenticação por tela: cada endpoint respeita o ACL da tela que ele alimenta.
const auth = (tela) => exigirAuth(tela ? { tela } : {});

/** /historico/:dataset atende duas telas diferentes. */
const authHistorico = (req, res, next) => {
  const tela = req.params.dataset === 'vendas' ? 'vendas-historico' : 'ativacoes-historico';
  return exigirAuth({ tela })(req, res, next);
};

/** Insights herdam o ACL da tela dona do visual — não existe porta lateral por aqui. */
const authVisual = (req, res, next) => {
  const visual = VISUAIS[req.params.id];
  if (!visual) return res.status(404).json({ error: 'Visual desconhecido.' });
  return exigirAuth({ tela: visual.tela })(req, res, next);
};

api.use((req, res, next) => {
  if (req.path === '/health' || req.path === '/meta') return next();
  // Condomínios e Leads têm modelo próprio e carregam em paralelo: quem só tem
  // acesso a uma dessas telas não pode ficar esperando a carga comercial, e uma
  // falha lá não pode derrubar uma tela que não depende dela. Cada uma checa o
  // SEU estado nos guardas logo abaixo.
  if (req.path.startsWith('/condominios')) return next();
  if (req.path.startsWith('/leads')) return next();
  if (req.path.startsWith('/negociacoes')) return next();
  if (req.path.startsWith('/desempenho')) return next();
  if (req.path.startsWith('/relatorios')) return next();
  if (!isReady()) {
    // sem detalhes das fontes: quem ainda não autenticou não precisa saber
    return res.status(503).json({ error: 'Carregando dados do Voalle/MariaDB…', carregando: true });
  }
  return next();
});

/** 503 com a mesma cara do global, mas olhando o modelo de condomínios. */
const exigirCondominios = (req, res, next) => {
  if (!condominiosPronto()) {
    return res.status(503).json({ error: 'Carregando a rede de splitters do Voalle…', carregando: true });
  }
  return next();
};

/**
 * O modelo de relatórios depende do comercial (ele lê os contratos de lá) E das
 * quatro fontes próprias. Checar as duas coisas evita a tela abrir com a cesta
 * vazia parecendo "nenhum produto" quando o que houve foi carga incompleta.
 */
const exigirRelatorios = (req, res, next) => {
  if (!relatoriosPronto()) {
    return res.status(503).json({ error: 'Carregando os relatórios comerciais…', carregando: true });
  }
  return next();
};

const exigirLeads = (req, res, next) => {
  if (!leadsPronto()) {
    return res.status(503).json({ error: 'Carregando os leads do Voalle…', carregando: true });
  }
  return next();
};

/**
 * A tela de negociações exige a fonte DELA. Sem esta checagem, uma falha na
 * consulta de negociações virava seis cartões zerados — que se lê como "não houve
 * negociação", não como "o dado não chegou".
 */
const exigirNegociacoes = (req, res, next) => {
  if (!negociacoesPronto()) {
    const erro = erroNegociacoes();
    return res.status(503).json({
      error: erro
        ? `A consulta de negociações falhou na última carga: ${erro}`
        : 'Carregando as negociações do Voalle…',
      carregando: !erro,
    });
  }
  return next();
};

function meta() {
  const s = getState();
  const c = getEstadoCondominios();
  const r = getEstadoRelatorios();
  const l = getEstadoLeads();
  return {
    version: s.version,
    builtAt: s.builtAt,
    buildMs: s.buildMs ?? null,
    contratos: s.facts.length,
    // as fontes dos dois modelos no mesmo lugar: o indicador do topo já acende
    // quando qualquer uma falha, e condomínios não fica com falha invisível
    sources: { ...s.sources, ...c.fontes, ...l.fontes },
    leads: {
      version: l.versao,
      builtAt: l.geradoEm,
      buildMs: l.buildMs ?? null,
      leads: l.leads.length,
      negociacoes: l.negociacoes.length,
      ready: leadsPronto(),
    },
    condominios: {
      version: c.versao,
      builtAt: c.geradoEm,
      buildMs: c.buildMs ?? null,
      portas: c.fatos.length,
      splitters: c.splitters.length,
      ready: condominiosPronto(),
    },
    relatorios: {
      version: r.versao,
      builtAt: r.geradoEm,
      buildMs: r.buildMs ?? null,
      contratos: r.fatos.length,
      cesta: r.cesta.length,
      pesquisa: r.pesquisa.length,
      fila: r.fila.length,
      base: r.base.length,
      clima: r.clima.length,
      avisos: r.avisos,
      ready: relatoriosPronto(),
    },
    /**
     * Como os vendedores casaram com o RH. Fica no meta porque é diagnóstico de
     * QUALIDADE DE DADO, não número de negócio: `divergentes` são e-mails iguais
     * com nomes diferentes nas duas bases — conta compartilhada ou erro de cadastro,
     * e alguém precisa olhar. Sem isso, 'SEM AUXILIAR' herda a admissão de outra
     * pessoa e entra em Rampagem sem ninguém notar.
     */
    juncaoVendedores: (() => {
      const j = s.juncaoSellers;
      if (!j) return null;
      return {
        porEmail: j.porEmail,
        porNome: j.porNome,
        porNomeSemAcento: j.porNomeSemAcento,
        divergentes: j.divergentes.length,
        recusados: j.recusados.length,
        // só os nomes; o e-mail não sai do servidor
        exemplos: j.divergentes.slice(0, 8),
        exemplosRecusados: j.recusados.slice(0, 8),
      };
    })(),
    refresh: config.refresh,
    // cache sem medida é fé: a taxa de acerto é o que denuncia chave errada
    cache: estatisticasCache(),
    since: config.since,
    phoneSince: config.phoneSince,
    crmSince: config.crmSince,
    relSince: config.relSince,
    iaConfigurada: iaConfigurada(),
    ready: isReady(),
  };
}

const withMeta = (payload) => ({ ...payload, meta: meta() });

/**
 * Painel com cache, para as telas do modelo comercial.
 *
 * A versão é a do modelo comercial, então uma carga nova invalida tudo sozinha. A
 * query vem do `req` DEPOIS do middleware — é lá que o escopo reescreve `equipe`, e
 * cachear antes disso serviria dado de uma equipe para quem não pode ver (o porquê
 * está em `model/cache.js`).
 */
const painelComCache = (nome, req, calcular) => comCache(
  { nome, versao: getState().version, query: req.query },
  calcular,
);

// público (healthcheck do Docker) — sem detalhes internos
api.get('/health', (req, res) => {
  res.json({ ok: isReady(), ready: isReady() });
});

api.get('/meta', auth(), (req, res) => res.json(meta()));

/**
 * Opções dos seletores. É o único endpoint de dados que não passa por
 * `parseFilters`, então o escopo precisa ser aplicado aqui à mão: sem isso a
 * pessoa veria no menu equipes e vendedores que não consegue abrir — e escolher
 * um deles devolveria uma tela vazia sem explicação.
 */
api.get('/filters', auth(), (req, res) => {
  const s = getState();
  const permitidas = req.usuario?.escopo?.equipes || null;
  const dentro = (f) => !permitidas || permitidas.includes(f.equipe);

  let min = null;
  let max = null;
  for (const f of s.facts) {
    if (!f.dtVenda || !dentro(f)) continue;
    if (!min || f.dtVenda < min) min = f.dtVenda;
    if (!max || f.dtVenda > max) max = f.dtVenda;
  }

  let dims = s.dims;
  if (permitidas) {
    const uniq = (arr) => [...new Set(arr.filter(Boolean))].sort((a, b) => a.localeCompare(b, 'pt-BR'));
    const doEscopo = s.facts.filter(dentro);
    const equipes = new Set(permitidas);
    dims = {
      ...s.dims,
      equipes: uniq([...s.dims.equipes].filter((e) => equipes.has(e))),
      vendedores: uniq([...s.teamsByName].filter(([, t]) => equipes.has(t.equipe)).map(([nome]) => nome)),
      situacoes: uniq([...s.teamsByName.values()].filter((t) => equipes.has(t.equipe)).map((t) => t.situacao)),
      canais: uniq(doEscopo.map((f) => f.canal)),
      cidades: uniq(doEscopo.map((f) => f.cidade)),
    };
  }

  res.json(withMeta({ ...dims, escopo: permitidas, periodo: { min, max, hoje: today() } }));
});

// --------------------------------------------------------------- DIRETORIA
api.get('/diretoria', auth('diretoria'), (req, res) => {
  res.json(withMeta(painelComCache('diretoria', req, () => painelDiretoria(
    parseFilters(req.query), parseGranularidade(req.query),
  ))));
});

// ------------------------------------------------------------------ VENDAS
api.get('/vendas', auth('vendas'), (req, res) => {
  res.json(withMeta(painelComCache('vendas', req, () => painelVendas(
    parseFilters(req.query), parseGranularidade(req.query),
  ))));
});

// --------------------------------------------------------------- ATIVAÇÕES
api.get('/ativacoes', auth('ativacoes'), (req, res) => {
  res.json(withMeta(painelComCache('ativacoes', req, () => painelAtivacoes(
    parseFilters(req.query), parseGranularidade(req.query),
  ))));
});

// ------------------------------------------------------- PRIMEIRO PAGAMENTO
api.get('/primeiro-pagamento', auth('primeiro-pagamento'), (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 1500, 20000);
  res.json(withMeta(painelComCache('primeiro-pagamento', req, () => painelPrimeiroPagamento(
    parseFilters(req.query), parseGranularidade(req.query), { limit },
  ))));
});

// -------------------------------------------------------------- HISTÓRICOS
api.get('/historico/:dataset', authHistorico, (req, res) => {
  const dataset = req.params.dataset === 'vendas' ? 'vendas' : 'ativos';
  const flt = parseFilters(req.query);
  /**
   * `hg` e não `por`: `por` já é usado pela tela de Desempenho ('vendedor'/'cidade'),
   * e as duas telas compartilham a mesma função que monta a query. Reaproveitar o
   * nome faria o valor de uma vazar na outra — inofensivo hoje, confuso amanhã.
   */
  const g = granularidadeHistorico(req.query.hg, flt);
  const painel = painelComCache(`historico:${dataset}`, req, () => painelHistorico(dataset, flt, g));
  res.json(withMeta({
    ...painel,
    // o que a tela pediu, para ela saber se o automático foi respeitado
    pedido: req.query.hg === 'dia' || req.query.hg === 'mes' ? req.query.hg : 'auto',
  }));
});

// ---------------------------------------------------------------- RAMPAGEM
api.get('/rampagem', auth('rampagem'), (req, res) => {
  res.json(withMeta(painelComCache('rampagem', req, () => rampagem(
    parseFilters(req.query), parseGranularidade(req.query),
  ))));
});

// -------------------------------------------------------- VENDAS CANCELADAS
api.get('/canceladas', auth('vendas-canceladas'), (req, res) => {
  res.json(withMeta(painelComCache('canceladas', req, () => painelCanceladas(parseFilters(req.query)))));
});

// ------------------------------------------------------------- CONDOMÍNIOS
/**
 * Opções dos seletores da tela de condomínios. Separado de `/filters` porque as
 * dimensões não têm nada a ver: lá é vendedor/equipe/tecnologia, aqui é
 * concentrador/ponto de acesso/splitter. Juntar os dois faria cada tela carregar
 * listas que nunca vai usar.
 */
api.get('/condominios/filtros', auth('condominios'), exigirCondominios, (req, res) => {
  res.json(withMeta(filtrosCondominios()));
});

api.get('/condominios', auth('condominios'), exigirCondominios, (req, res) => {
  res.json(withMeta(painelCondominios(parseFiltrosCondominios(req.query))));
});

// --------------------------------------------------------- LEADS E NEGOCIAÇÕES
/** Opções dos seletores da tela de leads (dimensões próprias, endpoint próprio). */
api.get('/leads/filtros', auth('leads'), exigirLeads, (req, res) => {
  res.json(withMeta(filtrosLeads()));
});

api.get('/leads', auth('leads'), exigirLeads, (req, res) => {
  res.json(withMeta(painelLeads(parseFiltrosLeads(req.query))));
});

/**
 * Sub-página de negociações. Mesma tela e mesmo ACL, base DIFERENTE: aqui o
 * recorte é a data de criação da negociação e o vendedor é o responsável por ela.
 */
api.get('/negociacoes/filtros', auth('leads'), exigirNegociacoes, (req, res) => {
  res.json(withMeta(filtrosNegociacoes()));
});

api.get('/negociacoes', auth('leads'), exigirNegociacoes, (req, res) => {
  res.json(withMeta(painelNegociacoes(parseFiltrosNegociacoes(req.query))));
});

/**
 * Desempenho. As duas páginas do relatório — do vendedor e por cidade — são a
 * mesma tela com outra dimensão de linha, então é uma rota com `?por=`. Exige as
 * duas fontes: a tela cruza os dois lados do funil.
 */
api.get('/desempenho/filtros', auth('leads'), exigirNegociacoes, (req, res) => {
  res.json(withMeta(filtrosDesempenho()));
});

api.get('/desempenho', auth('leads'), exigirNegociacoes, (req, res) => {
  const por = req.query.por === 'cidade' ? 'cidade' : 'vendedor';
  res.json(withMeta(painelDesempenho(parseFiltrosDesempenho(req.query), por)));
});

// ------------------------------------------------------- RELATÓRIOS COMERCIAL
/**
 * Sete sub-páginas, um ACL só (`relatorios`), cada uma com o seu recorte e as suas
 * dimensões. A separação por endpoint é a mesma dos outros relatórios: cada aba
 * pede o que precisa, e uma aba lenta não segura as outras.
 */
api.get('/relatorios/geral/filtros', auth('relatorios'), exigirRelatorios, (req, res) => {
  res.json(withMeta(filtrosGeral()));
});
api.get('/relatorios/geral', auth('relatorios'), exigirRelatorios, (req, res) => {
  res.json(withMeta(painelGeral(parseFiltrosGeral(req.query))));
});

api.get('/relatorios/resumo/filtros', auth('relatorios'), exigirRelatorios, (req, res) => {
  res.json(withMeta(filtrosResumo()));
});
api.get('/relatorios/resumo', auth('relatorios'), exigirRelatorios, (req, res) => {
  res.json(withMeta(painelResumo(parseFiltrosResumo(req.query))));
});

api.get('/relatorios/equipes/filtros', auth('relatorios'), exigirRelatorios, (req, res) => {
  res.json(withMeta(filtrosEquipes()));
});
api.get('/relatorios/equipes', auth('relatorios'), exigirRelatorios, (req, res) => {
  res.json(withMeta(painelEquipes(parseFiltrosEquipes(req.query))));
});

api.get('/relatorios/diario/filtros', auth('relatorios'), exigirRelatorios, (req, res) => {
  res.json(withMeta(filtrosDiario()));
});
api.get('/relatorios/diario', auth('relatorios'), exigirRelatorios, (req, res) => {
  res.json(withMeta(painelDiario(parseFiltrosDiario(req.query))));
});

api.get('/relatorios/base/filtros', auth('relatorios'), exigirRelatorios, (req, res) => {
  res.json(withMeta(filtrosBase()));
});
api.get('/relatorios/base', auth('relatorios'), exigirRelatorios, (req, res) => {
  res.json(withMeta(painelBase(parseFiltrosBase(req.query))));
});

api.get('/relatorios/pesquisa/filtros', auth('relatorios'), exigirRelatorios, (req, res) => {
  res.json(withMeta(filtrosPesquisa()));
});
api.get('/relatorios/pesquisa', auth('relatorios'), exigirRelatorios, (req, res) => {
  res.json(withMeta(painelPesquisa(parseFiltrosPesquisa(req.query))));
});

// O clima não depende de banco nenhum: se as consultas falharem, esta aba abre.
api.get('/relatorios/clima/filtros', auth('relatorios'), (req, res) => {
  res.json(withMeta(filtrosClima()));
});
api.get('/relatorios/clima', auth('relatorios'), (req, res) => {
  res.json(withMeta(painelClima(parseFiltrosClima(req.query))));
});

// -------------------------------------------------------------- PREMIAÇÕES
api.get('/premiacoes', auth('premiacoes'), (req, res) => {
  res.json(withMeta(premiacoes(parseFilters(req.query))));
});

// -------------------------------------------------------------- EXPORTAÇÕES
/** Conjuntos que o usuário pode exportar (respeita o acesso por tela). */
api.get('/exportacoes', auth(), (req, res) => {
  const podeVer = (tela) => podeVerTela(req.usuario, tela);
  res.json(withMeta({ conjuntos: listarConjuntos(podeVer, req.query) }));
});

/** Amostra do conjunto — as primeiras linhas, como sairão no arquivo. */
api.get('/exportar/:id/amostra', auth(), (req, res) => {
  const conjunto = CONJUNTOS[req.params.id];
  if (!conjunto) return res.status(404).json({ error: 'Conjunto de dados desconhecido.' });
  if (!podeVerTela(req.usuario, conjunto.tela)) {
    return res.status(403).json({ error: 'Você não tem acesso a estes dados.' });
  }
  try {
    const flt = filtrosDoConjunto(conjunto, req.query);
    return res.json(gerarAmostra(req.params.id, flt, req.query.limite));
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
});

/** CSV completo do conjunto, com os filtros da tela aplicados. */
api.get('/exportar/:id', auth(), (req, res) => {
  const conjunto = CONJUNTOS[req.params.id];
  if (!conjunto) return res.status(404).json({ error: 'Conjunto de dados desconhecido.' });
  if (!podeVerTela(req.usuario, conjunto.tela)) {
    return res.status(403).json({ error: 'Você não tem acesso a estes dados.' });
  }

  try {
    const flt = filtrosDoConjunto(conjunto, req.query);
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

// -------------------------------------------------------------- PREDITIVO
/** Indicadores preditivos — tudo calculado estatisticamente, sem IA. */
api.get('/preditivo', auth('preditivo'), (req, res) => {
  const analise = analisar(parseFilters(req.query));
  res.json(withMeta({ ...analise, iaConfigurada: iaConfigurada() }));
});

/** Leitura da IA sobre os indicadores acima. */
api.post('/preditivo/insights', auth('preditivo'), async (req, res) => {
  try {
    const analise = analisar(parseFilters(req.query));
    const insights = await gerarInsights(analise);
    console.log(`[ia] insights gerados para ${req.usuario.email} (${insights.modelo})`);
    return res.json(insights);
  } catch (err) {
    return res.status(err.status || 502).json({ error: err.message });
  }
});

// ------------------------------------------------- INSIGHTS POR GRÁFICO (IA)
/** Quais visuais têm o botão de leitura — o front usa para não mostrar botão morto. */
api.get('/insights/visuais', auth(), (req, res) => {
  res.json({ visuais: listarVisuais(), iaConfigurada: iaConfigurada() });
});

/**
 * Leitura de um visual. Recebe o ID e os filtros da tela pela query — os dados são
 * remontados aqui, pela mesma função que desenha o gráfico. O navegador não envia
 * números para serem interpretados.
 */
api.post('/insights/visual/:id', authVisual, async (req, res) => {
  try {
    // A query vai crua: quem sabe quais filtros o visual entende é o catálogo,
    // porque cada modelo em memória tem o seu conjunto.
    const insights = await gerarInsightsVisual(req.params.id, req.query);
    console.log(`[ia] leitura de ${req.params.id} para ${req.usuario.email} (${insights.modelo})`);
    return res.json(insights);
  } catch (err) {
    return res.status(err.status || 502).json({ error: err.message });
  }
});

// ----------------------------------------------------------------- REFRESH
api.post('/refresh', auth(), async (req, res) => {
  const group = req.query.group;
  try {
    if (group) await refreshGroup(String(group));
    else await refreshAll();
    // A versão nova já troca as chaves, mas o refresh manual existe para quem quer
    // ver AGORA: se a carga não mexeu na versão (nenhuma fonte mudou), o botão não
    // pode devolver a resposta guardada de antes dele.
    limparCache();
    res.json(withMeta({ ok: true }));
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});
