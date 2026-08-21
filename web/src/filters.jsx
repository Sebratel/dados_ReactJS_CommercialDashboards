import { createContext, useCallback, useContext, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { addDias, addMeses, fimDoMes, hoje, inicioDoMes } from './format';

const Ctx = createContext(null);

/** Seletores de lista do dashboard comercial. */
export const LISTAS = ['vendedor', 'equipe', 'tecnologia', 'situacao', 'cidade', 'canal'];

/**
 * Seletores da tela de condomínios. Ficam no MESMO provider porque o mecanismo é
 * o mesmo (filtro na URL, compartilhável por link), mas em campos próprios: a
 * cidade daqui é `cidadeCond` porque a lista de valores é outra, e herdar a
 * cidade de Vendas deixaria a tela vazia sem dizer por quê.
 */
export const LISTAS_CONDOMINIO = [
  'condominio', 'splitter', 'concentrador', 'ponto', 'site', 'cidadeCond', 'faixa',
];

/**
 * Seletores da tela de Leads e Negociações. Mesmo motivo do prefixo de
 * condomínios: `vendedor`, `equipe` e `cidade` existem no lado comercial com
 * listas de valores diferentes — lá o vendedor é quem fechou o contrato, aqui é o
 * dono do lead no CRM.
 */
export const LISTAS_LEADS = [
  'lvendedor', 'lequipe', 'lstatus', 'lcidade', 'lorigem', 'lforma',
];

/**
 * Seletores da sub-página de Negociações. Campos PRÓPRIOS, e não os de leads:
 * o vendedor aqui é o responsável pela negociação (na de leads é o dono do lead)
 * e o status tem três valores em vez de sete. Reusar os mesmos campos faria a
 * troca de sub-página carregar um valor que não existe na lista da outra.
 */
/**
 * Seletores das duas sub-páginas de Desempenho. Campos próprios porque a tela
 * cruza os DOIS lados do funil: o vendedor filtra o dono do lead E o responsável
 * pela negociação ao mesmo tempo, e há dois períodos independentes.
 */
export const LISTAS_DESEMPENHO = [
  'dvendedor', 'dequipe', 'dstatus', 'dtipo', 'dcidade', 'dbairro',
];

export const LISTAS_NEGOCIACAO = [
  'nvendedor', 'nequipe', 'nstatus', 'nfase', 'ntipo', 'norigem', 'nforma', 'nregiao',
];

const TODAS_AS_LISTAS = [
  ...LISTAS, ...LISTAS_CONDOMINIO, ...LISTAS_LEADS, ...LISTAS_NEGOCIACAO, ...LISTAS_DESEMPENHO,
];

/** período padrão ao abrir o dashboard (equivale ao slicer Ano do Power BI) */
export const PADRAO = 'ano';

export const PRESETS = [
  { id: 'hoje', label: 'Hoje', calc: () => ({ de: hoje(), ate: hoje() }) },
  { id: 'ontem', label: 'Ontem', calc: () => ({ de: addDias(hoje(), -1), ate: addDias(hoje(), -1) }) },
  { id: 'mes', label: 'Este mês', calc: () => ({ de: inicioDoMes(), ate: hoje() }) },
  { id: 'mesPassado', label: 'Mês passado', calc: () => {
    const ref = addMeses(hoje(), -1);
    return { de: inicioDoMes(ref), ate: fimDoMes(ref) };
  } },
  { id: '30d', label: '30 dias', calc: () => ({ de: addDias(hoje(), -29), ate: hoje() }) },
  { id: '12m', label: '12 meses', calc: () => ({ de: inicioDoMes(addMeses(hoje(), -11)), ate: hoje() }) },
  { id: 'ano', label: 'Este ano', calc: () => ({ de: `${hoje().slice(0, 4)}-01-01`, ate: hoje() }) },
  { id: 'tudo', label: 'Tudo', calc: () => ({ de: '', ate: '' }) },
];

export function FiltersProvider({ children }) {
  const [params, setParams] = useSearchParams();

  const filtros = useMemo(() => {
    const inicial = PRESETS.find((p) => p.id === PADRAO).calc();
    const f = {
      de: params.get('de') ?? inicial.de,
      ate: params.get('ate') ?? inicial.ate,
      cliente: params.get('cliente') || '',
      // granularidade dos gráficos de coluna (não conta como filtro)
      g: params.get('g') === 'dia' ? 'dia' : 'mes',
      // condomínios: período sobre a criação do splitter. Sem padrão, porque um
      // splitter instalado em 2019 continua valendo hoje — "este ano" esconderia
      // quase toda a rede.
      criadoDe: params.get('criadoDe') || '',
      criadoAte: params.get('criadoAte') || '',
      buscaCond: params.get('buscaCond') || '',
      // leads: período sobre a data de cadastro do lead, que é a única data ligada
      // ao Calendario no modelo de origem. Sem padrão: o recorte da consulta
      // (CRM_SINCE) já limita o histórico, e um padrão aqui esconderia meses.
      leadDe: params.get('leadDe') || '',
      leadAte: params.get('leadAte') || '',
      buscaLead: params.get('buscaLead') || '',
      // negociações: período sobre a data de CRIAÇÃO da negociação
      negDe: params.get('negDe') || '',
      negAte: params.get('negAte') || '',
      buscaNeg: params.get('buscaNeg') || '',
      // desempenho: DOIS períodos, um para cada lado do funil
      desLeadDe: params.get('desLeadDe') || '',
      desLeadAte: params.get('desLeadAte') || '',
      desNegDe: params.get('desNegDe') || '',
      desNegAte: params.get('desNegAte') || '',
      buscaDes: params.get('buscaDes') || '',
      // sub-página da tela de Leads (o relatório tem quatro)
      lpag: params.get('lpag') || '',
    };
    for (const k of TODAS_AS_LISTAS) {
      const v = params.get(k);
      f[k] = v ? v.split(',').filter(Boolean) : [];
    }
    return f;
  }, [params]);

  const setFiltro = useCallback((patch) => {
    setParams((prev) => {
      const next = new URLSearchParams(prev);
      for (const [k, v] of Object.entries(patch)) {
        if (v === null || v === undefined || v === '' || (Array.isArray(v) && !v.length)) {
          if (k === 'de' || k === 'ate') next.set(k, ''); // "Tudo" precisa ser explícito
          else next.delete(k);
        } else {
          next.set(k, Array.isArray(v) ? v.join(',') : String(v));
        }
      }
      return next;
    }, { replace: true });
  }, [setParams]);

  /** cross-filter: clicar numa barra adiciona/remove o valor do filtro */
  const alternar = useCallback((campo, valor) => {
    setParams((prev) => {
      const next = new URLSearchParams(prev);
      const atual = (next.get(campo) || '').split(',').filter(Boolean);
      const novo = atual.includes(valor) ? atual.filter((v) => v !== valor) : [...atual, valor];
      if (novo.length) next.set(campo, novo.join(','));
      else next.delete(campo);
      return next;
    }, { replace: true });
  }, [setParams]);

  const limpar = useCallback(() => {
    const inicial = PRESETS.find((p) => p.id === PADRAO).calc();
    setParams((prev) => new URLSearchParams({
      de: inicial.de,
      ate: inicial.ate,
      ...(prev.get('g') ? { g: prev.get('g') } : {}),
    }), { replace: true });
  }, [setParams]);

  const presetAtivo = useMemo(() => {
    const p = PRESETS.find((x) => {
      const c = x.calc();
      return c.de === filtros.de && c.ate === filtros.ate;
    });
    return p?.id || null;
  }, [filtros.de, filtros.ate]);

  /**
   * Quantos filtros estão valendo — mas só os da barra que está perguntando.
   * Cada tela conta os seus: sem isso, um filtro de condomínio deixado para trás
   * fazia a barra de Vendas oferecer "limpar 1 filtro" que não aparece em lugar
   * nenhum daquela tela.
   */
  const contar = useCallback((campos) => {
    let n = 0;
    for (const k of campos) {
      const v = filtros[k];
      n += (Array.isArray(v) ? v.length : v) ? 1 : 0;
    }
    return n;
  }, [filtros]);

  const ativos = useMemo(() => contar([...LISTAS, 'cliente']), [contar]);

  const value = useMemo(
    () => ({ filtros, setFiltro, alternar, limpar, presetAtivo, ativos, contar }),
    [filtros, setFiltro, alternar, limpar, presetAtivo, ativos, contar],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useFilters() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useFilters fora do FiltersProvider');
  return ctx;
}
