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
import {
  painelDesempenho, painelLeads, painelNegociacoes, parseFiltrosDesempenho,
  parseFiltrosLeads, parseFiltrosNegociacoes,
} from '../model/leads.js';

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
  desempenho: {
    parse: (q) => ({ flt: parseFiltrosDesempenho(q), por: q.por === 'cidade' ? 'cidade' : 'vendedor' }),
    montar: (visual, ctx) => painelDesempenho(ctx.flt, visual.por || ctx.por),
    // Esta tela tem DOIS períodos, um para cada lado do funil. Descrever só um
    // deles faria a IA achar que o recorte é metade do que é.
    periodo: ({ flt }) => {
      const partes = [];
      partes.push(flt.leadDe || flt.leadAte
        ? `cadastro do lead de ${flt.leadDe || 'início'} a ${flt.leadAte || 'hoje'}`
        : 'cadastro do lead sem recorte');
      partes.push(flt.negDe || flt.negAte
        ? `criação da negociação de ${flt.negDe || 'início'} a ${flt.negAte || 'hoje'}`
        : 'criação da negociação sem recorte');
      return `Dois períodos independentes — ${partes.join('; ')}.`;
    },
    recortes: ({ flt }) => [
      flt.vendedor?.length && `vendedores: ${flt.vendedor.join(', ')}`,
      flt.equipe?.length && `equipes: ${flt.equipe.join(', ')}`,
      flt.status?.length && `status do lead: ${flt.status.join(', ')}`,
      flt.tipoContrato?.length && `tipos de contrato: ${flt.tipoContrato.join(', ')}`,
      flt.cidade?.length && `cidades: ${flt.cidade.join(', ')}`,
      flt.bairro?.length && `bairros: ${flt.bairro.join(', ')}`,
    ],
  },
  negociacoes: {
    parse: (q) => ({ flt: parseFiltrosNegociacoes(q) }),
    montar: (visual, ctx) => painelNegociacoes(ctx.flt),
    periodo: ({ flt }) => (flt.de || flt.ate
      ? `Período filtrado pela data de CRIAÇÃO DA NEGOCIAÇÃO: ${flt.de || 'início'} a ${flt.ate || 'hoje'}.`
      : 'Sem filtro de período: entram todas as negociações carregadas (o recorte da consulta começa em 2026-01-01).'),
    recortes: ({ flt }) => [
      flt.responsavel?.length && `responsáveis: ${flt.responsavel.join(', ')}`,
      flt.equipe?.length && `equipes: ${flt.equipe.join(', ')}`,
      flt.status?.length && `status: ${flt.status.join(', ')}`,
      flt.fase?.length && `fases do funil: ${flt.fase.join(', ')}`,
      flt.tipoContrato?.length && `tipos de contrato: ${flt.tipoContrato.join(', ')}`,
      flt.origem?.length && `origens: ${flt.origem.join(', ')}`,
      flt.forma?.length && `formas de contato: ${flt.forma.join(', ')}`,
      flt.regiao?.length && `regiões: ${flt.regiao.join(', ')}`,
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
  // ---------------------------------------------------- negociações (CRM)
  // "Negociações por lead" fica FORA: é uma linha por cliente, com o nome dele.
  'negociacoes:serie': {
    tela: 'leads',
    modelo: 'negociacoes',
    titulo: 'Status por negociação / mês',
    oQueE: 'Composição mensal das negociações pelos três estados, pelo mês de CRIAÇÃO da negociação. O estado sai do tipo do motivo: 1 é ganho, 0 é perda, e motivo em branco ou de outro tipo é Em Andamento.',
    recorte: (p) => ({
      kpis: p.kpis,
      estados: p.serieStatus?.series,
      porMes: serieEnxuta(p.serieStatus?.dados, 36),
    }),
  },
  'negociacoes:motivo': {
    tela: 'leads',
    modelo: 'negociacoes',
    titulo: 'Negociações por status e motivo',
    oQueE: 'Cruzamento de estado com o motivo registrado no CRM. Conta LEADS, não negociações, e a participação é sobre os leads que negociaram — não sobre o total de leads do CRM.',
    recorte: (p) => ({
      leadsComNegociacao: p.kpis?.leadsComNegociacao,
      totalNegociacoes: p.kpis?.total,
      porMotivo: topo(p.porMotivo, 40),
    }),
  },
  'negociacoes:responsavel': {
    tela: 'leads',
    modelo: 'negociacoes',
    titulo: 'Negociações por responsável',
    oQueE: 'Quantas negociações cada responsável conduziu, quantas ganhou e a participação dele no total. A lista vem cortada nos 30 maiores.',
    recorte: (p) => ({ kpis: p.kpis, porResponsavel: topo(p.porResponsavel, 30) }),
  },
  'negociacoes:fase': {
    tela: 'leads',
    modelo: 'negociacoes',
    titulo: 'Negociações por fase do funil',
    oQueE: 'Em que fase do funil as negociações estão, com quantas de cada fase acabaram ganhas.',
    recorte: (p) => ({ kpis: p.kpis, porFase: p.porFase }),
  },
  'negociacoes:origem': {
    tela: 'leads',
    modelo: 'negociacoes',
    titulo: 'Negociações por origem',
    oQueE: 'De onde veio a negociação, com quantas de cada origem acabaram ganhas. As 15 maiores; o resto soma em Outros.',
    recorte: (p) => ({
      kpis: p.kpis,
      porOrigem: p.porOrigem,
      porForma: p.porForma,
      porRegiao: p.porRegiao,
    }),
  },
  'negociacoes:plano': {
    tela: 'leads',
    modelo: 'negociacoes',
    titulo: 'Negociações por plano',
    oQueE: 'Qual plano foi negociado, quantas vezes, quantas ganhas e a soma do valor. O valor é a mensalidade do plano, não o acumulado.',
    recorte: (p) => ({
      kpis: p.kpis,
      porServico: p.porServico,
      porTipoContrato: p.porTipoContrato,
    }),
  },
  'negociacoes:valores': {
    tela: 'leads',
    modelo: 'negociacoes',
    titulo: 'Valores por status',
    oQueE: 'Quantidade e soma do plano negociado em cada estado. A receita da tela conta apenas as ganhas; os outros estados mostram o que está em jogo ou o que se perdeu.',
    recorte: (p) => ({ kpis: p.kpis, porValorStatus: p.porValorStatus, porTime: p.porTime }),
  },

  'desempenho:vendedor': {
    tela: 'leads',
    modelo: 'desempenho',
    por: 'vendedor',
    titulo: 'Produtividade por vendedor',
    oQueE: 'Os dois lados do funil na mesma linha: leads cadastrados e ganhos de um lado, negociações conduzidas e ganhas do outro, com as três taxas. ATENÇÃO às bases: a conversão de CADASTRO é sobre os leads que ele cadastrou, e a de NEGOCIAÇÃO é sobre as negociações que ele conduziu — são conjuntos diferentes, e comparar as duas taxas como se fossem a mesma escala induz a erro. UMOV ME TECNOLOGIA é a integração que cadastra lead automaticamente, não uma pessoa: aparece com muitos leads e nenhuma negociação.',
    recorte: (p) => ({ kpis: p.kpis, linhas: p.produtividadeTotal, topo: topo(p.produtividade, 40) }),
  },
  'desempenho:vendedor-status': {
    tela: 'leads',
    modelo: 'desempenho',
    por: 'vendedor',
    titulo: 'Status dos leads por vendedor',
    oQueE: 'Quantos leads de cada vendedor estão ganhos, descartados e em backlog aberto (Em Andamento, Qualificado ou Disponível). A soma dos três não fecha com os cadastrados: falta Perda e Outros.',
    recorte: (p) => ({
      kpis: p.kpis,
      topo: topo(p.produtividade, 40).map((x) => ({
        key: x.key, cadastrados: x.cadastrados, ganhos: x.ganhosLead,
        descartados: x.descartados, backlog: x.backlog,
      })),
    }),
  },
  'desempenho:vendedor-resumo': {
    tela: 'leads',
    modelo: 'desempenho',
    por: 'vendedor',
    titulo: 'Resumo financeiro por vendedor',
    oQueE: 'Receita, ticket médio, duração média da negociação e tempo de vida do lead por vendedor. Receita é a soma da mensalidade dos planos ganhos, não valor acumulado; o ticket divide por LEAD ganho, não por negociação.',
    recorte: (p) => ({
      kpis: p.kpis,
      topo: topo(p.produtividade, 40).map((x) => ({
        key: x.key, receita: x.receita, ticketMedio: x.ticketMedio,
        duracao: x.duracao, tempoVidaLead: x.vidaLead,
      })),
    }),
  },
  'desempenho:vendedor-perdaLead': {
    tela: 'leads',
    modelo: 'desempenho',
    por: 'vendedor',
    titulo: 'Onde os leads se perdem',
    oQueE: 'Leads com classificação Perda ou Descartado, por motivo, origem, forma de contato e time. É o recorte de "onde se perde" do relatório, do lado do lead.',
    recorte: (p) => ({
      leadsPerdidos: p.leadsPerdidos,
      totalLeads: p.kpis?.cadastrados,
      porMotivo: p.perdaLeadMotivo,
      porOrigem: p.perdaLeadOrigem,
      porForma: p.perdaLeadForma,
      porTime: p.perdaLeadTime,
    }),
  },
  'desempenho:vendedor-perdaNeg': {
    tela: 'leads',
    modelo: 'desempenho',
    por: 'vendedor',
    titulo: 'Onde as negociações se perdem',
    oQueE: 'Negociações com status Perda, por motivo, origem, forma de contato e time. É o recorte de "onde se perde" do relatório, do lado da negociação.',
    recorte: (p) => ({
      negociacoesPerdidas: p.negsPerdidas,
      totalConduzidas: p.kpis?.conduzidas,
      porMotivo: p.perdaNegMotivo,
      porOrigem: p.perdaNegOrigem,
      porForma: p.perdaNegForma,
      porTime: p.perdaNegTime,
    }),
  },
  'desempenho:cidade': {
    tela: 'leads',
    modelo: 'desempenho',
    por: 'cidade',
    titulo: 'Produtividade por cidade',
    oQueE: 'Os dois lados do funil na mesma linha: leads cadastrados e ganhos de um lado, negociações conduzidas e ganhas do outro, com as três taxas. ATENÇÃO às bases: a conversão de CADASTRO é sobre os leads cadastrados nela, e a de NEGOCIAÇÃO é sobre as negociações dos leads dela — são conjuntos diferentes, e comparar as duas taxas como se fossem a mesma escala induz a erro.',
    recorte: (p) => ({ kpis: p.kpis, linhas: p.produtividadeTotal, topo: topo(p.produtividade, 40) }),
  },
  'desempenho:cidade-status': {
    tela: 'leads',
    modelo: 'desempenho',
    por: 'cidade',
    titulo: 'Status dos leads por cidade',
    oQueE: 'Quantos leads de cada cidade estão ganhos, descartados e em backlog aberto (Em Andamento, Qualificado ou Disponível). A soma dos três não fecha com os cadastrados: falta Perda e Outros.',
    recorte: (p) => ({
      kpis: p.kpis,
      topo: topo(p.produtividade, 40).map((x) => ({
        key: x.key, cadastrados: x.cadastrados, ganhos: x.ganhosLead,
        descartados: x.descartados, backlog: x.backlog,
      })),
    }),
  },
  'desempenho:cidade-resumo': {
    tela: 'leads',
    modelo: 'desempenho',
    por: 'cidade',
    titulo: 'Resumo financeiro por cidade',
    oQueE: 'Receita, ticket médio, duração média da negociação e tempo de vida do lead por cidade. Receita é a soma da mensalidade dos planos ganhos, não valor acumulado; o ticket divide por LEAD ganho, não por negociação.',
    recorte: (p) => ({
      kpis: p.kpis,
      topo: topo(p.produtividade, 40).map((x) => ({
        key: x.key, receita: x.receita, ticketMedio: x.ticketMedio,
        duracao: x.duracao, tempoVidaLead: x.vidaLead,
      })),
    }),
  },
  'desempenho:cidade-perdaLead': {
    tela: 'leads',
    modelo: 'desempenho',
    por: 'cidade',
    titulo: 'Onde os leads se perdem',
    oQueE: 'Leads com classificação Perda ou Descartado, por motivo, origem, forma de contato e time. É o recorte de "onde se perde" do relatório, do lado do lead.',
    recorte: (p) => ({
      leadsPerdidos: p.leadsPerdidos,
      totalLeads: p.kpis?.cadastrados,
      porMotivo: p.perdaLeadMotivo,
      porOrigem: p.perdaLeadOrigem,
      porForma: p.perdaLeadForma,
      porTime: p.perdaLeadTime,
    }),
  },
  'desempenho:cidade-perdaNeg': {
    tela: 'leads',
    modelo: 'desempenho',
    por: 'cidade',
    titulo: 'Onde as negociações se perdem',
    oQueE: 'Negociações com status Perda, por motivo, origem, forma de contato e time. É o recorte de "onde se perde" do relatório, do lado da negociação.',
    recorte: (p) => ({
      negociacoesPerdidas: p.negsPerdidas,
      totalConduzidas: p.kpis?.conduzidas,
      porMotivo: p.perdaNegMotivo,
      porOrigem: p.perdaNegOrigem,
      porForma: p.perdaNegForma,
      porTime: p.perdaNegTime,
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
