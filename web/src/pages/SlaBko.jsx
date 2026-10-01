import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useQuery } from '@tanstack/react-query';
import { apiFetch, useDados } from '../api';
import { PRESETS } from '../filters';
import { FiltroPeriodo } from '../components/SlicerBar';
import {
  BotaoExportar, Erro, Kpi, Loading, Segmentado, Vazio, Visual,
} from '../components/ui';
import { BarrasHorizontais, ComboChart, CORES } from '../components/charts';
import { Tabela } from '../components/tables';
import { haQuanto, int, labelDataHora, labelPeriodo, pct } from '../format';
import { baixar, baixarCSV, sufixoPeriodo, tabelaParaCSV } from '../exportar';
import '../sla-bko.css';

/**
 * SLA do BKO.
 *
 * Três fontes: o uMov.me pelo Data Hub (envio → análise do BKO, e os ciclos de
 * devolução) e o Elleven pelo Voalle (cadastro → 1º contato → agendamento).
 * Todas as horas são ÚTEIS no expediente do BKO — seg a sex 8h–21h, sábado e
 * feriado 8h–17h, domingo não conta — calculadas no servidor (`sla/horasUteis.js`).
 *
 * O estado dos filtros é local, não da URL: os campos desta tela (canal
 * Externo/Interno, granularidade) não existem nas outras e não devem vazar para elas.
 */

/** 1,5 → "1h 30min"; arredonda o minuto e carrega para a hora (nunca "1h 60min"). */
export function fmtHoras(v) {
  if (v === null || v === undefined || !Number.isFinite(Number(v))) return '—';
  const total = Math.round(Number(v) * 60);
  const h = Math.floor(total / 60);
  const m = total % 60;
  if (!h) return `${m}min`;
  return m ? `${h}h ${String(m).padStart(2, '0')}min` : `${h}h`;
}
const fmtPct = (v) => (v === null || v === undefined ? '—' : pct(v));
const fmtData = (v) => (v ? labelDataHora(v.replace(' ', 'T')) : '—');

const PRESETS_SLA = ['mes', 'mesPassado', '30d', '12m', 'ano', 'tudo']
  .map((id) => PRESETS.find((p) => p.id === id)).filter(Boolean);

const CANAIS = [
  { id: '', label: 'Todos' },
  { id: 'Externo', label: 'Externo' },
  { id: 'Interno', label: 'Interno' },
  { id: 'Sem canal', label: 'Sem canal' },
];
const GRANULARIDADE = [{ id: 'mes', label: 'Mês' }, { id: 'dia', label: 'Dia' }];
/**
 * Média ou mediana — as duas contam histórias diferentes e a escolha é de quem lê.
 * A média é a do Power BI e soma o peso das vendas que ficaram dias paradas; a
 * mediana é a venda típica, que esses poucos casos não puxam. Padrão: média.
 */
const MEDIDAS = [{ id: 'media', label: 'Média' }, { id: 'mediana', label: 'Mediana' }];
const NOME_MEDIDA = { media: 'média', mediana: 'mediana' };

const estouro = (limite) => (v) => (Number(v) > limite ? { color: '#A4262C', fontWeight: 700 } : undefined);

export default function SlaBko() {
  // padrão = últimos 30 dias (01/10/2026): "Este mês" ficava quase vazio nos primeiros dias
  const inicial = PRESETS.find((p) => p.id === '30d').calc();
  const [filtros, setFiltros] = useState({ de: inicial.de, ate: inicial.ate, preset: '30d', canal: '', g: 'mes', medida: 'media' });
  const consulta = {
    de: filtros.de, ate: filtros.ate, g: filtros.g, canal: filtros.canal ? [filtros.canal] : [],
  };
  const { data, error, isLoading } = useDados('/sla-bko', consulta);
  const carregando = isLoading && !data;
  const metas = data?.metas || { cadastro: 1, agendamento: 12 };
  // Interno e Sem canal não passam pelo uMov: somem cadastro, triagem, ciclos e fila do uMov
  const somenteInterno = filtros.canal === 'Interno' || filtros.canal === 'Sem canal';

  const mudarPeriodo = (r) => setFiltros((f) => {
    const novo = { ...f, ...r };
    const p = PRESETS_SLA.find((x) => {
      const c = x.calc();
      return c.de === novo.de && c.ate === novo.ate;
    });
    return { ...novo, preset: p?.id || null };
  });

  return (
    <main className="page tela-sla">
      <div className="filtros">
        <span className="rotulo">Filtros</span>
        <FiltroPeriodo
          de={filtros.de}
          ate={filtros.ate}
          presetAtivo={filtros.preset}
          presets={PRESETS_SLA}
          rotulo="Data de referência"
          onChange={mudarPeriodo}
        />
        <span className="rotulo-campo">Canal</span>
        <Segmentado
          valor={filtros.canal}
          opcoes={CANAIS}
          onChange={(canal) => setFiltros((f) => ({ ...f, canal }))}
          titulo="Canal da venda: Externo = Vendedor Externo (uMov.me); Interno = Vendedor Interno; Sem canal = vendedor sem setor no CRM (fica fora dos SLAs em Todos; aparece no Detalhamento e na fila)"
        />
        <span className="rotulo-campo">Tempo em</span>
        <Segmentado
          valor={filtros.medida}
          opcoes={MEDIDAS}
          onChange={(medida) => setFiltros((f) => ({ ...f, medida }))}
          titulo="Média: inclui o peso das vendas que ficaram dias paradas (é a do Power BI). Mediana: a venda típica, sem o efeito desses casos."
        />
        <span className="rotulo-campo">Gráficos por</span>
        <Segmentado
          valor={filtros.g}
          opcoes={GRANULARIDADE}
          onChange={(g) => setFiltros((f) => ({ ...f, g }))}
          titulo="Granularidade dos gráficos"
        />
      </div>

      {error && <Erro erro={error} />}
      {carregando ? <Loading texto="Carregando o SLA do BKO…" /> : data && (
        <>
          <Avisos data={data} />
          <Cartoes data={data} metas={metas} somenteInterno={somenteInterno} medida={filtros.medida} />

          {/* linha 1: o resumo e a situação das vendas; linha 2: os dois SLAs com meta */}
          <div className="grid linha-dupla">
            <ResumoSlas data={data} metas={metas} canal={filtros.canal} />
            <Visual title="SITUAÇÃO DAS VENDAS NO ELLEVEN" sub="cancelada e encerrada sem agendamento ficam fora da média e do % no prazo">
              {data.agendamento.situacoes.length
                ? <BarrasHorizontais data={data.agendamento.situacoes} nome="Vendas" larguraCategoria={210} />
                : <Vazio />}
            </Visual>
          </div>

          <div className="grid linha-dupla">
            {!somenteInterno && (
              <Visual
                title={`CADASTRO − INPUT — ${NOME_MEDIDA[filtros.medida].toUpperCase()} EM HORAS ÚTEIS / ${filtros.g === 'dia' ? 'DIA' : 'MÊS'}`}
                sub={`do envio no uMov (A1) ao cadastro no Elleven (A2) · linha = % dentro da meta de ${metas.cadastro} h`}
              >
                {data.cadastro.serie.length ? (
                  <ComboChart
                    data={data.cadastro.serie.map((s) => ({ ...s, label: labelPeriodo(s.periodo) }))}
                    barKey={filtros.medida} barName={`${NOME_MEDIDA[filtros.medida]} (h úteis)`} barFmt={fmtHoras}
                    lineKey="pctNoPrazo" lineName="% no prazo" lineFmt={fmtPct} escalaSecundaria
                    semRotulos={filtros.g === 'dia'}
                  />
                ) : <Vazio />}
              </Visual>
            )}
            <Visual
              title={`AGENDAMENTO — ${NOME_MEDIDA[filtros.medida].toUpperCase()} EM HORAS ÚTEIS / ${filtros.g === 'dia' ? 'DIA' : 'MÊS'}`}
              sub={`do cadastro no Elleven ao agendamento · linha = % dentro da meta de ${metas.agendamento} h`}
            >
              {data.agendamento.serie.length ? (
                <ComboChart
                  data={data.agendamento.serie.map((s) => ({ ...s, label: labelPeriodo(s.periodo) }))}
                  barKey={filtros.medida} barName={`${NOME_MEDIDA[filtros.medida]} (h úteis)`} barFmt={fmtHoras}
                  lineKey="pctNoPrazo" lineName="% no prazo" lineFmt={fmtPct} escalaSecundaria
                  semRotulos={filtros.g === 'dia'}
                />
              ) : <Vazio />}
            </Visual>
          </div>

          <div className="grid linha-dupla">
            {!somenteInterno && <RankingAnalistas data={data} filtros={filtros} />}
            <RankingAtendentes data={data} filtros={filtros} metas={metas} />
          </div>

          {!somenteInterno && (
            <div className="grid linha-dupla">
              <RankingVendedores data={data} filtros={filtros} medida={filtros.medida} />
              <Retrabalho data={data} />
            </div>
          )}

          <div className="grid linha-dupla">
            {!somenteInterno && <FilaUmov data={data} />}
            <FilaElleven data={data} metas={metas} />
          </div>

          <Detalhamento consulta={consulta} metas={metas} filtros={filtros} />

          <Qualidade data={data} />
        </>
      )}
    </main>
  );
}

function Avisos({ data }) {
  const f = data.qualidade.fontes || {};
  const nomes = { tarefas: 'uMov · tarefas', ciclos: 'uMov · ciclos', vendas: 'Elleven · vendas' };
  const erros = Object.entries(f).filter(([, x]) => x?.error);
  return (
    <>
      {erros.map(([k, x]) => (
        <div key={k} className="banner error">
          {nomes[k] || k}: a última carga falhou ({x.error}).
          {x.updatedAt ? ` Mostrando a carga de ${haQuanto(x.updatedAt)}.` : ' Esta parte da tela está sem dados.'}
        </div>
      ))}
      <div className="banner">
        Horas <b>úteis</b> no expediente do BKO: seg a sex 8h–21h, sábado e feriado 8h–17h, domingo não conta.
        A análise do BKO no uMov chega ao Data Hub <b>de hora em hora</b>, então um envio analisado há menos de
        ~2 h ainda pode aparecer como pendente. Só entram protocolos de <b>instalação de fibra</b>
        (TEC e #HR); Cortesia, Corporativo, Rádio e Telefonia ficam fora. Vendas de vendedor <b>sem canal</b> no
        CRM ficam fora dos SLAs em "Todos" (veja pelo filtro Sem canal).
        {' '}Atualizado: {Object.entries(nomes).map(([k, n]) => `${n} ${f[k]?.updatedAt ? haQuanto(f[k].updatedAt) : '—'}`).join(' · ')}.
      </div>
    </>
  );
}

function Cartoes({ data, metas, somenteInterno, medida }) {
  const outra = medida === 'media' ? 'mediana' : 'media';
  const a = data.agendamento;
  const c = data.cadastro;
  const itens = [
    // ordem pedida pelo BKO em 28/09: cadastro, agendamento, retrabalho, em aberto
    ...(!somenteInterno ? [
      { label: `Cadastro − input · ${NOME_MEDIDA[medida]}`, value: fmtHoras(c[medida]), desc: `${NOME_MEDIDA[outra]} ${fmtHoras(c[outra])}` },
      { label: `Cadastro no prazo (${metas.cadastro} h)`, value: fmtPct(c.pctNoPrazo), desc: `A2 − A1 · ${int(c.noPrazo || 0)} de ${int(c.n)} externas` },
    ] : []),
    { label: `Agendamento · ${NOME_MEDIDA[medida]}`, value: fmtHoras(a[medida]), desc: `${NOME_MEDIDA[outra]} ${fmtHoras(a[outra])}` },
    { label: `Agendamento no prazo (${metas.agendamento} h)`, value: fmtPct(a.pctNoPrazo), desc: `${int(a.noPrazo || 0)} de ${int(a.n)} agendadas` },
    ...(!somenteInterno ? [
      { label: 'Retrabalho nos ciclos', value: fmtPct(data.ciclos.pctRetrabalho), desc: `${int(data.ciclos.comRetrabalho)} de ${int(data.ciclos.ciclos)} ciclos` },
    ] : []),
    // destaque = o que está hoje na fila do BKO; o total fica entre parênteses
    // backlog de AGORA (não segue o período): na virada do mês o que ficou aberto continua aqui
    {
      label: `Abertos sem agendamento agora (de ${int(a.backlog ?? a.abertas)})`,
      value: int(a.backlogBko ?? a.abertasBko ?? a.abertas),
      desc: `na equipe ${a.equipeBko || 'do BKO'} · ${int(a.backlogBkoEstouradas ?? a.abertasBkoEstouradas ?? 0)} já passaram de ${metas.agendamento} h`
        + `${a.backlogBkoMaisDe7Dias ? ` · ${int(a.backlogBkoMaisDe7Dias)} com mais de 7 dias` : ''} · não segue o período`,
    },
  ];
  return (
    <div className="kpi-faixa">
      {itens.map((i) => <Kpi key={i.label} value={i.value} label={i.label} desc={i.desc} />)}
    </div>
  );
}

function ResumoSlas({ data, metas, canal }) {
  const pc = data.primeiroContato;
  // com um canal escolhido, as linhas do outro sairiam zeradas — e zero se lê como
  // "tempo zero", não como "não se aplica"
  const linhas = [
    { sla: 'Triagem no uMov', marcos: 'A1 → análise BKO', ...data.triagem, meta: null, so: 'Externo' },
    { sla: '1º contato — externa', marcos: 'A3 − A1', ...pc.externo, meta: null, so: 'Externo' },
    { sla: '1º contato — interna', marcos: 'B2 − B1', ...pc.interno, meta: null, so: 'Interno' },
    { sla: '1º contato → agendamento', marcos: 'A4 − A3 · B3 − B2', ...pc.contatoAteAgendamento, meta: null },
    { sla: 'Cadastro − input', marcos: 'A2 − A1', ...data.cadastro, meta: metas.cadastro, so: 'Externo' },
    { sla: 'Agendamento', marcos: 'A4 − A2 · B3 − B1', ...data.agendamento, meta: metas.agendamento },
    { sla: 'Total da venda externa', marcos: 'A4 − A1', ...data.totalExterna, meta: null, so: 'Externo' },
    { sla: 'Total da venda interna', marcos: 'B3 − B1', ...data.totalInterna, meta: null, so: 'Interno' },
  ].filter((l) => !canal || !l.so || l.so === (canal === 'Sem canal' ? 'Interno' : canal)).map((l, i) => ({ ...l, __key: i }));
  const colunas = [
    { key: 'sla', titulo: 'SLA', align: 'left' },
    { key: 'marcos', titulo: 'MARCOS', align: 'left' },
    { key: 'n', titulo: 'MEDIÇÕES', fmt: int },
    { key: 'mediana', titulo: 'MEDIANA', fmt: fmtHoras },
    { key: 'meta', titulo: 'META', fmt: (v) => (v ? `${v} h` : '—') },
    { key: 'pctNoPrazo', titulo: '% NO PRAZO', fmt: fmtPct },
    { key: 'media', titulo: 'MÉDIA', fmt: fmtHoras },
  ];
  return (
    <Visual
      title="RESUMO DOS SLAS"
      sub="horas úteis do BKO · cada linha conta só as vendas que já têm as duas datas"
      flush className="v-grafico"
      actions={<BotaoLegenda canal={canal} />}
    >
      <Tabela colunas={colunas} dados={linhas} ordemInicial={{ key: null }} />
    </Visual>
  );
}

/** O que é cada marco — sem isto "A3 − A1" não diz nada a quem abre a tela. */
const MARCOS_EXTERNA = [
  ['A1', 'último envio do pedido no uMov (o aprovado, quando houve reprovação e reenvio)'],
  ['A2', 'cadastro da venda no Elleven'],
  ['A3', '1º contato com o cliente (1º relato do protocolo)'],
  ['A4', 'agendamento da instalação (relato de agendamento)'],
];
const MARCOS_INTERNA = [
  ['B1', 'cadastro da venda no Elleven'],
  ['B2', '1º contato com o cliente (1º relato do protocolo)'],
  ['B3', 'agendamento da instalação (relato de agendamento)'],
];
/** Botão "Legenda" no cabeçalho do quadro: abre a explicação dos marcos só para quem quiser. */
function BotaoLegenda({ canal }) {
  const [aberto, setAberto] = useState(false);
  useEffect(() => {
    if (!aberto) return undefined;
    const esc = (e) => { if (e.key === 'Escape') setAberto(false); };
    document.addEventListener('keydown', esc);
    return () => document.removeEventListener('keydown', esc);
  }, [aberto]);
  const grupo = (titulo, itens) => (
    <div className="legenda-marcos-grupo">
      <b>{titulo}</b>
      <dl>
        {itens.map(([m, t]) => [<dt key={`${m}t`}><code>{m}</code></dt>, <dd key={`${m}d`}>{t}</dd>])}
      </dl>
    </div>
  );
  return (
    <>
      <button type="button" className="btn-exportar" onClick={() => setAberto(true)} title="O que é A1, A2, B1…">
        ? Legenda
      </button>
      {/* portal: fora do cabeçalho do quadro, que deixaria tudo em maiúsculas e centralizado */}
      {aberto && createPortal(
        <div className="legenda-modal-fundo" onClick={() => setAberto(false)} role="presentation">
          <div className="legenda-modal" role="dialog" aria-label="Legenda dos marcos" onClick={(e) => e.stopPropagation()}>
            <header>
              <b>Marcos dos SLAs</b>
              <button type="button" onClick={() => setAberto(false)} aria-label="Fechar">×</button>
            </header>
            <div className="legenda-marcos">
              {(!canal || canal === 'Externo') && grupo('Venda externa', MARCOS_EXTERNA)}
              {canal !== 'Externo' && grupo('Venda interna', MARCOS_INTERNA)}
            </div>
            <p className="legenda-nota">
              Cada SLA é o tempo em horas úteis do BKO entre dois marcos (seg a sex 8h–21h, sábado e
              feriado 8h–17h, domingo não conta). Uma venda só entra na linha quando já tem as duas datas.
            </p>
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}

function RankingAnalistas({ data, filtros }) {
  const colunas = [
    { key: 'nome', titulo: 'ANALISTA', align: 'left' },
    { key: 'n', titulo: 'ANÁLISES', fmt: int, databar: { cor: CORES.gold } },
    { key: 'aprovadas', titulo: 'APROVADAS', fmt: int },
    { key: 'reprovadas', titulo: 'REPROVADAS', fmt: int },
    { key: 'mediana', titulo: 'MEDIANA', fmt: fmtHoras },
    { key: 'media', titulo: 'MÉDIA', fmt: fmtHoras },
  ];
  const dados = data.triagem.porAnalista.map((l) => ({ ...l, __key: l.nome }));
  return (
    <Visual
      title="ANALISTAS DO BKO — TRIAGEM NO UMOV"
      sub="parte das análises fica no usuário genérico suporteumov, não num analista nomeado"
      flush className="v-tabela"
      actions={<BotaoExportar onExportar={() => baixarCSV('sla-bko-analistas', tabelaParaCSV(colunas, dados), sufixoPeriodo(filtros))} />}
    >
      {dados.length ? <Tabela colunas={colunas} dados={dados} ordemInicial={{ key: 'n', dir: 'desc' }} /> : <Vazio />}
    </Visual>
  );
}

function RankingAtendentes({ data, filtros, metas }) {
  const colunas = [
    { key: 'nome', titulo: 'ATENDENTE (AGENDAMENTO)', align: 'left' },
    { key: 'n', titulo: 'AGENDAMENTOS', fmt: int, databar: { cor: CORES.gold } },
    { key: 'mediana', titulo: 'MEDIANA', fmt: fmtHoras },
    { key: 'media', titulo: 'MÉDIA', fmt: fmtHoras },
    { key: 'pctNoPrazo', titulo: `% EM ${metas.agendamento} H`, fmt: fmtPct },
  ];
  const dados = data.agendamento.porAtendente.map((l) => ({ ...l, __key: l.nome }));
  return (
    <Visual
      title="ATENDENTES — AGENDAMENTO NO ELLEVEN"
      sub="quem escreveu o relato de agendamento · tempo desde o cadastro"
      flush className="v-tabela"
      actions={<BotaoExportar onExportar={() => baixarCSV('sla-bko-atendentes', tabelaParaCSV(colunas, dados), sufixoPeriodo(filtros))} />}
    >
      {dados.length ? <Tabela colunas={colunas} dados={dados} ordemInicial={{ key: 'n', dir: 'desc' }} /> : <Vazio />}
    </Visual>
  );
}

function RankingVendedores({ data, filtros, medida }) {
  const colunas = [
    { key: 'nome', titulo: 'VENDEDOR', align: 'left' },
    { key: 'n', titulo: 'ENVIOS', fmt: int, databar: { cor: CORES.gold } },
    { key: 'reprovadas', titulo: 'REPROVADOS', fmt: int },
    { key: 'pctReprovacao', titulo: '% REPROVAÇÃO', fmt: fmtPct },
    { key: medida, titulo: `${NOME_MEDIDA[medida].toUpperCase()} ATÉ ANÁLISE`, fmt: fmtHoras },
  ];
  const dados = data.triagem.porVendedor.map((l) => ({ ...l, __key: l.nome }));
  return (
    <Visual
      title="VENDEDORES EXTERNOS — ENVIOS NO UMOV"
      flush className="v-tabela"
      actions={<BotaoExportar onExportar={() => baixarCSV('sla-bko-vendedores', tabelaParaCSV(colunas, dados), sufixoPeriodo(filtros))} />}
    >
      {dados.length ? <Tabela colunas={colunas} dados={dados} ordemInicial={{ key: 'n', dir: 'desc' }} /> : <Vazio />}
    </Visual>
  );
}

function Retrabalho({ data }) {
  const c = data.ciclos;
  return (
    <Visual
      title="RETRABALHO — MOTIVOS DE DEVOLUÇÃO"
      sub={`${int(c.ciclos)} ciclos · ${fmtPct(c.pctRetrabalho)} com retrabalho · ${String(c.mediaRodadas ?? '—').replace('.', ',')} envios por ciclo · ciclo concluído em ${fmtHoras(c.horasCiclo.mediana)} (mediana)`}
      className="v-tabela"
    >
      {c.motivos.length
        ? <BarrasHorizontais data={c.motivos} nome="Devoluções" larguraCategoria={260} />
        : <Vazio texto="Nenhum motivo de devolução no período" />}
    </Visual>
  );
}

function FilaUmov({ data }) {
  const f = data.fila;
  const colunas = [
    { key: 'idTarefa', titulo: 'TAREFA', align: 'left', fmt: (v) => (v ? String(v) : '—') },
    { key: 'esperaHoras', titulo: 'ESPERANDO', fmt: fmtHoras },
    { key: 'envio', titulo: 'ENVIADA EM', align: 'left', fmt: fmtData },
    { key: 'qtdEnvios', titulo: 'ENVIOS', fmt: (v) => (v ? int(v) : '—') },
    { key: 'vendedor', titulo: 'VENDEDOR', align: 'left' },
    { key: 'cliente', titulo: 'CLIENTE', align: 'left' },
  ];
  const dados = f.umov.map((l) => ({ ...l, __key: l.idTarefa }));
  return (
    <Visual
      title="FILA NO UMOV — AGUARDANDO ANÁLISE DO BKO"
      sub={`agora, não segue o período · últimos ${f.janelaDias} dias: ${int(f.umovTotal)} · envio mais recente recebido do Data Hub: ${fmtData(f.umovUltimoEnvio)} · pedido com CPF e sem análise · a análise do BKO chega do uMov de hora em hora, então pedido analisado há menos de ~2 h ainda pode aparecer`
        + (f.umovMaisAntigas ? ` · ${int(f.umovMaisAntigas)} mais antigos fora da lista` : '')}
      flush className="v-tabela"
      actions={<BotaoExportar onExportar={() => baixarCSV('sla-bko-fila-umov', tabelaParaCSV(colunas, dados))} />}
    >
      {dados.length ? <Tabela colunas={colunas} dados={dados} ordemInicial={{ key: 'envio', dir: 'desc' }} /> : <Vazio texto="Nenhum envio aguardando análise" />}
    </Visual>
  );
}

function FilaElleven({ data, metas }) {
  const f = data.fila;
  const colunas = [
    { key: 'protocolo', titulo: 'PROTOCOLO', align: 'left' },
    { key: 'esperaHoras', titulo: 'SEM AGENDAR HÁ', fmt: fmtHoras, estilo: estouro(metas.agendamento) },
    { key: 'canal', titulo: 'CANAL', align: 'left' },
    { key: 'criadoEm', titulo: 'CADASTRO', align: 'left', fmt: fmtData },
    { key: 'contatoEm', titulo: '1º CONTATO', align: 'left', fmt: fmtData },
    { key: 'equipe', titulo: 'EQUIPE ATUAL', align: 'left', fmt: (v) => v || '—' },
    { key: 'statusProtocolo', titulo: 'STATUS', align: 'left', fmt: (v) => v || '—' },
    { key: 'cliente', titulo: 'CLIENTE', align: 'left' },
  ];
  const dados = f.elleven.map((l) => ({ ...l, __key: `${l.protocolo}-${l.contrato}` }));
  return (
    <Visual
      title="FILA NO ELLEVEN — CADASTRADAS SEM AGENDAMENTO"
      sub={`agora · cadastros dos últimos ${f.janelaDias} dias: ${int(f.ellevenTotal)}, ${int(f.ellevenEstouradas)} acima de ${metas.agendamento} h`
        + (f.ellevenMaisAntigas ? ` · ${int(f.ellevenMaisAntigas)} mais antigas fora da lista` : '')}
      flush className="v-tabela"
      actions={<BotaoExportar onExportar={() => baixarCSV('sla-bko-fila-elleven', tabelaParaCSV(colunas, dados))} />}
    >
      {dados.length ? <Tabela colunas={colunas} dados={dados} ordemInicial={{ key: 'criadoEm', dir: 'desc' }} /> : <Vazio texto="Nenhuma venda aguardando agendamento" />}
    </Visual>
  );
}

function Qualidade({ data }) {
  const q = data.qualidade;
  const pc = data.primeiroContato;
  const linhas = [
    { item: 'Vendas externas no período', valor: int(q.externas) },
    { item: 'Externas com CPF no Elleven', valor: int(q.externasComCpf) },
    { item: 'Externas cujo CPF existe no uMov (em qualquer data)', valor: `${int(q.externasComCpfNoUmov)} (${fmtPct(q.externas ? q.externasComCpfNoUmov / q.externas : null)})` },
    { item: 'Externas com ciclo do uMov anterior ao cadastro (A1 encontrado)', valor: `${int(q.externasComCiclo)} (${fmtPct(q.pctCruzamento)})` },
    { item: `Externas cujo único envio no uMov era de outra venda (mais de ${q.diasCicloValido} dias antes): ficam sem A1`, valor: int(q.ciclosAntigosDescartados || 0) },
    { item: 'Externas cujo pedido no uMov foi reprovado e não reenviado: ficam sem A1', valor: int(q.ciclosReprovadosDescartados || 0) },
    { item: 'Externas cujo pedido no uMov já tinha gerado outra venda do cliente: ficam sem A1', valor: int(q.ciclosJaUsadosDescartados || 0) },
    { item: 'Dias entre a análise do ciclo e o cadastro (mediana)', valor: String(q.diasCicloAteCadastro.mediana ?? '—').replace('.', ',') },
    { item: 'Cruzamentos com mais de 7 dias entre análise e cadastro', valor: int(q.cruzamentosAcimaDe7Dias) },
    { item: 'Vendas sem nenhum relato no atendimento (sem 1º contato)', valor: int(pc.vendasSemRelato) },
    { item: '1º relato já é o agendamento (contato e agendamento no mesmo horário)', valor: `${int(q.contatoEAgendamentoMesmoHorario)} de ${int(q.comContatoEAgendamento)} (${fmtPct(q.comContatoEAgendamento ? q.contatoEAgendamentoMesmoHorario / q.comContatoEAgendamento : null)})` },
    { item: 'Análises no uMov registradas antes do envio (fora do cálculo)', valor: `${int(q.analisesAntesDoEnvio)} de ${int(q.analisesNoPeriodo)}` },
    ...(q.fuso ? [
      // com o ajuste ligado (padrão −3 h), o teste vira conferência: análise antes do
      // envio deve ficar perto de zero e a diferença típica, positiva
      { item: `Fuso do uMov: ajuste em uso ${q.fuso.ajusteAtualHoras} h · análises antes do envio`, valor: `${int(q.fuso.antesDoEnvio)} de ${int(q.fuso.analisadas)}` },
      { item: 'Fuso do uMov: diferença típica análise − envio (mediana, horas corridas)', valor: `${String(q.fuso.medianaAnaliseMenosEnvioH ?? '—').replace('.', ',')} h` },
    ] : []),
    { item: 'Vendas com datas fora de ordem (excluídas do cálculo)', valor: int(q.datasForaDeOrdem) },
  ].map((l, i) => ({ ...l, __key: i }));
  return (
    <Visual
      title="QUALIDADE DO DADO"
      sub="o que sustenta os números acima — o cruzamento uMov ↔ Elleven é por CPF e vale só para o canal Vendedor Externo"
      flush className="v-meia"
    >
      <Tabela
        colunas={[{ key: 'item', titulo: 'VERIFICAÇÃO', align: 'left' }, { key: 'valor', titulo: 'VALOR' }]}
        dados={linhas}
        ordemInicial={{ key: null }}
      />
    </Visual>
  );
}

/**
 * DETALHAMENTO — uma linha por protocolo, com as datas e os SLAs de cada venda.
 * O servidor filtra e manda até 500 linhas; o CSV leva todas as do filtro.
 */
function Detalhamento({ consulta, metas, filtros }) {
  const [busca, setBusca] = useState('');
  const [buscaAtiva, setBuscaAtiva] = useState('');
  const [situacao, setSituacao] = useState('');
  const [fora, setFora] = useState(false);
  const [baixando, setBaixando] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setBuscaAtiva(busca.trim()), 400);
    return () => clearTimeout(t);
  }, [busca]);

  const params = new URLSearchParams();
  if (consulta.de) params.set('de', consulta.de);
  if (consulta.ate) params.set('ate', consulta.ate);
  if (consulta.canal?.length) params.set('canal', consulta.canal.join(','));
  if (buscaAtiva) params.set('busca', buscaAtiva);
  if (situacao) params.set('situacao', situacao);
  if (fora) params.set('fora', '1');
  const qs = params.toString();

  const { data, error, isLoading } = useQuery({
    queryKey: ['/sla-bko/detalhe', qs],
    queryFn: async ({ signal }) => {
      const res = await apiFetch(`/api/sla-bko/detalhe?${qs}`, { signal });
      if (!res.ok) throw new Error(`Erro ${res.status}`);
      return res.json();
    },
    placeholderData: (prev) => prev,
    staleTime: 20000,
  });

  const exportar = async () => {
    setBaixando(true);
    try {
      const res = await apiFetch(`/api/sla-bko/detalhe?${qs}&formato=csv`);
      if (!res.ok) throw new Error(`Erro ${res.status}`);
      baixar(`sla-bko-detalhamento_${sufixoPeriodo(filtros)}.csv`, await res.blob());
    } finally {
      setBaixando(false);
    }
  };

  const vermelho = { color: '#A4262C', fontWeight: 700 };
  // os SLAs vêm logo depois da identificação: é o que se procura primeiro; as
  // datas que explicam cada número ficam à direita, na ordem da jornada
  const colunas = [
    { key: 'protocolo', titulo: 'PROTOCOLO', align: 'left' },
    { key: 'situacao', titulo: 'SITUAÇÃO', align: 'left' },
    { key: 'canal', titulo: 'CANAL', align: 'left' },
    { key: 'slaCadastro', titulo: 'SLA CADASTRO (A2−A1)', fmt: fmtHoras, estilo: (v, l) => (l.foraCadastro ? vermelho : undefined) },
    { key: 'sla1Contato', titulo: 'SLA 1º CONTATO', fmt: fmtHoras },
    {
      key: 'slaAgendamento', titulo: 'SLA AGENDAMENTO',
      fmt: (v, l) => (v === null || v === undefined ? '—' : `${fmtHoras(v)}${l.agendamentoEmAberto ? ' (aberto)' : ''}`),
      estilo: (v, l) => (l.foraAgendamento ? vermelho : undefined),
    },
    { key: 'slaTriagem', titulo: 'SLA TRIAGEM UMOV', fmt: fmtHoras },
    { key: 'slaContatoAgendamento', titulo: 'CONTATO → AGEND.', fmt: fmtHoras },
    { key: 'slaTotalExterna', titulo: 'SLA TOTAL EXT.', fmt: fmtHoras },
    { key: 'envioUmov', titulo: 'ÚLTIMO ENVIO UMOV (A1)', align: 'left', fmt: fmtData },
    { key: 'primeiroEnvioUmov', titulo: '1º ENVIO UMOV', align: 'left', fmt: fmtData },
    { key: 'enviosNoCiclo', titulo: 'ENVIOS', fmt: (v) => (v ? int(v) : '—') },
    { key: 'analiseUmov', titulo: 'ANÁLISE UMOV', align: 'left', fmt: fmtData },
    { key: 'cadastro', titulo: 'CADASTRO (A2/B1)', align: 'left', fmt: fmtData },
    { key: 'primeiroContato', titulo: '1º CONTATO (A3/B2)', align: 'left', fmt: fmtData },
    { key: 'agendamento', titulo: 'AGENDAMENTO (A4/B3)', align: 'left', fmt: fmtData },
    { key: 'atendenteAgendamento', titulo: 'ATENDENTE AGEND.', align: 'left' },
    { key: 'cliente', titulo: 'CLIENTE', align: 'left' },
    { key: 'vendedor', titulo: 'VENDEDOR', align: 'left' },
    { key: 'tipo', titulo: 'TIPO', align: 'left' },
    { key: 'statusProtocolo', titulo: 'STATUS PROTOCOLO', align: 'left' },
    { key: 'equipe', titulo: 'EQUIPE ATUAL', align: 'left', fmt: (v) => v || '—' },
    { key: 'obsCruzamento', titulo: 'OBS. CRUZAMENTO UMOV', align: 'left', fmt: (v) => v || '—' },
  ];
  const linhas = (data?.linhas || []).map((l) => ({ ...l, __key: `${l.protocolo}-${l.contrato}` }));

  return (
    <Visual
      title="DETALHAMENTO"
      sub={data
        ? `${int(data.total)} vendas no filtro · ${int(data.foraDaMeta)} fora da meta (vermelho: cadastro − input > ${metas.cadastro} h, agendamento > ${metas.agendamento} h)`
          + (data.total > linhas.length ? ` · a tabela mostra as ${int(linhas.length)} de cadastro mais recente; o CSV leva todas` : '')
        : ''}
      flush className="v-tabela-alta"
      actions={<BotaoExportar onExportar={exportar} rotulo={baixando ? '…' : 'CSV'} titulo="Baixar todas as linhas do filtro em CSV" />}
    >
      <div className="detalhe-filtros">
        <input
          type="search" value={busca} onChange={(e) => setBusca(e.target.value)}
          placeholder="Buscar protocolo, contrato ou cliente"
        />
        <select value={situacao} onChange={(e) => setSituacao(e.target.value)}>
          <option value="">Todas as situações</option>
          {(data?.situacoes || []).map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <label>
          <input type="checkbox" checked={fora} onChange={(e) => setFora(e.target.checked)} />
          Só fora da meta
        </label>
      </div>
      {error && <Erro erro={error} />}
      {isLoading && !data ? <Loading /> : linhas.length
        ? <Tabela colunas={colunas} dados={linhas} ordemInicial={{ key: null }} />
        : <Vazio />}
    </Visual>
  );
}
