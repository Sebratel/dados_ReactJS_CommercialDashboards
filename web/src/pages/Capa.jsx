import { useMeta } from '../api';
import { haQuanto, int, labelDataHora } from '../format';

const OBJETIVOS = [
  'Consolidar os principais indicadores da área comercial, oferecendo uma visão clara e objetiva para a tomada de decisões;',
  'Monitorar os resultados continuamente, facilitando a identificação de tendências e ajustes nas estratégias comerciais;',
  'Fornecer informações precisas que embasam decisões, garantindo mais eficiência e assertividade nas ações;',
  'Ajudar a analisar padrões e preferências dos clientes, contribuindo para a otimização de processos e estratégias;',
  'Promover uma visão integrada entre setores, alinhando as metas comerciais aos objetivos corporativos;',
  'Gerar insights que ajudam a empresa a crescer de forma planejada, maximizando o valor gerado pela área comercial.',
];

const INDICADORES = [
  ['Total de Vendas Realizadas', 'número consolidado das vendas efetivadas no período.'],
  ['Ativações Realizadas', 'quantidade de serviços ativados a partir das vendas.'],
  ['Clientes com Primeiro Pagamento', 'sucesso no fechamento financeiro imediato.'],
  ['Premiações de Vendedores', 'metas alcançadas e valores atribuídos por faixa.'],
  ['Variação de Vendas por Período', 'comparação de desempenho entre períodos.'],
  ['Tendências de Ativações', 'evolução das ativações ao longo dos meses.'],
  ['Faturamento por Período', 'ticket mensal e acumulado.'],
  ['Rampagem de Novatos', 'desempenho dos vendedores nos primeiros 90 dias.'],
];

export default function Capa() {
  const { data: meta } = useMeta();

  const fontes = [
    ['Vendas (contratos)', meta?.sources?.base, meta?.refresh?.hot],
    ['Ativações fibra/rádio', meta?.sources?.aloc, meta?.refresh?.hot],
    ['Ativações telefonia', meta?.sources?.phone, meta?.refresh?.hot],
    ['Primeiro pagamento', meta?.sources?.pagto, meta?.refresh?.hot],
    ['Equipes comerciais', meta?.sources?.teams, meta?.refresh?.dims],
    ['RH (Senior)', meta?.sources?.senior, meta?.refresh?.dims],
  ];

  return (
    <main className="page">
      <section className="capa-topo">
        <img src="/logo-circular-sebratel.png" alt="" />
        <div className="txt">
          <h2>COM · GESTÃO COMERCIAL</h2>
          <p>Vendas, ativações e primeiro pagamento — direto do Voalle</p>
        </div>
        <div className="selo">
          <div>
            <b>{meta?.contratos ? int(meta.contratos) : '—'}</b>
            <span>contratos na base</span>
          </div>
          <div>
            <b>{meta?.since ? meta.since.slice(0, 4) : '—'}</b>
            <span>desde</span>
          </div>
          <div>
            <b>{meta?.sources?.base?.updatedAt ? haQuanto(meta.sources.base.updatedAt) : '—'}</b>
            <span>última leitura</span>
          </div>
        </div>
      </section>

      <div className="capa">
        <article className="bloco">
          <h3>Objetivo</h3>
          <div className="conteudo">
            <ul>{OBJETIVOS.map((o) => <li key={o}>{o}</li>)}</ul>
          </div>
        </article>

        <article className="bloco">
          <h3>Atualização dos dados</h3>
          <div className="conteudo">
            <p style={{ marginTop: 0 }}>
              As consultas vão direto ao <b>Voalle</b> (PostgreSQL) e ao <b>MariaDB</b> corporativo.
              A janela recente é relida a cada poucos minutos e a base completa a cada 30 minutos.
            </p>
            <table className="capa-fontes">
              <tbody>
                {fontes.map(([nome, fonte, intervalo]) => (
                  <tr key={nome}>
                    <td>{nome}</td>
                    <td>
                      {fonte?.error
                        ? <span style={{ color: '#b3261e' }}>falhou</span>
                        : fonte?.updatedAt
                          ? `${haQuanto(fonte.updatedAt)} · ${Math.round((intervalo || 0) / 60000)} min`
                          : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </article>

        <article className="bloco">
          <h3>Indicadores</h3>
          <div className="conteudo">
            <ul>
              {INDICADORES.map(([t, d]) => <li key={t}><b>{t}:</b> {d}</li>)}
            </ul>
          </div>
        </article>
      </div>

      <div className="rodape">
        <span>Dúvidas: intel@sebratel.com.br</span>
        <span>
          {meta?.builtAt ? `modelo reconstruído em ${labelDataHora(meta.builtAt)}` : ''}
        </span>
        <span>Inteligência de Dados · Sebratel</span>
      </div>
    </main>
  );
}
