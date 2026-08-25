import { useDados } from '../api';
import { useFilters } from '../filters';
import {
  BotaoExportar, Erro, Kpi, Legenda, Loading, Segmentado, Vazio, Visual,
} from '../components/ui';
import {
  ColunasEmpilhadas, ComboChart, CORES, corDaCategoria,
} from '../components/charts';
import { brl, int, labelMes } from '../format';
import { baixar, tabelaParaCSV } from '../exportar';

/**
 * Aba RESUMO - VENDAS.
 *
 * A página de origem tem três gráficos de coluna sobre a MESMA medida — contagem de
 * contrato — e o que muda é a quebra: nenhuma, por tecnologia e por cidade. Não é
 * redundância: o primeiro responde "quanto", os outros dois "de onde".
 *
 * Todos os três usam `CountNonNull(general[CONTRATO])`, e é por isso que os totais
 * fecham entre si. A granularidade (mês/dia) é do dashboard, não da origem — lá são
 * três slicers de Ano/Mês/Dia empilhados, que na prática é o mesmo controle.
 */

/** Converte a série do servidor para o formato do Recharts. */
function paraGrafico(s, granularidade) {
  if (!s?.periodos?.length) return { dados: [], series: [] };
  const rotulo = (p) => (granularidade === 'dia' ? p.slice(8) + '/' + p.slice(5, 7) : labelMes(p));
  const dados = s.periodos.map((p, i) => {
    const linha = { label: rotulo(p), periodo: p };
    let total = 0;
    for (const serie of s.series) {
      linha[serie.nome] = serie.pontos[i];
      total += serie.pontos[i] || 0;
    }
    // `total` existe porque a coluna empilhada rotula o topo da pilha com ele
    linha.total = total;
    return linha;
  });
  return { dados, series: s.series.map((x) => x.nome) };
}

export function PaginaResumoVendas({ filtros }) {
  const { setFiltro } = useFilters();
  const { data, error, isLoading } = useDados('/relatorios/resumo', filtros);
  const vazio = isLoading && !data;
  const c = data?.cartoes;
  const g = filtros.resG;

  const total = paraGrafico(data?.total, g);
  const porTec = paraGrafico(data?.porTecnologia, g);
  const porCidade = paraGrafico(data?.porCidade, g);

  const seletorGranularidade = (
    <Segmentado
      valor={g}
      opcoes={[{ id: 'mes', label: 'Mês' }, { id: 'dia', label: 'Dia' }]}
      onChange={(v) => setFiltro({ resG: v })}
      titulo="Agrupamento do eixo. A origem tem três slicers de Ano/Mês/Dia empilhados; aqui é um controle só."
    />
  );

  const exportarSerie = (nome, gr) => () => {
    const colunas = [{ key: 'label', titulo: 'PERÍODO' },
      ...gr.series.map((s) => ({ key: s, titulo: s.toUpperCase() }))];
    baixar(tabelaParaCSV(colunas, gr.dados), `${nome}.csv`);
  };

  if (error) return <Erro erro={error} />;

  return (
    <>
      <section className="grid linha-quatro">
        <Kpi
          value={vazio ? '—' : int(c.contratos)}
          label="CONTRATOS"
          desc="criados no período"
          title="Contagem de contratos criados — a medida CountNonNull(general[CONTRATO]) da origem."
        />
        <Kpi
          value={vazio ? '—' : int(c.clientes)}
          label="CLIENTES"
          desc="nomes distintos no período"
        />
        <Kpi
          value={vazio ? '—' : brl(c.valor)}
          label="VALOR MENSAL"
          desc="soma da mensalidade contratada"
          title="Soma do valor dos contratos criados no período. É recorrência mensal, não faturamento do período."
        />
        <Kpi
          value={vazio ? '—' : brl(c.ticket)}
          label="TICKET MÉDIO"
          desc="valor mensal ÷ contratos"
          title="Média da mensalidade por contrato. Não é por cliente: cliente com dois contratos entra duas vezes."
        />
      </section>

      <section className="grid">
        <Visual
          title="CONTRATOS CRIADOS"
          sub={vazio ? null : `${int(c.contratos)} no período · agrupado por ${g === 'dia' ? 'dia' : 'mês'}`}
          className="v-grafico"
          ia="relatorios:resumo"
          actions={<>{seletorGranularidade}{!vazio && <BotaoExportar onExportar={exportarSerie('contratos-por-periodo', total)} />}</>}
        >
          {vazio ? <Loading /> : total.dados.length
            ? (
              <ComboChart
                data={total.dados}
                barKey="Total"
                barName="Contratos"
                rotuloBarra={g === 'dia' ? 'nenhum' : 'centro'}
              />
            ) : <Vazio />}
        </Visual>
      </section>

      <section className="grid linha-dupla">
        <Visual
          title="POR TECNOLOGIA"
          sub={vazio ? null : legendaSerie(data.porTecnologia)}
          className="v-meia"
          ia="relatorios:resumo-tecnologia"
          actions={!vazio && <BotaoExportar onExportar={exportarSerie('contratos-por-tecnologia', porTec)} />}
        >
          {vazio ? <Loading /> : porTec.dados.length
            ? (
              <>
                <Legenda itens={porTec.series.map((n, i) => ({ label: n, cor: corDaCategoria(n, i) }))} />
                <ColunasEmpilhadas data={porTec.dados} series={porTec.series} cores={corDaCategoria} />
              </>
            ) : <Vazio />}
        </Visual>

        <Visual
          title="POR CIDADE"
          sub={vazio ? null : legendaSerie(data.porCidade)}
          className="v-meia"
          ia="relatorios:resumo-cidade"
          actions={!vazio && <BotaoExportar onExportar={exportarSerie('contratos-por-cidade', porCidade)} />}
        >
          {vazio ? <Loading /> : porCidade.dados.length
            ? (
              <>
                <Legenda itens={porCidade.series.map((n, i) => ({ label: n, cor: corDaCategoria(n, i) }))} />
                <ColunasEmpilhadas data={porCidade.dados} series={porCidade.series} cores={corDaCategoria} />
              </>
            ) : <Vazio />}
        </Visual>
      </section>
    </>
  );
}

/**
 * Diz a concentração, que é a leitura que a coluna empilhada sozinha não entrega:
 * com seis séries e uma delas valendo 90%, o gráfico parece variado e não é.
 */
function legendaSerie(s) {
  if (!s?.series?.length) return null;
  const totais = s.series.map((x) => ({ nome: x.nome, total: x.pontos.reduce((a, v) => a + v, 0) }));
  const soma = totais.reduce((a, t) => a + t.total, 0) || 1;
  const maior = totais.slice().sort((a, b) => b.total - a.total)[0];
  const cauda = s.series.find((x) => x.cauda);
  const partes = [`${s.series.length} séries`, `${maior.nome} concentra ${Math.round((100 * maior.total) / soma)}%`];
  if (cauda) partes.push('o resto está agrupado em "Outros"');
  return partes.join(' · ');
}
