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

export async function apiGet(path, filtros) {
  const qs = filtros ? buildQuery(filtros) : '';
  const res = await apiFetch(`/api${path}${qs ? `?${qs}` : ''}`);
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
    queryFn: () => apiGet(path, filtros),
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

export function useRefreshServidor() {
  const qc = useQueryClient();
  return async (group = 'hot') => {
    // via apiFetch: sem o header o servidor devolvia 401 em silêncio e a
    // atualização nunca acontecia — só o cache do front era invalidado
    await apiFetch(`/api/refresh?group=${group}`, { method: 'POST' });
    await qc.invalidateQueries();
  };
}
