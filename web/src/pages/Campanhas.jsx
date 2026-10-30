import { useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { apiUpload, useDados } from '../api';
import { useSession } from '../auth/session.jsx';
import { useFilters } from '../filters';
import { SlicerBarCampanhas } from '../components/SlicerBarCampanhas';
import { BotaoExportar, Erro, Kpi, Loading, Vazio, Visual } from '../components/ui';
import { BarrasHorizontais, ComboChart, CORES } from '../components/charts';
import { Tabela } from '../components/tables';
import { brl, int, labelData, labelPeriodo, pct } from '../format';
import { baixarCSV, sufixoPeriodo, tabelaParaCSV } from '../exportar';

/**
 * CAMPANHAS DE MARKETING — investimento em Google e Meta contra os leads que o
 * anúncio trouxe.
 *
 * O LEAD vem do "Relatório analítico de rastreamento de posts" do Matrix, que
 * registra o clique no anúncio do Meta (Click-to-WhatsApp) — inclusive de quem
 * mandou só "Oi" ou falou só com o robô. Até out/2026 a tela contava o
 * atendimento com tag de marketing, que cobria 36% desses leads. O relatório não
 * sai por API, então é importado aqui como CSV.
 */
const SUBPAGINAS = [
  { id: 'geral', label: 'Visão geral' },
  { id: 'google', label: 'Google Ads' },
  { id: 'meta', label: 'Meta Ads' },
  { id: 'atendimentos', label: 'Leads' },
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

/** Onde o CSV é exportado: a tela do relatório no Matrix (exige login no Matrix). */
const URL_RELATORIO_MATRIX = 'https://sebratel.matrixdobrasil.ai/relatorio-atendimento/relatorio-analitico-rastreamento-posts';

const dataHoraBR = (v) => (v ? `${labelData(v.slice(0, 10))} ${v.slice(11, 16)}` : '—');

/**
 * De onde vêm os leads e quando foi a última importação — com o botão de
 * importar para quem é admin.
 *
 * O arquivo vai cru para o servidor, que decide a codificação e grava. A resposta
 * só volta com o modelo já reconstruído, então invalidar o cache em seguida basta
 * para a tela mostrar os leads novos.
 */
function Importacao({ frescor }) {
  const { ehAdmin } = useSession();
  const qc = useQueryClient();
  const input = useRef(null);
  const [estado, setEstado] = useState({ enviando: false, resultado: null, erro: null });
  const ultima = frescor?.ultimaImportacao;

  const enviar = async (arquivo) => {
    if (!arquivo) return;
    setEstado({ enviando: true, resultado: null, erro: null });
    try {
      const resultado = await apiUpload('/campanhas/rastreamento', arquivo);
      setEstado({ enviando: false, resultado, erro: null });
      qc.invalidateQueries();
    } catch (err) {
      setEstado({ enviando: false, resultado: null, erro: err.message });
    } finally {
      if (input.current) input.current.value = '';
    }
  };

  const r = estado.resultado;
  return (
    <>
      <div className={`banner importacao${ultima ? ' banner-aviso' : ''}`}>
        <div className="texto">
          {ultima ? (
            <>
              Leads do <b>rastreamento de posts do Matrix</b>, de <b>{labelData(frescor.rastreamentoDe)}</b> a
              {' '}<b>{labelData(frescor.rastreamento)}</b>. Última importação em {dataHoraBR(ultima.importado_em)}
              {ultima.importado_por ? <> por {ultima.importado_por}</> : null}. O relatório não sai por API:
              {' '}depois do último dia importado, a tela não tem lead.
            </>
          ) : (
            <>
              <b>Nenhum rastreamento importado ainda.</b> Os leads desta tela vêm do “Relatório analítico de
              {' '}rastreamento de posts” do Matrix: exporte o CSV na tela de relatórios do Matrix e importe aqui.
              {!ehAdmin && ' A importação é feita por um administrador.'}
            </>
          )}
        </div>
        {ehAdmin && (
          <>
            <a
              className="botao-enquadrar"
              href={URL_RELATORIO_MATRIX}
              target="_blank"
              rel="noopener noreferrer"
              title="Abre o Relatório analítico de rastreamento de posts no Matrix, de onde se exporta o CSV."
            >
              Abrir relatório no Matrix ↗
            </a>
            <input
              ref={input}
              id="importar-rastreamento"
              type="file"
              accept=".csv,text/csv"
              hidden
              onChange={(e) => enviar(e.target.files?.[0])}
            />
            <button
              type="button"
              className="botao-enquadrar"
              disabled={estado.enviando}
              onClick={() => input.current?.click()}
              title="Importar o CSV do Relatório analítico de rastreamento de posts. Reimportar um período atualiza, não duplica."
            >
              {estado.enviando ? 'Importando…' : 'Importar CSV do Matrix'}
            </button>
          </>
        )}
      </div>
      {r && (
        <div className="banner">
          Importado: <b>{int(r.linhas)}</b> mensagens de {labelData(r.de)} a {labelData(r.ate)} —
          {' '}{int(r.novas)} novas e {int(r.existentes)} que já estavam na base (regravadas, sem duplicar)
          {r.recusadas ? <>, <b>{int(r.recusadas)} recusadas</b> (ex.: linha {r.exemplosRecusadas[0]?.linha}, {r.exemplosRecusadas[0]?.motivo})</> : null}.
        </div>
      )}
      {estado.erro && <div className="banner error">A importação não foi feita: {estado.erro}</div>}
    </>
  );
}

/**
 * Investimento e leads param em datas diferentes: são duas cargas manuais. Sem
 * este aviso, o custo por lead de um mês sem investimento carregado sai zero e
 * parece real.
 */
function AvisoFrescor({ frescor }) {
  if (!frescor?.rastreamento) return null;
  const { google, meta, rastreamento } = frescor;
  if (!meta || meta >= rastreamento) return null;
  return (
    <div className="banner banner-aviso">
      O investimento do Meta vai até <b>{labelData(meta)}</b> (Google {labelData(google) || '—'}) e os leads vão até
      {' '}<b>{labelData(rastreamento)}</b>. As tabelas de anúncio são de carga manual — depois de {labelData(meta)}
      {' '}o custo por lead cai a zero porque falta o investimento, não porque ele acabou.
    </div>
  );
}

const COLUNAS_ANUNCIO = [
  { key: 'key', titulo: 'ANÚNCIO', align: 'left' },
  { key: 'leads', titulo: 'LEADS', fmt: int, databar: { cor: CORES.gold } },
  { key: 'vendas', titulo: 'VENDAS', fmt: int },
  { key: 'conversao', titulo: 'CONVERSÃO', fmt: pct },
  { key: 'abandono', titulo: 'ABANDONO', fmt: pct },
  { key: 'fatiaSemAtendente', titulo: 'SEM ATENDENTE', fmt: pct },
];

export default function Campanhas() {
  const { filtros, setFiltro } = useFilters();
  const sub = SUBPAGINAS.some((s) => s.id === filtros.cpag) ? filtros.cpag : SUBPAGINAS[0].id;

  return (
    <main className="page">
      <SubNav atual={sub} onChange={(id) => setFiltro({ cpag: id })} />
      {sub === 'geral' && <PaginaGeral filtros={filtros} />}
      {sub === 'google' && <PaginaPlataforma filtros={filtros} plataforma="google" />}
      {sub === 'meta' && <PaginaPlataforma filtros={filtros} plataforma="meta" />}
      {sub === 'atendimentos' && <PaginaLeads filtros={filtros} />}
    </main>
  );
}

// ---------------------------------------------------------------- VISÃO GERAL
function PaginaGeral({ filtros }) {
  const { data, error, isLoading } = useDados('/campanhas', filtros);
  const vazio = isLoading && !data;
  const serie = (data?.serie || []).map((m) => ({ ...m, label: labelPeriodo(m.periodo) }));
  const k = data?.kpis;

  const colunasCidade = [
    { key: 'key', titulo: 'CIDADE', align: 'left' },
    { key: 'investimento', titulo: 'INVESTIMENTO', fmt: brl },
    { key: 'leads', titulo: 'LEADS', fmt: int, databar: { cor: CORES.gold } },
    { key: 'vendas', titulo: 'VENDAS', fmt: int },
    { key: 'conversao', titulo: 'CONVERSÃO', fmt: pct },
  ];

  if (error) return <Erro erro={error} />;

  return (
    <>
      <SlicerBarCampanhas campos={['plataforma', 'familia', 'cidade', 'anuncio']} />
      <Importacao frescor={data?.frescor} />
      <AvisoFrescor frescor={data?.frescor} />

      <div className="kpi-faixa">
        <Kpi value={brl(k?.investimento || 0)} label="INVESTIMENTO" desc={`Meta ${brl(k?.investimentoMeta || 0)} · Google ${brl(k?.investimentoGoogle || 0)}`} />
        <Kpi value={int(k?.leads || 0)} label="LEADS DE ANÚNCIO" small desc="rastreamento de posts do Matrix" />
        <Kpi value={int(k?.vendas || 0)} label="VENDAS CONCLUÍDAS" small desc={`conversão ${pct(k?.conversao || 0)}`} />
        <Kpi
          value={brl(k?.custoPorLead || 0)}
          label="CUSTO / LEAD (META)"
          small
          desc={`${brl(k?.investimentoMetaCoberto || 0)} do Meta ÷ leads`}
          title="Só o gasto do Meta (o rastreamento registra clique em anúncio do Meta) e só dos dias que o rastreamento importado cobre — gasto de mês sem lead importado não entra na divisão. Recrutamento entra apenas com o botão da barra."
        />
        <Kpi
          value={pct(k?.fatiaSemAtendente || 0)}
          label="NÃO CHEGARAM A ATENDENTE"
          small
          desc={`${int(k?.semAtendente || 0)} leads só com o robô`}
          title="O lead não existe no histórico de atendimentos do Matrix: conversou só com a ISA, ou o atendimento ainda não foi finalizado."
        />
      </div>

      <div className="grid linha-64-36">
        <Visual
          title="INVESTIMENTO META x LEADS / MÊS"
          sub="o gasto que gerou o lead e o lead que ele gerou, no mesmo eixo do tempo"
          className="v-grafico"
        >
          {vazio ? <Loading /> : (
            <ComboChart
              data={serie}
              barKey="investimentoMeta"
              barName="INVESTIMENTO META"
              barFmt={brl}
              lineKey="leads"
              lineName="LEADS"
              escalaSecundaria
            />
          )}
        </Visual>

        <Visual title="LEADS POR CLASSIFICAÇÃO" className="v-grafico">
          {vazio ? <Loading /> : <BarrasHorizontais data={data?.porClassificacao || []} nome="LEADS" larguraCategoria={170} />}
        </Visual>
      </div>

      <Visual
        title="LEADS POR ANÚNCIO"
        sub="o título do anúncio em que a pessoa clicou — o rastreamento não diz a campanha, e o mesmo título roda em várias"
        flush
        className="v-tabela"
        actions={(
          <BotaoExportar onExportar={() => baixarCSV(
            'campanhas-leads-por-anuncio', tabelaParaCSV(COLUNAS_ANUNCIO, data?.porAnuncio || []),
            sufixoPeriodo(filtros, ['cde', 'cate']),
          )} />
        )}
      >
        {vazio ? <Loading />
          : (data?.porAnuncio || []).length
            ? <Tabela colunas={COLUNAS_ANUNCIO} dados={data.porAnuncio} ordemInicial={{ key: 'leads', dir: 'desc' }} />
            : <Vazio texto="Nenhum lead no período. Confira se o rastreamento deste período já foi importado." />}
      </Visual>

      <Visual
        title="POR CIDADE"
        sub="investimento das campanhas que nomeiam a cidade; lead pela cidade do título do anúncio ou da mensagem"
        flush
        className="v-tabela"
      >
        {vazio ? <Loading /> : <Tabela colunas={colunasCidade} dados={data?.porCidade || []} ordemInicial={{ key: 'leads', dir: 'desc' }} />}
      </Visual>
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
          : <Kpi value={int(data?.kpis?.resultados || 0)} label="RESULTADOS" small desc="conversas iniciadas, pelo Meta" />}
        <Kpi
          value={int(data?.kpis?.leads || 0)}
          label="LEADS NO MATRIX"
          small
          desc="rastreamento de posts"
          title="Leads que o Matrix registrou como vindos de anúncio. O rastreamento só cobre o Meta."
        />
        <Kpi value={brl(data?.kpis?.custoPorLead || 0)} label="CUSTO / LEAD" small />
      </div>

      {ehGoogle && (
        <div className="banner">
          O rastreamento de posts do Matrix registra o clique em anúncio do <b>Meta</b> (Facebook e Instagram), não
          {' '}o do Google. O investimento do Google aparece aqui; o lead que ele gerou ainda não tem fonte que o
          {' '}identifique no Matrix.
        </div>
      )}

      <div className="grid linha-64-36">
        <Visual title={ehGoogle ? 'INVESTIMENTO / MÊS' : 'INVESTIMENTO x LEADS / MÊS'} className="v-grafico">
          {vazio ? <Loading /> : (
            <ComboChart
              data={serie} barKey="investimento" barName="INVESTIMENTO" barFmt={brl}
              lineKey={ehGoogle ? 'cliques' : 'leads'} lineName={ehGoogle ? 'CLIQUES' : 'LEADS'} escalaSecundaria
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

// ---------------------------------------------------------------------- LEADS
function PaginaLeads({ filtros }) {
  const { data, error, isLoading } = useDados('/campanhas/atendimentos', filtros);
  const vazio = isLoading && !data;
  const serie = (data?.serie || []).map((m) => ({ ...m, label: labelPeriodo(m.periodo) }));
  const k = data?.kpis;

  const colunas = [
    { key: 'entrada', titulo: 'ENTRADA', align: 'center', fmt: labelData },
    { key: 'protocolo', titulo: 'PROTOCOLO', align: 'left' },
    { key: 'contato', titulo: 'CONTATO', align: 'left' },
    { key: 'telefone', titulo: 'TELEFONE', align: 'left' },
    { key: 'titulo', titulo: 'ANÚNCIO', align: 'left' },
    { key: 'cidade', titulo: 'CIDADE', align: 'left' },
    { key: 'mensagem', titulo: 'PRIMEIRA MENSAGEM', align: 'left' },
    { key: 'atendente', titulo: 'ATENDENTE', align: 'left' },
    { key: 'classificacao', titulo: 'CLASSIFICAÇÃO', align: 'left' },
  ];
  const contagem = (titulo, cor = CORES.primary) => [
    { key: 'key', titulo, align: 'left' },
    { key: 'valor', titulo: 'LEADS', fmt: int, databar: { cor } },
  ];
  const colunasCidade = [
    { key: 'key', titulo: 'CIDADE', align: 'left' },
    { key: 'leads', titulo: 'LEADS', fmt: int, databar: { cor: CORES.gold } },
    { key: 'vendas', titulo: 'VENDAS', fmt: int },
    { key: 'fatiaSemAtendente', titulo: 'SEM ATENDENTE', fmt: pct },
  ];

  if (error) return <Erro erro={error} />;

  return (
    <>
      <SlicerBarCampanhas campos={['cidade', 'anuncio', 'tipo', 'classificacao', 'atendente']} />
      <Importacao frescor={data?.frescor} />

      <div className="kpi-faixa">
        <Kpi value={int(k?.leads || 0)} label="LEADS DE ANÚNCIO" desc="um por protocolo do rastreamento" />
        <Kpi value={int(k?.vendas || 0)} label="VENDAS CONCLUÍDAS" small desc={`efetividade ${pct(k?.conversao || 0)}`} />
        <Kpi
          value={pct(k?.abandono || 0)}
          label="TAXA DE ABANDONO"
          small
          desc="falta de contato sem retorno do cliente"
          title="Mesma medida do relatório de origem: leads classificados como FALTA DE CONTATO (SEM RETORNO CLIENTE) sobre o total."
        />
        <Kpi
          value={pct(k?.fatiaSemAtendente || 0)}
          label="NÃO CHEGARAM A ATENDENTE"
          small
          desc={`${int(k?.semAtendente || 0)} leads`}
          title="O histórico de atendimentos do Matrix (db_matrix) só guarda atendimento com atendente. Quem conversou só com a ISA aparece aqui."
        />
      </div>

      <Visual title="LEADS x VENDAS / MÊS" className="v-grafico">
        {vazio ? <Loading /> : (
          <ComboChart data={serie} barKey="leads" barName="LEADS" lineKey="vendas" lineName="VENDAS" escalaSecundaria />
        )}
      </Visual>

      <div className="grid linha-33-67">
        <Visual title="POR CLASSIFICAÇÃO" flush className="v-meia">
          {vazio ? <Loading /> : <Tabela colunas={contagem('CLASSIFICAÇÃO')} dados={data?.porClassificacao || []} />}
        </Visual>
        <Visual
          title="POR ANÚNCIO"
          sub="o título do anúncio em que a pessoa clicou"
          flush
          className="v-meia"
          actions={(
            <BotaoExportar onExportar={() => baixarCSV(
              'campanhas-leads-por-anuncio', tabelaParaCSV(COLUNAS_ANUNCIO, data?.porAnuncio || []),
              sufixoPeriodo(filtros, ['cde', 'cate']),
            )} />
          )}
        >
          {vazio ? <Loading /> : <Tabela colunas={COLUNAS_ANUNCIO} dados={data?.porAnuncio || []} ordemInicial={{ key: 'leads', dir: 'desc' }} />}
        </Visual>
      </div>

      <div className="grid linha-dupla">
        <Visual title="POR CIDADE" sub="a do título do anúncio ou a que o cliente escreveu" flush className="v-meia">
          {vazio ? <Loading /> : <Tabela colunas={colunasCidade} dados={data?.porCidade || []} ordemInicial={{ key: 'leads', dir: 'desc' }} />}
        </Visual>
        <Visual title="POR ATENDENTE" sub="só dos leads que chegaram a um atendente" flush className="v-meia">
          {vazio ? <Loading /> : <Tabela colunas={contagem('ATENDENTE', CORES.goldSoft)} dados={data?.porAtendente || []} />}
        </Visual>
      </div>

      <Visual
        title="RELATÓRIO DETALHADO DOS LEADS"
        sub={data ? `${int(data.total)} leads · a tabela mostra os ${int((data.detalhe || []).length)} mais recentes` : ''}
        flush
        className="v-tabela-alta"
        actions={(
          <BotaoExportar onExportar={() => baixarCSV(
            'campanhas-leads', tabelaParaCSV(colunas, data?.detalhe || []),
            sufixoPeriodo(filtros, ['cde', 'cate']),
          )} />
        )}
      >
        {vazio ? <Loading /> : <Tabela colunas={colunas} dados={data?.detalhe || []} />}
      </Visual>
    </>
  );
}
