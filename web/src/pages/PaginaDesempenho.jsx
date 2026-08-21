import { useDados } from '../api';
import { BotaoExportar, Erro, Kpi, Loading, Vazio, Visual } from '../components/ui';
import { BarrasHorizontais, CORES, escalaGradiente } from '../components/charts';
import { Tabela } from '../components/tables';
import { brl, int, pct } from '../format';
import { baixar, tabelaParaCSV } from '../exportar';

/**
 * As duas sub-páginas de Desempenho — DO VENDEDOR e POR CIDADE.
 *
 * No relatório são duas páginas de 5100px cada, com 32 e 30 visuais. Comparando
 * visual por visual, são a MESMA página com outra dimensão de linha: mesmos
 * cartões, mesma matriz de produtividade, mesmos funis, mesmas oito tabelas de
 * perda. Então aqui é um componente só, com `por` escolhendo o agrupamento — o
 * que também garante que as duas nunca divirjam por descuido.
 *
 * A ORDEM segue a do relatório: y=453 produtividade e os cartões à direita,
 * y=1102 status e resumo, y=1752 os dois funis e a taxa por forma de contato,
 * y=2418 a taxa por origem, y=3282 em diante as tabelas de perda.
 *
 * O QUE CADA LADO AGRUPA, que é a decisão central da tela:
 *
 *  - por vendedor: leads pelo DONO DO LEAD, negociações pelo RESPONSÁVEL. Uma
 *    negociação conta para quem a conduziu, mesmo que o lead seja de outro. É o
 *    USERELATIONSHIP das medidas do relatório.
 *  - por cidade: leads pela cidade deles, negociações pela cidade do LEAD. Aqui
 *    negociação de lead fora do recorte fica de fora — cidade quem tem é o lead.
 *
 * Numa linha de vendedor, a taxa de conversão de CADASTRO e a de NEGOCIAÇÃO têm
 * bases diferentes de propósito: a primeira é sobre os leads que ele cadastrou, a
 * segunda sobre as negociações que ele conduziu.
 */

const corDaTaxa = (v) => escalaGradiente(Number(v) || 0, 0, 1, '#f7f0d0', CORES.gold);
const corDoPct = (linha) => corDaTaxa(linha.pct);
const taxa = (k) => (linha) => corDaTaxa(linha[k]);

/** As oito tabelas de perda têm a mesma forma: rótulo, quantidade e %. */
const perda = (titulo, rotuloQtd) => [
  { key: 'key', titulo, align: 'left' },
  { key: 'qtd', titulo: rotuloQtd, fmt: int, databar: { cor: '#b3261e' } },
  { key: 'pct', titulo: '%', fmt: pct, align: 'center', corFundo: corDoPct },
];

export function PaginaDesempenho({ filtros, por }) {
  const { data, error, isLoading } = useDados('/desempenho', { ...filtros, por });
  const vazio = isLoading && !data;
  const k = data?.kpis;
  const rotulo = por === 'cidade' ? 'CIDADE' : 'VENDEDOR';

  // ---- y=453: a matriz de produtividade ---------------------------------
  const colunasProdutividade = [
    { key: 'key', titulo: rotulo, align: 'left' },
    { key: 'cadastrados', titulo: 'LEADS CADASTRADOS', fmt: int, databar: { cor: CORES.goldSoft } },
    { key: 'ganhosLead', titulo: 'CADASTRADOS E GANHOS', fmt: int },
    { key: 'taxaCadastro', titulo: 'CONVERSÃO DE CADASTRO', fmt: pct, align: 'center', corFundo: taxa('taxaCadastro') },
    { key: 'conduzidas', titulo: 'NEGOCIAÇÕES CONDUZIDAS', fmt: int, databar: { cor: CORES.gold } },
    { key: 'ganhasNeg', titulo: 'CONDUZIDAS GANHAS', fmt: int },
    { key: 'taxaNegociacao', titulo: 'CONVERSÃO DE NEGOCIAÇÃO', fmt: pct, align: 'center', corFundo: taxa('taxaNegociacao') },
    { key: 'taxaVendas', titulo: 'VENDAS SOBRE CADASTRO', fmt: pct, align: 'center', corFundo: taxa('taxaVendas') },
  ];

  // ---- y=1102: status dos leads e o resumo ------------------------------
  const colunasStatus = [
    { key: 'key', titulo: rotulo, align: 'left' },
    { key: 'cadastrados', titulo: 'CADASTRADOS', fmt: int, databar: { cor: CORES.goldSoft } },
    { key: 'ganhosLead', titulo: 'GANHOS', fmt: int, databar: { cor: CORES.green } },
    { key: 'descartados', titulo: 'DESCARTADOS', fmt: int, databar: { cor: '#b3261e' } },
    { key: 'backlog', titulo: 'BACKLOG ABERTO', fmt: int, databar: { cor: CORES.orange } },
  ];
  const colunasResumo = [
    { key: 'key', titulo: rotulo, align: 'left' },
    { key: 'ticketMedio', titulo: 'TICKET MÉDIO', fmt: brl },
    { key: 'receita', titulo: 'RECEITA', fmt: brl, databar: { cor: CORES.gold } },
    { key: 'duracao', titulo: 'DURAÇÃO MÉDIA', align: 'center' },
    { key: 'vidaLead', titulo: 'TEMPO DE VIDA DO LEAD', align: 'center' },
  ];

  // ---- as duas matrizes de taxa ----------------------------------------
  const matriz = (m, titulo) => {
    const cols = m?.colunas || [];
    return [
      { key: 'key', titulo, align: 'left' },
      ...cols.map((c) => ({
        key: c,
        titulo: c.toUpperCase(),
        fmt: (v) => (v === null || v === undefined ? '—' : pct(v)),
        corFundo: (linha) => (linha[c] === null || linha[c] === undefined ? undefined : corDaTaxa(linha[c])),
      })),
    ];
  };

  const tabela = (colunas, dados, ordem) => (
    vazio ? <Loading />
      : !(dados || []).length ? <Vazio texto="Sem dados para os filtros selecionados" />
        : <Tabela colunas={colunas} dados={dados} ordemInicial={ordem} />
  );

  const funil = (dados) => (
    vazio ? <Loading />
      : <BarrasHorizontais data={dados || []} keyValue="qtd" nome="QUANTIDADE" larguraCategoria={130} />
  );

  return (
    <>
      {error && <Erro erro={error} />}

      <div className="banner">
        Esta tela cruza os <b>dois lados do funil</b>, e por isso tem dois filtros de período.
        {por === 'cidade'
          ? ' A cidade vem do lead: negociação de lead fora do recorte não entra, porque não tem cidade.'
          : ' Leads contam pelo dono; negociações, por quem as conduziu. Numa mesma linha, a conversão de cadastro e a de negociação têm bases diferentes de propósito.'}
        {data?.semEquipe ? (
          <> Atenção: <b>{int(data.semEquipe)} dos {int(data.vendedores)}</b> vendedores do CRM não
            estão no cadastro de equipes (MariaDB <b>Comercial_Teams</b>), então aparecem
            agrupados sem equipe e o filtro de Equipe não os alcança.
          </>
        ) : null}
      </div>

      {/* y=453..921: os seis cartões da coluna direita do relatório */}
      <div className="kpi-faixa">
        <Kpi
          value={pct(k?.taxaCadastro || 0)}
          label="CONVERSÃO DE CADASTRO"
          desc={`${int(k?.ganhosLead || 0)} ganhos de ${int(k?.cadastrados || 0)} leads cadastrados`}
          title="Medidas[Taxa Conversao Cadastro]: leads com classificação Ganho divididos por todos os leads cadastrados no recorte."
        />
        <Kpi
          value={pct(k?.taxaNegociacao || 0)}
          label="CONVERSÃO DE NEGOCIAÇÃO"
          desc={`${int(k?.ganhasNeg || 0)} ganhas de ${int(k?.conduzidas || 0)} conduzidas`}
          title="Medidas[Taxa Conversao Negociacao]: negociações ganhas divididas pelas conduzidas. Base diferente da conversão de cadastro — são conjuntos distintos."
        />
        <Kpi
          value={brl(k?.receita || 0)}
          label="RECEITA"
          small
          desc="soma do plano das negociações ganhas"
          title="Medidas[Receita Total]. É a mensalidade do plano, não valor acumulado."
        />
        <Kpi
          value={brl(k?.ticketMedio || 0)}
          label="TICKET MÉDIO"
          small
          desc="receita dividida pelos leads com negociação ganha"
          title="Medidas[Ticket Medio]: por LEAD ganho, não por negociação ganha — um lead pode ter várias."
        />
        <Kpi
          value={k?.duracao || '---'}
          label="DURAÇÃO MÉDIA"
          small
          desc="do primeiro ao último relatório técnico da negociação"
          title="Medidas[Média Duração por Vendedor]: média dos minutos entre o início e o fim de cada negociação, formatada em dias, horas e minutos."
        />
        <Kpi
          value={k?.vidaLead || '---'}
          label="TEMPO DE VIDA DO LEAD"
          small
          desc="do cadastro até o fim da negociação ou o descarte"
          title="Medidas[Média Tempo Vida Lead]: média do tempo entre o cadastro do lead e o fim da última negociação dele; sem negociação encerrada, vale a data de descarte."
        />
      </div>

      {/* y=453: produtividade, largura inteira */}
      <Visual
        title={`PRODUTIVIDADE POR ${rotulo}`}
        sub={data
          ? `${int(data.produtividadeTotal)} ${por === 'cidade' ? 'cidades' : 'vendedores'}`
            + (data.produtividadeTotal > (data.produtividade || []).length
              ? ` — a tabela mostra os ${int((data.produtividade || []).length)} com mais leads`
              : '')
          : ''}
        flush
        className="v-tabela-alta"
        ia={`desempenho:${por}`}
        actions={(
          <BotaoExportar onExportar={() => baixar(
            `desempenho-por-${por}.csv`,
            tabelaParaCSV(colunasProdutividade, data?.produtividade || []),
          )} />
        )}
      >
        {tabela(colunasProdutividade, data?.produtividade, { key: 'cadastrados', dir: 'desc' })}
      </Visual>

      {/* y=1102: status à esquerda, resumo financeiro à direita */}
      <div className="grid linha-dupla">
        <Visual title={`STATUS DOS LEADS POR ${rotulo}`} flush className="v-meia" ia={`desempenho:${por}-status`}>
          {tabela(colunasStatus, data?.produtividade, { key: 'cadastrados', dir: 'desc' })}
        </Visual>
        <Visual title={`RESUMO POR ${rotulo}`} flush className="v-meia" ia={`desempenho:${por}-resumo`}>
          {tabela(colunasResumo, data?.produtividade, { key: 'receita', dir: 'desc' })}
        </Visual>
      </div>

      {/* y=1752: os dois funis e a taxa por forma de contato */}
      <div className="grid linha-38-19-43">
        <Visual title="FUNIL DE GANHOS" sub="leads → negociações → leads ganhos" className="v-meia">
          {funil(data?.funilGanhos)}
        </Visual>
        <Visual title="FUNIL DE DESCARTES" sub="leads → negociações → leads descartados" className="v-meia">
          {funil(data?.funilDescartes)}
        </Visual>
        <Visual
          title="CONVERSÃO DE CADASTRO × FORMA DE CONTATO"
          sub="as 10 formas com mais leads; célula vazia é forma que aquela linha não usou"
          flush
          className="v-meia"
        >
          {tabela(matriz(data?.taxaPorForma, rotulo), data?.taxaPorForma?.linhas)}
        </Visual>
      </div>

      {/* y=2418: taxa de conversão de negociação por origem */}
      <Visual
        title="CONVERSÃO DE NEGOCIAÇÃO × ORIGEM"
        sub="as 10 origens com mais negociações"
        flush
        className="v-tabela-alta"
      >
        {tabela(matriz(data?.taxaPorOrigem, rotulo), data?.taxaPorOrigem?.linhas)}
      </Visual>

      {/* y=4012: as quatro perdas do lado do LEAD */}
      <div className="banner">
        As oito tabelas abaixo são o <b>onde se perde</b> do relatório. Do lado do lead entram
        as classificações <b>Perda</b> e <b>Descartado</b>
        {data ? <> — {int(data.leadsPerdidos)} leads</> : null}; do lado da negociação, o status
        <b> Perda</b>{data ? <> — {int(data.negsPerdidas)} negociações</> : null}. São os filtros
        de visual do relatório de origem.
      </div>

      <div className="grid linha-quatro">
        <Visual title="PERDA × MOTIVO (LEAD)" flush className="v-meia" ia={`desempenho:${por}-perdaLead`}>
          {tabela(perda('MOTIVO', 'LEADS'), data?.perdaLeadMotivo)}
        </Visual>
        <Visual title="PERDA × ORIGEM (LEAD)" flush className="v-meia">
          {tabela(perda('ORIGEM', 'LEADS'), data?.perdaLeadOrigem)}
        </Visual>
        <Visual title="PERDA × FORMA (LEAD)" flush className="v-meia">
          {tabela(perda('FORMA', 'LEADS'), data?.perdaLeadForma)}
        </Visual>
        <Visual title="PERDA × TIME (LEAD)" flush className="v-meia">
          {tabela(perda('TIME', 'LEADS'), data?.perdaLeadTime)}
        </Visual>
      </div>

      {/* y=4542: as quatro perdas do lado da NEGOCIAÇÃO */}
      <div className="grid linha-quatro">
        <Visual title="PERDA × MOTIVO (NEGOCIAÇÃO)" flush className="v-meia" ia={`desempenho:${por}-perdaNeg`}>
          {tabela(perda('MOTIVO', 'NEGOCIAÇÕES'), data?.perdaNegMotivo)}
        </Visual>
        <Visual title="PERDA × ORIGEM (NEGOCIAÇÃO)" flush className="v-meia">
          {tabela(perda('ORIGEM', 'NEGOCIAÇÕES'), data?.perdaNegOrigem)}
        </Visual>
        <Visual title="PERDA × FORMA (NEGOCIAÇÃO)" flush className="v-meia">
          {tabela(perda('FORMA', 'NEGOCIAÇÕES'), data?.perdaNegForma)}
        </Visual>
        <Visual title="PERDA × TIME (NEGOCIAÇÃO)" flush className="v-meia">
          {tabela(perda('TIME', 'NEGOCIAÇÕES'), data?.perdaNegTime)}
        </Visual>
      </div>
    </>
  );
}
