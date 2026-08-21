import { useDados } from '../api';
import { BotaoExportar, Erro, Kpi, Legenda, Loading, Vazio, Visual } from '../components/ui';
import { COR_STATUS, ColunasEmpilhadas, CORES, escalaGradiente } from '../components/charts';
import { Tabela } from '../components/tables';
import { brl, int, labelDataHora, labelMes, pct } from '../format';
import { baixar, baixarDoServidor, tabelaParaCSV } from '../exportar';

/**
 * Sub-página NEGOCIAÇÕES do relatório "COM - Leads & Negociações" (2800x3000,
 * 25 visuais de dados).
 *
 * A ORDEM dos blocos segue a do relatório, lida das coordenadas: y=171 os quatro
 * cartões, y=355 os dois pivôs e o gráfico, y=982 o detalhamento completo, y=1669
 * as cinco tabelas de dimensão e y=2322 as outras quatro.
 *
 * A BASE desta tela é a negociação, não o lead — e essa é a decisão mais
 * importante aqui. O período filtra a data de criação da NEGOCIAÇÃO e o vendedor
 * é o RESPONSÁVEL por ela. Medido no banco: 6.694 negociações, de 5.660 leads,
 * têm o lead cadastrado antes do recorte de 01/01/2026 — 21% do total. Herdar a
 * base da sub-página de Leads faria os quatro cartões nascerem um quinto abaixo.
 *
 * DIFERENÇAS em relação ao relatório:
 *
 *  - Seis das nove tabelas de dimensão mostram, no relatório, DUAS contagens
 *    quase idênticas: `CountNonNull(negociacao_id)` e a medida `Total
 *    Negociacoes`, que é `COUNT(titulo_negociacao)`. Dão o mesmo número sempre
 *    que a negociação tem título, ou seja, quase sempre. Aqui a segunda coluna é
 *    a participação no total.
 *  - EQUIPE filtra pela equipe do RESPONSÁVEL. No modelo de origem a relação
 *    ativa com a dimensão de vendedores é a do dono do LEAD, então lá "EQUIPE" e
 *    "VENDEDOR", lado a lado na mesma barra, podem se referir a duas pessoas
 *    diferentes. Aqui os dois falam da mesma pessoa.
 *  - Sem emojis; colunas empilhadas onde o relatório usa agrupadas.
 */

const corDoStatus = (linha) => COR_STATUS[linha.status] || undefined;
const corDoStatusKey = (linha) => COR_STATUS[linha.key] || undefined;
const corDoPct = (linha) => escalaGradiente(Number(linha.pct) || 0, 0, 1, '#f7f0d0', CORES.gold);

/** As nove tabelas de dimensão têm todas a mesma forma: rótulo, qtd e %. */
const dimensao = (titulo) => [
  { key: 'key', titulo, align: 'left' },
  { key: 'qtd', titulo: 'NEGOCIAÇÕES', fmt: int, databar: { cor: CORES.gold } },
  { key: 'ganhas', titulo: 'GANHAS', fmt: int },
  { key: 'pct', titulo: '%', fmt: pct, align: 'center', corFundo: corDoPct },
];

export function PaginaNegociacoes({ filtros }) {
  const { data, error, isLoading } = useDados('/negociacoes', filtros);
  const vazio = isLoading && !data;
  const k = data?.kpis;

  const serie = {
    series: data?.serieStatus?.series || [],
    dados: (data?.serieStatus?.dados || []).map((d) => ({ ...d, label: labelMes(d.periodo) })),
  };

  // ---- y=355 esquerda: negociações por lead -----------------------------
  const statusCols = data?.serieStatus?.series?.length
    ? data.serieStatus.series
    : ['Ganho', 'Perda', 'Em Andamento'];
  const colunasPorLead = [
    { key: 'nome', titulo: 'LEAD', align: 'left' },
    { key: 'leadId', titulo: 'ID', fmt: (v) => (v == null ? '—' : int(v)) },
    ...statusCols.map((s) => ({
      key: s,
      titulo: s.toUpperCase(),
      fmt: (v) => (v ? int(v) : '—'),
    })),
    { key: 'total', titulo: 'TOTAL', fmt: int, bold: true },
  ];

  // ---- y=355 meio: status x motivo (conta LEADS, base = quem negociou) ---
  const colunasMotivo = [
    { key: 'status', titulo: 'STATUS', align: 'center', corFundo: corDoStatus },
    { key: 'motivo', titulo: 'MOTIVO', align: 'left' },
    { key: 'leads', titulo: 'LEADS', fmt: int, databar: { cor: CORES.gold } },
    { key: 'pct', titulo: '%', fmt: pct, align: 'center', corFundo: corDoPct },
  ];

  // ---- y=982: as 17 colunas do relatório, na ordem de lá -----------------
  const colunasCompleto = [
    { key: 'nome', titulo: 'LEAD', align: 'left' },
    { key: 'status', titulo: 'STATUS', align: 'center', corFundo: corDoStatus },
    { key: 'titulo', titulo: 'NEGOCIAÇÃO', align: 'left' },
    { key: 'responsavel', titulo: 'RESPONSÁVEL', align: 'left' },
    { key: 'equipe', titulo: 'EQUIPE', align: 'left', fmt: (v) => v || '—' },
    { key: 'time', titulo: 'TIME', align: 'left' },
    { key: 'protocolo', titulo: 'PROTOCOLO', align: 'left' },
    { key: 'campanha', titulo: 'CAMPANHA', align: 'left' },
    { key: 'origem', titulo: 'ORIGEM', align: 'left' },
    { key: 'forma', titulo: 'FORMA', align: 'left' },
    { key: 'faseFunil', titulo: 'FASE DO FUNIL', align: 'left' },
    { key: 'motivo', titulo: 'MOTIVO', align: 'left' },
    { key: 'dtInicio', titulo: 'INÍCIO', fmt: labelDataHora },
    { key: 'dtFim', titulo: 'FIM', fmt: labelDataHora },
    { key: 'duracao', titulo: 'DURAÇÃO', align: 'center' },
    { key: 'contrato', titulo: 'CONTRATO', align: 'left' },
    { key: 'servico', titulo: 'PLANO', align: 'left' },
    { key: 'valor', titulo: 'VALOR', fmt: brl },
  ];

  const colunasValores = [
    { key: 'key', titulo: 'STATUS', align: 'center', corFundo: corDoStatusKey },
    { key: 'qtd', titulo: 'NEGOCIAÇÕES', fmt: int, databar: { cor: CORES.gold } },
    { key: 'valor', titulo: 'VALOR', fmt: brl },
    { key: 'pct', titulo: '%', fmt: pct, align: 'center', corFundo: corDoPct },
  ];

  const tabela = (colunas, dados, ordem) => (
    vazio ? <Loading /> : <Tabela colunas={colunas} dados={dados || []} ordemInicial={ordem} />
  );

  return (
    <>
      {error && <Erro erro={error} />}

      <div className="banner">
        A base desta tela é a <b>negociação</b>: o período filtra a data de criação dela e o
        vendedor é o <b>responsável</b>, não o dono do lead. São bases diferentes de propósito —
        21% das negociações são de leads cadastrados antes do recorte de 01/01/2026, e herdar o
        filtro da sub-página de Leads perderia uma em cada cinco.
      </div>

      {/* y=171: os quatro cartões do relatório, mais receita e ticket */}
      <div className="kpi-faixa">
        <Kpi
          value={int(k?.total || 0)}
          label="NEGOCIAÇÕES"
          desc={k && k.linhas > k.total
            ? `distintas — a consulta devolve ${int(k.linhas)} linhas porque negociação com dois planos vira duas`
            : 'etapas de venda criadas no período'}
          title="Contagem DISTINTA de negociacao_id — a medida Medidas_old[Negociacoes]. O relatório também tem Medidas[Total Negociacoes], que conta linhas: uma negociação com dois planos aparece duas vezes lá. Toda contagem desta tela usa a distinta, para tabela e cartão não se contradizerem."
        />
        <Kpi
          value={int(k?.['Em Andamento'] || 0)}
          label="EM ANDAMENTO"
          desc="sem motivo de ganho nem de perda"
          title="O status sai do tipo do motivo: 1 é ganho, 0 é perda, e qualquer outra coisa (inclusive motivo em branco) é Em Andamento."
        />
        <Kpi
          value={int(k?.Ganho || 0)}
          label="GANHAS"
          desc="motivo do tipo ganho"
          title="Medidas_old[Negociacoes_Ganhas]: negociações cujo motivo tem type = 1."
        />
        <Kpi
          value={int(k?.Perda || 0)}
          label="PERDIDAS"
          desc="motivo do tipo perda"
          title="Medidas_old[Negociacoes_Perdas]: negociações cujo motivo tem type = 0."
        />
        <Kpi
          value={brl(k?.receita || 0)}
          label="RECEITA"
          small
          desc="soma do plano das negociações ganhas"
          title="Medidas[Receita Total]: SUM(valor_servico) só das negociações com status Ganho. É a mensalidade do plano negociado — receita recorrente que começa, não valor acumulado."
        />
        <Kpi
          value={brl(k?.ticketMedio || 0)}
          label="TICKET MÉDIO"
          small
          desc={`receita dividida por ${int(k?.leadsGanhos || 0)} leads ganhos`}
          title="Medidas[Ticket Medio]: receita total dividida pela contagem DISTINTA de leads com negociação ganha — por lead, não por negociação, porque um lead pode ter várias."
        />
      </div>

      {/* y=355: dois pivôs e o gráfico de status por mês */}
      <div className="grid linha-38-19-43">
        <Visual
          title="NEGOCIAÇÕES POR LEAD"
          sub={data
            ? `${int(data.porLeadTotal)} leads com negociação${data.porLeadTotal > (data.porLead || []).length ? ` — a tabela mostra os ${int((data.porLead || []).length)} com mais negociações` : ''}`
            : ''}
          flush
          className="v-meia"
        >
          {tabela(colunasPorLead, data?.porLead, { key: 'total', dir: 'desc' })}
        </Visual>

        <Visual
          title="NEGOCIAÇÕES × MOTIVOS"
          sub={data
            ? `conta LEADS, e a base do % são os ${int(data.kpis.leadsComNegociacao)} que negociaram — é a base do relatório aqui`
            : ''}
          flush
          className="v-meia"
          ia="negociacoes:motivo"
        >
          {tabela(colunasMotivo, data?.porMotivo, { key: 'leads', dir: 'desc' })}
        </Visual>

        <Visual
          title="STATUS POR NEGOCIAÇÃO / MÊS"
          sub="pelo mês de criação da negociação; empilhado para o total do mês aparecer"
          className="v-meia"
          ia="negociacoes:serie"
        >
          {vazio ? <Loading />
            : !serie.dados.length ? <Vazio texto="Sem negociações para os filtros selecionados" />
              : (
                <>
                  <Legenda itens={serie.series.map((s) => ({ label: s, cor: COR_STATUS[s] }))} />
                  <div style={{ flex: 1, minHeight: 0 }}>
                    <ColunasEmpilhadas
                      data={serie.dados}
                      series={serie.series}
                      cores={(s) => COR_STATUS[s]}
                    />
                  </div>
                </>
              )}
        </Visual>
      </div>

      {/* y=982: o detalhamento completo, largura inteira */}
      <Visual
        title="NEGOCIAÇÕES COMPLETO"
        sub={data
          ? `${int(data.total)} negociações — a tabela mostra as ${int((data.completo || []).length)} mais recentes; o CSV traz todas`
          : ''}
        flush
        className="v-tabela-alta"
        actions={(
          <BotaoExportar
            titulo="Baixar todas as negociações do filtro, com responsável, plano e valor"
            rotulo="CSV completo"
            onExportar={() => baixarDoServidor('negociacoes', filtros)}
          />
        )}
      >
        {tabela(colunasCompleto, data?.completo, { key: 'dtInicio', dir: 'desc' })}
      </Visual>

      {/* y=1669: as cinco tabelas de dimensão */}
      <div className="grid linha-cinco">
        <Visual title="RESPONSÁVEL" flush className="v-meia" ia="negociacoes:responsavel"
          actions={(
            <BotaoExportar onExportar={() => baixar(
              'negociacoes-por-responsavel.csv',
              tabelaParaCSV(dimensao('RESPONSÁVEL'), data?.porResponsavel || []),
            )} />
          )}
        >
          {tabela(dimensao('RESPONSÁVEL'), data?.porResponsavel)}
        </Visual>
        <Visual title="FASE DO FUNIL" flush className="v-meia" ia="negociacoes:fase">
          {tabela(dimensao('FASE'), data?.porFase)}
        </Visual>
        <Visual title="ORIGEM" flush className="v-meia" ia="negociacoes:origem">
          {tabela(dimensao('ORIGEM'), data?.porOrigem)}
        </Visual>
        <Visual title="FORMA DE CONTATO" flush className="v-meia">
          {tabela(dimensao('FORMA'), data?.porForma)}
        </Visual>
        <Visual title="REGIÃO" flush className="v-meia">
          {tabela(dimensao('REGIÃO'), data?.porRegiao)}
        </Visual>
      </div>

      {/* y=2322: times, contrato, plano e valores por status */}
      <div className="grid linha-quatro">
        <Visual title="TIMES" flush className="v-meia">
          {tabela(dimensao('TIME'), data?.porTime)}
        </Visual>
        <Visual title="TIPO DE CONTRATO" flush className="v-meia">
          {tabela(dimensao('CONTRATO'), data?.porTipoContrato)}
        </Visual>
        <Visual
          title="PLANO"
          sub="a soma passa do total: negociação com dois planos conta nos dois"
          flush
          className="v-meia"
          ia="negociacoes:plano"
        >
          {tabela(dimensao('PLANO'), data?.porServico)}
        </Visual>
        <Visual
          title="VALORES POR STATUS"
          sub="soma do plano negociado"
          flush
          className="v-meia"
          ia="negociacoes:valores"
        >
          {tabela(colunasValores, data?.porValorStatus, { key: 'qtd', dir: 'desc' })}
        </Visual>
      </div>
    </>
  );
}
