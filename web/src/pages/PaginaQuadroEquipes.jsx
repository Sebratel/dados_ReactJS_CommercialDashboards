import { useDados } from '../api';
import { BotaoExportar, Erro, Kpi, Loading, Vazio, Visual } from '../components/ui';
import { CORES, escalaGradiente } from '../components/charts';
import { Tabela } from '../components/tables';
import { brl, int, pct } from '../format';
import { baixar, tabelaParaCSV } from '../exportar';

/**
 * Aba QUADRO EQUIPES — uma tabela só, e a mais direta do relatório.
 *
 * Vendedor × cadastro, ativação, primeiro pagamento e churn. As três primeiras
 * colunas são contagens sobre datas DIFERENTES do mesmo contrato, e é por isso que
 * elas não fecham entre si: um contrato vendido em julho e ativado em agosto conta
 * cadastro em julho e ativação em agosto.
 *
 * O NOME "CHURN" ENGANA, e isso está dito no cartão e na coluna. A medida da origem
 * é `(cadastros - ativos) / cadastros`: não é cliente que saiu, é venda que nunca
 * chegou a instalar. Indicador ambíguo já virou número errado em apresentação neste
 * projeto mais de uma vez, então o nome fica (é o da origem) e a definição vem junto.
 */

/** Polaridade: quanto maior o churn, mais quente. Dois tons, sem arco-íris. */
const corDoChurn = (linha) => escalaGradiente(
  Math.min(Number(linha.churn) || 0, 1), 0, 1, '#EFF6EF', '#E8B4AE',
);

export function PaginaQuadroEquipes({ filtros }) {
  const { data, error, isLoading } = useDados('/relatorios/equipes', filtros);
  const vazio = isLoading && !data;
  const t = data?.totais;

  const colunas = [
    { key: 'vendedor', titulo: 'VENDEDOR', align: 'left' },
    { key: 'equipe', titulo: 'EQUIPE', align: 'left' },
    { key: 'situacao', titulo: 'SITUAÇÃO', align: 'left' },
    { key: 'cadastros', titulo: 'CADASTROS', fmt: int, databar: { cor: CORES.gold } },
    { key: 'ativos', titulo: 'ATIVAÇÕES', fmt: int, databar: { cor: CORES.orange } },
    { key: 'pagamentos', titulo: '1º PAGAMENTO', fmt: int, databar: { cor: CORES.green } },
    { key: 'valor', titulo: 'VALOR MENSAL', fmt: brl },
    { key: 'churn', titulo: 'NÃO ATIVADO', fmt: pct, align: 'center', corFundo: corDoChurn },
  ];

  if (error) return <Erro erro={error} />;

  return (
    <>
      <section className="grid linha-cinco">
        <Kpi
          value={vazio ? '—' : int(data.vendedores)}
          label="VENDEDORES"
          desc="com movimento no período"
          title="Só quem tem cadastro, ativação ou pagamento no período. Vendedor sem nenhum dos três não vira linha em branco."
        />
        <Kpi
          value={vazio ? '—' : int(t.cadastros)}
          label="CADASTROS"
          desc="contratos criados no período"
        />
        <Kpi
          value={vazio ? '—' : int(t.ativos)}
          label="ATIVAÇÕES"
          desc="instalações concluídas no período"
          title="Conta pela data de ativação, não pela da venda — as duas colunas não fecham entre si de propósito."
        />
        <Kpi
          value={vazio ? '—' : int(t.pagamentos)}
          label="1º PAGAMENTO"
          desc="primeiras faturas pagas no período"
        />
        <Kpi
          value={vazio ? '—' : pct(t.churn)}
          label="NÃO ATIVADO"
          desc="(cadastros − ativações) ÷ cadastros"
          title="É a medida %CHURN da origem. O nome engana: não é cliente que cancelou, é venda que ainda não instalou. Em período recente ela é naturalmente alta, porque a instalação vem depois da venda."
        />
      </section>

      <section className="grid">
        <Visual
          title="QUADRO POR VENDEDOR"
          sub={vazio ? null
            : `${int(data.vendedores)} vendedores · a coluna NÃO ATIVADO é (cadastros − ativações) ÷ cadastros, a medida %CHURN da origem`}
          className="v-matriz"
          ia="relatorios:equipes"
          actions={!vazio && (
            <BotaoExportar onExportar={() => baixar(tabelaParaCSV(colunas, data.linhas), 'quadro-de-equipes.csv')} />
          )}
        >
          {vazio ? <Loading /> : data.linhas.length
            ? (
              <Tabela
                colunas={colunas}
                dados={data.linhas.map((l) => ({ ...l, __key: l.vendedor }))}
                totais={{
                  vendedor: 'TOTAL',
                  equipe: '',
                  situacao: '',
                  cadastros: t.cadastros,
                  ativos: t.ativos,
                  pagamentos: t.pagamentos,
                  valor: t.valor,
                  churn: t.churn,
                }}
              />
            ) : <Vazio />}
        </Visual>
      </section>
    </>
  );
}
