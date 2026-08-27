import { useState } from 'react';
import { useDados } from '../api';
import { useFilters } from '../filters';
import { SlicerBar } from '../components/SlicerBar';
import { BotaoExportar, Erro, Kpi, Loading, Segmentado, Visual } from '../components/ui';
import { BarrasHorizontais, ComboChart, CORES, escalaGradiente } from '../components/charts';
import { Tabela } from '../components/tables';
import { brl, int, labelData, labelPeriodo } from '../format';
import { baixar, baixarDoServidor, sufixoPeriodo, tabelaParaCSV } from '../exportar';

/**
 * Réplica da tela única do relatório "COM - Vendas Canceladas": contratos
 * cancelados que nunca chegaram a ser ativados — a venda perdida antes da
 * instalação. Quem cancelou depois de ativado não aparece aqui.
 *
 * A ORDEM dos visuais segue a do relatório, lida das coordenadas dos visuais no
 * `.pbip` (y=196 detalhe, y=770 as seis contagens, y=1195 tipo e motivo, y=1629
 * gráfico). Isso importa mais do que parece: quem usa o relatório há meses procura
 * a informação pela posição, e inverter a ordem — como estava antes, com o gráfico
 * em cima e o detalhe no fim — faz a pessoa achar que falta coisa.
 *
 * A página de origem tem 2000px de altura e foi feita para rolar. Aqui também
 * rola, e é proposital: comprimir quatro faixas numa tela deixaria todas ilegíveis.
 */
export default function VendasCanceladas() {
  const { filtros, alternar, alternarUnico } = useFilters();
  const { data, error, isLoading } = useDados('/canceladas', filtros);
  // 'venda' é o padrão porque é a data que o filtro de período usa; 'cadastro'
  // reproduz o agrupamento do relatório de origem, para conferência
  const [porData, setPorData] = useState('venda');

  const bruta = porData === 'cadastro' ? data?.serieCadastro : data?.serie;
  const serie = (bruta || []).map((m) => ({ ...m, label: labelPeriodo(m.periodo) }));

  const motivos = (data?.porMotivo || []).filter((m) => !m.agrupado);
  const total = data?.kpis?.total || 0;
  let concentracao = '';
  if (motivos.length && total) {
    let acc = 0;
    let n = 0;
    while (n < motivos.length && acc / total < 0.9) { acc += motivos[n].valor; n += 1; }
    concentracao = `${n} ${n === 1 ? 'motivo responde' : 'motivos respondem'} por ${Math.round((acc / total) * 100)}% dos cancelamentos`;
  }

  /**
   * Cores lidas da formatação condicional do relatório de origem, não escolhidas:
   * o status do contrato tem fundo por valor (#1F601A normal, #9F0E0E cancelado,
   * fonte branca) e o valor tem escala linear de #e8d166 a #D9B300. Como esta tela
   * só mostra cancelados, o status sai sempre vermelho — e é justamente o que
   * sinaliza, de relance, que a linha é uma perda.
   */
  const valores = (data?.detalhe || []).map((d) => Number(d.valor) || 0);
  const valorMin = valores.length ? Math.min(...valores) : 0;
  const valorMax = valores.length ? Math.max(...valores) : 1;

  const colunasDetalhe = [
    { key: 'dtVenda', titulo: 'DATA DA VENDA', fmt: labelData },
    { key: 'contrato', titulo: 'CONTRATO', align: 'left' },
    { key: 'cliente', titulo: 'CLIENTE', align: 'left' },
    { key: 'cidade', titulo: 'CIDADE', align: 'left' },
    { key: 'vendedor', titulo: 'VENDEDOR', align: 'left' },
    { key: 'situacao', titulo: 'SITUAÇÃO', align: 'left' },
    {
      key: 'statusContrato',
      titulo: 'STATUS CONTRATO',
      align: 'center',
      corFundo: (d) => (d.statusContrato === 'Normal' ? '#1F601A' : '#9F0E0E'),
    },
    { key: 'statusCancelamento', titulo: 'MOTIVO DO CANCELAMENTO', align: 'left' },
    {
      key: 'valor',
      titulo: 'VALOR',
      fmt: brl,
      align: 'center',
      corFundo: (d) => escalaGradiente(Number(d.valor) || 0, valorMin, valorMax, '#e8d166', '#D9B300'),
    },
    { key: 'tecnologia', titulo: 'TECNOLOGIA', align: 'left' },
  ];

  /**
   * Cross-filter das contagens: todas têm a coluna `key` como dimensão, então o
   * clique na linha só precisa saber em QUAL campo do filtro aquele valor entra.
   *
   * Duas das seis ficam de fora — VALOR DO PLANO e TIPO DE ATENDIMENTO não existem
   * como filtro no modelo comercial, e uma linha clicável que não filtra nada é pior
   * do que uma linha que não convida ao clique.
   */
  const cruzar = (campo) => ({
    onSelect: (l) => alternar(campo, l.key),
    selecionada: (l) => filtros[campo].includes(l.key),
  });

  /** As seis contagens do relatório têm todas a mesma forma: rótulo + quantidade. */
  const contagem = (titulo, cor = CORES.primary) => [
    { key: 'key', titulo, align: 'left' },
    { key: 'valor', titulo: 'QTD', fmt: int, databar: { cor } },
  ];
  const colunasValor = [
    { key: 'valor', titulo: 'VALOR DO PLANO', fmt: brl },
    { key: 'qtd', titulo: 'QTD', fmt: int, databar: { cor: CORES.gold } },
  ];

  const vazio = isLoading && !data;

  return (
    <main className="page">
      <SlicerBar rotuloPeriodo="Data da venda" chipsExtra={['motivo', 'tipo']} />
      {error && <Erro erro={error} />}

      <div className="banner">
        Só entram contratos <b>cancelados</b> que <b>nunca foram ativados</b> — os dois filtros de
        página do relatório de origem. A ordem dos blocos abaixo é a mesma de lá: detalhamento,
        contagens, motivo e, por último, a evolução mensal.
      </div>

      {/* o relatório não tem KPI aqui (os cards de lá são data/hora da carga, que
          no nosso caso vivem no topo da página), mas o total e o valor perdido são
          a primeira pergunta de quem abre a tela — cabem numa faixa fina */}
      <div className="kpi-faixa">
        <Kpi
          value={int(data?.kpis?.total || 0)}
          label="VENDAS CANCELADAS"
          desc="contratos cancelados sem nunca ter sido ativados"
          title="Contagem de contratos no período filtrado (pela data da venda) com status Cancelado e sem data de ativação."
        />
        <Kpi
          value={brl(data?.kpis?.valor || 0)}
          label="VALOR PERDIDO"
          small
          desc="soma do valor mensal dos planos que não entraram"
          title="Soma do valor do contrato, que é a mensalidade do plano. É a receita recorrente que deixou de começar — uma parcela, não a perda acumulada ao longo do tempo, que dependeria de quanto cada cliente teria ficado."
        />
        <Kpi
          value={brl(data?.kpis?.ticketMedio || 0)}
          label="TICKET MÉDIO"
          small
          desc="mensalidade média por contrato perdido"
          title="Valor perdido dividido pela quantidade de contratos cancelados."
        />
      </div>

      {/* y=196 no relatório: a primeira coisa que aparece */}
      <Visual
        title="RELATÓRIO DETALHADO DAS VENDAS CANCELADAS"
        sub={data
          ? `${int(data.detalheTotal)} contratos · total ${brl(data.kpis.valor)} — a tabela mostra as ${int((data.detalhe || []).length)} mais recentes; o CSV traz todas`
          : ''}
        flush
        className="v-tabela-alta"
        actions={(
          <BotaoExportar
            titulo="Baixar as vendas canceladas do período (arquivo completo, sem o corte da tela)"
            rotulo="CSV completo"
            onExportar={() => baixarDoServidor('vendas-canceladas', filtros)}
          />
        )}
      >
        {vazio ? <Loading /> : (
          <Tabela
            colunas={colunasDetalhe}
            dados={(data?.detalhe || []).map((d, i) => ({ ...d, __key: `${d.contrato}-${i}` }))}
          />
        )}
      </Visual>

      {/* y=770: as seis contagens, lado a lado */}
      <div className="grid linha-seis">
        <Visual title="POR VENDEDOR" flush className="v-meia" ia="vendas-canceladas:vendedor">
          {vazio ? <Loading /> : <Tabela colunas={contagem('VENDEDOR')} dados={data?.porVendedor || []} {...cruzar('vendedor')} />}
        </Visual>
        <Visual title="POR EQUIPE" flush className="v-meia">
          {vazio ? <Loading /> : <Tabela colunas={contagem('EQUIPE')} dados={data?.porEquipe || []} {...cruzar('equipe')} />}
        </Visual>
        <Visual title="POR SITUAÇÃO" flush className="v-meia">
          {vazio ? <Loading /> : <Tabela colunas={contagem('SITUAÇÃO')} dados={data?.porSituacao || []} {...cruzar('situacao')} />}
        </Visual>
        <Visual title="POR CIDADE" flush className="v-meia" ia="vendas-canceladas:cidade">
          {vazio ? <Loading /> : <Tabela colunas={contagem('CIDADE')} dados={data?.porCidade || []} {...cruzar('cidade')} />}
        </Visual>
        <Visual title="POR VALOR" flush className="v-meia">
          {vazio ? <Loading /> : <Tabela colunas={colunasValor} dados={data?.porValor || []} />}
        </Visual>
        <Visual title="POR TECNOLOGIA" flush className="v-meia">
          {vazio ? <Loading /> : <Tabela colunas={contagem('TECNOLOGIA', CORES.goldSoft)} dados={data?.porTecnologia || []} {...cruzar('tecnologia')} />}
        </Visual>
      </div>

      {/* y=1195: tipo estreito à esquerda, motivo largo à direita */}
      <div className="grid linha-33-67">
        <Visual title="POR TIPO DE ATENDIMENTO" flush className="v-meia" ia="vendas-canceladas:tipo">
          {vazio ? <Loading /> : <Tabela colunas={contagem('TIPO DE ATENDIMENTO', CORES.gold)} dados={data?.porTipo || []} {...cruzar('tipo')} />}
        </Visual>

        <Visual
          title="MOTIVO DO CANCELAMENTO"
          sub={concentracao}
          className="v-meia"
          ia="vendas-canceladas:motivo"
          actions={(
            <BotaoExportar onExportar={() => baixar(
              `canceladas-por-motivo_${sufixoPeriodo(filtros)}.csv`,
              tabelaParaCSV(contagem('MOTIVO'), data?.porMotivo || []),
            )} />
          )}
        >
          {vazio ? <Loading /> : (
            <BarrasHorizontais
              data={data?.porMotivo || []}
              nome="CANCELADAS"
              larguraCategoria={170}
              selecionados={filtros.motivo}
              onSelect={(m) => alternar('motivo', m)}
            />
          )}
        </Visual>
      </div>

      {/* y=1629: por último, como no relatório */}
      <Visual
        title={`VENDAS CANCELADAS / MÊS ${porData === 'cadastro' ? 'DE CADASTRO DO CLIENTE' : 'DA VENDA'}`}
        sub={porData === 'cadastro'
          ? 'agrupamento do Power BI — é esta opção que reproduz os números do relatório antigo'
          : 'mesma data do filtro de período. Para comparar com o Power BI, troque para “cadastro”: lá o gráfico agrupa por cadastro do cliente'}
        className="v-grafico"
        ia="vendas-canceladas:serie"
        actions={(
          <Segmentado
            valor={porData}
            titulo="Agrupar o gráfico por"
            onChange={setPorData}
            opcoes={[
              { id: 'venda', label: 'data da venda' },
              { id: 'cadastro', label: 'cadastro' },
            ]}
          />
        )}
      >
        {vazio ? <Loading /> : (
          <ComboChart
            data={serie}
            barKey="canceladas"
            barName="CANCELADAS"
            /**
             * O clique só recorta no agrupamento por DATA DA VENDA. No de cadastro do
             * cliente a coluna é um mês de cadastro, mas o recorte de período do
             * modelo é sobre a venda: clicar ali filtraria um mês diferente do que a
             * coluna mostra — o tipo de erro que ninguém confere.
             */
            onSelect={porData === 'venda' ? (p) => alternarUnico('zoom', p) : undefined}
            selecionados={porData === 'venda' && filtros.zoom ? [filtros.zoom] : []}
          />
        )}
      </Visual>
    </main>
  );
}
