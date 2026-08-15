import { useMemo, useState } from 'react';
import { useDados } from '../api';
import { useFilters } from '../filters';
import { SlicerBar } from '../components/SlicerBar';
import { BotaoExportar, Erro, Loading, Segmentado, Visual } from '../components/ui';
import { Tabela } from '../components/tables';
import { escalaGradiente3 } from '../components/charts';
import { brl, int, labelData } from '../format';
import { baixar, sufixoPeriodo, tabelaParaCSV } from '../exportar';

// cores do relatório (linearGradient3 das colunas de premiação)
const CORES_FAIXA = ['#D8A579', '#BACDDF', '#7FCE79'];

/**
 * Calcula o gradiente das faixas. Como as faixas de Interno e Externo têm
 * escalas completamente diferentes (Interno vai até R$ 3.393 com 260+ pagamentos,
 * Externo até R$ 2.745 com 60+), o padrão é normalizar dentro de cada situação;
 * "geral" reproduz a escala única do Power BI.
 */
function useEscalaFaixa(linhas, campo, porSituacao) {
  return useMemo(() => {
    const faixas = new Map();
    const registrar = (chave, v) => {
      const cur = faixas.get(chave) || { min: Infinity, max: -Infinity };
      cur.min = Math.min(cur.min, v);
      cur.max = Math.max(cur.max, v);
      faixas.set(chave, cur);
    };
    for (const l of linhas) {
      const v = Number(l[campo]) || 0;
      registrar(porSituacao ? (l.situacao || '—') : '__geral', v);
    }
    return (linha) => {
      const chave = porSituacao ? (linha.situacao || '—') : '__geral';
      const f = faixas.get(chave);
      if (!f || f.min === Infinity) return null;
      return escalaGradiente3(Number(linha[campo]) || 0, f.min, f.max, CORES_FAIXA);
    };
  }, [linhas, campo, porSituacao]);
}

function AlternadorEscala({ porSituacao, onChange }) {
  return (
    <Segmentado
      titulo="Escala das cores: separada por situação ou única (como no Power BI)"
      valor={porSituacao ? 'sit' : 'geral'}
      opcoes={[{ id: 'sit', label: 'por situação' }, { id: 'geral', label: 'geral' }]}
      onChange={(v) => onChange(v === 'sit')}
    />
  );
}

export default function Premiacoes() {
  const { filtros } = useFilters();
  const { data, error, isLoading } = useDados('/premiacoes', filtros);
  const [porSituacao, setPorSituacao] = useState(true);

  const pagantes = data?.pagantes || [];
  const ativos = data?.ativos || [];
  const corPagantes = useEscalaFaixa(pagantes, 'valorFaixa', porSituacao);
  const corAtivos = useEscalaFaixa(ativos, 'qtd', porSituacao);

  const colunasPagantes = [
    { key: 'vendedor', titulo: 'VENDEDORES', align: 'left' },
    { key: 'equipe', titulo: 'EQUIPES', align: 'left' },
    { key: 'situacao', titulo: 'SITUAÇÃO', align: 'center' },
    { key: 'qtd', titulo: 'PRIMEIROS PAGAMENTOS', fmt: int, corFundo: corPagantes },
    { key: 'faixa', titulo: 'FAIXA', align: 'left', corFundo: corPagantes },
    { key: 'valorFaixa', titulo: 'VALOR DA FAIXA', fmt: brl, corFundo: corPagantes },
    { key: 'valorTempoDeCasa', titulo: 'TEMPO DE CASA', fmt: (v) => (v === null ? '—' : brl(v)), corFundo: corPagantes },
    { key: 'valorFinal', titulo: 'VALOR FINAL', fmt: brl, bold: true, corFundo: corPagantes },
    { key: 'tempoContrato', titulo: 'TEMPO DE CONTRATO', align: 'left' },
    { key: 'admissaoSenior', titulo: 'ADMISSÃO SENIOR', align: 'center', fmt: labelData },
  ];
  const colunasAtivos = [
    { key: 'vendedor', titulo: 'VENDEDORES', align: 'left' },
    { key: 'equipe', titulo: 'EQUIPES', align: 'left' },
    { key: 'situacao', titulo: 'SITUAÇÃO', align: 'center' },
    { key: 'qtd', titulo: 'ATIVAÇÕES', fmt: int, corFundo: corAtivos },
    { key: 'faixa', titulo: 'FAIXA', align: 'left', corFundo: corAtivos },
    { key: 'valorFaixa', titulo: 'VALOR DA FAIXA', fmt: brl, bold: true, corFundo: corAtivos },
    { key: 'mesVirada', titulo: 'VIRA PAGANTE EM', align: 'center', fmt: labelData },
    { key: 'tempoContrato', titulo: 'TEMPO DE CONTRATO', align: 'left' },
    { key: 'admissaoSenior', titulo: 'ADMISSÃO SENIOR', align: 'center', fmt: labelData },
  ];

  return (
    <main className="page">
      <SlicerBar rotuloPeriodo="Data" />
      {error && <Erro erro={error} />}
      {data && !data.tecnologia && (
        <div className="banner">
          As faixas de <b>TELEFONIA</b> valem só com uma única tecnologia selecionada no filtro (igual ao <i>SELECTEDVALUE</i> do Power BI).
        </div>
      )}

      <Visual
        title="Relatório detalhado das premiações dos vendedores com mais de 60 dias de contrato"
        sub={data ? `${int(pagantes.length)} vendedores · total ${brl(data.totalPagantes)}` : ''}
        actions={(
          <>
            <AlternadorEscala porSituacao={porSituacao} onChange={setPorSituacao} />
            <BotaoExportar onExportar={() => baixar(
              `premiacoes-mais-60-dias_${sufixoPeriodo(filtros)}.csv`,
              tabelaParaCSV(colunasPagantes, pagantes),
            )} />
          </>
        )}
        flush
        className="v-meia"
      >
        {isLoading && !data ? <Loading /> : (
          <Tabela
            colunas={colunasPagantes}
            dados={pagantes}
            totais={{
              __label: 'Total',
              qtd: pagantes.reduce((a, r) => a + r.qtd, 0),
              valorFaixa: pagantes.reduce((a, r) => a + r.valorFaixa, 0),
              valorFinal: data?.totalPagantes || 0,
            }}
            ordemInicial={{ key: 'valorFinal', dir: 'desc' }}
          />
        )}
      </Visual>

      <Visual
        title="Relatório detalhado das premiações dos vendedores dentro dos 60 dias de contrato"
        sub={data ? `${int(ativos.length)} vendedores · total ${brl(data.totalAtivos)}` : ''}
        actions={(
          <>
            <AlternadorEscala porSituacao={porSituacao} onChange={setPorSituacao} />
            <BotaoExportar onExportar={() => baixar(
              `premiacoes-ate-60-dias_${sufixoPeriodo(filtros)}.csv`,
              tabelaParaCSV(colunasAtivos, ativos),
            )} />
          </>
        )}
        flush
        className="v-meia"
      >
        {isLoading && !data ? <Loading /> : (
          <Tabela
            colunas={colunasAtivos}
            dados={ativos}
            totais={{
              __label: 'Total',
              qtd: ativos.reduce((a, r) => a + r.qtd, 0),
              valorFaixa: data?.totalAtivos || 0,
            }}
            ordemInicial={{ key: 'valorFaixa', dir: 'desc' }}
          />
        )}
      </Visual>
    </main>
  );
}
