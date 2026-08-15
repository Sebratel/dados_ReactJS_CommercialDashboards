import { useDados } from '../api';
import { useFilters } from '../filters';
import { SlicerBar } from '../components/SlicerBar';
import { Erro, Loading, Visual } from '../components/ui';
import { Matriz } from '../components/tables';
import { int, labelDia, labelMes } from '../format';

/** Páginas "HISTÓRICO": matriz vendedor x dia com mapa de calor. */
export function Historico({ dataset, titulo, rotuloPeriodo }) {
  const { filtros } = useFilters();
  const { data, error, isLoading } = useDados(`/historico/${dataset}`, filtros);

  // em períodos longos a API já devolve a matriz agrupada por mês
  const porMes = data?.granularidade === 'mes';
  const matriz = data;

  return (
    <main className="page">
      <SlicerBar rotuloPeriodo={rotuloPeriodo} />
      {error && <Erro erro={error} />}

      <Visual
        title={titulo}
        sub={data ? `${int(data.total)} registros · ${int(data.linhas.length)} vendedores · ${porMes ? 'agrupado por mês' : 'por dia'}` : ''}
        flush
        className="v-matriz"
      >
        {isLoading && !data ? <Loading /> : (
          <Matriz
            colunas={matriz.colunas}
            linhas={matriz.linhas}
            totalPorDia={matriz.totalPorDia}
            total={matriz.total}
            rotuloColuna={porMes ? labelMes : labelDia}
          />
        )}
      </Visual>
    </main>
  );
}
