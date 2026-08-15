import { useFilters } from '../filters';
import { Segmentado } from './ui';

/** Alterna a série dos gráficos de coluna entre mês e dia (vai na URL como ?g=). */
export function Granularidade() {
  const { filtros, setFiltro } = useFilters();
  return (
    <Segmentado
      titulo="Agrupar as colunas por mês ou por dia"
      valor={filtros.g}
      opcoes={[{ id: 'mes', label: 'mês' }, { id: 'dia', label: 'dia' }]}
      onChange={(g) => setFiltro({ g })}
    />
  );
}
