import { useDados, useFiltrosRelBase } from '../api';
import { useFilters } from '../filters';
import { FiltroLateral } from '../components/SlicerBar';
import { BotaoExportar, Erro, Kpi, Legenda, Loading, Vazio, Visual } from '../components/ui';
import { ColunasEmpilhadas, CORES, corDaCategoria } from '../components/charts';
import { Tabela } from '../components/tables';
import { brl, int, labelData, labelMes } from '../format';
import { baixar, tabelaParaCSV } from '../exportar';

/**
 * Aba CLIENTES BASE — o tamanho da base de clientes conectados.
 *
 * O QUE A MEDIDA DA ORIGEM FAZ, e por que a leitura é diferente do resto do
 * dashboard: `AcumuladoContratosBase` é contagem distinta de contrato ATÉ a data, não
 * no dia. É estoque, não fluxo. É por isso que a curva só sobe: cada ponto é o
 * tamanho da base naquele dia, e não quantos clientes entraram nele.
 *
 * Consequência prática: filtrar um mês não mostra "quem entrou no mês", mostra a base
 * chegando até ali. O subtítulo de cada visual diz isso, porque um gráfico que só
 * sobe convida à leitura errada.
 */

/** Converte a matriz acumulada do servidor para o formato do gráfico. */
function paraGrafico(ac, granularidade = 'mes') {
  if (!ac?.datas?.length) return { dados: [], series: [] };
  // Uma linha por dia seria 240 colunas; agrupa por mês pegando o ÚLTIMO dia de
  // cada mês, que é o acumulado correto do período (somar acumulados dobraria).
  const porRotulo = new Map();
  ac.datas.forEach((data, i) => {
    const rotulo = granularidade === 'dia' ? data : data.slice(0, 7);
    porRotulo.set(rotulo, i); // o último índice do rótulo vence
  });
  const dados = [...porRotulo.entries()].map(([rotulo, i]) => {
    const linha = { label: granularidade === 'dia' ? labelData(rotulo) : labelMes(rotulo), chave: rotulo };
    let total = 0;
    for (const c of ac.celulas) {
      linha[c.nome] = c.pontos[i];
      total += c.pontos[i] || 0;
    }
    linha.total = total;
    return linha;
  });
  return { dados, series: ac.celulas.map((c) => c.nome) };
}

export function PaginaClientesBase({ filtros }) {
  const { data, error, isLoading } = useDados('/relatorios/base', filtros);
  const { data: dims } = useFiltrosRelBase();
  const { setFiltro } = useFilters();
  const vazio = isLoading && !data;
  const c = data?.cartoes;

  const porCidade = paraGrafico(data?.porCidade);
  const porBairro = paraGrafico(data?.porBairro);

  if (error) return <Erro erro={error} />;

  const colunasTec = !vazio ? [
    { key: 'tecnologia', titulo: 'TECNOLOGIA', align: 'left' },
    ...data.porTecnologia.cidades.map((cid, i) => ({
      key: `c${i}`, titulo: cid.toUpperCase(), fmt: int,
    })),
    { key: 'total', titulo: 'TOTAL', fmt: int, databar: { cor: CORES.gold } },
  ] : [];

  const dadosTec = !vazio ? data.porTecnologia.linhas.map((l) => {
    const linha = { __key: l.tecnologia, tecnologia: l.tecnologia, total: l.total };
    l.valores.forEach((v, i) => { linha[`c${i}`] = v; });
    return linha;
  }) : [];

  return (
    <>
      <div className="kpi-faixa">
        <Kpi
          value={vazio ? '—' : int(c.contratos)}
          label="CLIENTES NA BASE"
          desc="contratos distintos com ponto de acesso"
          title="Contrato com ponto de autenticação é o que caracteriza cliente conectado. Contagem distinta, então um contrato com dois pontos conta uma vez."
        />
        <Kpi
          value={vazio ? '—' : brl(c.valorTotal)}
          label="VALOR DA BASE"
          desc="soma da mensalidade"
          title="Soma do valor dos contratos da base no recorte. É recorrência mensal."
        />
        <Kpi
          value={vazio ? '—' : brl(c.valorMedio)}
          label="TICKET MÉDIO"
          desc="valor ÷ linhas da base"
        />
        <Kpi
          value={vazio ? '—' : int(c.cidades)}
          label="CIDADES"
          desc="com cliente conectado"
        />
      </div>

      {/*
        Painel lateral, como na origem: lá o slicer de cidade+bairro tem 311x849 e
        ocupa a altura inteira das três matrizes, à esquerda delas (x=12, contra
        x=333 das matrizes). Aqui é a mesma ideia — cidade e bairro saíram da barra
        de cima e vivem ao lado do gráfico, porque nesta tela eles são o eixo de
        leitura, não um acessório: quem usa troca de bairro e olha a matriz ao lado.
      */}
      <section className="grid linha-com-lateral">
        <FiltroLateral
          titulo="Cidade e bairro"
          onChange={setFiltro}
          grupos={[
            {
              campo: 'bcidade', titulo: 'Cidade', opcoes: dims?.cidades || [], valor: filtros.bcidade,
            },
            {
              campo: 'bbairro', titulo: 'Bairro', opcoes: dims?.bairros || [], valor: filtros.bbairro,
            },
          ]}
        />

        <div className="coluna-visuais">
        <Visual
          title="BASE ACUMULADA POR CIDADE"
          sub={vazio ? null
            : `${porCidade.series.length} cidades · cada ponto é o TAMANHO da base até aquele mês, não quantos entraram nele`}
          className="v-grafico"
          ia="relatorios:base-cidade"
          actions={!vazio && (
            <BotaoExportar onExportar={() => baixar(tabelaParaCSV(
              [{ key: 'label', titulo: 'MÊS' }, ...porCidade.series.map((s) => ({ key: s, titulo: s.toUpperCase() }))],
              porCidade.dados,
            ), 'base-por-cidade.csv')}
            />
          )}
        >
          {vazio ? <Loading /> : porCidade.dados.length
            ? (
              <>
                <Legenda itens={porCidade.series.map((n, i) => ({ label: n, cor: corDaCategoria(n, i) }))} />
                <ColunasEmpilhadas
                  data={porCidade.dados}
                  series={porCidade.series}
                  cores={corDaCategoria}
                  mostrarTotal={false}
                />
              </>
            ) : <Vazio />}
        </Visual>

        <div className="grid linha-dupla">
        <Visual
          title="BASE ACUMULADA POR BAIRRO"
          sub={vazio ? null : `${porBairro.series.length} bairros mais representativos · o resto está em "Outros"`}
          className="v-meia"
        >
          {vazio ? <Loading /> : porBairro.dados.length
            ? (
              <>
                <Legenda itens={porBairro.series.map((n, i) => ({ label: n, cor: corDaCategoria(n, i) }))} />
                <ColunasEmpilhadas
                  data={porBairro.dados}
                  series={porBairro.series}
                  cores={corDaCategoria}
                  mostrarTotal={false}
                />
              </>
            ) : <Vazio />}
        </Visual>

        <Visual
          title="TECNOLOGIA POR CIDADE"
          sub={vazio ? null : legendaTecnologia(data)}
          className="v-meia"
          actions={!vazio && (
            <BotaoExportar onExportar={() => baixar(tabelaParaCSV(colunasTec, dadosTec), 'base-por-tecnologia.csv')} />
          )}
        >
          {vazio ? <Loading /> : dadosTec.length
            ? <Tabela colunas={colunasTec} dados={dadosTec} />
            : <Vazio />}
        </Visual>
        </div>
        </div>
      </section>
    </>
  );
}

/**
 * A classificação de tecnologia é por PREFIXO do nome do ponto de acesso, e o
 * resultado surpreende: no recorte atual é tudo fibra. Dizer isso evita a conclusão
 * de que a coluna de rádio está quebrada.
 */
function legendaTecnologia(data) {
  const linhas = data.porTecnologia.linhas;
  if (!linhas.length) return null;
  const semPonto = linhas.find((l) => l.tecnologia === '(sem ponto de acesso)');
  const partes = [`${linhas.length} tecnologia(s) · classificada pelo prefixo do ponto de acesso`];
  if (linhas.length === 1) {
    partes.push(`só ${linhas[0].tecnologia} no recorte — a regra de rádio existe e não encontra ninguém aqui`);
  }
  if (semPonto) partes.push(`${int(semPonto.total)} contrato(s) sem ponto de acesso cadastrado`);
  return partes.join(' · ');
}
