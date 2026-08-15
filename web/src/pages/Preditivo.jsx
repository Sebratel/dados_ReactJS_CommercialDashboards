import { useState } from 'react';
import { apiJson, useDados } from '../api';
import { useFilters } from '../filters';
import { SlicerBar } from '../components/SlicerBar';
import { Erro, Loading, Visual } from '../components/ui';
import { Icone } from '../components/Icone';
import { BarrasHorizontais, ComboChart, CORES } from '../components/charts';
import { Tabela } from '../components/tables';
import { brl, dec1, int, labelData, labelMes } from '../format';

const GRAVIDADE = {
  critico: { rotulo: 'crítico', cor: '#b3261e', fundo: '#FDE7E9' },
  atencao: { rotulo: 'atenção', cor: '#8a6100', fundo: '#FDF3D6' },
  positivo: { rotulo: 'positivo', cor: '#0E7A28', fundo: '#E7F6EA' },
};

/** Cartão grande da projeção do mês. */
function Projecao({ p }) {
  const dentro = p.variacaoProjetada;
  const sinal = dentro === null ? null : dentro >= 0;
  return (
    <div className="proj">
      <div className="proj-principal">
        <span className="rotulo">Projeção de fechamento · {labelMes(p.mes)}</span>
        <div className="proj-numero">
          {int(p.projetado)}
          {p.margem > 0 && <small>± {int(p.margem)}</small>}
        </div>
        <span className="proj-sub">
          {int(p.realizado)} realizadas em {dec1(p.diasUteisDecorridos)} de {dec1(p.diasUteisTotais)} dias úteis
          {' '}({p.percentualDecorrido}% do mês)
        </span>
      </div>

      <div className="proj-barra" title={`${p.percentualDecorrido}% do mês decorrido`}>
        <i style={{ width: `${Math.min(100, (p.realizado / Math.max(p.projetado, 1)) * 100)}%` }} />
      </div>

      <div className="proj-comparativos">
        <div>
          <b>{p.ritmoDiario}</b>
          <span>por dia útil</span>
        </div>
        <div>
          <b className={p.variacaoMesmoPonto >= 0 ? 'positivo' : 'negativo'}>
            {p.variacaoMesmoPonto === null ? '—' : `${p.variacaoMesmoPonto > 0 ? '+' : ''}${p.variacaoMesmoPonto}%`}
          </b>
          <span>vs mesmo ponto do mês anterior</span>
        </div>
        <div>
          <b className={sinal ? 'positivo' : 'negativo'}>
            {dentro === null ? '—' : `${dentro > 0 ? '+' : ''}${dentro}%`}
          </b>
          <span>projetado vs fechamento anterior ({int(p.anteriorFechado)})</span>
        </div>
      </div>
    </div>
  );
}

/** Bloco de insights vindos da IA. */
function Insights({ filtros, configurada }) {
  const [dados, setDados] = useState(null);
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState(null);

  const gerar = async () => {
    setCarregando(true);
    setErro(null);
    try {
      const qs = new URLSearchParams({
        de: filtros.de || '', ate: filtros.ate || '',
        vendedor: (filtros.vendedor || []).join(','),
        equipe: (filtros.equipe || []).join(','),
        tecnologia: (filtros.tecnologia || []).join(','),
      });
      setDados(await apiJson(`/preditivo/insights?${qs}`, { method: 'POST' }));
    } catch (e) {
      setErro(e);
    } finally {
      setCarregando(false);
    }
  };

  if (!configurada) {
    return (
      <div className="ia-vazia">
        <Icone nome="alerta" tamanho={20} />
        <div>
          <b>Nenhum provedor de IA configurado.</b>
          <span>
            Os indicadores desta tela funcionam sem IA — ela entra para interpretar e priorizar.
            Um administrador pode cadastrar a chave em Configurações → Provedor de IA.
          </span>
        </div>
      </div>
    );
  }

  return (
    <div className="ia">
      <div className="ia-topo">
        <div>
          <b>Leitura da IA</b>
          <span>
            A IA recebe os indicadores já calculados e devolve a interpretação — ela não
            recalcula nada, então os números continuam sendo os do sistema.
          </span>
        </div>
        <button type="button" className="cfg-botao" onClick={gerar} disabled={carregando}>
          <Icone nome={carregando ? 'atualizar' : 'play'} tamanho={13} className={carregando ? 'spin' : ''} />
          {carregando ? 'analisando…' : dados ? 'analisar de novo' : 'gerar análise'}
        </button>
      </div>

      {erro && <Erro erro={erro} />}

      {dados && (
        <>
          {dados.resumo && <p className="ia-resumo">{dados.resumo}</p>}

          <div className="ia-cards">
            {(dados.insights || []).map((i, k) => {
              const g = GRAVIDADE[i.gravidade] || GRAVIDADE.atencao;
              return (
                <article className="ia-card" key={k} style={{ borderLeftColor: g.cor }}>
                  <header>
                    <span className="ia-tag" style={{ background: g.fundo, color: g.cor }}>{g.rotulo}</span>
                    <b>{i.titulo}</b>
                  </header>
                  <p>{i.detalhe}</p>
                  {i.acao && <p className="ia-acao"><b>O que fazer:</b> {i.acao}</p>}
                  {!!(i.indicadores || []).length && (
                    <div className="ia-indicadores">
                      {i.indicadores.map((n, j) => <span key={j}>{n}</span>)}
                    </div>
                  )}
                </article>
              );
            })}
          </div>

          {!!(dados.perguntas || []).length && (
            <div className="ia-perguntas">
              <b>Perguntas que os dados atuais não respondem</b>
              <ul>{dados.perguntas.map((q, k) => <li key={k}>{q}</li>)}</ul>
            </div>
          )}

          <p className="ia-rodape">
            {dados.provedor} · {dados.modelo} · gerado em {new Date(dados.geradoEm).toLocaleString('pt-BR')}
          </p>
        </>
      )}
    </div>
  );
}

export default function Preditivo() {
  const { filtros } = useFilters();
  const { data, error, isLoading } = useDados('/preditivo', filtros, { refetchInterval: 300000 });

  if (isLoading && !data) {
    return (
      <main className="page">
        <SlicerBar campos={['vendedor', 'tecnologia', 'equipe', 'situacao']} />
        <Loading texto="Calculando previsões…" />
      </main>
    );
  }
  if (error) {
    return (
      <main className="page">
        <SlicerBar campos={['vendedor', 'tecnologia', 'equipe', 'situacao']} />
        <Erro erro={error} />
      </main>
    );
  }

  const { projecao: p, funil, riscos, tendencias, novatos, sazonalidade, cancelamento, concentracao } = data;

  const coortes = funil.coortes.slice(-8).map((c) => ({
    ...c, label: labelMes(c.mes), periodo: c.mes,
  }));
  const cancel = cancelamento.coortes.slice(-8).map((c) => ({ ...c, label: labelMes(c.mes) }));

  return (
    <main className="page">
      <SlicerBar campos={['vendedor', 'tecnologia', 'equipe', 'situacao']} />

      <p className="preditivo-nota">
        Cada análise usa a sua própria janela de tempo (mês corrente, últimos 14 dias, coortes de
        12 meses), por isso o filtro de período não se aplica aqui — os demais filtros sim.
        Base: {int(data.universo)} contratos.
      </p>

      {/* projeção + risco */}
      <div className="grid linha-preditivo">
        <Visual title="Projeção do mês" className="v-grafico">
          <Projecao p={p} />
        </Visual>

        <Visual
          title="Carteira em risco"
          sub="contratos parados além do prazo em que 90% costuma avançar"
          className="v-grafico"
        >
          <div className="risco-par">
            <div className="risco-bloco critico">
              <span className="risco-num">{int(riscos.semAtivar.total)}</span>
              <b>vendidos sem ativar</b>
              <span className="risco-sub">
                parados há mais de {riscos.semAtivar.prazo} dias · {brl(riscos.semAtivar.valor)} em contratos
              </span>
            </div>
            <div className="risco-bloco atencao">
              <span className="risco-num">{int(riscos.semPagar.total)}</span>
              <b>ativados sem pagar</b>
              <span className="risco-sub">
                há mais de {riscos.semPagar.prazo} dias da ativação · {brl(riscos.semPagar.valor)}
              </span>
            </div>
          </div>
          <div className="risco-top">
            <b>Concentração dos travados sem ativar</b>
            <div className="risco-chips">
              {riscos.semAtivar.porCidade.slice(0, 6).map((c) => (
                <span key={c.nome}>{c.nome} <i>{c.qtd}</i></span>
              ))}
            </div>
          </div>
        </Visual>
      </div>

      {/* IA */}
      <Visual title="Análise por IA" className="v-auto">
        <Insights filtros={filtros} configurada={data.iaConfigurada} />
      </Visual>

      {/* funil */}
      <div className="grid linha-dupla">
        <Visual
          title="Conversão por coorte de venda"
          sub={`${funil.lagAtivacao.mediana} dias até ativar (mediana) · ${funil.lagPagamento.mediana} dias até o 1º pagamento`}
          className="v-grafico"
        >
          <ComboChart
            data={coortes}
            barKey="taxaAtivacao"
            barName="% que ativou"
            lineKey="taxaPagamento"
            lineName="% que pagou (dos ativados)"
            barFmt={(v) => `${v}%`}
            lineFmt={(v) => `${v}%`}
          />
        </Visual>

        <Visual title="Vendedores com queda de ritmo" sub={tendencias.janelaRecente} className="v-grafico" flush>
          <Tabela
            colunas={[
              { key: 'vendedor', titulo: 'VENDEDOR', align: 'left' },
              { key: 'ritmoBase', titulo: 'RITMO ANTERIOR', fmt: dec1 },
              { key: 'ritmoRecente', titulo: 'RITMO ATUAL', fmt: dec1 },
              {
                key: 'variacao',
                titulo: 'VARIAÇÃO',
                fmt: (v) => (v === null ? '—' : `${v}%`),
                estilo: (v) => ({ color: v <= -50 ? '#b3261e' : '#8a6100', fontWeight: 700 }),
              },
            ]}
            dados={[...tendencias.emQueda, ...tendencias.pararam.filter(
              (p2) => !tendencias.emQueda.some((q) => q.vendedor === p2.vendedor),
            )]}
            ordemInicial={{ key: 'variacao', dir: 'asc' }}
          />
        </Visual>
      </div>

      {/* novatos + sazonalidade */}
      <div className="grid linha-dupla">
        <Visual
          title="Novatos: projeção dos 90 dias"
          sub={`referência histórica: ${novatos.referencia} vendas no período (mediana de ${novatos.amostraHistorica} veteranos)`}
          className="v-tabela"
          flush
        >
          <Tabela
            colunas={[
              { key: 'vendedor', titulo: 'VENDEDOR', align: 'left' },
              { key: 'vendas', titulo: 'VENDAS ATÉ AGORA', fmt: int },
              { key: 'diasRestantes', titulo: 'DIAS RESTANTES', fmt: int },
              { key: 'projetado', titulo: 'PROJEÇÃO EM 90 DIAS', fmt: int, databar: { cor: CORES.gold } },
              {
                key: 'indice',
                titulo: 'VS REFERÊNCIA',
                fmt: (v) => (v === null ? '—' : `${Math.round(v * 100)}%`),
                estilo: (v) => ({
                  color: v === null ? undefined : v < 0.7 ? '#b3261e' : v >= 1 ? '#0E7A28' : '#8a6100',
                  fontWeight: 700,
                }),
              },
            ]}
            dados={novatos.lista}
            ordemInicial={{ key: 'indice', dir: 'asc' }}
          />
        </Visual>

        <Visual
          title="Ritmo por dia da semana"
          sub="média de vendas nos últimos 180 dias"
          className="v-tabela"
        >
          <BarrasHorizontais
            data={sazonalidade.map((s) => ({ key: s.dia, valor: s.media }))}
            nome="média por dia"
            fmt={dec1}
            larguraCategoria={80}
          />
        </Visual>
      </div>

      {/* cancelamento + concentração */}
      <div className="grid linha-dupla">
        <Visual title="Cancelamento por coorte de venda" className="v-grafico">
          <ComboChart
            data={cancel}
            barKey="taxa"
            barName="% cancelado"
            barFmt={(v) => `${v}%`}
          />
        </Visual>

        <Visual title="Concentração da operação" sub="participação nas vendas dos últimos 90 dias" className="v-grafico">
          <div className="conc">
            {[
              ['Top 5 vendedores', concentracao.top5],
              ['Top 10 vendedores', concentracao.top10],
              ['Top 20 vendedores', concentracao.top20],
            ].map(([rotulo, pct]) => (
              <div className="conc-linha" key={rotulo}>
                <span>{rotulo}</span>
                <div className="conc-barra"><i style={{ width: `${pct}%` }} /></div>
                <b>{pct}%</b>
              </div>
            ))}
            <p className="conc-nota">
              {int(concentracao.vendedoresAtivos)} vendedores ativos no período.
              {concentracao.top10 > 60
                ? ' Concentração alta: a saída de poucos vendedores derruba o resultado.'
                : ' Distribuição saudável entre a equipe.'}
            </p>
          </div>
        </Visual>
      </div>

      {/* casos em risco */}
      <Visual
        title="Contratos parados há mais tempo"
        sub={`os ${riscos.semAtivar.casos.length} mais antigos sem ativação`}
        className="v-tabela"
        flush
      >
        <Tabela
          colunas={[
            { key: 'contrato', titulo: 'CONTRATO', align: 'center' },
            { key: 'cliente', titulo: 'CLIENTE', align: 'left' },
            { key: 'vendedor', titulo: 'VENDEDOR', align: 'left' },
            { key: 'cidade', titulo: 'CIDADE', align: 'left' },
            { key: 'tecnologia', titulo: 'TECNOLOGIA', align: 'center' },
            { key: 'data', titulo: 'VENDIDO EM', align: 'center', fmt: labelData },
            {
              key: 'diasParado',
              titulo: 'DIAS PARADO',
              fmt: int,
              estilo: () => ({ color: '#b3261e', fontWeight: 700 }),
            },
          ]}
          dados={riscos.semAtivar.casos.map((c, i) => ({ ...c, __key: `${c.contrato}-${i}` }))}
          ordemInicial={{ key: 'diasParado', dir: 'desc' }}
        />
      </Visual>
    </main>
  );
}
