import { useDados } from '../api';
import { useFilters } from '../filters';
import { SlicerBar } from '../components/SlicerBar';
import { Granularidade } from '../components/Granularidade';
import { BotaoExportar, Erro, KpiStack, Legenda, Loading, Visual } from '../components/ui';
import { BarrasHorizontais, ColunasPorTecnologia, ComboChart, CORES } from '../components/charts';
import { Tabela } from '../components/tables';
import { brl, dec1, int, labelDia, labelMesLongo, labelPeriodo } from '../format';
import { baixar, sufixoPeriodo, tabelaParaCSV } from '../exportar';

export default function Vendas() {
  const { filtros, alternar } = useFilters();
  const { data, error, isLoading } = useDados('/vendas', filtros);

  const serie = (data?.serie || []).map((m) => ({ ...m, label: labelPeriodo(m.periodo) }));
  const colunasVendedor = [
    { key: 'vendedor', titulo: 'VENDEDORES', align: 'left' },
    { key: 'total', titulo: 'NOVOS CADASTROS', fmt: int, databar: { cor: CORES.gold } },
    { key: 'media', titulo: 'MÉDIA / DIA', fmt: dec1 },
    { key: 'spark', titulo: 'AO DECORRER DO TEMPO', tipo: 'spark' },
  ];
  const porDia = (data?.porDia || []).map((d) => ({ ...d, label: labelDia(d.dia) }));

  return (
    <main className="page">
      <SlicerBar rotuloPeriodo="Data da venda" />
      {error && <Erro erro={error} />}

      <div className="grid linha-principal">
        <Visual
          title={`TOTAL DE VENDAS / ${filtros.g === 'dia' ? 'DIA' : 'MÊS'}`}
          ia="vendas:serie"
          actions={<Granularidade />}
        >
          {isLoading && !data ? <Loading /> : (
            <>
              <Legenda itens={[
                { label: 'VENDAS', cor: CORES.gold },
                { label: 'ATIVAÇÕES', cor: CORES.orange, linha: true },
              ]} />
              <div style={{ flex: 1, minHeight: 0 }}>
                <ComboChart
                  data={serie}
                  barKey="vendas"
                  barName="VENDAS"
                  lineKey="ativacoes"
                  lineName="ATIVAÇÕES"
                />
              </div>
            </>
          )}
        </Visual>

        <div className="col-kpi">
          <KpiStack itens={[
            { label: 'VALOR DO TICKET', value: brl(data?.kpis?.valorTicket || 0), small: true },
            { label: 'MEDIA VENDAS / DIA', value: dec1(data?.kpis?.mediaVendas || 0) },
            { label: 'TOTAL VENDAS', value: int(data?.kpis?.totalVendas || 0) },
          ]} />
        </div>

        <Visual title="TOTAL DE VENDAS / CIDADE" ia="vendas:porCidade">
          {isLoading && !data ? <Loading /> : (
            <BarrasHorizontais
              data={data?.porCidade || []}
              nome="VENDAS"
              selecionados={filtros.cidade}
              onSelect={(c) => alternar('cidade', c)}
            />
          )}
        </Visual>
      </div>

      <div className="grid linha-dupla">
        <Visual
          title="VENDAS / VENDEDOR"
          ia="vendas:porVendedor"
          flush
          className="v-tabela"
          actions={(
            <BotaoExportar onExportar={() => baixar(
              `vendas-por-vendedor_${sufixoPeriodo(filtros)}.csv`,
              tabelaParaCSV(colunasVendedor, data?.porVendedor || []),
            )} />
          )}
        >
          {isLoading && !data ? <Loading /> : (
            <Tabela
              colunas={colunasVendedor}
              dados={data?.porVendedor || []}
              totais={{
                __label: `Total (${(data?.porVendedor || []).length} vendedores)`,
                total: data?.kpis?.totalVendas || 0,
                media: data?.kpis?.mediaVendas || 0,
              }}
              ordemInicial={{ key: 'total', dir: 'desc' }}
              onSelect={(l) => alternar('vendedor', l.vendedor)}
              selecionada={(l) => filtros.vendedor.includes(l.vendedor)}
            />
          )}
        </Visual>

        <Visual
          title="TOTAL DE VENDAS / DIA"
          ia="vendas:porDia"
          sub={data?.mesAtual ? labelMesLongo(data.mesAtual) : ''}
          className="v-tabela"
        >
          {isLoading && !data ? <Loading /> : (
            <>
              <Legenda
                itens={[
                  { label: 'FIBRA', cor: CORES.goldSoft },
                  { label: 'RÁDIO', cor: CORES.ink },
                  { label: 'TELEFONIA', cor: CORES.orangeSoft },
                ]}
                onSelect={(t) => alternar('tecnologia', t)}
                selecionados={filtros.tecnologia}
              />
              <div style={{ flex: 1, minHeight: 0 }}>
                <ColunasPorTecnologia
                  data={porDia}
                  onSelect={(t) => alternar('tecnologia', t)}
                  selecionados={filtros.tecnologia}
                />
              </div>
            </>
          )}
        </Visual>
      </div>
    </main>
  );
}
