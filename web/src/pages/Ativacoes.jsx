import { useDados } from '../api';
import { useFilters } from '../filters';
import { SlicerBar } from '../components/SlicerBar';
import { Granularidade } from '../components/Granularidade';
import { Erro, KpiStack, Loading, Visual } from '../components/ui';
import { BarrasHorizontais, ComboChart, CORES } from '../components/charts';
import { Tabela } from '../components/tables';
import { dec1, int, labelPeriodo } from '../format';

export default function Ativacoes() {
  const { filtros, alternar } = useFilters();
  const { data, error, isLoading } = useDados('/ativacoes', filtros);

  const serie = (data?.serie || []).map((m) => ({ ...m, label: labelPeriodo(m.periodo) }));

  return (
    <main className="page">
      <SlicerBar rotuloPeriodo="Data da ativação" />
      {error && <Erro erro={error} />}

      <div className="grid linha-principal">
        <Visual
          title={`TOTAL ATIVOS / ${filtros.g === 'dia' ? 'DIA' : 'MÊS'}`}
          actions={<Granularidade />}
        >
          {isLoading && !data ? <Loading /> : (
            <ComboChart data={serie} barKey="ativacoes" barName="ATIVAÇÕES" />
          )}
        </Visual>

        <div className="col-kpi">
          <KpiStack itens={[
            { label: 'MEDIA ATIVOS / DIA', value: dec1(data?.kpis?.mediaAtivos || 0) },
            { label: 'TOTAL ATIVOS', value: int(data?.kpis?.totalAtivos || 0) },
          ]} />
        </div>

        <Visual title="CANAL VOALLE">
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
        <Visual title="TOTAL / CIDADE" className="v-tabela">
          {isLoading && !data ? <Loading /> : (
            <BarrasHorizontais
              data={data?.porCidade || []}
              nome="ATIVAÇÕES"
              selecionados={filtros.cidade}
              onSelect={(c) => alternar('cidade', c)}
            />
          )}
        </Visual>

        <Visual title="ATIVOS / VENDEDOR" flush className="v-tabela">
          {isLoading && !data ? <Loading /> : (
            <Tabela
              colunas={[
                { key: 'vendedor', titulo: 'VENDEDORES', align: 'left' },
                { key: 'total', titulo: 'TOTAL ATIVOS', fmt: int, databar: { cor: CORES.gold } },
                { key: 'media', titulo: 'MEDIA ATIVOS / DIA', fmt: dec1 },
                { key: 'spark', titulo: 'MÉDIA AO LONGO DO TEMPO', tipo: 'spark' },
                { key: 'equipe', titulo: 'EQUIPES', align: 'left' },
              ]}
              dados={data?.porVendedor || []}
              totais={{
                __label: `Total (${(data?.porVendedor || []).length} vendedores)`,
                total: data?.kpis?.totalAtivos || 0,
                media: data?.kpis?.mediaAtivos || 0,
              }}
              ordemInicial={{ key: 'total', dir: 'desc' }}
            />
          )}
        </Visual>
      </div>
    </main>
  );
}
