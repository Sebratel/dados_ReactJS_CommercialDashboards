import { useDados } from '../api';
import { BotaoExportar, Erro, Kpi, Loading, Vazio, Visual } from '../components/ui';
import { CHUVA, CORES, escalaGradiente } from '../components/charts';
import { Tabela } from '../components/tables';
import { Icone } from '../components/Icone';
import { brl, dec1, int, labelData, pct } from '../format';
import { baixar, tabelaParaCSV } from '../exportar';

/**
 * Aba RELATÓRIO DIÁRIO — a tela mais densa do relatório de origem: 34 visuais.
 *
 * A pergunta dela é uma só: o mês fecha na meta? E ela responde em quatro cortes
 * (venda e ativação, fibra e rádio), mais a fila de instalação e o clima.
 *
 * A RÉGUA DE DIAS, que é o que faz os números significarem algo:
 *   sábado vale MEIO dia, domingo zero, feriado zero — a régua da origem.
 *   meta/dia  = meta ÷ dias PRODUTIVOS   (o mês inteiro, porque é alvo)
 *   média/dia = realizado ÷ dias ÚTEIS   (só o que já passou)
 *   projeção  = média/dia × dias produtivos
 * Os dois divisores serem diferentes é de propósito: a projeção pega o ritmo do que
 * já aconteceu e estende pelo mês todo.
 *
 * O clima está aqui e não é enfeite: instalação de fibra é serviço de rua, e um dia
 * de chuva forte derruba ativação. A matriz ao lado da meta explica um dia ruim sem
 * ninguém precisar procurar a explicação.
 */

/** Polaridade em relação à meta: abaixo esfria, acima esquenta. Neutro no meio. */
const corDoPercentual = (linha) => {
  const v = Number(linha.percentual);
  if (!Number.isFinite(v)) return undefined;
  if (v >= 1) return escalaGradiente(Math.min(v, 2), 1, 2, '#DFF0DC', '#8FCB88');
  return escalaGradiente(v, 0, 1, '#F6DAD5', '#F3EFD8');
};

const COLUNAS_META = (rotulo) => [
  { key: 'nome', titulo: rotulo, align: 'left' },
  { key: 'meta', titulo: 'META', fmt: int },
  { key: 'realizado', titulo: 'REALIZADO', fmt: int, databar: { cor: CORES.gold } },
  { key: 'percentual', titulo: '% DA META', fmt: pct, align: 'center', corFundo: corDoPercentual },
  { key: 'metaDia', titulo: 'META/DIA', fmt: dec1 },
  { key: 'mediaDia', titulo: 'MÉDIA/DIA', fmt: dec1 },
  { key: 'projecao', titulo: 'PROJEÇÃO', fmt: int },
];

export function PaginaRelatorioDiario({ filtros }) {
  const { data, error, isLoading } = useDados('/relatorios/diario', filtros);
  const vazio = isLoading && !data;
  const c = data?.cartoes;

  if (error) return <Erro erro={error} />;

  const tabelaMeta = (bloco, rotulo, nome) => (
    <Visual
      title={rotulo.toUpperCase()}
      sub={vazio ? null : `meta ÷ ${dec1(data.dias.produtivos)} dias produtivos · média ÷ ${dec1(data.dias.uteis)} dias úteis já decorridos`}
      className="v-tabela"
      ia={`relatorios:diario-${nome}`}
      actions={!vazio && (
        <BotaoExportar onExportar={() => baixar(
          tabelaParaCSV(COLUNAS_META('CIDADE'), bloco.linhas), `meta-${nome}.csv`,
        )}
        />
      )}
    >
      {vazio ? <Loading /> : bloco.linhas.length
        ? (
          <Tabela
            colunas={COLUNAS_META('CIDADE')}
            dados={bloco.linhas.map((l) => ({ ...l, __key: l.nome }))}
            totais={bloco.total}
          />
        ) : <Vazio />}
    </Visual>
  );

  return (
    <>
      {!vazio && data.periodo.padrao && (
        <p className="aviso-recorte">
          <Icone nome="relogio" tamanho={12} />
          Mostrando o mês corrente ({labelData(data.periodo.de)} a {labelData(data.periodo.ate)}), que é
          o padrão desta tela. O período no filtro acima troca o mês.
        </p>
      )}

      <section className="grid linha-cinco">
        <Kpi
          value={vazio ? '—' : int(c.vendas)}
          label="VENDAS"
          desc="contratos criados no mês"
        />
        <Kpi
          value={vazio ? '—' : int(c.ativos)}
          label="ATIVAÇÕES"
          desc="instalações concluídas no mês"
        />
        <Kpi
          value={vazio ? '—' : brl(c.valorAtivo)}
          label="VALOR ATIVADO"
          desc="mensalidade das ativações do mês"
          title="Soma da mensalidade dos contratos ATIVADOS no mês — é o que passa a faturar, não o que foi vendido."
        />
        <Kpi
          value={vazio ? '—' : dec1(c.diasProdutivos)}
          label="DIAS PRODUTIVOS"
          desc="do mês, com sábado valendo meio"
          title="Régua da origem: sábado 0,5, domingo 0, feriado 0. É o divisor da meta/dia e o multiplicador da projeção. Os feriados vêm de Configurações → Feriados."
        />
        <Kpi
          value={vazio ? '—' : dec1(c.diasUteis)}
          label="DIAS DECORRIDOS"
          desc="já passados, na mesma régua"
          title="Conta só até ontem. Incluir o dia de hoje, ainda em andamento, derrubaria a média por dia toda manhã."
        />
      </section>

      <section className="grid linha-dupla">
        {vazio ? <Visual title="VENDAS POR CIDADE" className="v-tabela"><Loading /></Visual>
          : tabelaMeta(data.vendas, 'Vendas por cidade', 'vendas')}
        {vazio ? <Visual title="ATIVAÇÕES POR CIDADE" className="v-tabela"><Loading /></Visual>
          : tabelaMeta(data.ativos, 'Ativações por cidade', 'ativos')}
      </section>

      <section className="grid linha-dupla">
        <Visual
          title="RÁDIO"
          sub={vazio ? null : 'na origem a meta de rádio é um número único, não por cidade — então é uma linha para cada lado'}
          className="v-meia"
        >
          {vazio ? <Loading /> : (
            <Tabela
              colunas={COLUNAS_META('')}
              dados={[
                { ...data.vendasRadio, nome: 'Vendas', __key: 'v' },
                { ...data.ativosRadio, nome: 'Ativações', __key: 'a' },
              ]}
            />
          )}
        </Visual>

        <Visual
          title="FILA DE INSTALAÇÃO"
          sub={vazio ? null : legendaFila(data.fila)}
          className="v-meia"
          ia="relatorios:diario-fila"
        >
          {vazio ? <Loading /> : (
            <FilaPorCidade fila={data.fila} />
          )}
        </Visual>
      </section>

      <section className="grid">
        <Visual
          title="CHUVA POR CIDADE E DIA"
          sub={vazio ? null : legendaClima(data.clima)}
          className="v-tabela"
        >
          {vazio ? <Loading /> : <MatrizClima clima={data.clima} />}
        </Visual>
      </section>
    </>
  );
}

/** As duas tabelas de fila da origem (fibra e rádio) numa matriz de cidade. */
function FilaPorCidade({ fila }) {
  const cidades = [...new Set([
    ...fila.fibra.porCidade.map((l) => l.nome),
    ...fila.radio.porCidade.map((l) => l.nome),
  ])].sort((a, b) => a.localeCompare(b, 'pt-BR'));

  if (!cidades.length) return <Vazio texto="Nenhuma instalação em aberto" />;

  const mapa = (linhas) => new Map(linhas.map((l) => [l.nome, l.valor]));
  const fibra = mapa(fila.fibra.porCidade);
  const radio = mapa(fila.radio.porCidade);

  const colunas = [
    { key: 'cidade', titulo: 'CIDADE', align: 'left' },
    { key: 'fibra', titulo: 'FIBRA', fmt: int, databar: { cor: CORES.gold } },
    { key: 'radio', titulo: 'RÁDIO', fmt: int, databar: { cor: CORES.orange } },
    { key: 'total', titulo: 'TOTAL', fmt: int },
  ];
  const dados = cidades.map((cidade) => {
    const f = fibra.get(cidade) || 0;
    const r = radio.get(cidade) || 0;
    return { __key: cidade, cidade, fibra: f, radio: r, total: f + r };
  });

  return (
    <Tabela
      colunas={colunas}
      dados={dados}
      totais={{
        cidade: 'TOTAL',
        fibra: fila.fibra.total,
        radio: fila.radio.total,
        total: fila.fibra.total + fila.radio.total,
      }}
    />
  );
}

/**
 * Matriz cidade × dia com a classificação da chuva.
 *
 * Tabela crua e não o componente `Matriz`: aquele soma número por dia, e aqui a
 * célula é categoria (com ícone), não valor. Somar chuva não faz sentido.
 */
function MatrizClima({ clima }) {
  if (clima.erro) {
    return (
      <Vazio texto={`Não foi possível buscar o clima: ${clima.erro}. O resto da tela não depende dele.`} />
    );
  }
  if (!clima.dias.length) return <Vazio texto="Sem dados de chuva para o período" />;

  return (
    <div className="tbl-wrap">
      <table className="pbi matriz">
        <thead>
          <tr>
            <th className="left col-nome">CIDADE</th>
            {clima.dias.map((d) => (
              <th key={d} className="center" title={labelData(d)}>{d.slice(8)}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {clima.celulas.map((linha) => (
            <tr key={linha.cidade}>
              <td className="left col-nome">{linha.cidade}</td>
              {linha.dias.map((cel, i) => {
                const ic = cel ? CHUVA[cel.classificacao] : null;
                return (
                  <td
                    key={clima.dias[i]}
                    className="center"
                    title={cel
                      ? `${labelData(clima.dias[i])} · ${cel.classificacao} · ${dec1(cel.mm)} mm · ${cel.tipo}`
                      : 'sem medida'}
                  >
                    {ic ? <Icone nome={ic.icone} tamanho={13} style={{ color: ic.cor }} /> : '–'}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function legendaFila(fila) {
  const base = `${int(fila.fibra.total + fila.radio.total)} em aberto · sem recorte de data, porque fila é retrato do agora`;
  if (!fila.oculta) return base;
  return `${base} · a tabela de detalhe da aba Geral não mostra ${int(fila.oculta)} da equipe Field Service, mas estes totais mostram — a divergência é da origem`;
}

function legendaClima(clima) {
  if (clima.erro) return 'a busca do clima falhou; o resto da tela não depende dela';
  const fortes = clima.celulas.reduce((a, l) => a + l.dias.filter((d) => d?.classificacao === 'Forte').length, 0);
  return `${clima.cidades.length} cidades · ${clima.dias.length} dias · ${fortes} dia-cidade com chuva forte (acima de 20 mm) · fonte Open-Meteo`;
}
