import { useEffect, useMemo, useState } from 'react';
import { useFiltrosDesempenho, useMeta } from '../api';
import { LISTAS_DESEMPENHO, PRESETS, useFilters } from '../filters';
import { Icone } from './Icone';
import { FiltroLista, FiltroPeriodo } from './SlicerBar';

/**
 * Barra de filtros das duas sub-páginas de Desempenho.
 *
 * Única barra do dashboard com DOIS períodos, e eles não são redundância: a tela
 * cruza os dois lados do funil, e cada lado tem a sua data. "Cadastro do lead"
 * recorta quem entrou; "criação da negociação" recorta o que foi trabalhado. O
 * relatório tem os dois slicers lado a lado (DATA CRIAÇÃO LEAD e DATA
 * NEGOCIAÇÃO) pelo mesmo motivo.
 *
 * `dvendedor` filtra o dono do lead E o responsável pela negociação ao mesmo
 * tempo — é a dimensão compartilhada `dVendedores` do modelo de origem.
 *
 * Os seletores mudam com a sub-página: vendedor e equipe na de vendedor, cidade
 * e bairro na de cidade. É o que o relatório faz, e evita oferecer um filtro que
 * não move nada na tela em que se está.
 */
const PRESETS_DES = ['tudo', 'mes', 'mesPassado', '30d', '12m', 'ano']
  .map((id) => PRESETS.find((p) => p.id === id))
  .filter(Boolean);

export function SlicerBarDesempenho({ por }) {
  const { filtros, setFiltro, limpar, contar } = useFilters();
  const { data: dims } = useFiltrosDesempenho();
  const { data: meta } = useMeta();
  const [busca, setBusca] = useState(filtros.buscaDes || '');

  useEffect(() => setBusca(filtros.buscaDes || ''), [filtros.buscaDes]);
  useEffect(() => {
    const t = setTimeout(() => {
      if (busca !== (filtros.buscaDes || '')) setFiltro({ buscaDes: busca });
    }, 400);
    return () => clearTimeout(t);
  }, [busca]); // eslint-disable-line react-hooks/exhaustive-deps

  const campos = por === 'cidade'
    ? [
      { campo: 'dcidade', titulo: 'Cidade', opcoes: dims?.cidades },
      { campo: 'dbairro', titulo: 'Bairro', opcoes: dims?.bairros },
      { campo: 'dstatus', titulo: 'Status do lead', opcoes: dims?.status },
      { campo: 'dtipo', titulo: 'Tipo de contrato', opcoes: dims?.tiposContrato },
    ]
    : [
      { campo: 'dvendedor', titulo: 'Vendedor', opcoes: dims?.vendedores },
      { campo: 'dequipe', titulo: 'Equipe', opcoes: dims?.equipes },
      { campo: 'dstatus', titulo: 'Status do lead', opcoes: dims?.status },
      { campo: 'dtipo', titulo: 'Tipo de contrato', opcoes: dims?.tiposContrato },
    ];

  const periodo = (campoDe, campoAte) => ({
    de: filtros[campoDe],
    ate: filtros[campoAte],
    onChange: (patch) => {
      const p = {};
      if ('de' in patch) p[campoDe] = patch.de;
      if ('ate' in patch) p[campoAte] = patch.ate;
      setFiltro(p);
    },
    presetAtivo: PRESETS_DES.find((x) => {
      const c = x.calc();
      return c.de === (filtros[campoDe] || '') && c.ate === (filtros[campoAte] || '');
    })?.id || null,
  });

  const pLead = useMemo(() => periodo('desLeadDe', 'desLeadAte'), [filtros.desLeadDe, filtros.desLeadAte]); // eslint-disable-line react-hooks/exhaustive-deps
  const pNeg = useMemo(() => periodo('desNegDe', 'desNegAte'), [filtros.desNegDe, filtros.desNegAte]); // eslint-disable-line react-hooks/exhaustive-deps

  const ativos = contar([...LISTAS_DESEMPENHO, 'buscaDes'])
    + (filtros.desLeadDe || filtros.desLeadAte ? 1 : 0)
    + (filtros.desNegDe || filtros.desNegAte ? 1 : 0);

  return (
    <div className="filtros">
      <span className="rotulo">Filtros</span>

      <FiltroPeriodo
        de={pLead.de}
        ate={pLead.ate}
        presetAtivo={pLead.presetAtivo}
        onChange={pLead.onChange}
        rotulo="Cadastro do lead"
        presets={PRESETS_DES}
        min={meta?.crmSince}
      />
      <FiltroPeriodo
        de={pNeg.de}
        ate={pNeg.ate}
        presetAtivo={pNeg.presetAtivo}
        onChange={pNeg.onChange}
        rotulo="Criação da negociação"
        presets={PRESETS_DES}
        min={meta?.crmSince}
      />

      {campos.map(({ campo, titulo, opcoes }, i) => (
        <FiltroLista
          key={campo}
          campo={campo}
          titulo={titulo}
          opcoes={opcoes || []}
          valor={filtros[campo]}
          onChange={(v) => setFiltro({ [campo]: v })}
          alinhar={i >= campos.length - 2 ? 'direita' : undefined}
        />
      ))}

      <label className="busca">
        <Icone nome="busca" tamanho={13} />
        <input
          type="text"
          value={busca}
          placeholder="Cliente, contrato…"
          onChange={(e) => setBusca(e.target.value)}
        />
      </label>

      {ativos > 0 && (
        <button type="button" className="limpar" onClick={limpar}>
          <Icone nome="fechar" tamanho={12} /> limpar {ativos} filtro{ativos > 1 ? 's' : ''}
        </button>
      )}
    </div>
  );
}
