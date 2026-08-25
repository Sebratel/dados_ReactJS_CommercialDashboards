import { useDados } from '../api';
import { BotaoExportar, Erro, Kpi, Loading, Vazio, Visual } from '../components/ui';
import { BarrasHorizontais, CORES, escalaGradiente } from '../components/charts';
import { Tabela } from '../components/tables';
import { Icone } from '../components/Icone';
import { int, labelData, labelDataHora, pct } from '../format';
import { baixar, tabelaParaCSV } from '../exportar';

/**
 * Aba PESQUISA CANCELAMENTO — o questionário aplicado no encerramento do
 * cancelamento, com uma pergunta por linha do checklist.
 *
 * A DIVERGÊNCIA MAIS IMPORTANTE DE TODA A RÉPLICA ESTÁ AQUI. As três medidas da
 * origem (`Qtd Sim2`, `Qtd Não2`, `Qtd Vazio2`) são todas
 * `CALCULATE(DISTINCTCOUNT(Protocolo), ISBLANK(valor) || valor = "<X>")`. O `||`
 * soma os vazios nas TRÊS colunas — e como 90% das respostas são vazias, "Sim" e
 * "Não" mostram quase o mesmo número gigante e nenhuma das duas responde à pergunta.
 * É erro de cópia, não intenção.
 *
 * Aqui cada resposta conta na sua coluna, e a de vazios fica ao lado para conferir
 * que a soma fecha com o total de protocolos. O número desta tela vai ser MENOR que
 * o do Power BI, e é o certo.
 */

/** Magnitude do "sim": um só tom, claro para escuro. */
const corDoSim = (linha) => escalaGradiente(Number(linha.pctSim) || 0, 0, 1, '#F7F0D0', CORES.gold);

export function PaginaPesquisaCancelamento({ filtros }) {
  const { data, error, isLoading } = useDados('/relatorios/pesquisa', filtros);
  const vazio = isLoading && !data;
  const c = data?.cartoes;

  const colunasPerguntas = [
    { key: 'ordem', titulo: '#', align: 'center' },
    { key: 'pergunta', titulo: 'PERGUNTA', align: 'left' },
    { key: 'sim', titulo: 'SIM', fmt: int, databar: { cor: CORES.gold } },
    { key: 'nao', titulo: 'NÃO', fmt: int, databar: { cor: CORES.muted } },
    { key: 'respondidas', titulo: 'RESPONDIDAS', fmt: int },
    { key: 'pctSim', titulo: '% SIM', fmt: pct, align: 'center', corFundo: corDoSim },
    { key: 'vazio', titulo: 'EM BRANCO', fmt: int },
  ];

  const colunasProtocolos = [
    { key: 'numeroProtocolo', titulo: 'PROTOCOLO', align: 'left' },
    { key: 'criado', titulo: 'ABERTURA', fmt: labelDataHora },
    { key: 'cliente', titulo: 'CLIENTE', align: 'left' },
    { key: 'contrato', titulo: 'CONTRATO', align: 'left' },
    { key: 'etiqueta', titulo: 'ETIQUETA', align: 'left' },
    { key: 'status', titulo: 'STATUS', align: 'left' },
    { key: 'cidade', titulo: 'CIDADE', align: 'left' },
    { key: 'bairro', titulo: 'BAIRRO', align: 'left' },
    { key: 'rua', titulo: 'RUA', align: 'left' },
    { key: 'numero', titulo: 'Nº', align: 'left' },
    { key: 'encerradoPor', titulo: 'ENCERRADO POR', align: 'left' },
    { key: 'dataCancelamento', titulo: 'CANCELAMENTO', fmt: labelData },
    { key: 'motivoCancelamento', titulo: 'MOTIVO', align: 'left' },
  ];

  if (error) return <Erro erro={error} />;

  return (
    <>
      {!vazio && (
        <p className="aviso-recorte">
          <Icone nome="alerta" tamanho={12} />
          As colunas SIM e NÃO contam só quem respondeu aquilo. No relatório de origem as três
          medidas incluem os vazios, e por isso lá as duas colunas mostram quase o mesmo número —
          é erro de cópia na medida, não diferença de dado.
        </p>
      )}

      <div className="kpi-faixa">
        <Kpi
          value={vazio ? '—' : int(c.protocolos)}
          label="PESQUISAS"
          desc="protocolos distintos com pesquisa"
          title="Atendimento de cancelamento cujo checklist final registra a pesquisa. Contagem distinta de número de protocolo."
        />
        <Kpi
          value={vazio ? '—' : int(c.clientes)}
          label="CLIENTES"
          desc="nomes distintos"
        />
        <Kpi
          value={vazio ? '—' : int(c.respostas)}
          label="RESPOSTAS"
          desc="perguntas efetivamente respondidas"
          title="Itens do checklist com Sim ou Não. Os em branco ficam de fora — são a maioria, porque o questionário tem onze perguntas e quase sempre só a primeira é preenchida."
        />
        <Kpi
          value={vazio ? '—' : int(c.itens)}
          label="ITENS"
          desc="linhas de checklist, respondidas ou não"
        />
      </div>

      <section className="grid">
        <Visual
          title="RESPOSTAS POR PERGUNTA"
          sub={vazio ? null
            : `${data.perguntas.length} perguntas · SIM e NÃO contam protocolo distinto; EM BRANCO é quem não respondeu aquela pergunta`}
          className="v-tabela"
          ia="relatorios:pesquisa"
          actions={!vazio && (
            <BotaoExportar onExportar={() => baixar(
              tabelaParaCSV(colunasPerguntas, data.perguntas), 'pesquisa-por-pergunta.csv',
            )}
            />
          )}
        >
          {vazio ? <Loading /> : data.perguntas.length
            ? (
              <Tabela
                colunas={colunasPerguntas}
                dados={data.perguntas.map((p) => ({ ...p, __key: `${p.ordem}-${p.pergunta}` }))}
                ordemInicial={{ key: 'respondidas', dir: 'desc' }}
              />
            ) : <Vazio />}
        </Visual>
      </section>

      <section className="grid linha-dupla">
        {/*
          Sem `flush`, e isso importa: com o padding do corpo removido, o SVG do
          gráfico fica da altura EXATA do container, e o arredondamento sub-pixel
          o empurra 4px além. O corpo tem `overflow: auto`, então aparece a barra
          vertical, que rouba largura, que faz aparecer a horizontal, que rouba
          altura — as duas se alimentam e o gráfico fica tremendo. As telas que
          usam este gráfico e não tremem não passam `flush`.
        */}
        <Visual
          title="MOTIVO DO CANCELAMENTO"
          sub={vazio ? null : 'motivo registrado no contrato, não a resposta da pesquisa'}
          className="v-meia"
        >
          {vazio ? <Loading /> : data.porMotivo.length
            ? <BarrasHorizontais data={data.porMotivo} keyLabel="nome" keyValue="valor" nome="Protocolos" larguraCategoria={210} />
            : <Vazio />}
        </Visual>

        <Visual
          title="POR CIDADE"
          sub={vazio ? null : 'protocolos de pesquisa por cidade do cliente'}
          className="v-meia"
        >
          {vazio ? <Loading /> : data.porCidade.length
            ? <BarrasHorizontais data={data.porCidade} keyLabel="nome" keyValue="valor" nome="Protocolos" />
            : <Vazio />}
        </Visual>
      </section>

      <section className="grid">
        <Visual
          title="PESQUISAS"
          sub={vazio ? null : legendaProtocolos(data)}
          className="v-tabela"
          actions={!vazio && (
            <BotaoExportar onExportar={() => baixar(
              tabelaParaCSV(colunasProtocolos, data.protocolos.amostra), 'pesquisas-de-cancelamento.csv',
            )}
            />
          )}
        >
          {vazio ? <Loading /> : data.protocolos.amostra.length
            ? (
              <Tabela
                colunas={colunasProtocolos}
                dados={data.protocolos.amostra.map((p) => ({ ...p, __key: p.numeroProtocolo }))}
                ordemInicial={{ key: 'criado', dir: 'desc' }}
              />
            ) : <Vazio />}
        </Visual>
      </section>
    </>
  );
}

function legendaProtocolos(data) {
  const partes = [`${int(data.protocolos.total)} pesquisas`];
  if (data.protocolos.total > data.protocolos.amostra.length) {
    partes.push(`mostrando as ${data.protocolos.amostra.length} mais recentes — o CSV traz tudo`);
  }
  if (data.checklistInvalido) {
    partes.push(`${int(data.checklistInvalido)} com checklist ilegível, contadas mas sem respostas`);
  }
  return partes.join(' · ');
}
