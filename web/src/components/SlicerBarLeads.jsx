import { useEffect, useMemo, useState } from 'react';
import { useFiltrosLeads } from '../api';
import { LISTAS_LEADS, PRESETS, useFilters } from '../filters';
import { Icone } from './Icone';
import { FiltroLista, FiltroPeriodo } from './SlicerBar';

/**
 * Barra de filtros da tela de Leads e Negociações.
 *
 * Os seis seletores são os do relatório de origem (DATA CRIAÇÃO LEAD, VENDEDOR,
 * EQUIPE, STATUS LEAD, CLIENTE e CIDADE), com uma troca: CLIENTE era um seletor
 * de lista com 68 mil nomes — aqui é caixa de busca, que também acha por CPF,
 * e-mail, telefone e protocolo. Rolar 68 mil opções não é um seletor, é um
 * castigo.
 *
 * Origem e Forma de contato são acréscimo: no relatório elas só existem como
 * série dos gráficos, e a leitura natural depois de ver o gráfico é "quero só
 * essa origem" — sem o filtro, esse clique não tem para onde ir.
 *
 * A barra é COMPARTILHADA pelas quatro sub-páginas, como no relatório, onde os
 * mesmos slicers se repetem em todas. Trocar de sub-página preserva o filtro.
 */

/** O recorte da consulta (CRM_SINCE) já limita o histórico; "tudo" é o padrão. */
const PRESETS_LEAD = ['tudo', 'mes', 'mesPassado', '30d', '12m', 'ano']
  .map((id) => PRESETS.find((p) => p.id === id))
  .filter(Boolean);

export function SlicerBarLeads() {
  const { filtros, setFiltro, limpar, contar } = useFilters();
  const { data: dims } = useFiltrosLeads();
  const [busca, setBusca] = useState(filtros.buscaLead || '');

  useEffect(() => setBusca(filtros.buscaLead || ''), [filtros.buscaLead]);
  useEffect(() => {
    const t = setTimeout(() => {
      if (busca !== (filtros.buscaLead || '')) setFiltro({ buscaLead: busca });
    }, 400);
    return () => clearTimeout(t);
  }, [busca]); // eslint-disable-line react-hooks/exhaustive-deps

  const campos = [
    { campo: 'lvendedor', titulo: 'Vendedor', opcoes: dims?.vendedores },
    { campo: 'lequipe', titulo: 'Equipe', opcoes: dims?.equipes },
    { campo: 'lstatus', titulo: 'Status do lead', opcoes: dims?.status },
    { campo: 'lcidade', titulo: 'Cidade', opcoes: dims?.cidades },
    { campo: 'lorigem', titulo: 'Origem', opcoes: dims?.origens },
    { campo: 'lforma', titulo: 'Forma de contato', opcoes: dims?.formas },
  ];

  /** O componente de período fala `de`/`ate`; aqui eles são `leadDe`/`leadAte`. */
  const trocarPeriodo = (patch) => {
    const p = {};
    if ('de' in patch) p.leadDe = patch.de;
    if ('ate' in patch) p.leadAte = patch.ate;
    setFiltro(p);
  };

  const presetAtivo = useMemo(() => {
    const achado = PRESETS_LEAD.find((p) => {
      const c = p.calc();
      return c.de === (filtros.leadDe || '') && c.ate === (filtros.leadAte || '');
    });
    return achado?.id || null;
  }, [filtros.leadDe, filtros.leadAte]);

  const ativos = contar([...LISTAS_LEADS, 'buscaLead'])
    + (filtros.leadDe || filtros.leadAte ? 1 : 0);

  return (
    <div className="filtros">
      <span className="rotulo">Filtros</span>

      <FiltroPeriodo
        de={filtros.leadDe}
        ate={filtros.leadAte}
        presetAtivo={presetAtivo}
        onChange={trocarPeriodo}
        rotulo="Cadastro do lead"
        presets={PRESETS_LEAD}
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
          placeholder="Nome, CPF, e-mail, telefone…"
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
