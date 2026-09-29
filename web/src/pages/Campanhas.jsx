import { useDados } from '../api';
import { LISTAS_CAMPANHAS, useFilters } from '../filters';
import { SlicerBarCampanhas } from '../components/SlicerBarCampanhas';
import { BotaoExportar, Erro, Kpi, Loading, Vazio, Visual } from '../components/ui';
import { BarrasHorizontais, ComboChart, CORES } from '../components/charts';
import { Tabela } from '../components/tables';
import { brl, int, labelData, labelPeriodo, pct } from '../format';
import { baixarCSV, sufixoPeriodo, tabelaParaCSV } from '../exportar';

/**
 * CAMPANHAS DE MARKETING — porte do relatório "MKT - Campanhas de Marketing",
 * com a ligação entre as três fontes que lá não existe.
 *
 * As quatro sub-páginas espelham as quatro de dados do original (Campanhas,
 * Google Ads, Meta Ads e Detalhamento dos entrantes), e a VISÃO GERAL é nova: no
 * Power BI cada fonte mora numa aba, e comparar exige trocar de página e guardar
 * o número de cabeça.
 */
const SUBPAGINAS = [
  { id: 'geral', label: 'Visão geral' },
  { id: 'google', label: 'Google Ads' },
  { id: 'meta', label: 'Meta Ads' },
  { id: 'atendimentos', label: 'Atendimentos' },
];

function SubNav({ atual, onChange }) {
  return (
    <nav className="subnav">
      {SUBPAGINAS.map((s) => (
        <button key={s.id} type="button" className={atual === s.id ? 'on' : ''} onClick={() => onChange(s.id)}>
          {s.label}
        </button>
      ))}
    </nav>
  );
}

/**
 * AS TRÊS FONTES PARAM EM DATAS DIFERENTES, e isso muda a leitura de tudo.
 *
 * As tabelas de anúncio são de CARGA — foram importadas uma vez, em julho, e não
 * têm esteira. O Matrix é ao vivo. Comparar investimento de julho com atendimento
 * de setembro dá custo por lead zero, e a tela tem de dizer por quê em vez de
 * mostrar o zero e deixar quem olha concluir sozinho.
 */
function AvisoFrescor({ frescor }) {
  if (!frescor) return null;
  const { google, meta, matrix } = frescor;
  const anuncio = [google, meta].filter(Boolean).sort().pop();
  if (!anuncio || !matrix || anuncio >= matrix) return null;
  return (
    <div className="banner banner-aviso">
      O investimento de anúncio vai até <b>{labelData(anuncio)}</b> (Google {labelData(google) || '—'} ·
      {' '}Meta {labelData(meta) || '—'}) e os atendimentos vão até <b>{labelData(matrix)}</b>.
      As tabelas de Google e Meta são de <b>carga manual</b>, não de esteira — depois de {labelData(anuncio)}
      {' '}o custo por atendimento cai a zero porque falta o investimento, não porque ele acabou.
    </div>
  );
}

/** Um selo curto dizendo por que degrau a ligação campanha↔atendimento foi feita. */
function SeloConfianca({ valor }) {
  if (!valor) return <span className="selo selo-neutro" title="Nenhuma campanha de anúncio corresponde a esta tag — é tráfego orgânico ou campanha sem verba.">sem anúncio</span>;
  const texto = { exata: 'exata', familia: 'por família', cidade: 'por cidade' }[valor] || valor;
  const dica = {
    exata: 'Plataforma, tipo de campanha e cidade batem entre a tag do atendimento e o nome da campanha.',
    familia: 'A tag diz a cidade, mas a campanha cobre todas — o investimento é rateado entre as cidades que ela atendeu.',
    cidade: 'A tag antiga (macro) não diz a plataforma, então a ligação é só pela cidade: junta Google e Meta daquela cidade.',
  }[valor];
  return <span className={`selo selo-${valor}`} title={dica}>{texto}</span>;
}

export default function Campanhas() {
  const { filtros, setFiltro } = useFilters();
  const sub = SUBPAGINAS.some((s) => s.id === filtros.cpag) ? filtros.cpag : SUBPAGINAS[0].id;

  return (
    <main className="page">
      <SubNav atual={sub} onChange={(id) => setFiltro({ cpag: id })} />
      {sub === 'geral' && <PaginaGeral filtros={filtros} />}
      {sub === 'google' && <PaginaPlataforma filtros={filtros} plataforma="google" />}
      {sub === 'meta' && <PaginaPlataforma filtros={filtros} plataforma="meta" />}
      {sub === 'atendimentos' && <PaginaAtendimentos filtros={filtros} />}
    </main>
  );
}

// ---------------------------------------------------------------- VISÃO GERAL
function PaginaGeral({ filtros }) {
  const { data, error, isLoading } = useDados('/campanhas', filtros);
  const vazio = isLoading && !data;
  const serie = (data?.serie || []).map((m) => ({ ...m, label: labelPeriodo(m.periodo) }));

  const colunasFunil = [
    { key: 'rotulo', titulo: 'CAMPANHA', align: 'left' },
    { key: 'investimento', titulo: 'INVESTIMENTO', fmt: brl },
    { key: 'atendimentos', titulo: 'ATENDIMENTOS', fmt: int, databar: { cor: CORES.gold } },
    { key: 'vendas', titulo: 'VENDAS', fmt: int },
    { key: 'conversao', titulo: 'CONVERSÃO', fmt: pct },
    { key: 'custoPorAtendimento', titulo: 'CUSTO / ATEND.', fmt: brl },
    { key: 'custoPorVenda', titulo: 'CUSTO / VENDA', fmt: brl },
    // `fmt` pode devolver JSX: a célula renderiza o retorno e o `title` já se
    // protege de não-string. O CSV cai no valor cru ('exata'/'familia'/'cidade').
    { key: 'confianca', titulo: 'LIGAÇÃO', align: 'center', fmt: (v) => <SeloConfianca valor={v} /> },
  ];

  const colunasOrfas = [
    { key: 'campanha', titulo: 'CAMPANHA', align: 'left' },
    { key: 'plataformaRotulo', titulo: 'PLATAFORMA', align: 'left' },
    { key: 'investimento', titulo: 'GASTO', fmt: brl, databar: { cor: CORES.primary } },
    { key: 'impressoes', titulo: 'IMPRESSÕES', fmt: int },
  ];

  const colunasCidade = [
    { key: 'key', titulo: 'CIDADE', align: 'left' },
    { key: 'investimento', titulo: 'INVESTIMENTO', fmt: brl },
    { key: 'atendimentos', titulo: 'ATENDIMENTOS', fmt: int, databar: { cor: CORES.gold } },
    { key: 'vendas', titulo: 'VENDAS', fmt: int },
    { key: 'custoPorAtendimento', titulo: 'CUSTO / ATEND.', fmt: brl },
  ];

  if (error) return <Erro erro={error} />;

  return (
    <>
      <SlicerBarCampanhas />
      <AvisoFrescor frescor={data?.frescor} />

      <div className="banner">
        Google, Meta e Matrix <b>não têm chave comum</b> — as campanhas ainda não carregam o mesmo ID
        nos três lados. A ligação abaixo é feita pelo <b>nome</b>: plataforma, tipo de campanha e cidade,
        lidos da tag do atendimento e do nome do anúncio. A coluna <i>Ligação</i> diz, por linha, qual
        degrau foi usado. Campanhas de <b>vaga de emprego</b> ficam fora do investimento por padrão —
        o botão “recrutamento” na barra as inclui.
      </div>

      <div className="kpi-faixa">
        <Kpi value={brl(data?.kpis?.investimento || 0)} label="INVESTIMENTO" desc="Google + Meta no período" />
        <Kpi value={int(data?.kpis?.atendimentos || 0)} label="ATENDIMENTOS" small desc="entradas com tag de campanha" />
        <Kpi value={int(data?.kpis?.vendas || 0)} label="VENDAS CONCLUÍDAS" small desc={`conversão ${pct(data?.kpis?.conversao || 0)}`} />
        <Kpi
          value={brl(data?.kpis?.custoPorAtendimento || 0)}
          label="CUSTO / ATENDIMENTO"
          small
          desc="investimento ÷ atendimentos tagueados"
          title="Só das campanhas de captação — recrutamento entra apenas com o botão da barra."
        />
        <Kpi value={brl(data?.kpis?.custoPorVenda || 0)} label="CUSTO / VENDA" small desc="investimento ÷ vendas concluídas" />
      </div>

      <div className="grid linha-64-36">
        <Visual
          title="INVESTIMENTO x ATENDIMENTO / MÊS"
          sub="a comparação que o relatório de origem não faz: os dois lados no mesmo eixo do tempo"
          className="v-grafico"
        >
          {vazio ? <Loading /> : (
            <ComboChart
              data={serie}
              barKey="investimento"
              barName="INVESTIMENTO"
              barFmt={brl}
              lineKey="atendimentos"
              lineName="ATENDIMENTOS"
              escalaSecundaria
            />
          )}
        </Visual>

        <Visual title="ATENDIMENTOS POR PLATAFORMA" className="v-grafico">
          {vazio ? <Loading /> : (
            <BarrasHorizontais
              data={(data?.porPlataforma || []).map((p) => ({ key: p.key, valor: p.atendimentos }))}
              nome="ATENDIMENTOS"
            />
          )}
        </Visual>
      </div>

      <Visual
        title="FUNIL POR CAMPANHA"
        sub={data ? `${int(data.kpis.atendimentos)} atendimentos · investimento rateado entre os grupos que alcançaram cada campanha, para a soma não passar do gasto real` : ''}
        flush
        className="v-tabela"
        actions={(
          <BotaoExportar onExportar={() => baixarCSV(
            'campanhas-funil', tabelaParaCSV(colunasFunil, data?.funil || []),
            sufixoPeriodo(filtros, ['cde', 'cate']),
          )} />
        )}
      >
        {vazio ? <Loading /> : <Tabela colunas={colunasFunil} dados={data?.funil || []} ordemInicial={{ key: 'atendimentos', dir: 'desc' }} />}
      </Visual>

      <div className="grid linha-dupla">
        <Visual
          title="GASTOU E NÃO GEROU ATENDIMENTO TAGUEADO"
          sub="campanhas que rodaram sem nenhum atendimento marcado com elas — ou não converteram, ou a tag não foi aplicada"
          flush
          className="v-tabela"
        >
          {vazio ? <Loading />
            : (data?.semAtendimento || []).length
              ? <Tabela colunas={colunasOrfas} dados={data.semAtendimento} ordemInicial={{ key: 'investimento', dir: 'desc' }} />
              : <Vazio texto="Toda campanha do período gerou algum atendimento tagueado" />}
        </Visual>

        <Visual
          title="POR CIDADE"
          sub="a dimensão em que as três fontes mais se encontram: ela aparece no nome da campanha e na tag"
          flush
          className="v-tabela"
        >
          {vazio ? <Loading /> : <Tabela colunas={colunasCidade} dados={data?.porCidade || []} ordemInicial={{ key: 'atendimentos', dir: 'desc' }} />}
        </Visual>
      </div>
    </>
  );
}

// ------------------------------------------------------- GOOGLE ADS / META ADS
function PaginaPlataforma({ filtros, plataforma }) {
  const { data, error, isLoading } = useDados(`/campanhas/${plataforma}`, filtros);
  const vazio = isLoading && !data;
  const serie = (data?.serie || []).map((m) => ({ ...m, label: labelPeriodo(m.periodo) }));
  const ehGoogle = plataforma === 'google';

  const colunas = [
    { key: 'campanha', titulo: 'CAMPANHA', align: 'left' },
    { key: 'cidade', titulo: 'CIDADE', align: 'left' },
    { key: 'de', titulo: 'DE', align: 'center', fmt: labelData },
    { key: 'ate', titulo: 'ATÉ', align: 'center', fmt: labelData },
    { key: 'investimento', titulo: 'INVESTIMENTO', fmt: brl, databar: { cor: CORES.gold } },
    { key: 'impressoes', titulo: 'IMPRESSÕES', fmt: int },
    ...(ehGoogle
      ? [
        { key: 'cliques', titulo: 'CLIQUES', fmt: int },
        { key: 'ctr', titulo: 'CTR', fmt: pct },
        { key: 'cpc', titulo: 'CPC', fmt: brl },
      ]
      : [
        { key: 'alcance', titulo: 'ALCANCE', fmt: int },
        { key: 'resultados', titulo: 'RESULTADOS', fmt: int },
        { key: 'custoPorResultado', titulo: 'CUSTO / RESULT.', fmt: brl },
      ]),
    { key: 'custoPorMil', titulo: 'CPM', fmt: brl },
  ];

  if (error) return <Erro erro={error} />;

  return (
    <>
      <SlicerBarCampanhas campos={['familia', 'cidade']} />

      {data?.frescor && (
        <div className="banner banner-aviso">
          Esta tabela é de <b>carga manual</b>, não de esteira: o último dia com dado é
          {' '}<b>{labelData(data.frescor)}</b>. Nada depois disso aparece aqui.
        </div>
      )}

      <div className="kpi-faixa">
        <Kpi value={brl(data?.kpis?.investimento || 0)} label="INVESTIMENTO" desc={`${int(data?.kpis?.campanhas || 0)} campanhas no período`} />
        <Kpi value={int(data?.kpis?.impressoes || 0)} label="IMPRESSÕES" small />
        {ehGoogle
          ? <Kpi value={int(data?.kpis?.cliques || 0)} label="CLIQUES" small />
          : <Kpi value={int(data?.kpis?.resultados || 0)} label="RESULTADOS" small desc="conversas iniciadas" />}
        <Kpi
          value={int(data?.kpis?.atendimentos || 0)}
          label="ATENDIMENTOS ATRIBUÍDOS"
          small
          desc="pela tag do Matrix"
          title="Atendimentos cuja tag aponta para esta plataforma. Sem tag da plataforma, não há como atribuir."
        />
        <Kpi value={brl(data?.kpis?.custoPorAtendimento || 0)} label="CUSTO / ATENDIMENTO" small />
      </div>

      {/* o Google não tem tag correspondente no Matrix, e isso precisa ser dito */}
      {ehGoogle && data && data.kpis.atendimentos < 5 && (
        <div className="banner">
          Quase nenhum atendimento é atribuído ao Google porque <b>não existe tag de Google no Matrix</b>:
          a taxonomia de tags nomeia <code>_meta</code> e <code>site_organico</code>, mas não o Google.
          O investimento aparece aqui; o retorno dele só será mensurável com uma tag própria — ou com o
          ID de campanha nas tags, que é o passo seguinte.
        </div>
      )}

      <div className="grid linha-64-36">
        <Visual title="INVESTIMENTO x ATENDIMENTO / MÊS" className="v-grafico">
          {vazio ? <Loading /> : (
            <ComboChart
              data={serie} barKey="investimento" barName="INVESTIMENTO" barFmt={brl}
              lineKey="atendimentos" lineName="ATENDIMENTOS" escalaSecundaria
            />
          )}
        </Visual>
        <Visual title="INVESTIMENTO POR TIPO DE CAMPANHA" className="v-grafico">
          {vazio ? <Loading /> : <BarrasHorizontais data={data?.porFamilia || []} nome="INVESTIMENTO" fmt={brl} larguraCategoria={150} />}
        </Visual>
      </div>

      <Visual
        title="CAMPANHAS"
        flush
        className="v-tabela-alta"
        actions={(
          <BotaoExportar onExportar={() => baixarCSV(
            `campanhas-${plataforma}`, tabelaParaCSV(colunas, data?.tabela || []),
            sufixoPeriodo(filtros, ['cde', 'cate']),
          )} />
        )}
      >
        {vazio ? <Loading /> : <Tabela colunas={colunas} dados={data?.tabela || []} ordemInicial={{ key: 'investimento', dir: 'desc' }} />}
      </Visual>
    </>
  );
}

// ------------------------------------------------------------- ATENDIMENTOS
function PaginaAtendimentos({ filtros }) {
  const { data, error, isLoading } = useDados('/campanhas/atendimentos', filtros);
  const vazio = isLoading && !data;
  const serie = (data?.serie || []).map((m) => ({ ...m, label: labelPeriodo(m.periodo) }));

  const colunas = [
    { key: 'entrada', titulo: 'ENTRADA', align: 'center', fmt: labelData },
    { key: 'protocolo', titulo: 'PROTOCOLO', align: 'left' },
    { key: 'contato', titulo: 'CONTATO', align: 'left' },
    { key: 'telefone', titulo: 'TELEFONE', align: 'left' },
    { key: 'canal', titulo: 'CANAL', align: 'left' },
    { key: 'ativoReceptivo', titulo: 'ATIVO/RECEPTIVO', align: 'left' },
    { key: 'atendente', titulo: 'ATENDENTE', align: 'left' },
    { key: 'classificacao', titulo: 'CLASSIFICAÇÃO', align: 'left' },
    { key: 'campanhas', titulo: 'CAMPANHA(S)', align: 'left' },
  ];
  const contagem = (titulo, cor = CORES.primary) => [
    { key: 'key', titulo, align: 'left' },
    { key: 'valor', titulo: 'QTD', fmt: int, databar: { cor } },
  ];

  if (error) return <Erro erro={error} />;

  return (
    <>
      <SlicerBarCampanhas campos={['plataforma', 'familia', 'cidade', 'canal', 'classificacao', 'atendente']} />
      <AvisoFrescor frescor={data?.frescor} />

      <div className="kpi-faixa">
        <Kpi value={int(data?.kpis?.atendimentos || 0)} label="ATENDIMENTOS" desc="entradas com tag de campanha" />
        <Kpi value={int(data?.kpis?.vendas || 0)} label="VENDAS CONCLUÍDAS" small desc={`efetividade ${pct(data?.kpis?.conversao || 0)}`} />
        <Kpi
          value={pct(data?.kpis?.abandono || 0)}
          label="TAXA DE ABANDONO"
          small
          desc="falta de contato sem retorno do cliente"
          title="Mesma medida do relatório de origem: atendimentos classificados como FALTA DE CONTATO (SEM RETORNO CLIENTE) sobre o total."
        />
        <Kpi value={int(data?.kpis?.protocolos || 0)} label="PROTOCOLOS" small />
      </div>

      <Visual title="ATENDIMENTOS x VENDAS / MÊS" className="v-grafico">
        {vazio ? <Loading /> : (
          <ComboChart data={serie} barKey="atendimentos" barName="ATENDIMENTOS" lineKey="vendas" lineName="VENDAS" escalaSecundaria />
        )}
      </Visual>

      <div className="grid linha-33-67">
        <Visual title="POR CLASSIFICAÇÃO" flush className="v-meia">
          {vazio ? <Loading /> : <Tabela colunas={contagem('CLASSIFICAÇÃO')} dados={data?.porClassificacao || []} />}
        </Visual>
        <Visual
          title="POR CAMPANHA"
          sub="um atendimento pode carregar mais de uma tag, então a soma daqui passa do total — cada linha conta quem tocou aquele cliente"
          flush
          className="v-meia"
        >
          {vazio ? <Loading /> : <Tabela colunas={contagem('CAMPANHA', CORES.gold)} dados={data?.porCampanha || []} />}
        </Visual>
      </div>

      <div className="grid linha-dupla">
        <Visual title="POR CANAL" flush className="v-meia">
          {vazio ? <Loading /> : <Tabela colunas={contagem('CANAL')} dados={data?.porCanal || []} />}
        </Visual>
        <Visual title="POR ATENDENTE" flush className="v-meia">
          {vazio ? <Loading /> : <Tabela colunas={contagem('ATENDENTE', CORES.goldSoft)} dados={data?.porAtendente || []} />}
        </Visual>
      </div>

      <Visual
        title="RELATÓRIO DETALHADO DOS ATENDIMENTOS"
        sub={data ? `${int(data.total)} atendimentos · a tabela mostra os ${int((data.detalhe || []).length)} mais recentes` : ''}
        flush
        className="v-tabela-alta"
        actions={(
          <BotaoExportar onExportar={() => baixarCSV(
            'campanhas-atendimentos', tabelaParaCSV(colunas, data?.detalhe || []),
            sufixoPeriodo(filtros, ['cde', 'cate']),
          )} />
        )}
      >
        {vazio ? <Loading /> : <Tabela colunas={colunas} dados={data?.detalhe || []} />}
      </Visual>
    </>
  );
}
