import { createContext, useCallback, useContext, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { addDias, addMeses, fimDoMes, hoje, inicioDoMes } from './format';

const Ctx = createContext(null);

const LISTAS = ['vendedor', 'equipe', 'tecnologia', 'situacao', 'cidade', 'canal'];

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
    };
    for (const k of LISTAS) {
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

  const ativos = useMemo(() => {
    let n = 0;
    for (const k of LISTAS) n += filtros[k].length ? 1 : 0;
    if (filtros.cliente) n += 1;
    return n;
  }, [filtros]);

  const value = useMemo(
    () => ({ filtros, setFiltro, alternar, limpar, presetAtivo, ativos }),
    [filtros, setFiltro, alternar, limpar, presetAtivo, ativos],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useFilters() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useFilters fora do FiltersProvider');
  return ctx;
}
