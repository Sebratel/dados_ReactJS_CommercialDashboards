import { useState } from 'react';
import { useDados } from '../api';
import { useFilters } from '../filters';
import { SlicerBar } from '../components/SlicerBar';
import { BotaoExportar, Erro, KpiStack, Loading, Segmentado, Visual } from '../components/ui';
import { BarrasHorizontais, ComboChart, CORES } from '../components/charts';
import { Tabela } from '../components/tables';
import { brl, int, labelData, labelPeriodo } from '../format';
import { baixar, baixarDoServidor, sufixoPeriodo, tabelaParaCSV } from '../exportar';

/**
 * Réplica da tela única do relatório "COM - Vendas Canceladas": contratos
 * cancelados que nunca chegaram a ser ativados — a venda perdida antes da
 * instalação. Quem cancelou depois de ativado não aparece aqui.
 */
export default function VendasCanceladas() {
  const { filtros, alternar } = useFilters();
  const { data, error, isLoading } = useDados('/canceladas', filtros);
  // 'venda' é o padrão porque é a data que o filtro de período usa; 'cadastro'
  // reproduz o agrupamento do relatório de origem, para conferência
  const [porData, setPorData] = useState('venda');

  const bruta = porData === 'cadastro' ? data?.serieCadastro : data?.serie;
  const serie = (bruta || []).map((m) => ({ ...m, label: labelPeriodo(m.periodo) }));

  // os motivos são muito concentrados; dizer isso em uma linha poupa quem só
  // olha o gráfico de contar as barras
  const motivos = (data?.porMotivo || []).filter((m) => !m.agrupado);
  const total = data?.kpis?.total || 0;
  let concentracao = '';
  if (motivos.length && total) {
    let acc = 0;
    let n = 0;
    while (n < motivos.length && acc / total < 0.9) { acc += motivos[n].valor; n += 1; }
    concentracao = `${n} ${n === 1 ? 'motivo responde' : 'motivos respondem'} por ${Math.round((acc / total) * 100)}% dos cancelamentos`;
  }

  const colunasVendedor = [
    { key: 'key', titulo: 'VENDEDOR', align: 'left' },
    { key: 'valor', titulo: 'CANCELADAS', fmt: int, databar: { cor: CORES.primary } },
  ];
  const colunasTipo = [
    { key: 'key', titulo: 'TIPO DE ATENDIMENTO', align: 'left' },
    { key: 'valor', titulo: 'QTD', fmt: int, databar: { cor: CORES.gold } },
  ];
  const colunasDetalhe = [
    { key: 'dtVenda', titulo: 'DATA DA VENDA', fmt: labelData },
    { key: 'contrato', titulo: 'CONTRATO', align: 'left' },
    { key: 'cliente', titulo: 'CLIENTE', align: 'left' },
    { key: 'cidade', titulo: 'CIDADE', align: 'left' },
    { key: 'vendedor', titulo: 'VENDEDOR', align: 'left' },
    { key: 'situacao', titulo: 'SITUAÇÃO', align: 'left' },
    { key: 'statusCancelamento', titulo: 'MOTIVO DO CANCELAMENTO', align: 'left' },
    { key: 'tecnologia', titulo: 'TECNOLOGIA', align: 'left' },
    { key: 'valor', titulo: 'VALOR', fmt: brl },
  ];

  return (
    <main className="page">
      <SlicerBar rotuloPeriodo="Data da venda" />
      {error && <Erro erro={error} />}

      <div className="banner">
        Só entram contratos <b>cancelados</b> que <b>nunca foram ativados</b> — os dois filtros de
        página do relatório de origem. O período filtra pela data da venda; o gráfico agrupa por
        mês de cadastro do cliente, como no Power BI.
      </div>

      <div className="grid linha-principal">
        <Visual
          title={`VENDAS CANCELADAS / MÊS ${porData === 'cadastro' ? 'DE CADASTRO DO CLIENTE' : 'DA VENDA'}`}
          sub={porData === 'cadastro'
            ? 'agrupamento do Power BI: o cliente pode ter se cadastrado muito antes de fechar o contrato'
            : 'mesma data usada pelo filtro de período'}
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
          {isLoading && !data ? <Loading /> : (
            <ComboChart data={serie} barKey="canceladas" barName="CANCELADAS" />
          )}
        </Visual>

        <div className="col-kpi">
          <KpiStack itens={[
            { label: 'VENDAS CANCELADAS', value: int(data?.kpis?.total || 0) },
            { label: 'VALOR PERDIDO', value: brl(data?.kpis?.valor || 0), small: true },
            { label: 'TICKET MÉDIO', value: brl(data?.kpis?.ticketMedio || 0), small: true },
          ]} />
        </div>

        <Visual
          title="MOTIVO DO CANCELAMENTO"
          sub={concentracao}
          ia="vendas-canceladas:motivo"
        >
          {isLoading && !data ? <Loading /> : (
            <BarrasHorizontais
              data={data?.porMotivo || []}
              nome="CANCELADAS"
              larguraCategoria={170}
            />
          )}
        </Visual>
      </div>

      <div className="grid linha-33-67">
        <Visual title="POR CIDADE" ia="vendas-canceladas:cidade">
          {isLoading && !data ? <Loading /> : (
            <BarrasHorizontais
              data={data?.porCidade || []}
              nome="CANCELADAS"
              selecionados={filtros.cidade}
              onSelect={(c) => alternar('cidade', c)}
            />
          )}
        </Visual>

        <div className="grid linha-dupla">
          <Visual
            title="POR VENDEDOR"
            flush
            className="v-meia"
            ia="vendas-canceladas:vendedor"
            actions={(
              <BotaoExportar onExportar={() => baixar(
                `canceladas-por-vendedor_${sufixoPeriodo(filtros)}.csv`,
                tabelaParaCSV(colunasVendedor, data?.porVendedor || []),
              )} />
            )}
          >
            {isLoading && !data ? <Loading /> : (
              <Tabela colunas={colunasVendedor} dados={data?.porVendedor || []} />
            )}
          </Visual>

          <Visual
            title="POR TIPO DE ATENDIMENTO"
            flush
            className="v-meia"
            ia="vendas-canceladas:tipo"
          >
            {isLoading && !data ? <Loading /> : (
              <Tabela colunas={colunasTipo} dados={data?.porTipo || []} />
            )}
          </Visual>
        </div>
      </div>

      <Visual
        title="RELATÓRIO DETALHADO DAS VENDAS CANCELADAS"
        sub={data ? `${int(data.detalheTotal)} contratos - total ${brl(data.kpis.valor)} · role a tabela ou baixe o arquivo completo` : ''}
        flush
        className="v-meia"
        // as duas faixas de cima já ocupam a tela; aqui o detalhamento fica como
        // amostra rolável, e quem precisa de tudo usa o CSV completo ao lado
        style={{ height: 250 }}
        actions={(
          <BotaoExportar
            titulo="Baixar as vendas canceladas do período (arquivo completo, sem o corte da tela)"
            rotulo="CSV completo"
            onExportar={() => baixarDoServidor('vendas-canceladas', filtros)}
          />
        )}
      >
        {isLoading && !data ? <Loading /> : (
          <Tabela
            colunas={colunasDetalhe}
            dados={(data?.detalhe || []).map((d, i) => ({ ...d, __key: `${d.contrato}-${i}` }))}
            alturaMax={196}
          />
        )}
      </Visual>
    </main>
  );
}
