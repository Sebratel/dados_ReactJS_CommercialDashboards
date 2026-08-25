import { useDados } from '../api';
import { useFilters } from '../filters';
import { SlicerBarRelatorios } from '../components/SlicerBarRelatorios';
import { BotaoExportar, Erro, Kpi, Loading, Vazio, Visual } from '../components/ui';
import { CORES } from '../components/charts';
import { Tabela } from '../components/tables';
import { Icone } from '../components/Icone';
import { brl, int, labelData, labelDataHora } from '../format';
import { baixar, tabelaParaCSV } from '../exportar';
import { PaginaResumoVendas } from './PaginaResumoVendas';
import { PaginaQuadroEquipes } from './PaginaQuadroEquipes';
import { PaginaRelatorioDiario } from './PaginaRelatorioDiario';
import { PaginaClientesBase } from './PaginaClientesBase';
import { PaginaPesquisaCancelamento } from './PaginaPesquisaCancelamento';
import { PaginaClima } from './PaginaClima';

/**
 * Réplica do relatório Power BI "COM - Relatórios Comercial".
 *
 * É o quinto e maior dos relatórios replicados: oito páginas e 189 visuais. A CAPA
 * de lá é só navegação e cartão de "atualizado em" — o dashboard já tem as duas
 * coisas —, então sobram SETE páginas de dados, que aqui são sub-páginas de uma
 * entrada de menu, em `?rpag=`. A navegação principal já tem 14 itens.
 *
 * O que este relatório é, e que os outros quatro não são: uma tela de CONSULTA. Os
 * outros respondem "como estamos"; este responde "onde está aquele contrato", "o que
 * tem naquela cesta", "quem está na fila de instalação". Por isso a densidade de
 * tabela é alta e a de gráfico é baixa — nas 189 caixas da origem há 15 gráficos e
 * mais de 20 tabelas.
 */

const SUBPAGINAS = [
  { id: 'geral', label: 'Geral' },
  { id: 'resumo', label: 'Resumo de vendas' },
  { id: 'equipes', label: 'Quadro de equipes' },
  { id: 'diario', label: 'Relatório diário' },
  { id: 'base', label: 'Clientes base' },
  { id: 'pesquisa', label: 'Pesquisa de cancelamento' },
  { id: 'clima', label: 'Clima' },
];

function SubNav({ atual, onChange }) {
  return (
    <nav className="subnav">
      {SUBPAGINAS.map((s) => (
        <button
          key={s.id}
          type="button"
          className={atual === s.id ? 'on' : ''}
          onClick={() => onChange(s.id)}
        >
          {s.label}
        </button>
      ))}
    </nav>
  );
}

export default function Relatorios() {
  const { filtros, setFiltro } = useFilters();
  const sub = SUBPAGINAS.some((s) => s.id === filtros.rpag) ? filtros.rpag : SUBPAGINAS[0].id;

  return (
    <main className="page">
      <SlicerBarRelatorios aba={sub} />
      <SubNav atual={sub} onChange={(id) => setFiltro({ rpag: id })} />
      {sub === 'geral' && <PaginaGeral filtros={filtros} />}
      {sub === 'resumo' && <PaginaResumoVendas filtros={filtros} />}
      {sub === 'equipes' && <PaginaQuadroEquipes filtros={filtros} />}
      {sub === 'diario' && <PaginaRelatorioDiario filtros={filtros} />}
      {sub === 'base' && <PaginaClientesBase filtros={filtros} />}
      {sub === 'pesquisa' && <PaginaPesquisaCancelamento filtros={filtros} />}
      {sub === 'clima' && <PaginaClima filtros={filtros} />}
    </main>
  );
}

/**
 * Marca de onde a linha veio.
 *
 * A tabela não tem fundo por linha (o componente pinta célula, não linha), e isso
 * acabou melhor: uma coluna ORIGEM diz explicitamente o que a cor só insinuaria.
 * Linha da ponte histórica não tem contrato, protocolo, bairro nem canal — sem essa
 * coluna, a célula vazia pareceria defeito de carga.
 */
const corDaOrigem = (linha) => (linha.origem === 'ponte' ? CORES.gold200 : undefined);
const rotuloOrigem = (v) => (v === 'ponte' ? 'Histórico' : 'Voalle');

/**
 * Aba GERAL — as três tabelas de consulta da página de origem.
 *
 * Ordem de leitura da origem, por coordenada: contrato (y=0), cesta de produtos
 * (y=760) e fila de instalação (y=1420). Mantida.
 */
function PaginaGeral({ filtros }) {
  const { data, error, isLoading } = useDados('/relatorios/geral', filtros);
  const vazio = isLoading && !data;
  const c = data?.cartoes;

  const colunasContrato = [
    { key: 'dtVenda', titulo: 'CRIAÇÃO', fmt: labelData },
    { key: 'horaVenda', titulo: 'HORA', align: 'center' },
    { key: 'contrato', titulo: 'CONTRATO', align: 'left' },
    { key: 'cliente', titulo: 'CLIENTE', align: 'left' },
    { key: 'cidade', titulo: 'CIDADE', align: 'left' },
    { key: 'bairro', titulo: 'BAIRRO', align: 'left' },
    { key: 'vendedor', titulo: 'VENDEDOR', align: 'left' },
    { key: 'situacao', titulo: 'SITUAÇÃO', align: 'left' },
    { key: 'statusContrato', titulo: 'STATUS', align: 'left' },
    { key: 'dtCancelado', titulo: 'CANCELADO', fmt: labelData },
    { key: 'statusCancelamento', titulo: 'MOTIVO', align: 'left' },
    { key: 'dtAtiv', titulo: 'ATIVAÇÃO', fmt: labelData },
    { key: 'valor', titulo: 'VALOR', fmt: brl },
    { key: 'tecnologia', titulo: 'TEC.', align: 'center' },
    {
      key: 'origem', titulo: 'ORIGEM', align: 'center', fmt: rotuloOrigem, corFundo: corDaOrigem,
    },
  ];

  const colunasCesta = [
    { key: 'contrato', titulo: 'CONTRATO', align: 'left' },
    { key: 'tipoContrato', titulo: 'TIPO', align: 'left' },
    { key: 'valorPlano', titulo: 'VALOR DO PLANO', fmt: brl },
    { key: 'statusContrato', titulo: 'STATUS', align: 'left' },
    { key: 'etiqueta', titulo: 'ETIQUETA', align: 'left' },
    { key: 'codigoServico', titulo: 'CÓD.', align: 'left' },
    { key: 'servico', titulo: 'SERVIÇO PRINCIPAL', align: 'left' },
    { key: 'unidades', titulo: 'UN.', fmt: int, align: 'center' },
    { key: 'valor', titulo: 'VALOR', fmt: brl, databar: { cor: CORES.gold } },
    { key: 'adicionadoEm', titulo: 'ADICIONADO', fmt: labelData },
    { key: 'situacaoItem', titulo: 'SITUAÇÃO', align: 'center' },
  ];

  const colunasFila = [
    { key: 'protocolo', titulo: 'PROTOCOLO', align: 'left' },
    { key: 'status', titulo: 'STATUS', align: 'left' },
    { key: 'contrato', titulo: 'CONTRATO', align: 'left' },
    { key: 'statusContrato', titulo: 'STATUS DO CONTRATO', align: 'left' },
    { key: 'cliente', titulo: 'CLIENTE', align: 'left' },
    { key: 'cidade', titulo: 'CIDADE', align: 'left' },
    { key: 'bairro', titulo: 'BAIRRO', align: 'left' },
    { key: 'canal', titulo: 'CANAL', align: 'left' },
    { key: 'equipe', titulo: 'EQUIPE', align: 'left' },
    { key: 'vendedor', titulo: 'VENDEDOR', align: 'left' },
  ];

  const exportar = (colunas, dados, nome) => () => baixar(
    tabelaParaCSV(colunas, dados), `${nome}.csv`,
  );

  if (error) return <Erro erro={error} />;

  return (
    <>
      <section className="grid linha-cinco">
        <Kpi
          value={vazio ? '—' : int(c.contratos)}
          label="CONTRATOS"
          desc="linhas no recorte atual"
          title="Contagem de contratos do Voalle mais as linhas da ponte histórica que o Voalle não tem. A tabela marca quais são quais."
        />
        <Kpi
          value={vazio ? '—' : int(c.clientes)}
          label="CLIENTES"
          desc="nomes distintos"
          title="Contagem distinta de nome de cliente — um cliente com dois contratos conta uma vez aqui e duas na coluna ao lado."
        />
        <Kpi
          value={vazio ? '—' : brl(c.valor)}
          label="VALOR MENSAL"
          desc="soma do valor dos contratos"
          title="Soma da mensalidade dos contratos do recorte. É valor recorrente por mês, não faturamento acumulado."
        />
        <Kpi
          value={vazio ? '—' : int(c.itensCesta)}
          label="ITENS DE CESTA"
          desc="produtos e serviços nos contratos"
          title="Um item por produto ou serviço avulso contratado. Um contrato com internet, ponto adicional e telefone conta três."
        />
        <Kpi
          value={vazio ? '—' : int(c.naFila)}
          label="NA FILA"
          desc="instalações em aberto"
          title="Protocolos de instalação de fibra ou rádio sem equipamento entregue. Não respeita o período: fila em aberto é retrato do agora."
        />
      </section>

      <section className="grid">
        <Visual
          title="CONTRATOS"
          sub={vazio ? null : legendaAmostra(data.contratos, data.porOrigem)}
          className="v-tabela"
          actions={!vazio && (
            <BotaoExportar onExportar={exportar(colunasContrato, data.contratos.amostra, 'contratos')} />
          )}
        >
          {vazio ? <Loading /> : data.contratos.amostra.length
            ? (
              <Tabela
                colunas={colunasContrato}
                dados={data.contratos.amostra.map((l, i) => ({ ...l, __key: `${l.contrato}-${i}` }))}
              />
            ) : <Vazio />}
        </Visual>
      </section>

      <section className="grid">
        <Visual
          title="CESTA DE PRODUTOS"
          sub={vazio ? null
            : `${int(data.cesta.total)} itens · ${brl(data.cesta.valor)} somados${data.cesta.total > data.cesta.amostra.length ? ` · mostrando os ${data.cesta.amostra.length} primeiros` : ''}`}
          className="v-tabela"
          actions={!vazio && (
            <BotaoExportar onExportar={exportar(colunasCesta, data.cesta.amostra, 'cesta-de-produtos')} />
          )}
        >
          {vazio ? <Loading /> : data.cesta.amostra.length
            ? (
              <Tabela
                colunas={colunasCesta}
                dados={data.cesta.amostra.map((l, i) => ({ ...l, __key: `${l.contrato}-${l.etiqueta}-${i}` }))}
              />
            ) : <Vazio texto="Nenhum item de cesta para os filtros selecionados" />}
        </Visual>
      </section>

      <section className="grid">
        <Visual
          title="FILA DE INSTALAÇÃO"
          sub={vazio ? null : legendaFila(data)}
          className="v-tabela"
          actions={!vazio && (
            <BotaoExportar onExportar={exportar(colunasFila, data.fila.amostra, 'fila-de-instalacao')} />
          )}
        >
          {vazio ? <Loading /> : data.fila.amostra.length
            ? (
              <Tabela
                colunas={colunasFila}
                dados={data.fila.amostra.map((l) => ({ ...l, __key: l.protocolo }))}
              />
            )
            : <Vazio texto="Nenhuma instalação em aberto" />}
        </Visual>
      </section>
    </>
  );
}

/**
 * Diz quantas linhas existem, quantas estão à vista e quantas vieram da ponte.
 *
 * A parte da ponte muda de redação conforme ela apareça ou não na amostra, e isso
 * não é preciosismo: a amostra mostra os mais recentes, e as linhas da ponte são
 * todas de 2024. Dizer "em destaque" quando nenhuma está visível manda a pessoa
 * procurar na tabela um destaque que não existe.
 */
function legendaAmostra(tabela, origem) {
  const partes = [`${int(tabela.total)} contratos`];
  if (tabela.total > tabela.amostra.length) {
    partes.push(`mostrando os ${tabela.amostra.length} mais recentes — o CSV traz tudo`);
  }
  if (origem?.ponte) {
    const naAmostra = tabela.amostra.filter((l) => l.origem === 'ponte').length;
    partes.push(naAmostra
      ? `${int(origem.ponte)} da ponte histórica, ${int(naAmostra)} nesta amostra (marcadas na coluna ORIGEM)`
      : `${int(origem.ponte)} da ponte histórica, todas de 2024 — fora desta amostra dos mais recentes, mas no CSV`);
  }
  return partes.join(' · ');
}

/**
 * A fila tem um recorte invisível na origem, e recorte invisível gera chamado: a
 * tabela de detalhe de lá não enxerga a equipe Field Service, enquanto os totais da
 * mesma página enxergam. Então a tela diz o número.
 */
function legendaFila(data) {
  const base = `${int(data.fila.total)} instalações em aberto · sem recorte de data`;
  if (!data.filaOculta) return base;
  return `${base} · ${int(data.filaOculta)} da equipe Field Service ficam fora desta tabela, como no relatório de origem`;
}
