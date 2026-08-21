import { useEffect, useMemo, useState } from 'react';
import { useFiltrosNegociacoes } from '../api';
import { LISTAS_NEGOCIACAO, PRESETS, useFilters } from '../filters';
import { Icone } from './Icone';
import { FiltroLista, FiltroPeriodo } from './SlicerBar';

/**
 * Barra de filtros da sub-página de NEGOCIAÇÕES.
 *
 * Separada da de Leads porque nenhum campo é o mesmo, e isso não é detalhe de
 * implementação — é o assunto da tela. O período aqui é a data de CRIAÇÃO da
 * negociação (é a ela que o slicer DATA do relatório está ligado), e o vendedor é
 * o RESPONSÁVEL por ela, não o dono do lead. Medido no banco, 21% das
 * negociações são de leads cadastrados antes do recorte: filtrar pelo lead
 * perderia uma em cada cinco.
 *
 * Os cinco seletores do relatório (DATA, VENDEDOR, EQUIPE, CLIENTE e TIPO
 * CONTRATO) estão todos aqui. CLIENTE virou busca, pelo mesmo motivo da tela de
 * Leads. Fase do funil, origem, forma de contato e região são acréscimo: o
 * relatório tem uma tabela para cada uma, e a leitura natural depois de ver a
 * tabela é "quero só essa fase" — sem o filtro, esse clique não tem para onde ir.
 */
const PRESETS_NEG = ['tudo', 'mes', 'mesPassado', '30d', '12m', 'ano']
  .map((id) => PRESETS.find((p) => p.id === id))
  .filter(Boolean);

export function SlicerBarNegociacoes() {
  const { filtros, setFiltro, limpar, contar } = useFilters();
  const { data: dims } = useFiltrosNegociacoes();
  const [busca, setBusca] = useState(filtros.buscaNeg || '');

  useEffect(() => setBusca(filtros.buscaNeg || ''), [filtros.buscaNeg]);
  useEffect(() => {
    const t = setTimeout(() => {
      if (busca !== (filtros.buscaNeg || '')) setFiltro({ buscaNeg: busca });
    }, 400);
    return () => clearTimeout(t);
  }, [busca]); // eslint-disable-line react-hooks/exhaustive-deps

  const campos = [
    { campo: 'nvendedor', titulo: 'Responsável', opcoes: dims?.responsaveis },
    { campo: 'nequipe', titulo: 'Equipe', opcoes: dims?.equipes },
    { campo: 'nstatus', titulo: 'Status', opcoes: dims?.status },
    { campo: 'nfase', titulo: 'Fase do funil', opcoes: dims?.fases },
    { campo: 'ntipo', titulo: 'Tipo de contrato', opcoes: dims?.tiposContrato },
    { campo: 'norigem', titulo: 'Origem', opcoes: dims?.origens },
    { campo: 'nforma', titulo: 'Forma de contato', opcoes: dims?.formas },
    { campo: 'nregiao', titulo: 'Região', opcoes: dims?.regioes },
  ];

  const trocarPeriodo = (patch) => {
    const p = {};
    if ('de' in patch) p.negDe = patch.de;
    if ('ate' in patch) p.negAte = patch.ate;
    setFiltro(p);
  };

  const presetAtivo = useMemo(() => {
    const achado = PRESETS_NEG.find((p) => {
      const c = p.calc();
      return c.de === (filtros.negDe || '') && c.ate === (filtros.negAte || '');
    });
    return achado?.id || null;
  }, [filtros.negDe, filtros.negAte]);

  const ativos = contar([...LISTAS_NEGOCIACAO, 'buscaNeg'])
    + (filtros.negDe || filtros.negAte ? 1 : 0);

  return (
    <div className="filtros">
      <span className="rotulo">Filtros</span>

      <FiltroPeriodo
        de={filtros.negDe}
        ate={filtros.negAte}
        presetAtivo={presetAtivo}
        onChange={trocarPeriodo}
        rotulo="Criação da negociação"
        presets={PRESETS_NEG}
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
          placeholder="Cliente, contrato, protocolo…"
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
