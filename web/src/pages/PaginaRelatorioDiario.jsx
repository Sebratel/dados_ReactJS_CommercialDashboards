import { useDados } from '../api';
import { BotaoExportar, Erro, Loading, Vazio, Visual } from '../components/ui';
import { CHUVA, CORES, escalaGradiente } from '../components/charts';
import { Tabela } from '../components/tables';
import { Icone } from '../components/Icone';
import { brl, dec1, int, labelData, pct } from '../format';
import { baixar, tabelaParaCSV } from '../exportar';

/**
 * Aba RELATÓRIO DIÁRIO — a tela mais densa do relatório de origem: 34 visuais.
 *
 * A pergunta dela é uma só: o mês fecha na meta? E ela responde em TRÊS BLOCOS DE
 * TECNOLOGIA, porque cada visual de lá tem `TECNOLOGIA` no próprio filtro:
 *
 *   FIBRA     — vendas e ativações por cidade, contra meta, mais os cartões
 *   RÁDIO     — o mesmo, com meta ÚNICA (não por cidade, é assim na origem)
 *   TELEFONIA — só contagem e média por dia; não tem meta lá
 *
 * Uma tabela só, somando as três, responderia uma pergunta que ninguém faz.
 *
 * O LAYOUT E AS CORES SEGUEM A ORIGEM, e aqui isso é decisão consciente. Esta é a
 * única tela do dashboard que foge do padrão de cor da casa: barra de título em
 * dourado, corpo de tabela com tom próprio por bloco, cartões de número em vinho.
 * Não é enfeite — quem usa este relatório todo dia acha o número pela cor e pela
 * posição, e uniformizar tudo em branco fez a tela deixar de ser reconhecível.
 * Os tokens ficam escopados em `.tela-diario` para não vazarem.
 *
 * A RÉGUA DE DIAS, que é o que faz os números significarem algo:
 *   sábado vale MEIO dia, domingo zero, feriado zero — a régua da origem.
 *   meta/dia  = meta ÷ dias PRODUTIVOS   (o mês inteiro, porque é alvo)
 *   média/dia = realizado ÷ dias ÚTEIS   (só o que já passou)
 *   projeção  = média/dia × dias produtivos
 * Os dois divisores serem diferentes é de propósito: a projeção pega o ritmo do que
 * já aconteceu e estende pelo mês todo.
 */

/** Polaridade em relação à meta: abaixo esfria, acima esquenta. Neutro no meio. */
const corDoPercentual = (linha) => {
  const v = Number(linha.percentual);
  if (!Number.isFinite(v)) return undefined;
  if (v >= 1) return escalaGradiente(Math.min(v, 2), 1, 2, '#DFF0DC', '#8FCB88');
  return escalaGradiente(v, 0, 1, '#F6DAD5', '#F3EFD8');
};

const COLUNAS_META = (rotulo, rotuloRealizado) => [
  { key: 'nome', titulo: rotulo, align: 'left' },
  { key: 'meta', titulo: 'META', fmt: int },
  { key: 'projecao', titulo: 'PROJEÇÃO', fmt: int },
  { key: 'realizado', titulo: rotuloRealizado, fmt: int, databar: { cor: CORES.gold } },
  { key: 'percentual', titulo: `% ${rotuloRealizado}`, fmt: pct, align: 'center', corFundo: corDoPercentual },
  { key: 'metaDia', titulo: 'META/DIA', fmt: dec1 },
  { key: 'mediaDia', titulo: `${rotuloRealizado}/DIA`, fmt: dec1 },
];

const COLUNAS_TELEFONIA = [
  { key: 'nome', titulo: 'CIDADE', align: 'left' },
  { key: 'vendas', titulo: 'VENDAS', fmt: int, databar: { cor: CORES.gold } },
  { key: 'mediaDia', titulo: 'VENDAS/DIA', fmt: dec1 },
];

const COLUNAS_FILA = [
  { key: 'nome', titulo: 'CIDADE', align: 'left' },
  { key: 'valor', titulo: 'TOTAL', fmt: int },
];

/**
 * Cartão de número grande, no formato dos `card` da origem: rótulo embaixo do
 * número, fundo em vinho, texto branco. O par fundo+texto muda junto, no CSS.
 *
 * `tom` escolhe entre o vinho dos números de negócio e o cinza dos contadores de
 * dia — a mesma distinção que a origem faz, e ela ajuda: dia útil não é resultado.
 */
function CartaoDiario({ valor, rotulo, tom = 'vinho', largo = false, title }) {
  return (
    <div className={`cartao-diario ${tom}${largo ? ' largo' : ''}`} title={title || undefined}>
      <strong>{valor}</strong>
      <span>{rotulo}</span>
    </div>
  );
}

/** Tabela pequena da fila, com o subtítulo que explica a equipe. */
function TabelaFila({ titulo, sub, bloco, vazio, tom }) {
  return (
    <Visual title={titulo} sub={vazio ? null : sub} className={`v-meia bloco-${tom}`}>
      {vazio ? <Loading /> : bloco.porCidade.length
        ? (
          <Tabela
            colunas={COLUNAS_FILA}
            dados={bloco.porCidade.map((l) => ({ ...l, __key: l.nome }))}
            totais={{ nome: 'TOTAL', valor: bloco.total }}
          />
        ) : <Vazio texto="Nenhum protocolo nesta fila" />}
    </Visual>
  );
}

export function PaginaRelatorioDiario({ filtros }) {
  const { data, error, isLoading } = useDados('/relatorios/diario', filtros);
  const vazio = isLoading && !data;

  if (error) return <Erro erro={error} />;

  const subMeta = vazio ? null
    : `meta ÷ ${dec1(data.dias.produtivos)} dias produtivos · média ÷ ${dec1(data.dias.uteis)} dias úteis decorridos`;

  const tabelaMeta = ({ titulo, bloco, rotulo, tom, ia, nome }) => (
    <Visual
      title={titulo}
      sub={subMeta}
      className={`v-tabela bloco-${tom}`}
      ia={ia}
      actions={!vazio && (
        <BotaoExportar onExportar={() => baixar(
          tabelaParaCSV(COLUNAS_META('CIDADE', rotulo), bloco.linhas), `${nome}.csv`,
        )}
        />
      )}
    >
      {vazio ? <Loading /> : bloco.linhas.length
        ? (
          <Tabela
            colunas={COLUNAS_META('CIDADE', rotulo)}
            dados={bloco.linhas.map((l) => ({ ...l, __key: l.nome }))}
            totais={bloco.total}
          />
        ) : <Vazio />}
    </Visual>
  );

  return (
    <div className="tela-diario">
      {!vazio && data.periodo.padrao && (
        <p className="aviso-recorte">
          <Icone nome="relogio" tamanho={12} />
          Mês corrente ({labelData(data.periodo.de)} a {labelData(data.periodo.ate)}), que é o padrão
          desta tela — o período no filtro acima troca o mês.
          {data.excluidos.ativacoesFibra + data.excluidos.ativacoesRadio > 0 && (
            <>
              {' '}As ativações não contam {data.excluidos.clientes.join(' nem ')}
              {' '}({int(data.excluidos.ativacoesFibra + data.excluidos.ativacoesRadio)} no mês),
              como no relatório de origem: são contratos institucionais que valem um prédio.
            </>
          )}
        </p>
      )}

      <section className="grid linha-diario">
        {/* ---- coluna esquerda: os três blocos de tecnologia (x=22 na origem) ---- */}
        <div className="coluna-diario">
          {vazio ? <Visual title="VENDAS FIBRA" className="v-tabela"><Loading /></Visual>
            : tabelaMeta({
              titulo: 'VENDAS FIBRA', bloco: data.fibra.vendas, rotulo: 'VENDAS',
              tom: 'azul', ia: 'relatorios:diario-vendas', nome: 'vendas-fibra',
            })}

          {vazio ? <Visual title="ATIVOS FIBRA" className="v-tabela"><Loading /></Visual>
            : tabelaMeta({
              titulo: 'ATIVOS FIBRA', bloco: data.fibra.ativos, rotulo: 'ATIVOS',
              tom: 'verde', ia: 'relatorios:diario-ativos', nome: 'ativos-fibra',
            })}

          <Visual
            title="RÁDIO"
            sub={vazio ? null : 'meta de rádio é um número único na origem, não por cidade — uma linha para cada lado'}
            className="v-meia bloco-azul"
          >
            {vazio ? <Loading /> : (
              <Tabela
                colunas={COLUNAS_META('', 'REALIZADO')}
                dados={[
                  { ...data.radio.vendas, __key: 'v' },
                  { ...data.radio.ativos, __key: 'a' },
                ]}
              />
            )}
          </Visual>

          <Visual
            title="VENDAS TELEFONIA"
            sub={vazio ? null : 'sem meta no relatório de origem — só contagem e média por dia'}
            className="v-meia bloco-roxo"
          >
            {vazio ? <Loading /> : data.telefonia.linhas.length
              ? (
                <Tabela
                  colunas={COLUNAS_TELEFONIA}
                  dados={data.telefonia.linhas.map((l) => ({ ...l, __key: l.nome }))}
                  totais={data.telefonia.total}
                />
              ) : <Vazio texto="Nenhuma venda de telefonia no mês" />}
          </Visual>
        </div>

        {/* ---- coluna direita: filas e números (x=1256 na origem) ---- */}
        <div className="coluna-diario">
          <div className="par-diario">
            <TabelaFila
              titulo="BKO"
              sub="protocolos na equipe Validação de Dados — parados na conferência de cadastro"
              bloco={vazio ? null : data.fila.bkoFibra}
              vazio={vazio}
              tom="salmao"
            />
            <TabelaFila
              titulo="AGENDADOS"
              sub="protocolos nas equipes de campo — já têm agenda, esperam a rua"
              bloco={vazio ? null : data.fila.agendadosFibra}
              vazio={vazio}
              tom="pessego"
            />
          </div>

          <div className="cartoes-diario">
            <CartaoDiario valor={vazio ? '—' : int(data.fibra.cartoes.ativos)} rotulo="ATIVOS" />
            <CartaoDiario valor={vazio ? '—' : int(data.fibra.cartoes.projecao)} rotulo="PROJEÇÃO ATIVOS" />
            <CartaoDiario
              largo
              valor={vazio ? '—' : brl(data.fibra.cartoes.valor)}
              rotulo="VALOR INSTALADO"
              title="Soma da mensalidade dos contratos de FIBRA ativados no mês — é o que passa a faturar, não o que foi vendido."
            />
            <CartaoDiario
              tom="cinza"
              valor={vazio ? '—' : dec1(data.dias.produtivos)}
              rotulo="DIAS PRODUTIVOS"
              title="Régua da origem: sábado 0,5, domingo 0, feriado 0. Divide a meta e multiplica a projeção. Os feriados vêm de Configurações → Feriados."
            />
            <CartaoDiario
              tom="cinza"
              valor={vazio ? '—' : dec1(data.dias.uteis)}
              rotulo="DIAS TRABALHADOS"
              title="Conta só até ontem. Incluir o dia de hoje, ainda em andamento, derrubaria a média por dia toda manhã."
            />
          </div>

          <div className="par-diario">
            <TabelaFila
              titulo="AGENDADOS RÁDIO"
              sub="equipes de campo, protocolos de rádio"
              bloco={vazio ? null : data.fila.agendadosRadio}
              vazio={vazio}
              tom="roxo"
            />
            <TabelaFila
              titulo="BKO RÁDIO"
              sub="Validação de Dados, protocolos de rádio"
              bloco={vazio ? null : data.fila.bkoRadio}
              vazio={vazio}
              tom="salmao"
            />
          </div>

          <div className="cartoes-diario">
            <CartaoDiario valor={vazio ? '—' : int(data.radio.cartoes.ativos)} rotulo="ATIVOS RÁDIO" />
            <CartaoDiario valor={vazio ? '—' : int(data.radio.cartoes.projecao)} rotulo="PROJEÇÃO RÁDIO" />
            <CartaoDiario
              largo
              valor={vazio ? '—' : brl(data.radio.cartoes.valor)}
              rotulo="VALOR INSTALADO RÁDIO"
            />
          </div>
        </div>
      </section>

      <section className="grid">
        <Visual
          title="CLIMA / TEMPO"
          sub={vazio ? null : legendaClima(data.clima)}
          className="v-tabela bloco-dourado"
          ia="relatorios:diario-fila"
        >
          {vazio ? <Loading /> : <MatrizClima clima={data.clima} />}
        </Visual>
      </section>
    </div>
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
              <th key={d} className="center" title={labelData(d)}>
                {d.slice(8)}/{d.slice(5, 7)}
              </th>
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

function legendaClima(clima) {
  if (clima.erro) return 'a busca do clima falhou; o resto da tela não depende dela';
  const fortes = clima.celulas.reduce((a, l) => a + l.dias.filter((d) => d?.classificacao === 'Forte').length, 0);
  return `${clima.cidades.length} cidades · ${clima.dias.length} dias · ${fortes} dia-cidade com chuva forte (acima de 20 mm) · Porto Alegre fica fora, como na origem · fonte Open-Meteo`;
}
