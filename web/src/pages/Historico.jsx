import { useMemo } from 'react';
import { useDados } from '../api';
import { useFilters } from '../filters';
import { SlicerBar } from '../components/SlicerBar';
import { BotaoExportar, Erro, Loading, Segmentado, Visual } from '../components/ui';
import { Matriz } from '../components/tables';
import { Icone } from '../components/Icone';
import { int, labelDia, labelMes } from '../format';
import { baixar, matrizParaCSV, sufixoPeriodo } from '../exportar';

/**
 * Páginas "HISTÓRICO": matriz vendedor × período com mapa de calor.
 *
 * A GRANULARIDADE TEM TRÊS ESTADOS, e o padrão continua sendo o automático: acima de
 * ~2 meses a matriz vira mensal, senão fica por dia. Isso é o que faz a tela caber.
 *
 * Mas quem usa pediu para poder FORÇAR o dia mesmo num período longo, e o motivo é
 * bom: às vezes a pergunta é sobre o dia dentro de um trimestre, e consolidar por mês
 * apaga exatamente o que se quer ver. O controle fica no cabeçalho do visual.
 *
 * O QUE PROTEGE O NAVEGADOR, e por que o corte é em VENDEDOR e não em dia.
 *
 * A matriz desenha coluna × vendedor. Forçando dia no recorte inteiro dá 519 dias por
 * 451 vendedores: medido, 181 mil células no DOM e 113 ms por rolagem horizontal —
 * engasgo visível. A primeira tentativa foi cortar colunas, e estava errada: o pedido
 * era justamente ver os dias.
 *
 * Cortar VENDEDOR resolve sem tirar o que se pediu. A matriz já vem ordenada por
 * total, então os primeiros são os que têm volume; vendedor tem filtro próprio na
 * barra de cima para quem procura alguém específico; e o CSV sai completo. Com 60
 * vendedores × 519 dias são 31 mil células, um oitavo do custo.
 *
 * O RODAPÉ CONTINUA SOMANDO TODOS. É o total do período, não o dos visíveis — e a
 * tela diz isso, porque um rodapé que não fecha com as linhas à vista é exatamente o
 * tipo de coisa que gera desconfiança no número.
 */

/**
 * Teto de CÉLULAS desenhadas, e não de linhas — a diferença importa.
 *
 * Com teto de linha fixo, a visão mensal (20 colunas) cortava vendedor sem motivo:
 * 60 × 20 são 1.200 células, e a tela avisava que 391 vendedores tinham ficado de
 * fora de uma matriz que caberia inteira. O corte tem que responder ao custo real.
 *
 * 40 mil é o número medido: com 519 colunas isso dá 77 vendedores e ~62 ms na rolagem
 * de salto, 22 ms na rolagem de roda; 181 mil células davam 113 ms e engasgo visível.
 * Na visão mensal, 40 mil ÷ 20 colunas passa de 451 — ou seja, nada é cortado.
 */
const MAX_CELULAS = 40000;

/** Piso de linhas: mesmo numa matriz larguíssima, menos que isto não é matriz. */
const MIN_LINHAS = 25;

const OPCOES = [
  { id: '', label: 'Automático' },
  { id: 'dia', label: 'Dia' },
  { id: 'mes', label: 'Mês' },
];

export function Historico({ dataset, titulo, rotuloPeriodo }) {
  const { filtros, setFiltro } = useFilters();
  const { data, error, isLoading } = useDados(`/historico/${dataset}`, filtros);

  const porMes = data?.granularidade === 'mes';
  const rotulo = porMes ? labelMes : labelDia;

  /**
   * Recorta os VENDEDORES desenhados, mantendo os de maior volume — a matriz já vem
   * ordenada por total. As colunas ficam todas: são elas que a pessoa pediu para ver.
   *
   * `totalPorDia` e `total` continuam vindo do dado completo, de propósito: o rodapé
   * é o total do período.
   */
  const visao = useMemo(() => {
    if (!data) return null;
    const colunas = Math.max(data.colunas.length, 1);
    const cabem = Math.max(MIN_LINHAS, Math.floor(MAX_CELULAS / colunas));
    if (data.linhas.length <= cabem) return { ...data, omitidas: 0, cabem };
    return {
      ...data,
      linhas: data.linhas.slice(0, cabem),
      omitidas: data.linhas.length - cabem,
      cabem,
    };
  }, [data]);

  return (
    <main className="page">
      <SlicerBar rotuloPeriodo={rotuloPeriodo} />
      {error && <Erro erro={error} />}

      {visao?.omitidas > 0 && (
        <p className="aviso-recorte">
          <Icone nome="alerta" tamanho={12} />
          São {int(data.linhas.length)} vendedores no período, e a tela desenha os{' '}
          {int(visao.cabem)} de maior volume — a matriz inteira passaria de{' '}
          {int(data.linhas.length * data.colunas.length)} células e a rolagem engasga.
          Todos os {int(data.colunas.length)} dias estão aí, o{' '}
          <b>rodapé soma os {int(data.linhas.length)}</b>, e o CSV sai completo. Para ver
          alguém específico, use o filtro de vendedor acima.
        </p>
      )}

      <Visual
        title={titulo}
        sub={data ? legenda(data, visao) : ''}
        flush
        className="v-matriz"
        actions={(
          <>
            <Segmentado
              valor={filtros.hg}
              opcoes={OPCOES}
              onChange={(v) => setFiltro({ hg: v })}
              titulo={'Como agrupar as colunas. No automático a matriz vira mensal acima de ~2 meses, '
                + 'para caber na tela; "Dia" força o dia mesmo em período longo.'}
            />
            {data && (
              <BotaoExportar onExportar={() => baixar(
                `${dataset === 'vendas' ? 'vendas' : 'ativacoes'}-por-vendedor-matriz_${sufixoPeriodo(filtros)}.csv`,
                // o CSV sai do dado COMPLETO, nunca da visão recortada
                matrizParaCSV(data, rotulo),
              )}
              />
            )}
          </>
        )}
      >
        {isLoading && !data ? <Loading /> : (
          <Matriz
            colunas={visao.colunas}
            linhas={visao.linhas}
            totalPorDia={visao.totalPorDia}
            total={visao.total}
            rotuloColuna={rotulo}
          />
        )}
      </Visual>
    </main>
  );
}

/**
 * O subtítulo diz o agrupamento E de onde ele veio. Sem isso, quem escolhe "Dia" num
 * período longo e recebe uma matriz mensal não sabe se o controle não funcionou ou se
 * o dado não existe — e quem nunca tocou no controle não sabe que o automático agiu.
 */
function legenda(data, visao) {
  const partes = [`${int(data.total)} registros`, `${int(data.linhas.length)} vendedores`];
  const modo = data.granularidade === 'mes' ? 'agrupado por mês' : 'por dia';
  partes.push(data.pedido === 'auto' ? `${modo} (automático)` : `${modo} (escolhido)`);
  partes.push(`${int(data.colunas.length)} colunas`);
  if (visao?.omitidas > 0) {
    partes.push(`${int(visao.linhas.length)} de ${int(data.linhas.length)} vendedores na tela`);
  }
  return partes.join(' · ');
}
