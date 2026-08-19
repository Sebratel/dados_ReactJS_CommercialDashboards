import { useDados } from '../api';
import { useFilters } from '../filters';
import { SlicerBarCondominios } from '../components/SlicerBarCondominios';
import { BotaoExportar, Erro, Kpi, Loading, Vazio, Visual } from '../components/ui';
import { ComboChart, CORES, escalaGradiente } from '../components/charts';
import { Tabela } from '../components/tables';
import { int, labelData, labelMes, pct, pct2 } from '../format';
import { baixar, baixarDoServidor, tabelaParaCSV } from '../exportar';

/**
 * Réplica da página "CONDOMÍNIOS" do relatório Power BI "COM - Condomínios":
 * ocupação das portas dos splitters instalados em prédios e residenciais.
 *
 * O que é um condomínio aqui: o título do splitter secundário contém "COND.",
 * "RES." ou "ED.". É o filtro de página do relatório de origem, e o nome do
 * condomínio é o pedaço do título entre a marca e o primeiro " -".
 *
 * A ORDEM dos blocos segue a do relatório, lida das coordenadas dos visuais no
 * `.pbip`: y=343 os três cartões, y=484 a ocupação por splitter, y=1144 o
 * detalhe porta a porta, y=1759 os resumos por condomínio e por cidade, y=2567 a
 * matriz de aprovações e o gráfico por cidade. Quem usa o relatório há meses
 * procura a informação pela posição — inverter faz parecer que falta conteúdo.
 *
 * A página de origem tem 3950px de altura e foi feita para rolar. Aqui também
 * rola: são seis faixas de conteúdo, e comprimir tudo numa tela deixaria as seis
 * ilegíveis.
 *
 * DIFERENÇAS em relação ao relatório (as do banco estão em `sql/splitters.sql`):
 *
 *  - Os dois mapas (LOCALIZAÇÃO SPLITTERS e LOCALIZAÇÃO CLIENTE) não vieram: o
 *    dashboard não tem biblioteca de mapa e não vale acoplá-lo a um servidor de
 *    tiles externo por dois visuais. As coordenadas do splitter e do cliente vão
 *    nos dois CSVs, para abrir no mapa que a pessoa já usa.
 *  - Sem emojis. O original marca a faixa com 🔴🟡🟢 e a porta com 🚹/👤 — emoji
 *    renderiza diferente por sistema operacional e desalinha a coluna. Aqui a
 *    faixa é a cor da célula e a porta é a coluna "com cliente".
 *  - A tela mostra TODAS as cidades; o relatório fixa cinco. O recorte de lá
 *    ficou a um clique na barra de filtros, em vez de escondido no código.
 *  - O filtro de cidade é a do EQUIPAMENTO, não a do cliente como no relatório.
 *    Porta livre não tem conexão e portanto não tem cidade: filtrando pela do
 *    cliente, escolher uma cidade descartava todas as portas livres e "portas"
 *    virava sinônimo de "clientes" — num painel cujo assunto é quanto ainda cabe.
 */

/**
 * Cores da faixa de ocupação. É polaridade, não magnitude: três estados, com o
 * vermelho e o verde reservados para "precisa de ação" e "tranquilo". Os mesmos
 * tons já usados na tela de Vendas Canceladas, que vieram da formatação
 * condicional do Power BI.
 */
const COR_FAIXA = {
  'CRÍTICO': '#9F0E0E',
  'ALERTA': CORES.gold600,
  'OK': '#1F601A',
  'SEM CAPACIDADE': '#605E5C',
};

const corDaFaixa = (linha) => COR_FAIXA[linha.classificacao] || undefined;
/** Ocupação é magnitude: um só tom, claro -> escuro, na escala fixa de 0 a 100%. */
const corDaOcupacao = (linha) => escalaGradiente(Number(linha.percentual) || 0, 0, 1, '#f7f0d0', CORES.gold);

const diasTexto = (v) => (v === null || v === undefined ? '—' : `${int(v)} dias`);

export default function Condominios() {
  const { filtros } = useFilters();
  const { data, error, isLoading } = useDados('/condominios', filtros);

  const vazio = isLoading && !data;
  const k = data?.kpis;

  /** Concentração das faixas — a leitura que a tabela sozinha não entrega. */
  const faixas = data?.porClassificacao || [];
  const resumoFaixas = faixas.length
    ? faixas.map((f) => `${int(f.splitters)} ${f.key.toLowerCase()}`).join(' · ')
    : '';

  // ---- y=484: uma linha por splitter de condomínio -----------------------
  const colunasSplitter = [
    { key: 'condominio', titulo: 'CONDOMÍNIO', align: 'left' },
    // o relatório mostra só o nome do condomínio; sem o equipamento, dois
    // splitters do mesmo prédio viram duas linhas indistinguíveis
    { key: 'splitter', titulo: 'SPLITTER', align: 'left' },
    { key: 'pontoAcesso', titulo: 'PONTO DE ACESSO', align: 'left' },
    { key: 'capacidade', titulo: 'CAPACIDADE', fmt: int },
    { key: 'ocupadas', titulo: 'PORTAS OCUPADAS', fmt: int, databar: { cor: CORES.gold } },
    { key: 'disponiveis', titulo: 'PORTAS DISPONÍVEIS', fmt: int, databar: { cor: CORES.goldSoft } },
    { key: 'percentual', titulo: 'OCUPAÇÃO', fmt: pct, align: 'center', corFundo: corDaOcupacao },
    { key: 'classificacao', titulo: 'FAIXA', align: 'center', corFundo: corDaFaixa },
    { key: 'criado', titulo: 'CRIADO EM', fmt: labelData },
    { key: 'diasDeVida', titulo: 'TEMPO DE VIDA', fmt: diasTexto },
    { key: 'site', titulo: 'SITE', align: 'left' },
  ];

  // ---- y=1144: detalhe porta a porta ------------------------------------
  const colunasDetalhe = [
    { key: 'condominio', titulo: 'CONDOMÍNIO', align: 'left' },
    { key: 'splitter', titulo: 'SPLITTER', align: 'left' },
    { key: 'porta', titulo: 'PORTA', fmt: int },
    { key: 'usuario', titulo: 'USUÁRIO', align: 'left', fmt: (v) => v || '—' },
    { key: 'cliente', titulo: 'CLIENTE', align: 'left', fmt: (v) => v || '(porta livre)' },
    {
      key: 'ocupada',
      titulo: 'COM CLIENTE',
      align: 'center',
      fmt: (v) => (v ? 'Sim' : 'Não'),
      corFundo: (d) => (d.ocupada ? '#1F601A' : '#F3F2F1'),
    },
    { key: 'dataAprovacao', titulo: 'DATA DA APROVAÇÃO', fmt: labelData },
    { key: 'cidade', titulo: 'CIDADE', align: 'left' },
    { key: 'rua', titulo: 'RUA DO CLIENTE', align: 'left' },
    { key: 'numero', titulo: 'NÚMERO' },
    { key: 'bairro', titulo: 'BAIRRO', align: 'left' },
  ];

  // ---- y=1759 esquerda: resumo por condomínio ---------------------------
  // Sem coluna de "portas": o Voalle cria uma linha de porta por porta declarada,
  // então a contagem de portas é igual à capacidade — duas colunas com o mesmo
  // número lado a lado fazem quem lê procurar a diferença que não existe.
  const colunasCondominio = [
    { key: 'key', titulo: 'CONDOMÍNIO', align: 'left' },
    { key: 'splitters', titulo: 'SPLITTERS', fmt: int },
    { key: 'capacidade', titulo: 'CAPACIDADE', fmt: int },
    { key: 'clientes', titulo: 'CLIENTES', fmt: int, databar: { cor: CORES.gold } },
    { key: 'ocupadas', titulo: 'PORTAS OCUPADAS', fmt: int },
    { key: 'percentual', titulo: 'OCUPAÇÃO', fmt: pct, align: 'center', corFundo: corDaOcupacao },
    { key: 'classificacao', titulo: 'FAIXA', align: 'center', corFundo: corDaFaixa },
  ];

  // ---- y=1759 direita: resumo por cidade -------------------------------
  const colunasCidade = [
    { key: 'key', titulo: 'CIDADE', align: 'left' },
    { key: 'splitters', titulo: 'SPLITTERS', fmt: int },
    { key: 'capacidade', titulo: 'CAPACIDADE', fmt: int },
    { key: 'ocupadas', titulo: 'OCUPADAS', fmt: int, databar: { cor: CORES.gold } },
    { key: 'disponiveis', titulo: 'DISPONÍVEIS', fmt: int, databar: { cor: CORES.goldSoft } },
    { key: 'percentual', titulo: '% DE OCUPAÇÃO', fmt: pct2, align: 'center', corFundo: corDaOcupacao },
  ];

  // ---- y=2567 esquerda: matriz mês de aprovação x cidade ---------------
  const cidadesMatriz = data?.matriz?.colunas || [];
  const colunasMatriz = [
    { key: 'periodo', titulo: 'MÊS DA APROVAÇÃO', align: 'left', fmt: labelMes },
    ...cidadesMatriz.map((c) => ({
      key: c,
      titulo: c.toUpperCase(),
      fmt: (v) => (v ? int(v) : '—'),
    })),
    { key: 'total', titulo: 'TOTAL', fmt: int, bold: true },
  ];
  const totaisMatriz = data?.matriz
    ? { __label: 'TOTAL', ...data.matriz.totalPorColuna, total: data.matriz.total }
    : null;

  // ---- y=2567 direita: clientes por cidade -----------------------------
  // Uma série só, como no relatório (o visual de lá é um combo, mas com um único
  // campo em Y). Nada de segunda série artificial para "usar" o formato do combo.
  const serieCidades = (data?.clientesPorCidade || [])
    .slice(0, 12)
    .map((c) => ({ label: c.key, clientes: c.clientes }));

  return (
    <main className="page">
      <SlicerBarCondominios />
      {error && <Erro erro={error} />}

      <div className="banner">
        Entram apenas os splitters cujo título identifica um condomínio —
        <b> COND.</b>, <b> RES.</b> ou <b> ED.</b> — que é o filtro de página do relatório de
        origem. Cada linha do detalhamento é uma <b>porta</b> do splitter; “cliente” é a porta
        que tem uma conexão vinculada. Os mapas do relatório não vieram: as coordenadas do
        splitter e do cliente estão nos dois CSVs desta tela.
      </div>

      {/* y=343: os três cartões do relatório (splitters primários, portas e
          splitters de condomínio) mais os dois que a tela pede — a pergunta de
          quem abre esta página é quanto ainda cabe */}
      <div className="kpi-faixa">
        <Kpi
          value={int(k?.primarios || 0)}
          label="SPLITTERS PRIMÁRIOS"
          desc="caixas de rua que alimentam os condomínios do filtro"
          title="Contagem distinta de splitters primários (type=2) com ao menos um splitter de condomínio pendurado."
        />
        <Kpi
          value={int(k?.portas || 0)}
          label="PORTAS"
          desc="portas cadastradas — livres incluídas"
          title="Uma linha por porta de splitter secundário, ocupada ou não. O Voalle cria uma porta por porta declarada no equipamento, então este número acompanha a capacidade instalada; quem conta cliente é o cartão ao lado."
        />
        <Kpi
          value={int(k?.splitters || 0)}
          label="SPLITTERS DE CONDOMÍNIO"
          desc="equipamentos instalados nos prédios"
          title="Contagem distinta de splitters secundários (type=1) cujo título identifica um condomínio."
        />
        <Kpi
          value={int(k?.condominios || 0)}
          label="CONDOMÍNIOS"
          desc="nomes distintos — um condomínio pode ter vários splitters"
          title="Contagem distinta do nome extraído do título do splitter. Menor que o número de splitters sempre que um prédio recebe mais de um equipamento."
        />
        <Kpi
          value={int(k?.clientes || 0)}
          label="CLIENTES"
          desc="portas com conexão vinculada"
          title="Portas que têm um authentication_contract vinculado. É a mesma definição que a consulta de ocupação usa para contar porta ocupada."
        />
        <Kpi
          value={pct(k?.ocupacao || 0)}
          label="OCUPAÇÃO"
          small
          desc={`${int(k?.ocupadas || 0)} de ${int(k?.capacidade || 0)} portas · ${int(k?.disponiveis || 0)} livres`}
          title="Portas ocupadas dividido pela capacidade declarada dos splitters (out_ports). A capacidade é somada por splitter distinto, não por porta."
        />
      </div>

      {/* y=484 no relatório: a ocupação de cada splitter, largura inteira */}
      <Visual
        title="OCUPAÇÃO DOS SPLITTERS DE CONDOMÍNIO"
        sub={data
          ? `${int(data.porSplitterTotal)} splitters${resumoFaixas ? ` · ${resumoFaixas}` : ''}`
            + (data.porSplitterTotal > data.porSplitter.length
              ? ` — a tabela mostra os ${int(data.porSplitter.length)} mais ocupados; o CSV traz todos`
              : '')
          : ''}
        flush
        className="v-tabela-alta"
        actions={(
          <BotaoExportar
            titulo="Baixar a ocupação de todos os splitters do filtro (arquivo completo do servidor)"
            rotulo="CSV completo"
            onExportar={() => baixarDoServidor('condominios-ocupacao', filtros)}
          />
        )}
      >
        {vazio ? <Loading /> : (
          <Tabela
            colunas={colunasSplitter}
            dados={data?.porSplitter || []}
            ordemInicial={{ key: 'percentual', dir: 'desc' }}
          />
        )}
      </Visual>

      {/* y=1144: o detalhe porta a porta, largura inteira */}
      <Visual
        title="DETALHAMENTO DAS PORTAS E DOS CLIENTES"
        sub={data
          ? `${int(data.detalheTotal)} portas — a tabela mostra as ${int((data.detalhe || []).length)} de aprovação mais recente; o CSV traz todas, com as coordenadas`
          : ''}
        flush
        className="v-tabela-alta"
        actions={(
          <BotaoExportar
            titulo="Baixar todas as portas do filtro, com cliente, endereço e coordenadas"
            rotulo="CSV completo"
            onExportar={() => baixarDoServidor('condominios', filtros)}
          />
        )}
      >
        {vazio ? <Loading /> : (
          <Tabela
            colunas={colunasDetalhe}
            dados={data?.detalhe || []}
            ordemInicial={{ key: 'dataAprovacao', dir: 'desc' }}
          />
        )}
      </Visual>

      {/* y=1759: condomínio à esquerda (1186px), cidade à direita (1290px) */}
      <div className="grid linha-dupla">
        <Visual
          title="POR CONDOMÍNIO"
          sub={data && data.porCondominioTotal > data.porCondominio.length
            ? `${int(data.porCondominioTotal)} condomínios — os ${int(data.porCondominio.length)} com mais clientes. Capacidade somada por splitter distinto`
            : 'capacidade e portas ocupadas somadas por splitter distinto do condomínio'}
          flush
          className="v-meia"
          actions={(
            <BotaoExportar
              titulo={`Baixar as ${int((data?.porCondominio || []).length)} linhas desta tabela. Para todos os ${int(data?.porCondominioTotal || 0)} condomínios do filtro, use o CSV completo de ocupação por splitter, no primeiro visual.`}
              onExportar={() => baixar(
                'condominios-por-condominio.csv',
                tabelaParaCSV(colunasCondominio, data?.porCondominio || []),
              )}
            />
          )}
        >
          {vazio ? <Loading /> : <Tabela colunas={colunasCondominio} dados={data?.porCondominio || []} ordemInicial={{ key: 'clientes', dir: 'desc' }} />}
        </Visual>

        <Visual
          title="OCUPAÇÃO POR CIDADE"
          sub="cidade do equipamento: quando o splitter não tem cidade cadastrada, vale a mais frequente entre os clientes dele. Cada splitter conta em uma cidade só"
          flush
          className="v-meia"
          actions={(
            <BotaoExportar onExportar={() => baixar(
              'condominios-por-cidade.csv',
              tabelaParaCSV(colunasCidade, data?.porCidade || []),
            )} />
          )}
        >
          {vazio ? <Loading /> : <Tabela colunas={colunasCidade} dados={data?.porCidade || []} ordemInicial={{ key: 'ocupadas', dir: 'desc' }} />}
        </Visual>
      </div>

      {/* y=2567: matriz à esquerda, gráfico por cidade à direita */}
      <div className="grid linha-dupla">
        <Visual
          title="CLIENTES POR MÊS DE APROVAÇÃO E CIDADE"
          sub={data?.matriz?.linhas?.length
            ? `${int(data.matriz.total)} clientes com contrato aprovado nas ${cidadesMatriz.length} cidades com mais portas ocupadas`
            : 'porta sem contrato aprovado não tem data de aprovação e fica fora desta matriz, como no relatório'}
          flush
          className="v-meia"
          actions={(
            <BotaoExportar onExportar={() => baixar(
              'condominios-aprovacoes-por-cidade.csv',
              tabelaParaCSV(colunasMatriz, data?.matriz?.linhas || []),
            )} />
          )}
        >
          {vazio ? <Loading /> : (
            <Tabela
              colunas={colunasMatriz}
              dados={(data?.matriz?.linhas || []).map((l) => ({ ...l, __key: l.periodo }))}
              totais={totaisMatriz}
              ordemInicial={{ key: 'periodo', dir: 'asc' }}
            />
          )}
        </Visual>

        <Visual
          title="CLIENTES EM CONDOMÍNIOS POR CIDADE"
          sub={`portas com conexão vinculada, pela cidade do cliente${serieCidades.length ? ` · ${serieCidades.length} cidades` : ''}`}
          className="v-meia"
        >
          {vazio ? <Loading />
            : serieCidades.length ? <ComboChart data={serieCidades} barKey="clientes" barName="CLIENTES" />
              : <Vazio texto="Nenhum cliente em condomínio para os filtros selecionados" />}
        </Visual>
      </div>
    </main>
  );
}
