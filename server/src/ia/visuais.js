/**
 * Catálogo dos visuais que aceitam leitura de IA.
 *
 * O cliente manda só o ID do visual e os filtros da tela; quem remonta os números
 * é o servidor, pela MESMA função que alimenta o gráfico (`model/paineis.js`). O
 * navegador nunca envia dados para serem interpretados — se enviasse, bastaria
 * adulterar a requisição para a IA "concluir" o que se quisesse, e a leitura sairia
 * autoritativa na tela sem nada por trás.
 *
 * `recorte` também é o filtro de privacidade: só passa o que o gráfico já mostra,
 * agregado. Nome de cliente e número de contrato não saem daqui em hipótese alguma
 * — por isso o detalhamento do primeiro pagamento não tem visual cadastrado.
 */
import { PAINEIS } from '../model/paineis.js';

const topo = (lista, n) => (Array.isArray(lista) ? lista.slice(0, n) : []);

/** Séries longas em granularidade diária estouram o contexto sem ganhar precisão. */
const serieEnxuta = (serie, max = 120) => {
  if (!Array.isArray(serie)) return [];
  return serie.length <= max ? serie : serie.slice(-max);
};

export const VISUAIS = {
  // ------------------------------------------------------------- diretoria
  'diretoria:serie': {
    tela: 'diretoria',
    titulo: 'Resumo Diretoria',
    oQueE: 'Evolução conjunta de vendas, ativações e primeiro pagamento por período, com os totais do recorte.',
    recorte: (p) => ({ kpis: p.kpis, granularidade: p.granularidade, serie: serieEnxuta(p.serie) }),
  },

  // ---------------------------------------------------------------- vendas
  'vendas:serie': {
    tela: 'vendas',
    titulo: 'Total de vendas por período',
    oQueE: 'Colunas de vendas com a linha de ativações sobreposta, no mesmo período. A distância entre as duas é o funil ainda não convertido.',
    recorte: (p) => ({ kpis: p.kpis, granularidade: p.granularidade, serie: serieEnxuta(p.serie) }),
  },
  'vendas:porCidade': {
    tela: 'vendas',
    titulo: 'Total de vendas por cidade',
    oQueE: 'As 15 cidades com mais vendas no recorte.',
    recorte: (p) => ({ totalVendas: p.kpis?.totalVendas, porCidade: topo(p.porCidade, 15) }),
  },
  'vendas:porVendedor': {
    tela: 'vendas',
    titulo: 'Vendas por vendedor',
    oQueE: 'Ranking de vendedores por quantidade, com a média por dia útil de cada um.',
    recorte: (p) => ({ totalVendas: p.kpis?.totalVendas, porVendedor: topo(p.porVendedor, 30) }),
  },
  'vendas:porDia': {
    tela: 'vendas',
    titulo: 'Total de vendas por dia (mês atual)',
    oQueE: 'Vendas dia a dia do mês corrente, separadas por tecnologia.',
    recorte: (p) => ({ mesAtual: p.mesAtual, porDia: serieEnxuta(p.porDia, 62) }),
  },

  // ------------------------------------------------------------- ativações
  'ativacoes:serie': {
    tela: 'ativacoes',
    titulo: 'Total de ativações por período',
    oQueE: 'Instalações concluídas por período, com as colunas separadas por tecnologia. O relatório antigo em Power BI não contabiliza a telefonia, então só a parte de fibra e rádio é comparável com ele.',
    recorte: (p) => ({ kpis: p.kpis, granularidade: p.granularidade, serie: serieEnxuta(p.serie) }),
  },
  'ativacoes:porCanal': {
    tela: 'ativacoes',
    titulo: 'Canal Voalle',
    oQueE: 'Distribuição das ativações pelo canal de origem cadastrado no Voalle.',
    recorte: (p) => ({ totalAtivos: p.kpis?.totalAtivos, porCanal: topo(p.porCanal, 12) }),
  },
  'ativacoes:porCidade': {
    tela: 'ativacoes',
    titulo: 'Total de ativações por cidade',
    oQueE: 'As 15 cidades com mais ativações no recorte.',
    recorte: (p) => ({ totalAtivos: p.kpis?.totalAtivos, porCidade: topo(p.porCidade, 15) }),
  },
  'ativacoes:porVendedor': {
    tela: 'ativacoes',
    titulo: 'Ativos por vendedor',
    oQueE: 'Ranking de vendedores por ativações concluídas.',
    recorte: (p) => ({ totalAtivos: p.kpis?.totalAtivos, porVendedor: topo(p.porVendedor, 30) }),
  },

  // ----------------------------------------------------- primeiro pagamento
  'primeiro-pagamento:serie': {
    tela: 'primeiro-pagamento',
    titulo: 'Total de primeiro pagante por período',
    oQueE: 'Clientes que quitaram a primeira fatura, por período, com o valor arrecadado.',
    recorte: (p) => ({ kpis: p.kpis, granularidade: p.granularidade, serie: serieEnxuta(p.serie) }),
  },
  'primeiro-pagamento:planos': {
    tela: 'primeiro-pagamento',
    titulo: 'Planos mais vendidos',
    oQueE: 'Planos ordenados por quantidade de primeiros pagamentos, com o valor de tabela e o total arrecadado.',
    recorte: (p) => ({ kpis: p.kpis, planos: topo(p.planos, 25) }),
  },
  // -------------------------------------------------------------- rampagem
  'rampagem:serie': {
    tela: 'rampagem',
    titulo: 'Rampagem novatos (menos de 90 dias)',
    oQueE: 'Vendas e ativações realizadas dentro dos 90 primeiros dias de cada vendedor, por período.',
    recorte: (p) => ({ kpis: p.kpis, dataRef: p.dataRef, serie: serieEnxuta(p.serie) }),
  },
  'rampagem:porCidade': {
    tela: 'rampagem',
    titulo: 'Total de vendas de novatos por cidade',
    oQueE: 'Onde os vendedores novos estão conseguindo vender.',
    recorte: (p) => ({ kpis: p.kpis, porCidade: topo(p.porCidade, 15) }),
  },
  'rampagem:tabela': {
    tela: 'rampagem',
    titulo: 'Vendas por vendedor (novatos)',
    oQueE: 'Cada novato com dias de casa, dias trabalhados, vendas, ativações e média por dia útil. Quem tem menos dias de casa naturalmente produziu menos no total — a média por dia útil é a comparação justa.',
    recorte: (p) => ({
      kpis: p.kpis,
      dataRef: p.dataRef,
      // o spark alimenta a mini-linha da tabela; não acrescenta nada à leitura
      tabela: topo(p.tabela, 40).map(({ spark, ...r }) => r),
    }),
  },
  'rampagem:novatos': {
    tela: 'rampagem',
    titulo: 'Novatos em rampagem',
    oQueE: 'Relação dos vendedores dentro dos 90 dias, com data de admissão, equipe e quando saem da rampagem.',
    recorte: (p) => ({ dataRef: p.dataRef, total: p.kpis?.novatos, novatos: topo(p.novatos, 60) }),
  },

  // ------------------------------------------------------------ premiações
  'premiacoes:pagantes': {
    tela: 'premiacoes',
    titulo: 'Premiações — vendedores com mais de 60 dias de contrato',
    oQueE: 'Faixa de premiação por vendedor, calculada sobre clientes que pagaram. As escalas de interno e externo são diferentes: comparar o valor entre as duas situações induz a erro.',
    recorte: (p) => ({
      dataRef: p.dataRef,
      tecnologia: p.tecnologia,
      totalPagantes: p.totalPagantes,
      pagantes: topo(p.pagantes, 40),
    }),
  },
  'premiacoes:ativos': {
    tela: 'premiacoes',
    titulo: 'Premiações — vendedores dentro dos 60 dias de contrato',
    oQueE: 'Faixa de premiação dos vendedores recentes, calculada sobre ativações. As escalas de interno e externo são diferentes.',
    recorte: (p) => ({
      dataRef: p.dataRef,
      tecnologia: p.tecnologia,
      totalAtivos: p.totalAtivos,
      ativos: topo(p.ativos, 40),
    }),
  },
};

export const listarVisuais = () => Object.entries(VISUAIS)
  .map(([id, v]) => ({ id, tela: v.tela, titulo: v.titulo }));

/**
 * Remonta o visual e devolve só o recorte que vai para a IA.
 * Lança se o id não existir — a rota traduz em 404.
 */
export function recortarVisual(id, flt, g) {
  const visual = VISUAIS[id];
  if (!visual) {
    const erro = new Error('Visual desconhecido.');
    erro.status = 404;
    throw erro;
  }
  const montar = PAINEIS[visual.tela];
  if (!montar) {
    const erro = new Error(`Tela sem painel registrado: ${visual.tela}.`);
    erro.status = 500;
    throw erro;
  }
  return {
    tela: visual.tela,
    titulo: visual.titulo,
    oQueE: visual.oQueE,
    dados: visual.recorte(montar(flt, g)),
  };
}
