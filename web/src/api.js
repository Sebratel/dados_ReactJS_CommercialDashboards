import { useQuery, useQueryClient } from '@tanstack/react-query';
import { encerrarSessao, getToken, renovarToken } from './auth/session.jsx';

/** intervalo de auto-refresh do front (ms) */
export const AUTO_REFRESH_MS = 60000;

export function buildQuery(filtros = {}) {
  const p = new URLSearchParams();
  const add = (k, v) => {
    if (v === null || v === undefined || v === '') return;
    if (Array.isArray(v)) {
      if (!v.length) return;
      p.set(k, v.join(','));
    } else {
      p.set(k, String(v));
    }
  };
  add('de', filtros.de);
  add('ate', filtros.ate);
  add('vendedor', filtros.vendedor);
  add('equipe', filtros.equipe);
  add('tecnologia', filtros.tecnologia);
  add('situacao', filtros.situacao);
  add('cidade', filtros.cidade);
  add('canal', filtros.canal);
  add('cliente', filtros.cliente);
  add('g', filtros.g);
  add('hg', filtros.hg);
  // condomínios — nomes iguais aos da URL, então o link compartilhado e a
  // chamada de API falam a mesma língua
  add('condominio', filtros.condominio);
  add('splitter', filtros.splitter);
  add('concentrador', filtros.concentrador);
  add('ponto', filtros.ponto);
  add('site', filtros.site);
  add('cidadeCond', filtros.cidadeCond);
  add('faixa', filtros.faixa);
  add('criadoDe', filtros.criadoDe);
  add('criadoAte', filtros.criadoAte);
  add('buscaCond', filtros.buscaCond);
  // leads e negociações
  add('lde', filtros.leadDe);
  add('late', filtros.leadAte);
  add('lvend', filtros.lvendedor);
  add('lequipe', filtros.lequipe);
  add('lstatus', filtros.lstatus);
  add('lcidade', filtros.lcidade);
  add('lorigem', filtros.lorigem);
  add('lforma', filtros.lforma);
  add('lbusca', filtros.buscaLead);
  // negociações — base própria: data de criação da negociação e responsável
  add('nde', filtros.negDe);
  add('nate', filtros.negAte);
  add('nvend', filtros.nvendedor);
  add('nequipe', filtros.nequipe);
  add('nstatus', filtros.nstatus);
  add('nfase', filtros.nfase);
  add('ntipo', filtros.ntipo);
  add('norigem', filtros.norigem);
  add('nforma', filtros.nforma);
  add('nregiao', filtros.nregiao);
  add('nbusca', filtros.buscaNeg);
  // desempenho — dois períodos e as dimensões dos dois lados do funil
  add('dlde', filtros.desLeadDe);
  add('dlate', filtros.desLeadAte);
  add('dnde', filtros.desNegDe);
  add('dnate', filtros.desNegAte);
  add('dvend', filtros.dvendedor);
  add('dequipe', filtros.dequipe);
  add('dstatus', filtros.dstatus);
  add('dtipo', filtros.dtipo);
  add('dcidade', filtros.dcidade);
  add('dbairro', filtros.dbairro);
  add('dbusca', filtros.buscaDes);
  /**
   * `por` escolhe a dimensão das duas sub-páginas de desempenho (vendedor ou
   * cidade). Precisa vir para a QUERY, não só para o cache: sem isto as duas
   * telas tinham chaves de cache diferentes — então cada uma buscava de novo — e
   * chamavam a MESMA URL sem `por`, caindo no padrão do servidor. As duas
   * mostravam os números do vendedor, e a de cidade parecia certa porque o texto
   * do banner vem do lado do cliente.
   */
  add('por', filtros.por);

  // --- Relatorios Comercial: sete abas, cada uma com o seu prefixo -----------
  // GERAL
  add('rde', filtros.relDe);
  add('rate', filtros.relAte);
  add('rcidade', filtros.rcidade);
  add('rbairro', filtros.rbairro);
  add('rvend', filtros.rvend);
  add('requipe', filtros.requipe);
  add('rsit', filtros.rsit);
  add('rstatus', filtros.rstatus);
  add('rtec', filtros.rtec);
  add('rserv', filtros.rserv);
  add('retiq', filtros.retiq);
  add('ritem', filtros.ritem);
  add('rbusca', filtros.buscaRel);
  // RESUMO - VENDAS
  add('vde', filtros.resDe);
  add('vate', filtros.resAte);
  add('vcidade', filtros.vcidade);
  add('vvend', filtros.vvend);
  add('vequipe', filtros.vequipe);
  add('vsit', filtros.vsit);
  add('vstatus', filtros.vstatus);
  add('vtec', filtros.vtec);
  add('vtipo', filtros.vtipo);
  add('vg', filtros.resG);
  // QUADRO EQUIPES
  add('qde', filtros.eqpDe);
  add('qate', filtros.eqpAte);
  add('qvend', filtros.qvend);
  add('qequipe', filtros.qequipe);
  add('qsit', filtros.qsit);
  add('qtec', filtros.qtec);
  add('qativo', filtros.eqpAtivo);
  // RELATORIO DIARIO
  add('dde', filtros.diaDe);
  add('date', filtros.diaAte);
  add('dcidade', filtros.dcidade);
  add('dequipe', filtros.dequipe);
  add('dsit', filtros.dsit);
  add('dtec', filtros.dtec);
  add('dtipo', filtros.dtipo);
  // CLIENTES BASE
  add('bde', filtros.baseDe);
  add('bate', filtros.baseAte);
  add('bcidade', filtros.bcidade);
  add('bbairro', filtros.bbairro);
  add('btec', filtros.btec);
  add('bbusca', filtros.buscaBase);
  // PESQUISA CANCELAMENTO
  add('pde', filtros.pesqDe);
  add('pate', filtros.pesqAte);
  add('pcidade', filtros.pcidade);
  add('petiq', filtros.petiq);
  add('pstatus', filtros.pstatus);
  add('pperg', filtros.pperg);
  add('presp', filtros.presp);
  add('pbusca', filtros.buscaPesq);
  // CLIMA
  add('ccidade', filtros.ccidade);
  return p.toString();
}

/** fetch autenticado: manda o Bearer e, em 401, renova o token e tenta de novo. */
export async function apiFetch(url, init = {}) {
  const comToken = (extra = {}) => {
    const token = getToken();
    return {
      ...init,
      headers: {
        ...(init.headers || {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...extra,
      },
    };
  };

  let res = await fetch(url, comToken());
  if (res.status === 401 && getToken()) {
    try {
      await renovarToken();
      res = await fetch(url, comToken());
      // 401 depois de renovar: o token novo também não serve, então acabou
      if (res.status === 401) encerrarSessao('expirada', `${url} devolveu 401 mesmo com token renovado`);
    } catch (err) {
      // a renovação silenciosa falhou (sessão do Google encerrada, cookies de
      // terceiros bloqueados). Aqui, ao contrário do temporizador, já houve um 401
      // de verdade: o token não serve mais, então a sessão termina.
      encerrarSessao('expirada', `${url} deu 401 e a renovação falhou: ${err?.message || err}`);
    }
  }
  return res;
}

/**
 * `signal` vem do react-query. Repassar importa desde o cross-filter: quatro cliques
 * em rajada abriam quatro requisições que iam até o fim, e a penúltima resposta podia
 * chegar depois da última — a tela mostrava o recorte anterior com o chip do novo.
 * Com o sinal, o react-query cancela o que já não interessa.
 */
export async function apiGet(path, filtros, { signal } = {}) {
  const qs = filtros ? buildQuery(filtros) : '';
  const res = await apiFetch(`/api${path}${qs ? `?${qs}` : ''}`, { signal });
  if (!res.ok) {
    let msg = `Erro ${res.status}`;
    try {
      const j = await res.json();
      msg = j.error || msg;
    } catch { /* corpo não é JSON */ }
    const err = new Error(msg);
    err.status = res.status;
    throw err;
  }
  return res.json();
}

export async function apiJson(path, { method = 'GET', body } = {}) {
  const res = await apiFetch(`/api${path}`, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  let dados = null;
  try { dados = await res.json(); } catch { /* sem corpo */ }
  if (!res.ok) {
    const err = new Error(dados?.error || `Erro ${res.status}`);
    err.status = res.status;
    throw err;
  }
  return dados;
}

export function useDados(path, filtros, options = {}) {
  return useQuery({
    queryKey: [path, filtros],
    queryFn: ({ signal }) => apiGet(path, filtros, { signal }),
    refetchInterval: AUTO_REFRESH_MS,
    refetchOnWindowFocus: true,
    staleTime: 20000,
    placeholderData: (prev) => prev,
    retry: 1,
    ...options,
  });
}

export function useMeta() {
  return useQuery({
    queryKey: ['/meta'],
    queryFn: () => apiGet('/meta'),
    refetchInterval: 30000,
    staleTime: 10000,
  });
}

export function useFiltros() {
  return useQuery({
    queryKey: ['/filters'],
    queryFn: () => apiGet('/filters'),
    staleTime: 10 * 60 * 1000,
    refetchInterval: 10 * 60 * 1000,
  });
}

/** Opções dos seletores da tela de condomínios (endpoint próprio). */
export function useFiltrosCondominios() {
  return useQuery({
    queryKey: ['/condominios/filtros'],
    queryFn: () => apiGet('/condominios/filtros'),
    staleTime: 10 * 60 * 1000,
    refetchInterval: 10 * 60 * 1000,
    retry: 1,
  });
}

/** Opções dos seletores da tela de leads (endpoint próprio). */
export function useFiltrosLeads() {
  return useQuery({
    queryKey: ['/leads/filtros'],
    queryFn: () => apiGet('/leads/filtros'),
    staleTime: 10 * 60 * 1000,
    refetchInterval: 10 * 60 * 1000,
    retry: 1,
  });
}

/** Opções dos seletores da sub-página de negociações (endpoint próprio). */
export function useFiltrosNegociacoes() {
  return useQuery({
    queryKey: ['/negociacoes/filtros'],
    queryFn: () => apiGet('/negociacoes/filtros'),
    staleTime: 10 * 60 * 1000,
    refetchInterval: 10 * 60 * 1000,
    retry: 1,
  });
}

/** Opções dos seletores das sub-páginas de desempenho. */
/**
 * Opcoes dos seletores de cada aba de Relatorios. Sete endpoints em vez de um
 * porque as dimensoes nao se cruzam: a cesta tem servico e etiqueta, a base tem
 * bairro e ponto de acesso, a pesquisa tem pergunta e resposta.
 */
const filtrosDeAba = (aba) => function useFiltrosAba() {
  return useQuery({
    queryKey: [`/relatorios/${aba}/filtros`],
    queryFn: () => apiGet(`/relatorios/${aba}/filtros`),
    staleTime: 5 * 60 * 1000,
  });
};

export const useFiltrosRelGeral = filtrosDeAba('geral');
export const useFiltrosRelResumo = filtrosDeAba('resumo');
export const useFiltrosRelEquipes = filtrosDeAba('equipes');
export const useFiltrosRelDiario = filtrosDeAba('diario');
export const useFiltrosRelBase = filtrosDeAba('base');
export const useFiltrosRelPesquisa = filtrosDeAba('pesquisa');
export const useFiltrosRelClima = filtrosDeAba('clima');

export function useFiltrosDesempenho() {
  return useQuery({
    queryKey: ['/desempenho/filtros'],
    queryFn: () => apiGet('/desempenho/filtros'),
    staleTime: 10 * 60 * 1000,
    refetchInterval: 10 * 60 * 1000,
    retry: 1,
  });
}

export function useRefreshServidor() {
  const qc = useQueryClient();
  return async (group = 'hot') => {
    // via apiFetch: sem o header o servidor devolvia 401 em silêncio e a
    // atualização nunca acontecia — só o cache do front era invalidado
    await apiFetch(`/api/refresh?group=${group}`, { method: 'POST' });
    await qc.invalidateQueries();
  };
}
