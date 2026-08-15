import { useDados } from '../api';
import { useFilters } from '../filters';
import { SlicerBar } from '../components/SlicerBar';
import { Granularidade } from '../components/Granularidade';
import { Erro, KpiStack, Legenda, Loading, Visual } from '../components/ui';
import { ComboChart, CORES } from '../components/charts';
import { Tabela } from '../components/tables';
import { brl, brl2, dec1, int, labelData, labelPeriodo } from '../format';

export default function PrimeiroPagamento() {
  const { filtros } = useFilters();
  const { data, error, isLoading } = useDados('/primeiro-pagamento', filtros);

  const serie = (data?.serie || []).map((m) => ({ ...m, label: labelPeriodo(m.periodo) }));

  return (
    <main className="page">
      <SlicerBar rotuloPeriodo="Data do pagamento" />
      {error && <Erro erro={error} />}

      <div className="grid linha-pagto">
        <Visual
          title={`TOTAL PRIMEIRO PAGANTE / ${filtros.g === 'dia' ? 'DIA' : 'MÊS'}`}
          actions={<Granularidade />}
        >
          {isLoading && !data ? <Loading /> : (
            <>
              <Legenda itens={[
                { label: 'PRIMEIRO PAGANTE', cor: CORES.gold },
                { label: 'VALOR', cor: CORES.ink, linha: true },
              ]} />
              <div style={{ flex: 1, minHeight: 0 }}>
                <ComboChart
                  data={serie}
                  barKey="pagantes"
                  barName="PRIMEIRO PAGANTE"
                  lineKey="valor"
                  lineName="VALOR"
                  lineFmt={brl}
                  corLinha={CORES.ink}
                  escalaSecundaria
                />
              </div>
            </>
          )}
        </Visual>

        <div className="col-kpi">
          <KpiStack itens={[
            { label: 'TOTAL PRIMEIRO PAGANTE', value: int(data?.kpis?.totalPagantes || 0) },
            { label: 'VALOR', value: brl(data?.kpis?.valor || 0), small: true },
            { label: 'MÉDIA / DIA', value: dec1(data?.kpis?.media || 0) },
          ]} />
        </div>

        <Visual title="Planos mais vendidos" flush>
          {isLoading && !data ? <Loading /> : (
            <Tabela
              colunas={[
                { key: 'plano', titulo: 'PLANO', align: 'left' },
                { key: 'valorPadrao', titulo: 'VALOR PADRÃO', fmt: brl2 },
                { key: 'qtd', titulo: 'QUANTIDADE', fmt: int },
                { key: 'valorTotal', titulo: 'VALOR TOTAL', fmt: brl, databar: { cor: CORES.green } },
              ]}
              dados={data?.planos || []}
              ordemInicial={{ key: 'qtd', dir: 'desc' }}
            />
          )}
        </Visual>
      </div>

      <Visual
        title="Relatório detalhado dos primeiros pagamentos"
        sub={data ? `${int(data.detalheTotal)} pagamentos no período${data.detalheTotal > (data.detalhe?.length || 0) ? ` · exibindo os ${int(data.detalhe.length)} mais recentes` : ''}` : ''}
        flush
        className="v-tabela-alta"
      >
        {isLoading && !data ? <Loading /> : (
          <Tabela
            colunas={[
              { key: 'vendedor', titulo: 'VENDEDORES', align: 'left' },
              { key: 'cliente', titulo: 'CLIENTES', align: 'left' },
              { key: 'dtPagto', titulo: 'DATA PAGAMENTO', align: 'center', fmt: labelData },
              { key: 'plano', titulo: 'PLANO', align: 'left' },
              { key: 'tecnologia', titulo: 'TECNOLOGIA', align: 'center' },
              { key: 'valor', titulo: 'VALOR', fmt: brl2 },
              { key: 'contrato', titulo: 'CONTRATO', align: 'center' },
            ]}
            dados={(data?.detalhe || []).map((d, i) => ({ ...d, __key: `${d.contrato}-${i}` }))}
            totais={{ __label: 'Total', valor: data?.kpis?.valor || 0 }}
            ordemInicial={{ key: 'dtPagto', dir: 'desc' }}
          />
        )}
      </Visual>
    </main>
  );
}
