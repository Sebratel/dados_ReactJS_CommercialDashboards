import { useDados } from '../api';
import { useFilters } from '../filters';
import { SlicerBar } from '../components/SlicerBar';
import { Granularidade } from '../components/Granularidade';
import { BotaoExportar, Erro, KpiStack, Legenda, Loading, Visual } from '../components/ui';
import { BarrasHorizontais, ColunasPorTecnologia, CORES } from '../components/charts';
import { Tabela } from '../components/tables';
import { dec1, int, labelPeriodo } from '../format';
import { baixar, sufixoPeriodo, tabelaParaCSV } from '../exportar';

export default function Ativacoes() {
  const { filtros, alternar } = useFilters();
  const { data, error, isLoading } = useDados('/ativacoes', filtros);

  const serie = (data?.serie || []).map((m) => ({ ...m, label: labelPeriodo(m.periodo) }));
  const colunasVendedor = [
    { key: 'vendedor', titulo: 'VENDEDORES', align: 'left' },
    { key: 'total', titulo: 'TOTAL ATIVOS', fmt: int, databar: { cor: CORES.gold } },
    { key: 'media', titulo: 'MEDIA ATIVOS / DIA', fmt: dec1 },
    { key: 'spark', titulo: 'MÉDIA AO LONGO DO TEMPO', tipo: 'spark' },
    { key: 'equipe', titulo: 'EQUIPES', align: 'left' },
  ];

  return (
    <main className="page">
      <SlicerBar rotuloPeriodo="Data da ativação" />
      {error && <Erro erro={error} />}

      <div className="grid linha-principal">
        <Visual
          title={`TOTAL ATIVOS / ${filtros.g === 'dia' ? 'DIA' : 'MÊS'}`}
          sub="o rótulo é o total; a telefonia aparece separada porque o Power BI não a contabiliza"
          ia="ativacoes:serie"
          actions={<Granularidade />}
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
                  data={serie}
                  onSelect={(t) => alternar('tecnologia', t)}
                  selecionados={filtros.tecnologia}
                />
              </div>
            </>
          )}
        </Visual>

        <div className="col-kpi">
          <KpiStack itens={[
            { label: 'MEDIA ATIVOS / DIA', value: dec1(data?.kpis?.mediaAtivos || 0) },
            { label: 'TOTAL ATIVOS', value: int(data?.kpis?.totalAtivos || 0) },
            { label: 'FIBRA E RÁDIO', value: int(data?.kpis?.totalFibraRadio || 0), small: true },
            { label: 'TELEFONIA', value: int(data?.kpis?.totalTelefonia || 0), small: true },
          ]} />
        </div>

        <Visual title="CANAL VOALLE" ia="ativacoes:porCanal">
          {isLoading && !data ? <Loading /> : (
            <BarrasHorizontais
              data={data?.porCanal || []}
              nome="ATIVAÇÕES"
              larguraCategoria={110}
              selecionados={filtros.canal}
              onSelect={(c) => alternar('canal', c)}
            />
          )}
        </Visual>
      </div>

      <div className="grid linha-33-67">
        <Visual title="TOTAL / CIDADE" className="v-tabela" ia="ativacoes:porCidade">
          {isLoading && !data ? <Loading /> : (
            <BarrasHorizontais
              data={data?.porCidade || []}
              nome="ATIVAÇÕES"
              selecionados={filtros.cidade}
              onSelect={(c) => alternar('cidade', c)}
            />
          )}
        </Visual>

        <Visual
          title="ATIVOS / VENDEDOR"
          ia="ativacoes:porVendedor"
          flush
          className="v-tabela"
          actions={(
            <BotaoExportar onExportar={() => baixar(
              `ativacoes-por-vendedor_${sufixoPeriodo(filtros)}.csv`,
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
                total: data?.kpis?.totalAtivos || 0,
                media: data?.kpis?.mediaAtivos || 0,
              }}
              ordemInicial={{ key: 'total', dir: 'desc' }}
              onSelect={(l) => alternar('vendedor', l.vendedor)}
              selecionada={(l) => filtros.vendedor.includes(l.vendedor)}
            />
          )}
        </Visual>
      </div>
    </main>
  );
}
