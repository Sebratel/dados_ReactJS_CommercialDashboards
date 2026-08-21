import { useDados } from '../api';
import { useFilters } from '../filters';
import { SlicerBarLeads } from '../components/SlicerBarLeads';
import { SlicerBarNegociacoes } from '../components/SlicerBarNegociacoes';
import { PaginaNegociacoes } from './PaginaNegociacoes';
import { PaginaDesempenho } from './PaginaDesempenho';
import { SlicerBarDesempenho } from '../components/SlicerBarDesempenho';
import { BotaoExportar, Erro, Kpi, Legenda, Loading, Vazio, Visual } from '../components/ui';
import {
  COR_STATUS, ColunasEmpilhadas, CORES, corDaCategoria, escalaGradiente,
} from '../components/charts';
import { Tabela } from '../components/tables';
import { Icone } from '../components/Icone';
import { int, labelData, labelDataHora, labelMes, pct } from '../format';
import { baixar, baixarDoServidor, tabelaParaCSV } from '../exportar';

/**
 * Réplica do relatório Power BI "COM - Leads & Negociações".
 *
 * O relatório tem QUATRO páginas de dados — LEADS, NEGOCIAÇÕES, DESEMPENHO DO
 * VENDEDOR e DESEMPENHO POR CIDADE — mais uma capa que é só navegação. Aqui elas
 * viram sub-páginas de uma única entrada no menu: a navegação principal já tem 13
 * itens e passaria a rolar em telas de 1366px, e os seis slicers do relatório se
 * repetem nas quatro páginas, então a barra de filtros é uma só e sobrevive à
 * troca de sub-página (que fica na URL, em `?lpag=`, para o link ser
 * compartilhável).
 *
 * As quatro sub-páginas do relatório estão prontas. As duas de Desempenho são o
 * MESMO componente com `por` diferente: comparadas visual por visual, as páginas
 * de origem só divergem na dimensão de linha.
 *
 * Cada sub-página tem a SUA barra de filtros, e não é preciosismo: em Leads o
 * período é o cadastro do lead e o vendedor é o dono dele; em Negociações o
 * período é a criação da negociação e o vendedor é o responsável por ela. São
 * campos diferentes no modelo de origem, e 21% das negociações são de leads
 * cadastrados antes do recorte — reusar uma barra só perderia um quinto delas.
 */

/** Sub-páginas do relatório. `pronta: false` fica fora da navegação. */
const SUBPAGINAS = [
  { id: 'leads', label: 'Leads', pronta: true },
  { id: 'negociacoes', label: 'Negociações', pronta: true },
  { id: 'vendedor', label: 'Desempenho do vendedor', pronta: true },
  { id: 'cidade', label: 'Desempenho por cidade', pronta: true },
];

const DISPONIVEIS = SUBPAGINAS.filter((s) => s.pronta);

/** Os oito cartões do relatório, na ordem do funil que eles seguem lá. */
const CARTOES = [
  { key: 'total', label: 'LEADS', desc: 'pessoas distintas cadastradas no CRM no período', title: 'Contagem distinta de lead_id — a medida Medidas_old[Leads] do relatório.' },
  { key: 'Disponível', label: 'DISPONÍVEIS', desc: 'situação "Lead", sem CPF/CNPJ e sem negociação', title: 'Lead com situação 4 ("Lead") que ainda não tem documento preenchido nem negociação aberta, e que não foi criado pela integração UMOV.' },
  { key: 'Qualificado', label: 'QUALIFICADOS', desc: 'situação "Lead" já com CPF/CNPJ', title: 'Igual a "Disponível", mas com o documento preenchido — é o que separa os dois estados no relatório.' },
  { key: 'Em Andamento', label: 'EM ANDAMENTO', desc: 'com negociação aberta, sem desfecho', title: 'Tem negociação cujo motivo ainda não é de ganho nem de perda. Costuma ficar baixo: o CRM registra o motivo junto com o desfecho.' },
  { key: 'Ganho', label: 'GANHOS', desc: 'com pelo menos uma negociação ganha', title: 'Vence os outros estados: um lead com negociação ganha conta aqui mesmo que também esteja descartado.' },
  { key: 'Perda', label: 'PERDAS', desc: 'com negociação de motivo perdido', title: 'Só entra quem não tem nenhuma negociação ganha e não está descartado.' },
  { key: 'Descartado', label: 'DESCARTADOS', desc: 'excluídos do CRM, sem negociação ganha', title: 'Pessoa marcada como deletada no CRM. A data de descarte é a da última modificação.' },
  { key: 'Outros', label: 'OUTROS', desc: 'sem negociação e fora da situação "Lead"', title: 'O resto: cadastro que não está na situação "Lead" e nunca teve negociação. Na base atual é a maior fatia — normalmente cliente antigo ou registro de outra origem.' },
];

const corStatus = (nome, i) => COR_STATUS[nome] || corDaCategoria(nome, i);

/** Participação no total: magnitude, um só tom claro -> escuro. */
const corDoPct = (linha) => escalaGradiente(Number(linha.pct) || 0, 0, 1, '#f7f0d0', CORES.gold);
const corDoStatus = (linha) => COR_STATUS[linha.status] || undefined;

/** As seis tabelinhas do relatório têm todas a mesma forma: rótulo, qtd e %. */
const contagem = (titulo) => [
  { key: 'key', titulo, align: 'left' },
  { key: 'leads', titulo: 'LEADS', fmt: int, databar: { cor: CORES.gold } },
  { key: 'pct', titulo: '%', fmt: pct, align: 'center', corFundo: corDoPct },
];

function SubNav({ atual, onChange }) {
  if (DISPONIVEIS.length < 2) return null;
  return (
    <nav className="subnav">
      {DISPONIVEIS.map((s) => (
        <button
          key={s.id}
          type="button"
          className={atual === s.id ? 'on' : ''}
          onClick={() => onChange(s.id)}
        >
          {s.label}
        </button>
      ))}
      {SUBPAGINAS.some((s) => !s.pronta) && (
        <span className="subnav-aviso" title={`Em construção: ${SUBPAGINAS.filter((s) => !s.pronta).map((s) => s.label).join(', ')}`}>
          <Icone nome="relogio" tamanho={11} />
          {SUBPAGINAS.filter((s) => !s.pronta).length} sub-páginas a caminho
        </span>
      )}
    </nav>
  );
}

export default function LeadsNegociacoes() {
  const { filtros, setFiltro } = useFilters();
  const sub = DISPONIVEIS.some((s) => s.id === filtros.lpag) ? filtros.lpag : DISPONIVEIS[0].id;

  return (
    <main className="page">
      {sub === 'negociacoes' && <SlicerBarNegociacoes />}
      {sub === 'leads' && <SlicerBarLeads />}
      {(sub === 'vendedor' || sub === 'cidade') && <SlicerBarDesempenho por={sub} />}
      <SubNav atual={sub} onChange={(id) => setFiltro({ lpag: id })} />
      {sub === 'leads' && <PaginaLeads filtros={filtros} />}
      {sub === 'negociacoes' && <PaginaNegociacoes filtros={filtros} />}
      {(sub === 'vendedor' || sub === 'cidade') && (
        <PaginaDesempenho filtros={filtros} por={sub} />
      )}
    </main>
  );
}

function PaginaLeads({ filtros }) {
  const { data, error, isLoading } = useDados('/leads', filtros);
  const vazio = isLoading && !data;
  const k = data?.kpis;

  const serie = (s) => ({
    series: s?.series || [],
    dados: (s?.dados || []).map((d) => ({ ...d, label: labelMes(d.periodo) })),
  });
  const sStatus = serie(data?.serieStatus);
  const sOrigem = serie(data?.serieOrigem);
  const sForma = serie(data?.serieForma);

  // ---- y=487 esquerda: status por lead ----------------------------------
  const colunasStatus = [
    { key: 'leadId', titulo: 'ID', fmt: int },
    { key: 'nome', titulo: 'LEAD', align: 'left' },
    { key: 'dtCadastro', titulo: 'CADASTRO', fmt: labelDataHora },
    { key: 'status', titulo: 'STATUS', align: 'center', corFundo: corDoStatus },
  ];

  // ---- y=1124: o detalhamento completo (26 colunas do relatório) --------
  const colunasCompleto = [
    { key: 'leadId', titulo: 'ID', fmt: int },
    { key: 'nome', titulo: 'LEAD', align: 'left' },
    { key: 'dtCadastro', titulo: 'CADASTRO', fmt: labelDataHora },
    { key: 'status', titulo: 'STATUS', align: 'center', corFundo: corDoStatus },
    { key: 'tempoDeVida', titulo: 'TEMPO DE VIDA', align: 'center' },
    { key: 'genero', titulo: 'GÊNERO', align: 'left' },
    { key: 'tipoDocumento', titulo: 'TIPO', align: 'left' },
    { key: 'cpfCnpj', titulo: 'CPF/CNPJ', align: 'left' },
    { key: 'dtNascimento', titulo: 'NASCIMENTO', fmt: labelData },
    { key: 'telefone', titulo: 'TELEFONE', align: 'left' },
    { key: 'celular', titulo: 'CELULAR', align: 'left' },
    { key: 'email', titulo: 'E-MAIL', align: 'left' },
    { key: 'cep', titulo: 'CEP', align: 'left' },
    { key: 'cidade', titulo: 'CIDADE', align: 'left' },
    { key: 'bairro', titulo: 'BAIRRO', align: 'left' },
    { key: 'rua', titulo: 'RUA', align: 'left' },
    { key: 'numero', titulo: 'Nº' },
    { key: 'criadoPor', titulo: 'CRIADO POR', align: 'left' },
    { key: 'proprietarioVenda', titulo: 'PROPRIETÁRIO', align: 'left' },
    { key: 'time', titulo: 'TIME', align: 'left' },
    { key: 'origem', titulo: 'ORIGEM', align: 'left' },
    { key: 'forma', titulo: 'FORMA DE CONTATO', align: 'left' },
    { key: 'motivo', titulo: 'MOTIVO', align: 'left' },
    { key: 'modificadoPor', titulo: 'MODIFICADO POR', align: 'left' },
    { key: 'dtModificacao', titulo: 'MODIFICADO EM', fmt: labelDataHora },
    { key: 'deletado', titulo: 'DELETADO', align: 'center' },
  ];

  // ---- y=2971: matriz vendedor x status --------------------------------
  const colsMatriz = data?.matrizVendedor?.colunas || [];
  const colunasMatriz = [
    { key: 'vendedor', titulo: 'DONO DO LEAD', align: 'left' },
    { key: 'equipe', titulo: 'EQUIPE', align: 'left', fmt: (v) => v || '—' },
    ...colsMatriz.map((c) => ({
      key: c,
      titulo: c.toUpperCase(),
      fmt: (v) => (v ? int(v) : '—'),
    })),
    { key: 'total', titulo: 'TOTAL', fmt: int, bold: true },
  ];
  const totaisMatriz = data?.matrizVendedor
    ? { __label: 'TOTAL', ...data.matrizVendedor.totalPorColuna, total: data.matrizVendedor.total }
    : null;

  const legendaStatus = (s) => (
    <Legenda itens={s.series.map((x, i) => ({ label: x, cor: corStatus(x, i) }))} />
  );
  const legendaCategoria = (s) => (
    <Legenda itens={s.series.map((x, i) => ({ label: x, cor: corDaCategoria(x, i) }))} />
  );

  const grafico = (s, cores) => {
    if (vazio) return <Loading />;
    if (!s.dados.length) return <Vazio texto="Sem leads para os filtros selecionados" />;
    return (
      <>
        {cores === corStatus ? legendaStatus(s) : legendaCategoria(s)}
        <div style={{ flex: 1, minHeight: 0 }}>
          <ColunasEmpilhadas data={s.dados} series={s.series} cores={cores} />
        </div>
      </>
    );
  };

  return (
    <>
      {error && <Erro erro={error} />}

      <div className="banner">
        Um lead é uma pessoa no CRM cadastrada a partir de <b>01/01/2026</b> — o mesmo recorte
        das duas consultas do relatório. O <b>status</b> é decidido na ordem em que aparece nos
        cartões abaixo: quem tem negociação ganha conta como <b>Ganho</b> mesmo que também esteja
        descartado. O vendedor é o <b>dono do lead</b>: o proprietário da venda quando existe,
        senão quem cadastrou.
      </div>

      {/* y=318: os oito cartões do relatório */}
      <div className="kpi-faixa">
        {CARTOES.map((c) => (
          <Kpi
            key={c.key}
            value={int(k?.[c.key] || 0)}
            label={c.label}
            desc={c.desc}
            title={c.title}
          />
        ))}
      </div>

      {/* y=487: lista curta à esquerda, evolução à direita */}
      <div className="grid linha-dupla">
        <Visual
          title="STATUS POR LEAD"
          sub={data
            ? `${int(data.total)} leads no filtro — a tabela mostra os ${int((data.statusPorLead || []).length)} de cadastro mais recente`
            : ''}
          flush
          className="v-meia"
        >
          {vazio ? <Loading /> : (
            <Tabela
              colunas={colunasStatus}
              dados={data?.statusPorLead || []}
              ordemInicial={{ key: 'dtCadastro', dir: 'desc' }}
            />
          )}
        </Visual>

        <Visual
          title="STATUS POR LEAD / MÊS"
          ia="leads:status"
          sub="empilhado: o relatório usa colunas agrupadas, que com sete estados viram sete barras finas por mês e escondem o total"
          className="v-meia"
        >
          {grafico(sStatus, corStatus)}
        </Visual>
      </div>

      {/* y=1124: o detalhamento completo, largura inteira */}
      <Visual
        title="LEADS COMPLETO"
        sub={data
          ? `${int(data.total)} leads — a tabela mostra os ${int((data.completo || []).length)} mais recentes; o CSV traz todos, com as coordenadas`
          : ''}
        flush
        className="v-tabela-alta"
        actions={(
          <BotaoExportar
            titulo="Baixar todos os leads do filtro, com endereço, origem e coordenadas"
            rotulo="CSV completo"
            onExportar={() => baixarDoServidor('leads', filtros)}
          />
        )}
      >
        {vazio ? <Loading /> : (
          <Tabela
            colunas={colunasCompleto}
            dados={data?.completo || []}
            ordemInicial={{ key: 'dtCadastro', dir: 'desc' }}
          />
        )}
      </Visual>

      {/* y=1764: origem, forma de contato e motivos */}
      <div className="grid linha-38-38-24">
        <Visual title="ORIGEM POR LEAD / MÊS" sub="as 6 origens com mais leads; o resto soma em Outros" className="v-meia" ia="leads:origem">
          {grafico(sOrigem, corDaCategoria)}
        </Visual>
        <Visual title="FORMA DE CONTATO POR LEAD / MÊS" sub="as 6 formas com mais leads; o resto soma em Outros" className="v-meia" ia="leads:forma">
          {grafico(sForma, corDaCategoria)}
        </Visual>
        <Visual
          title="MOTIVOS POR LEAD"
          sub={data
            ? `base: ${int(data.leadsComMotivo)} leads com motivo registrado, de ${int(data.kpis?.total || 0)} — é a base que o relatório usa nesta tabela`
            : ''}
          ia="leads:motivo"
          flush
          className="v-meia"
          actions={(
            <BotaoExportar onExportar={() => baixar(
              'leads-por-motivo.csv',
              tabelaParaCSV(contagem('MOTIVO'), data?.porMotivo || []),
            )} />
          )}
        >
          {vazio ? <Loading /> : <Tabela colunas={contagem('MOTIVO')} dados={data?.porMotivo || []} />}
        </Visual>
      </div>

      {/* y=2401: as cinco tabelinhas de perfil */}
      <div className="grid linha-cinco">
        <Visual title="CIDADE" flush className="v-meia" ia="leads:perfil">
          {vazio ? <Loading /> : <Tabela colunas={contagem('CIDADE')} dados={data?.porCidade || []} />}
        </Visual>
        <Visual title="BAIRRO" flush className="v-meia">
          {vazio ? <Loading /> : <Tabela colunas={contagem('BAIRRO')} dados={data?.porBairro || []} />}
        </Visual>
        <Visual title="RUA" flush className="v-meia">
          {vazio ? <Loading /> : <Tabela colunas={contagem('RUA')} dados={data?.porRua || []} />}
        </Visual>
        <Visual title="GÊNERO" flush className="v-meia">
          {vazio ? <Loading /> : <Tabela colunas={contagem('GÊNERO')} dados={data?.porGenero || []} />}
        </Visual>
        <Visual title="TIPO DE PESSOA" flush className="v-meia">
          {vazio ? <Loading /> : <Tabela colunas={contagem('TIPO')} dados={data?.porTipoPessoa || []} />}
        </Visual>
      </div>

      {/* y=2971: matriz vendedor x status (o mapa do relatório não veio) */}
      <Visual
        title="STATUS DE LEAD POR VENDEDOR"
        ia="leads:vendedor"
        sub={data?.matrizVendedor
          ? `${int(data.matrizVendedor.linhas.length)} donos de lead. O mapa de geolocalização do relatório não veio: as coordenadas estão no CSV acima`
          : ''}
        flush
        className="v-tabela-alta"
        actions={(
          <BotaoExportar onExportar={() => baixar(
            'leads-status-por-vendedor.csv',
            tabelaParaCSV(colunasMatriz, data?.matrizVendedor?.linhas || []),
          )} />
        )}
      >
        {vazio ? <Loading /> : (
          <Tabela
            colunas={colunasMatriz}
            dados={(data?.matrizVendedor?.linhas || []).map((l) => ({ ...l, __key: l.vendedor }))}
            totais={totaisMatriz}
            ordemInicial={{ key: 'total', dir: 'desc' }}
          />
        )}
      </Visual>
    </>
  );
}
