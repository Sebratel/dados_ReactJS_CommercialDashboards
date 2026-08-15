import { useDados } from '../api';
import { useFilters } from '../filters';
import { SlicerBar } from '../components/SlicerBar';
import { Granularidade } from '../components/Granularidade';
import { Erro, Kpi, Legenda, Loading, Visual } from '../components/ui';
import { AreaResumo, CORES } from '../components/charts';
import { brl, dec1, int, labelPeriodo } from '../format';

const SERIES = [
  { key: 'vendas', nome: 'VENDAS', cor: CORES.gold600 },
  { key: 'pagantes', nome: 'PRIMEIRO PAGANTE', cor: CORES.primary },
  { key: 'ativacoes', nome: 'ATIVAÇÕES', cor: CORES.orange },
];

export default function Diretoria() {
  const { filtros } = useFilters();
  const { data, error, isLoading } = useDados('/diretoria', filtros);
  const k = data?.kpis || {};
  const serie = (data?.serie || []).map((m) => ({ ...m, label: labelPeriodo(m.periodo) }));

  return (
    <main className="page">
      <SlicerBar campos={['periodo', 'vendedor', 'tecnologia', 'equipe', 'situacao']} rotuloPeriodo="Período" />
      {error && <Erro erro={error} />}

      <Visual
        title="Resumo Diretoria"
        ia="diretoria:serie"
        sub="Visão consolidada dos três principais indicadores do comercial"
        actions={<Granularidade />}
        className="v-diretoria"
      >
        {isLoading && !data ? <Loading /> : (
          <>
            <div className="kpi-row">
              <div className="kpi-grupo">
                <Kpi value={int(k.totalAtivos)} label="TOTAL ATIVOS" />
                <Kpi value={dec1(k.mediaAtivos)} label="MEDIA ATIVOS / DIA" small />
              </div>
              <div className="kpi-grupo">
                <Kpi value={int(k.totalVendas)} label="TOTAL VENDAS" />
                <div className="kpi-par">
                  <Kpi value={brl(k.valorTicket)} label="VALOR DO TICKET" small />
                  <Kpi value={dec1(k.mediaVendas)} label="MEDIA VENDAS / DIA" small />
                </div>
              </div>
              <div className="kpi-grupo">
                <Kpi value={int(k.totalPagantes)} label="TOTAL PRIMEIRO PAGANTE" />
                <Kpi value={brl(k.valorPagantes)} label="VALOR" small />
              </div>
            </div>

            <div className="area-diretoria">
              <div className="area-titulo">
                Resumo dos 3 principais indicadores do Comercial por {filtros.g === 'dia' ? 'dia' : 'mês'}
              </div>
              <Legenda itens={SERIES.map((s) => ({ label: s.nome, cor: s.cor }))} />
              <div style={{ flex: 1, minHeight: 0 }}>
                <AreaResumo data={serie} series={SERIES} denso={serie.length > 24} />
              </div>
            </div>
          </>
        )}
      </Visual>
    </main>
  );
}
