import { useEffect, useState } from 'react';
import { useFiltrosCampanhas, useMeta } from '../api';
import { LISTAS_CAMPANHAS, PRESETS, useFilters } from '../filters';
import { Icone } from './Icone';
import { FiltroLista, FiltroPeriodo } from './SlicerBar';

/**
 * Barra de filtros da tela de Campanhas.
 *
 * Barra própria, como a de condomínios e a de leads, porque as dimensões são
 * outras: aqui é plataforma, família de campanha e cidade — não vendedor e
 * equipe. Herdar a barra comercial ofereceria seis filtros que não mexem em nada
 * desta tela.
 *
 * "Tudo" vem primeiro nos presets: o dado de anúncio termina em 01/07/2026 e o de
 * atendimento segue até ontem, então abrir a tela em "Este ano" é o que mostra as
 * duas pontas. Um recorte de mês por padrão mostraria atendimento com
 * investimento zero e pareceria defeito.
 */
const PRESETS_MKT = ['tudo', 'mes', 'mesPassado', '30d', '12m', 'ano']
  .map((id) => PRESETS.find((p) => p.id === id))
  .filter(Boolean);

export function SlicerBarCampanhas({ campos = ['plataforma', 'familia', 'cidade'] }) {
  const { filtros, setFiltro, limpar, contar } = useFilters();
  const { data: dims } = useFiltrosCampanhas();
  const { data: meta } = useMeta();
  const [busca, setBusca] = useState(filtros.cbusca || '');

  useEffect(() => setBusca(filtros.cbusca || ''), [filtros.cbusca]);
  useEffect(() => {
    const t = setTimeout(() => {
      if (busca !== (filtros.cbusca || '')) setFiltro({ cbusca: busca });
    }, 400);
    return () => clearTimeout(t);
  }, [busca]); // eslint-disable-line react-hooks/exhaustive-deps

  /**
   * As listas mostram o RÓTULO e guardam o id. `plataforma` e `familia` são
   * códigos internos ('meta', 'site_organico') e ninguém procura por eles na
   * tela — mas é o código que o servidor filtra.
   */
  const rotular = (lista, mapa) => (lista || []).map((v) => ({ v, r: mapa?.[v] || v }));

  const OPCOES = {
    plataforma: { campo: 'cplat', titulo: 'Plataforma', itens: rotular(dims?.plataformas, dims?.plataformasRotulo) },
    familia: { campo: 'cfam', titulo: 'Campanha', itens: rotular(dims?.familias, dims?.familiasRotulo) },
    cidade: { campo: 'ccid', titulo: 'Cidade', itens: rotular(dims?.cidades) },
    canal: { campo: 'ccanal', titulo: 'Canal', itens: rotular(dims?.canais) },
    classificacao: { campo: 'cclass', titulo: 'Classificação', itens: rotular(dims?.classificacoes) },
    atendente: { campo: 'catend', titulo: 'Atendente', itens: rotular(dims?.atendentes) },
  };

  const usados = campos.map((c) => OPCOES[c]).filter(Boolean);
  const campoDatas = ['cde', 'cate'];
  const periodoLigado = Boolean(filtros.cde || filtros.cate);
  const ativos = contar([...LISTAS_CAMPANHAS, 'cbusca'])
    + (periodoLigado ? 1 : 0)
    + (filtros.crec === '1' ? 1 : 0);

  return (
    <div className="filtros">
      <span className="rotulo">Filtros</span>

      <FiltroPeriodo
        de={filtros.cde}
        ate={filtros.cate}
        presetAtivo={PRESETS_MKT.find((p) => {
          const c = p.calc();
          return c.de === (filtros.cde || '') && c.ate === (filtros.cate || '');
        })?.id || null}
        onChange={(patch) => {
          const p = {};
          if ('de' in patch) p[campoDatas[0]] = patch.de;
          if ('ate' in patch) p[campoDatas[1]] = patch.ate;
          setFiltro(p);
        }}
        rotulo="Período"
        presets={PRESETS_MKT}
        min={meta?.since}
        ativo={periodoLigado}
      />

      {usados.map((o, i) => (
        <FiltroLista
          key={o.campo}
          campo={o.campo}
          titulo={o.titulo}
          opcoes={o.itens.map((x) => x.v)}
          rotulos={Object.fromEntries(o.itens.map((x) => [x.v, x.r]))}
          valor={filtros[o.campo]}
          onChange={(v) => setFiltro({ [o.campo]: v })}
          alinhar={i >= usados.length - 2 ? 'direita' : undefined}
        />
      ))}

      <label className="busca">
        <Icone nome="busca" tamanho={13} />
        <input
          type="text"
          value={busca}
          placeholder="Contato, telefone, protocolo…"
          onChange={(e) => setBusca(e.target.value)}
        />
      </label>

      {/**
       * O ÚNICO interruptor desta barra que muda um total por omissão — e por
       * isso ele fica escrito, e não escondido num menu.
       *
       * As 44 campanhas de vaga de emprego somam R$ 202.517,74, 43,5% do gasto do
       * Meta. Ligadas, o custo por atendimento quase dobra. O relatório de origem
       * somava tudo junto num `Custo_Total_META` só, e nada dizia por quê.
       */}
      <button
        type="button"
        className={`filtro-toggle${filtros.crec === '1' ? ' on' : ''}`}
        onClick={() => setFiltro({ crec: filtros.crec === '1' ? '' : '1' })}
        title={filtros.crec === '1'
          ? 'Campanhas de vaga de emprego estão somando no investimento. Clique para tirá-las.'
          : 'Campanhas de vaga de emprego estão fora do investimento (padrão). Clique para incluí-las.'}
      >
        <Icone nome={filtros.crec === '1' ? 'ok' : 'fechar'} tamanho={11} />
        recrutamento
      </button>

      {ativos > 0 && (
        <button type="button" className="limpar" onClick={() => limpar([...LISTAS_CAMPANHAS, 'cbusca', 'cde', 'cate', 'crec'])}>
          <Icone nome="fechar" tamanho={12} /> limpar {ativos} filtro{ativos > 1 ? 's' : ''}
        </button>
      )}
    </div>
  );
}
