import { useEffect, useMemo, useState } from 'react';
import {
  useFiltrosRelBase, useFiltrosRelClima, useFiltrosRelDiario, useFiltrosRelEquipes,
  useFiltrosRelGeral, useFiltrosRelPesquisa, useFiltrosRelResumo, useMeta,
} from '../api';
import { PRESETS, useFilters } from '../filters';
import { Icone } from './Icone';
import { FiltroLista, FiltroPeriodo } from './SlicerBar';

/**
 * Barra de filtros das sete sub-páginas de Relatórios Comercial.
 *
 * Aqui é UMA barra parametrizada, e não sete arquivos, porque a diferença entre as
 * abas é só a lista de campos — a mecânica (período, seletores, busca, contador de
 * filtros ativos) é idêntica. Nas telas de Leads foram arquivos separados porque lá
 * a lógica divergia de verdade: duas datas em Desempenho, presets próprios em cada
 * uma. Aqui o que muda é declaração, então vira tabela.
 *
 * O que NÃO muda de aba para aba: cada uma tem os seus próprios campos na URL, com
 * prefixo. Trocar de aba não pode carregar o filtro da anterior — a lista de cidades
 * da base de clientes não é a mesma dos contratos, e um valor que não existe na
 * outra lista viraria filtro invisível zerando a tela.
 */

/** Presets de data: os mesmos do resto do dashboard, menos "hoje/ontem" nas telas de série. */
const PRESETS_MES = PRESETS.filter((p) => p.id !== 'hoje' && p.id !== 'ontem');

/**
 * A declaração de cada aba: onde ficam as datas na URL, quais seletores existem, de
 * onde vêm as opções e o que a busca procura.
 */
const ABAS = {
  geral: {
    hook: useFiltrosRelGeral,
    de: 'relDe',
    ate: 'relAte',
    rotuloPeriodo: 'Criação do contrato',
    busca: { campo: 'buscaRel', placeholder: 'Cliente, contrato ou protocolo…' },
    campos: [
      { campo: 'rcidade', titulo: 'Cidade', opcoes: 'cidades' },
      { campo: 'rbairro', titulo: 'Bairro', opcoes: 'bairros' },
      { campo: 'rvend', titulo: 'Vendedor', opcoes: 'vendedores' },
      { campo: 'requipe', titulo: 'Equipe', opcoes: 'equipes' },
      { campo: 'rsit', titulo: 'Situação', opcoes: 'situacoes' },
      { campo: 'rstatus', titulo: 'Status', opcoes: 'status' },
      { campo: 'rtec', titulo: 'Tecnologia', opcoes: 'tecnologias' },
      { campo: 'rserv', titulo: 'Serviço', opcoes: 'servicos' },
      { campo: 'retiq', titulo: 'Etiqueta', opcoes: 'etiquetas' },
      { campo: 'ritem', titulo: 'Item', opcoes: 'situacoesItem' },
    ],
  },
  resumo: {
    hook: useFiltrosRelResumo,
    de: 'resDe',
    ate: 'resAte',
    rotuloPeriodo: 'Criação do contrato',
    presets: PRESETS_MES,
    campos: [
      { campo: 'vcidade', titulo: 'Cidade', opcoes: 'cidades' },
      { campo: 'vvend', titulo: 'Vendedor', opcoes: 'vendedores' },
      { campo: 'vequipe', titulo: 'Equipe', opcoes: 'equipes' },
      { campo: 'vsit', titulo: 'Situação', opcoes: 'situacoes' },
      { campo: 'vstatus', titulo: 'Status', opcoes: 'status' },
      { campo: 'vtec', titulo: 'Tecnologia', opcoes: 'tecnologias' },
      { campo: 'vtipo', titulo: 'Tipo', opcoes: 'tipos' },
    ],
  },
  equipes: {
    hook: useFiltrosRelEquipes,
    de: 'eqpDe',
    ate: 'eqpAte',
    rotuloPeriodo: 'Período',
    presets: PRESETS_MES,
    // O quadro tem uma marca só, não um seletor de lista: "somente vendedor ativo".
    marca: { campo: 'eqpAtivo', label: 'Só vendedor ativo', title: 'Usa a coluna ATIVO do Comercial_Teams. Sem a marca, o quadro inclui quem já saiu — o que é o certo para um período passado.' },
    campos: [
      { campo: 'qvend', titulo: 'Vendedor', opcoes: 'vendedores' },
      { campo: 'qequipe', titulo: 'Equipe', opcoes: 'equipes' },
      { campo: 'qsit', titulo: 'Situação', opcoes: 'situacoes' },
      { campo: 'qtec', titulo: 'Tecnologia', opcoes: 'tecnologias' },
    ],
  },
  diario: {
    hook: useFiltrosRelDiario,
    de: 'diaDe',
    ate: 'diaAte',
    rotuloPeriodo: 'Mês',
    presets: PRESETS_MES,
    campos: [
      { campo: 'dcidade', titulo: 'Cidade', opcoes: 'cidades' },
      { campo: 'dequipe', titulo: 'Equipe', opcoes: 'equipes' },
      { campo: 'dsit', titulo: 'Situação', opcoes: 'situacoes' },
      { campo: 'dtec', titulo: 'Tecnologia', opcoes: 'tecnologias' },
      { campo: 'dtipo', titulo: 'Tipo', opcoes: 'tipos' },
    ],
  },
  base: {
    hook: useFiltrosRelBase,
    de: 'baseDe',
    ate: 'baseAte',
    rotuloPeriodo: 'Entrada na base',
    busca: { campo: 'buscaBase', placeholder: 'Contrato, usuário ou descrição…' },
    campos: [
      { campo: 'bcidade', titulo: 'Cidade', opcoes: 'cidades' },
      { campo: 'bbairro', titulo: 'Bairro', opcoes: 'bairros' },
      { campo: 'btec', titulo: 'Tecnologia', opcoes: 'tecnologias' },
    ],
  },
  pesquisa: {
    hook: useFiltrosRelPesquisa,
    de: 'pesqDe',
    ate: 'pesqAte',
    rotuloPeriodo: 'Abertura do atendimento',
    busca: { campo: 'buscaPesq', placeholder: 'Cliente, contrato ou protocolo…' },
    campos: [
      { campo: 'pcidade', titulo: 'Cidade', opcoes: 'cidades' },
      { campo: 'petiq', titulo: 'Etiqueta', opcoes: 'etiquetas' },
      { campo: 'pstatus', titulo: 'Status', opcoes: 'status' },
      { campo: 'pperg', titulo: 'Pergunta', opcoes: 'perguntas' },
      { campo: 'presp', titulo: 'Resposta', opcoes: 'respostas' },
    ],
  },
  clima: {
    hook: useFiltrosRelClima,
    // Sem período: a série é o ano corrente mais dezesseis dias de previsão, e
    // recortá-la só esconderia dias.
    campos: [{ campo: 'ccidade', titulo: 'Cidade', opcoes: 'cidades' }],
  },
};

export function SlicerBarRelatorios({ aba }) {
  const def = ABAS[aba] || ABAS.geral;
  const { filtros, setFiltro, limpar, contar } = useFilters();
  const { data: dims } = def.hook();
  const { data: meta } = useMeta();

  const [busca, setBusca] = useState(def.busca ? filtros[def.busca.campo] || '' : '');
  useEffect(() => {
    setBusca(def.busca ? filtros[def.busca.campo] || '' : '');
  }, [aba, def.busca ? filtros[def.busca.campo] : null]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!def.busca) return undefined;
    const t = setTimeout(() => {
      if (busca !== (filtros[def.busca.campo] || '')) setFiltro({ [def.busca.campo]: busca });
    }, 400);
    return () => clearTimeout(t);
  }, [busca]); // eslint-disable-line react-hooks/exhaustive-deps

  // Duas listas, e a diferença importa: para CONTAR, o par de datas é um filtro só
  // (senão a barra diz "2 filtros" quando o usuário escolheu um período); para
  // LIMPAR, as duas datas precisam sair, senão fica a data final sozinha.
  const { camposContados, camposLimpar } = useMemo(() => {
    const base = def.campos.map((c) => c.campo);
    if (def.busca) base.push(def.busca.campo);
    if (def.marca) base.push(def.marca.campo);
    return {
      camposContados: def.de ? [...base, def.de] : base,
      camposLimpar: def.de ? [...base, def.de, def.ate] : base,
    };
  }, [aba]); // eslint-disable-line react-hooks/exhaustive-deps

  const ativos = contar(camposContados);
  const marcado = def.marca ? filtros[def.marca.campo] === '1' : false;

  return (
    <div className="filtros">
      {def.de && (
        <FiltroPeriodo
          de={filtros[def.de]}
          ate={filtros[def.ate]}
          presetAtivo={null}
          onChange={(p) => setFiltro({
            ...(p.de !== undefined ? { [def.de]: p.de } : {}),
            ...(p.ate !== undefined ? { [def.ate]: p.ate } : {}),
          })}
          rotulo={def.rotuloPeriodo}
          presets={def.presets || PRESETS}
          min={meta?.since}
        />
      )}

      {def.campos.map(({ campo, titulo, opcoes }, i) => (
        <FiltroLista
          key={campo}
          campo={campo}
          titulo={titulo}
          opcoes={dims?.[opcoes] || []}
          valor={filtros[campo]}
          onChange={(v) => setFiltro({ [campo]: v })}
          alinhar={i >= def.campos.length - 2 ? 'direita' : undefined}
        />
      ))}

      {def.marca && (
        <label className="filtro-marca" title={def.marca.title}>
          <input
            type="checkbox"
            checked={marcado}
            onChange={(e) => setFiltro({ [def.marca.campo]: e.target.checked ? '1' : '' })}
          />
          <span>{def.marca.label}</span>
        </label>
      )}

      {def.busca && (
        <label className="busca">
          <Icone nome="busca" tamanho={13} />
          <input
            type="text"
            value={busca}
            placeholder={def.busca.placeholder}
            onChange={(e) => setBusca(e.target.value)}
          />
        </label>
      )}

      {ativos > 0 && (
        <button type="button" className="limpar" onClick={() => limpar(camposLimpar)}>
          <Icone nome="fechar" tamanho={12} /> limpar {ativos} filtro{ativos > 1 ? 's' : ''}
        </button>
      )}
    </div>
  );
}
