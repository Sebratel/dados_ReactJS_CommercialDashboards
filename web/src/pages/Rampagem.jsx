import { useDados } from '../api';
import { useFilters } from '../filters';
import { SlicerBar } from '../components/SlicerBar';
import { Granularidade } from '../components/Granularidade';
import { Erro, KpiStack, Legenda, Loading, Visual } from '../components/ui';
import { BarrasHorizontais, ComboChart, CORES } from '../components/charts';
import { Tabela } from '../components/tables';
import { dec1, int, labelData, labelPeriodo } from '../format';

export default function Rampagem() {
  const { filtros, alternar } = useFilters();
  const { data, error, isLoading } = useDados('/rampagem', filtros);
  const serie = (data?.serie || []).map((m) => ({ ...m, label: labelPeriodo(m.periodo) }));

  return (
    <main className="page">
      <SlicerBar rotuloPeriodo="Período" />
      {error && <Erro erro={error} />}

      <div className="grid linha-principal">
        <Visual
          title="RAMPAGEM NOVATOS ( < 90 dias )"
          sub="vendas e ativações dentro dos 90 primeiros dias do vendedor"
          actions={<Granularidade />}
        >
          {isLoading && !data ? <Loading /> : (
            <>
              <Legenda itens={[
                { label: 'VENDAS (90d)', cor: CORES.gold },
                { label: 'ATIVAÇÕES (90d)', cor: CORES.orange, linha: true },
              ]} />
              <div style={{ flex: 1, minHeight: 0 }}>
                <ComboChart data={serie} barKey="vendas" barName="VENDAS (90d)" lineKey="ativos" lineName="ATIVAÇÕES (90d)" />
              </div>
            </>
          )}
        </Visual>

        <div className="col-kpi">
          <KpiStack itens={[
            { label: 'VENDAS EM RAMPAGEM', value: int(data?.kpis?.vendas || 0) },
            { label: 'ATIVOS EM RAMPAGEM', value: int(data?.kpis?.ativos || 0) },
            { label: 'NOVATOS ATIVOS', value: int(data?.kpis?.novatos || 0) },
          ]} />
        </div>

        <Visual title="TOTAL DE VENDAS / CIDADE">
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

      <div className="grid linha-64-36">
        <Visual title="VENDAS / VENDEDOR" flush className="v-tabela">
          {isLoading && !data ? <Loading /> : (
            <Tabela
              colunas={[
                { key: 'vendedor', titulo: 'VENDEDORES', align: 'left' },
                { key: 'vendas', titulo: 'VENDAS 90', fmt: int, databar: { cor: CORES.gold } },
                { key: 'mediaVendas', titulo: 'MEDIA VENDAS', fmt: dec1 },
                { key: 'ativos', titulo: 'ATIVOS 90', fmt: int },
                { key: 'mediaAtivos', titulo: 'MEDIA ATIVOS', fmt: dec1 },
                { key: 'diasContratado', titulo: 'DIAS CONTRATADO', fmt: int },
                { key: 'diasTrabalhados', titulo: 'DIAS TRABALHADOS', fmt: dec1 },
                { key: 'spark', titulo: 'AO DECORRER DO TEMPO', tipo: 'spark' },
              ]}
              dados={data?.tabela || []}
              ordemInicial={{ key: 'vendas', dir: 'desc' }}
            />
          )}
        </Visual>

        <Visual title="VENDEDOR" flush className="v-tabela">
          {isLoading && !data ? <Loading /> : (
            <Tabela
              colunas={[
                { key: 'vendedor', titulo: 'VENDEDORES', align: 'left' },
                { key: 'admissaoReal', titulo: 'ADMISSÃO', align: 'center', fmt: labelData },
                { key: 'dataApos90', titulo: 'FIM DA RAMPAGEM', align: 'center', fmt: labelData },
                { key: 'diasContratado', titulo: 'DIAS', fmt: int },
              ]}
              dados={data?.novatos || []}
              ordemInicial={{ key: 'admissaoReal', dir: 'desc' }}
            />
          )}
        </Visual>
      </div>
    </main>
  );
}
