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
import { parseFilters, parseGranularidade } from '../model/measures.js';
import { painelCondominios, parseFiltrosCondominios } from '../model/condominios.js';
import { painelLeads, parseFiltrosLeads } from '../model/leads.js';

/**
 * De qual MODELO o visual vem.
 *
 * Existia um só quando isto foi escrito, e o caminho da IA parseava os filtros
 * comerciais direto na rota. Com três modelos em memória — cada um com o seu
 * conjunto de filtros — isso passou a ser uma armadilha: um visual de condomínio
 * registrado sem adaptação receberia `parseFilters`, que não conhece
 * `cidadeCond` nem `faixa`, e a IA leria a base INTEIRA achando que estava lendo
 * o recorte da tela. Leitura errada com cara de autoridade é pior que nenhuma.
 *
 * Então cada modelo declara três coisas: como ler os filtros da query, como
 * montar o painel, e como descrever o recorte em português para o prompt — o
 * vocabulário é diferente em cada tela ("tecnologia" não existe em condomínios,
 * "faixa de ocupação" não existe em vendas).
 */
const MODELOS = {
  comercial: {
    parse: (q) => ({ flt: parseFilters(q), g: parseGranularidade(q) }),
    montar: (visual, ctx) => {
      const painel = PAINEIS[visual.tela];
      if (!painel) {
        const erro = new Error(`Tela sem painel registrado: ${visual.tela}.`);
        erro.status = 500;
        throw erro;
      }
      return painel(ctx.flt, ctx.g);
    },
    periodo: ({ flt }) => (flt.de || flt.ate
      ? `Período filtrado pela data do indicador: ${flt.de || 'início'} a ${flt.ate || 'hoje'}.`
      : 'Sem filtro de período: o visual mostra todo o histórico carregado.'),
    recortes: ({ flt }) => [
      flt.vendedor?.length && `vendedores: ${flt.vendedor.join(', ')}`,
      flt.equipe?.length && `equipes: ${flt.equipe.join(', ')}`,
      flt.tecnologia?.length && `tecnologias: ${flt.tecnologia.join(', ')}`,
      flt.cidade?.length && `cidades: ${flt.cidade.join(', ')}`,
      flt.canal?.length && `canais: ${flt.canal.join(', ')}`,
    ],
  },
  condominios: {
    parse: (q) => ({ flt: parseFiltrosCondominios(q) }),
    montar: (visual, ctx) => painelCondominios(ctx.flt),
    periodo: ({ flt }) => (flt.de || flt.ate
      ? `Período filtrado pela data de CRIAÇÃO DO SPLITTER: ${flt.de || 'início'} a ${flt.ate || 'hoje'}.`
      : 'Sem filtro de período: entram os splitters de qualquer época.'),
    recortes: ({ flt }) => [
      flt.condominio?.length && `condomínios: ${flt.condominio.join(', ')}`,
      flt.cidade?.length && `cidades: ${flt.cidade.join(', ')}`,
      flt.classificacao?.length && `faixas de ocupação: ${flt.classificacao.join(', ')}`,
      flt.concentrador?.length && `concentradores: ${flt.concentrador.join(', ')}`,
      flt.pontoAcesso?.length && `pontos de acesso: ${flt.pontoAcesso.join(', ')}`,
      flt.site?.length && `sites: ${flt.site.join(', ')}`,
      flt.splitter?.length && `splitters: ${flt.splitter.join(', ')}`,
    ],
  },
  leads: {
    parse: (q) => ({ flt: parseFiltrosLeads(q) }),
    montar: (visual, ctx) => painelLeads(ctx.flt),
    periodo: ({ flt }) => (flt.de || flt.ate
      ? `Período filtrado pela data de CADASTRO DO LEAD: ${flt.de || 'início'} a ${flt.ate || 'hoje'}.`
      : 'Sem filtro de período: entram todos os leads carregados (o recorte da consulta começa em 2026-01-01).'),
    recortes: ({ flt }) => [
      flt.vendedor?.length && `donos de lead: ${flt.vendedor.join(', ')}`,
      flt.equipe?.length && `equipes: ${flt.equipe.join(', ')}`,
      flt.status?.length && `status do lead: ${flt.status.join(', ')}`,
      flt.cidade?.length && `cidades: ${flt.cidade.join(', ')}`,
      flt.origem?.length && `origens: ${flt.origem.join(', ')}`,
      flt.forma?.length && `formas de contato: ${flt.forma.join(', ')}`,
    ],
  },
};

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

  // ------------------------------------------------------ vendas canceladas
  'vendas-canceladas:serie': {
    tela: 'vendas-canceladas',
    titulo: 'Vendas canceladas por mês',
    oQueE: 'Contratos cancelados que nunca foram ativados, agrupados pelo mês de CADASTRO DO CLIENTE (é assim no relatório de origem), enquanto o filtro de período usa a data do contrato.',
    recorte: (p) => ({ kpis: p.kpis, serie: serieEnxuta(p.serie) }),
  },
  'vendas-canceladas:motivo': {
    tela: 'vendas-canceladas',
    titulo: 'Motivo do cancelamento',
    oQueE: 'Justificativa registrada no cancelamento. Motivo vazio significa cancelamento sem justificativa preenchida, não ausência de motivo.',
    recorte: (p) => ({ total: p.kpis?.total, porMotivo: topo(p.porMotivo, 20) }),
  },
  'vendas-canceladas:vendedor': {
    tela: 'vendas-canceladas',
    titulo: 'Cancelamentos por vendedor',
    oQueE: 'Quem mais perdeu venda antes da instalação. Quem vende mais tende a cancelar mais em número absoluto.',
    recorte: (p) => ({ total: p.kpis?.total, porVendedor: topo(p.porVendedor, 30) }),
  },
  'vendas-canceladas:cidade': {
    tela: 'vendas-canceladas',
    titulo: 'Cancelamentos por cidade',
    oQueE: 'Onde a venda se perde antes de virar instalação.',
    recorte: (p) => ({ total: p.kpis?.total, porCidade: topo(p.porCidade, 20) }),
  },
  'vendas-canceladas:tipo': {
    tela: 'vendas-canceladas',
    titulo: 'Cancelamentos por tipo de atendimento',
    oQueE: 'Tipo de solicitação registrado no atendimento que originou o contrato.',
    recorte: (p) => ({ total: p.kpis?.total, porTipo: topo(p.porTipo, 12), porTecnologia: topo(p.porTecnologia, 6) }),
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

  // ----------------------------------------------------------- condomínios
  // O detalhamento porta a porta NÃO está aqui, de propósito: ele tem nome de
  // cliente e endereço. `recorte` é o filtro de privacidade desta tela, e só
  // passa por ele o que já é agregado.
  'condominios:ocupacao': {
    tela: 'condominios',
    modelo: 'condominios',
    titulo: 'Ocupação dos splitters de condomínio',
    oQueE: 'Um splitter por linha: capacidade declarada, portas ocupadas e livres, percentual e a faixa (OK abaixo de 70%, ALERTA de 70 a 90%, CRÍTICO acima de 90%). Ordenado pelos mais ocupados; a lista vem cortada no topo, então o último não é o menos ocupado da rede.',
    recorte: (p) => ({
      kpis: p.kpis,
      porFaixa: p.porClassificacao,
      splittersNoFiltro: p.porSplitterTotal,
      topoOcupacao: topo(p.porSplitter, 40).map((s) => ({
        condominio: s.condominio,
        splitter: s.splitter,
        pontoAcesso: s.pontoAcesso,
        site: s.site,
        cidade: s.cidade,
        capacidade: s.capacidade,
        ocupadas: s.ocupadas,
        disponiveis: s.disponiveis,
        percentual: s.percentual,
        faixa: s.classificacao,
        criadoEm: s.criado,
        diasDeVida: s.diasDeVida,
      })),
    }),
  },
  'condominios:condominio': {
    tela: 'condominios',
    modelo: 'condominios',
    titulo: 'Ocupação por condomínio',
    oQueE: 'Os condomínios agrupados por nome, somando a capacidade e as portas ocupadas dos splitters distintos de cada um. Um condomínio pode ter vários splitters.',
    recorte: (p) => ({
      kpis: p.kpis,
      condominiosNoFiltro: p.porCondominioTotal,
      topo: topo(p.porCondominio, 30),
    }),
  },
  'condominios:cidade': {
    tela: 'condominios',
    modelo: 'condominios',
    titulo: 'Ocupação por cidade',
    oQueE: 'Capacidade, portas livres e ocupadas por cidade do equipamento. Cada splitter conta em uma cidade só; quando o cadastro do splitter não tem cidade, vale a mais frequente entre os clientes dele.',
    recorte: (p) => ({ kpis: p.kpis, porCidade: p.porCidade }),
  },
  'condominios:matriz': {
    tela: 'condominios',
    modelo: 'condominios',
    titulo: 'Clientes por mês de aprovação e cidade',
    oQueE: 'Quantos clientes de condomínio tiveram contrato aprovado em cada mês, por cidade. Porta sem data de aprovação fica fora.',
    recorte: (p) => ({
      cidades: p.matriz?.colunas,
      total: p.matriz?.total,
      totalPorCidade: p.matriz?.totalPorColuna,
      porMes: serieEnxuta(p.matriz?.linhas, 36),
      clientesSemDataAprovacao: p.clientesSemDataAprovacao,
    }),
  },

  // ------------------------------------------------- leads e negociações
  // Fora daqui, também de propósito: as tabelas "Status por lead" e "Leads
  // completo". Elas têm nome, CPF, e-mail e telefone — nada disso sai do
  // servidor para um provedor de IA.
  'leads:status': {
    tela: 'leads',
    modelo: 'leads',
    titulo: 'Status por lead / mês',
    oQueE: 'Composição mensal dos leads cadastrados pelos sete estados do funil. A ordem dos estados é a regra de classificação: quem tem negociação ganha conta como Ganho mesmo que também esteja descartado. "Outros" é cadastro fora da situação "Lead" e sem negociação nenhuma.',
    recorte: (p) => ({
      kpis: p.kpis,
      estados: p.serieStatus?.series,
      porMes: serieEnxuta(p.serieStatus?.dados, 36),
    }),
  },
  'leads:origem': {
    tela: 'leads',
    modelo: 'leads',
    titulo: 'Origem por lead / mês',
    oQueE: 'De onde vieram os leads, mês a mês. Só as 6 origens com mais leads aparecem como série; o resto está somado em "Outros".',
    recorte: (p) => ({
      totalLeads: p.kpis?.total,
      origens: p.serieOrigem?.series,
      porMes: serieEnxuta(p.serieOrigem?.dados, 36),
    }),
  },
  'leads:forma': {
    tela: 'leads',
    modelo: 'leads',
    titulo: 'Forma de contato por lead / mês',
    oQueE: 'Por qual canal o lead chegou, mês a mês. Só as 6 formas com mais leads aparecem como série; o resto está somado em "Outros".',
    recorte: (p) => ({
      totalLeads: p.kpis?.total,
      formas: p.serieForma?.series,
      porMes: serieEnxuta(p.serieForma?.dados, 36),
    }),
  },
  'leads:motivo': {
    tela: 'leads',
    modelo: 'leads',
    titulo: 'Motivos por lead',
    oQueE: 'Motivo da oportunidade registrado no CRM. A participação de cada motivo é calculada sobre os leads QUE TÊM motivo, não sobre o total — é a base que o relatório usa aqui. A lista vem cortada nos 12 maiores; o resto está em "Outros".',
    recorte: (p) => ({
      totalLeads: p.kpis?.total,
      leadsComMotivo: p.leadsComMotivo,
      porMotivo: p.porMotivo,
    }),
  },
  'leads:perfil': {
    tela: 'leads',
    modelo: 'leads',
    titulo: 'Perfil dos leads',
    oQueE: 'Distribuição dos leads por cidade, gênero e tipo de pessoa, com a participação de cada faixa no total.',
    // bairro e rua ficam fora: rua com um lead só, somada à cidade, chega perto
    // de um endereço — e não muda a leitura que a IA faz do perfil.
    recorte: (p) => ({
      totalLeads: p.kpis?.total,
      porCidade: topo(p.porCidade, 20),
      porGenero: p.porGenero,
      porTipoPessoa: p.porTipoPessoa,
    }),
  },
  'leads:vendedor': {
    tela: 'leads',
    modelo: 'leads',
    titulo: 'Status de lead por vendedor',
    oQueE: 'Quantos leads cada dono tem em cada estado do funil. O dono é o proprietário da venda quando existe, senão quem cadastrou o lead.',
    recorte: (p) => ({
      estados: p.matrizVendedor?.colunas,
      total: p.matrizVendedor?.total,
      totalPorEstado: p.matrizVendedor?.totalPorColuna,
      vendedores: topo(p.matrizVendedor?.linhas, 40),
      leadsSemDono: p.semDono,
    }),
  },
};

export const listarVisuais = () => Object.entries(VISUAIS)
  .map(([id, v]) => ({ id, tela: v.tela, titulo: v.titulo, modelo: v.modelo || 'comercial' }));

/**
 * Remonta o visual a partir da QUERY CRUA e devolve só o recorte que vai para a
 * IA, mais o recorte descrito em português para o prompt.
 *
 * Recebe a query, e não os filtros já interpretados, porque quem sabe COMO
 * interpretá-los é o visual: cada modelo tem o seu conjunto. Deixar isso na rota
 * era o que impedia registrar aqui os visuais de condomínios e de leads.
 *
 * Lança se o id não existir — a rota traduz em 404.
 */
export function recortarVisual(id, query = {}) {
  const visual = VISUAIS[id];
  if (!visual) {
    const erro = new Error('Visual desconhecido.');
    erro.status = 404;
    throw erro;
  }
  const modelo = MODELOS[visual.modelo || 'comercial'];
  const ctx = modelo.parse(query);
  const painel = modelo.montar(visual, ctx);
  return {
    tela: visual.tela,
    titulo: visual.titulo,
    oQueE: visual.oQueE,
    dados: visual.recorte(painel),
    periodo: modelo.periodo(ctx),
    recortes: modelo.recortes(ctx).filter(Boolean),
  };
}
