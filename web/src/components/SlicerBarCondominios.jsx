import { useEffect, useMemo, useState } from 'react';
import { useFiltrosCondominios } from '../api';
import { LISTAS_CONDOMINIO, PRESETS, useFilters } from '../filters';
import { Icone } from './Icone';
import { FiltroLista, FiltroPeriodo } from './SlicerBar';

/**
 * Barra de filtros da tela de condomínios.
 *
 * É uma barra separada da comercial porque as dimensões não têm interseção: lá é
 * vendedor, equipe e tecnologia; aqui é concentrador, ponto de acesso, site e
 * splitter. Os controles são os mesmos componentes — o que muda é de onde vêm as
 * opções (`/condominios/filtros`) e em quais campos elas escrevem.
 *
 * Os oito seletores reproduzem os do relatório de origem, com duas diferenças:
 *
 *  - USUÁRIO virou caixa de busca. Lá é um seletor de lista, e a lista tem um
 *    item por conexão ativa da rede — rolar milhares de logins para achar um é
 *    mais lento que digitar três letras.
 *  - "DT. CRIAÇÃO SPLITTER PRIM." saiu. Sobrou a do secundário, que é o
 *    equipamento do condomínio: a idade do primário é da rede, não do prédio, e
 *    dois filtros de data lado a lado com nomes quase iguais é convite a erro.
 */

/**
 * Splitter velho não é anomalia — é o normal —, então "tudo" é o padrão e vem
 * primeiro. "Hoje" e "ontem" saíram: instalação de splitter não é evento diário.
 */
const PRESETS_CRIACAO = ['tudo', '30d', '12m', 'ano', 'mes']
  .map((id) => PRESETS.find((p) => p.id === id))
  .filter(Boolean);

export function SlicerBarCondominios() {
  const { filtros, setFiltro, limpar, contar } = useFilters();
  const { data: dims } = useFiltrosCondominios();
  const [busca, setBusca] = useState(filtros.buscaCond || '');

  useEffect(() => setBusca(filtros.buscaCond || ''), [filtros.buscaCond]);
  useEffect(() => {
    const t = setTimeout(() => {
      if (busca !== (filtros.buscaCond || '')) setFiltro({ buscaCond: busca });
    }, 400);
    return () => clearTimeout(t);
  }, [busca]); // eslint-disable-line react-hooks/exhaustive-deps

  const campos = [
    { campo: 'condominio', titulo: 'Condomínio', opcoes: dims?.condominios },
    { campo: 'cidadeCond', titulo: 'Cidade', opcoes: dims?.cidades },
    { campo: 'faixa', titulo: 'Faixa de ocupação', opcoes: dims?.classificacoes },
    { campo: 'concentrador', titulo: 'Concentrador', opcoes: dims?.concentradores },
    { campo: 'ponto', titulo: 'Ponto de acesso', opcoes: dims?.pontosAcesso },
    { campo: 'site', titulo: 'Site', opcoes: dims?.sites },
    { campo: 'splitter', titulo: 'Splitter', opcoes: dims?.splitters },
  ];

  /**
   * O período aqui escreve em `criadoDe`/`criadoAte`. O componente fala em
   * `de`/`ate` porque é o mesmo da barra comercial, então a tradução acontece
   * neste ponto — e aceita alteração parcial, que é o que os dois campos de data
   * mandam quando só um deles muda.
   */
  const trocarPeriodo = (patch) => {
    const p = {};
    if ('de' in patch) p.criadoDe = patch.de;
    if ('ate' in patch) p.criadoAte = patch.ate;
    setFiltro(p);
  };

  const presetAtivo = useMemo(() => {
    const achado = PRESETS_CRIACAO.find((p) => {
      const c = p.calc();
      return c.de === (filtros.criadoDe || '') && c.ate === (filtros.criadoAte || '');
    });
    return achado?.id || null;
  }, [filtros.criadoDe, filtros.criadoAte]);

  // o período conta como UM filtro, não como dois campos de data
  const ativos = contar([...LISTAS_CONDOMINIO, 'buscaCond'])
    + (filtros.criadoDe || filtros.criadoAte ? 1 : 0);

  return (
    <div className="filtros">
      <span className="rotulo">Filtros</span>

      <FiltroPeriodo
        de={filtros.criadoDe}
        ate={filtros.criadoAte}
        presetAtivo={presetAtivo}
        onChange={trocarPeriodo}
        rotulo="Criação do splitter"
        presets={PRESETS_CRIACAO}
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
          placeholder="Cliente, usuário ou contrato…"
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
