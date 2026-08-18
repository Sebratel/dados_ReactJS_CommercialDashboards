/**
 * Montagem dos painéis — o que cada tela de gráficos devolve.
 *
 * Vive fora das rotas porque tem dois consumidores: o endpoint que alimenta os
 * gráficos e o de insights de IA. Se cada um montasse a sua versão, a leitura da
 * IA poderia divergir do que o usuário está vendo na tela — que é justamente o
 * tipo de erro que ninguém percebe. Aqui os dois leem da mesma função.
 */
import {
  DATE_FIELD, groupCount, matriz, mediaPonderada, porVendedor, premiacoes, rampagem,
  rows, serie, serieDiaria, serieDiariaPorTecnologia, seriePorTecnologia, soma,
} from './measures.js';
import { monthKey, today } from './dates.js';

export function painelDiretoria(flt, g) {
  const vendas = rows('vendas', flt);
  const ativos = rows('ativos', flt);
  const pagantes = rows('pagantes', flt);

  const meses = new Map();
  const put = (list, field, campo) => {
    for (const m of serie(list, field, g)) {
      const cur = meses.get(m.periodo) || { periodo: m.periodo, vendas: 0, pagantes: 0, ativacoes: 0 };
      cur[campo] = m.qtd;
      meses.set(m.periodo, cur);
    }
  };
  put(vendas, 'dtVenda', 'vendas');
  put(pagantes, 'dtPagto', 'pagantes');
  put(ativos, 'dtAtiv', 'ativacoes');

  return {
    kpis: {
      totalAtivos: ativos.length,
      mediaAtivos: mediaPonderada(ativos, 'dtAtiv'),
      totalVendas: vendas.length,
      valorTicket: soma(vendas),
      mediaVendas: mediaPonderada(vendas, 'dtVenda'),
      totalPagantes: pagantes.length,
      valorPagantes: soma(pagantes),
    },
    granularidade: g,
    serie: [...meses.values()].sort((a, b) => a.periodo.localeCompare(b.periodo)),
  };
}

export function painelVendas(flt, g) {
  const vendas = rows('vendas', flt);
  const ativos = rows('ativos', flt);

  // combo "TOTAL DE VENDAS / MÊS (ou DIA)": colunas = vendas, linha = ativações
  const meses = new Map();
  for (const m of serie(vendas, 'dtVenda', g)) {
    meses.set(m.periodo, { periodo: m.periodo, vendas: m.qtd, ativacoes: 0, valor: m.valor });
  }
  for (const m of serie(ativos, 'dtAtiv', g)) {
    const cur = meses.get(m.periodo) || { periodo: m.periodo, vendas: 0, ativacoes: 0, valor: 0 };
    cur.ativacoes = m.qtd;
    meses.set(m.periodo, cur);
  }

  // "TOTAL DE VENDAS / DIA (MÊS ATUAL)" — último mês do período filtrado
  const mesAtual = monthKey(flt.ate || today());
  const doMes = vendas.filter((f) => monthKey(f.dtVenda) === mesAtual);

  return {
    kpis: {
      totalVendas: vendas.length,
      valorTicket: soma(vendas),
      mediaVendas: mediaPonderada(vendas, 'dtVenda'),
      totalAtivos: ativos.length,
    },
    granularidade: g,
    serie: [...meses.values()].sort((a, b) => a.periodo.localeCompare(b.periodo)),
    porCidade: groupCount(vendas, (f) => f.cidade, { limit: 15 }),
    porVendedor: porVendedor(vendas, 'dtVenda'),
    mesAtual,
    porDia: serieDiariaPorTecnologia(doMes, 'dtVenda'),
  };
}

export function painelAtivacoes(flt, g) {
  const ativos = rows('ativos', flt);
  const porTec = seriePorTecnologia(ativos, 'dtAtiv', g);
  const totalTelefonia = ativos.reduce((a, f) => a + (f.tecnologia === 'TELEFONIA' ? 1 : 0), 0);

  return {
    kpis: {
      totalAtivos: ativos.length,
      mediaAtivos: mediaPonderada(ativos, 'dtAtiv'),
      valor: soma(ativos),
      // o relatório do Power BI não mostra a telefonia; separar aqui deixa o
      // total reconciliável com ele sem precisar refazer a conta na mão
      totalTelefonia,
      totalFibraRadio: ativos.length - totalTelefonia,
    },
    granularidade: g,
    // `ativacoes` é o mesmo que `total`, mantido porque a série já era consumida
    // com esse nome pelo gráfico e pelas exportações
    serie: porTec.map((m) => ({ ...m, ativacoes: m.total })),
    porCanal: groupCount(ativos, (f) => f.canal || '(sem canal)', { limit: 12 }),
    porCidade: groupCount(ativos, (f) => f.cidade, { limit: 15 }),
    porVendedor: porVendedor(ativos, 'dtAtiv'),
    porDia: serieDiaria(ativos, 'dtAtiv'),
  };
}

export function painelPrimeiroPagamento(flt, g, { limit = 1500 } = {}) {
  const pagantes = rows('pagantes', flt);

  // "Planos mais vendidos": agrupado pelo valor do plano
  const planos = new Map();
  for (const f of pagantes) {
    const key = `${f.plano || '(sem plano)'}|${(Number(f.valor) || 0).toFixed(2)}`;
    const cur = planos.get(key) || { plano: f.plano || '(sem plano)', valorPadrao: Number(f.valor) || 0, qtd: 0, valorTotal: 0 };
    cur.qtd += 1;
    cur.valorTotal += Number(f.valor) || 0;
    planos.set(key, cur);
  }

  const detalhe = pagantes
    .slice()
    .sort((a, b) => (b.dtPagto || '').localeCompare(a.dtPagto || ''))
    .slice(0, limit)
    .map((f) => ({
      vendedor: f.vendedor,
      cliente: f.cliente,
      dtPagto: f.dtPagto,
      plano: f.plano,
      tecnologia: f.tecnologia,
      valor: f.valor,
      contrato: f.contrato,
    }));

  return {
    kpis: {
      totalPagantes: pagantes.length,
      valor: soma(pagantes),
      media: mediaPonderada(pagantes, 'dtPagto'),
    },
    granularidade: g,
    serie: serie(pagantes, 'dtPagto', g).map((m) => ({ periodo: m.periodo, pagantes: m.qtd, valor: m.valor })),
    planos: [...planos.values()].sort((a, b) => b.qtd - a.qtd).slice(0, 40),
    porVendedor: porVendedor(pagantes, 'dtPagto'),
    detalhe,
    detalheTotal: pagantes.length,
  };
}

export function painelHistorico(dataset, flt, granularidade) {
  const list = rows(dataset, flt);
  return { granularidade, ...matriz(list, DATE_FIELD[dataset], granularidade) };
}

/** Granularidade da matriz: acima de ~2 meses vira mensal, senão fica ilegível. */
export function granularidadeHistorico(query, flt) {
  if (query === 'dia' || query === 'mes') return query;
  const dias = flt.de && flt.ate
    ? Math.round((new Date(flt.ate) - new Date(flt.de)) / 86400000)
    : 999;
  return dias > 62 ? 'mes' : 'dia';
}


/**
 * VENDAS CANCELADAS — réplica da tela única do relatório "COM - Vendas Canceladas".
 *
 * O recorte é dado pelos dois filtros de página daquele relatório: contrato
 * cancelado E sem data de ativação, ou seja, a venda que se perdeu antes de
 * virar instalação. Contrato cancelado depois de ativado não entra aqui.
 *
 * Duas fidelidades que exigiram atenção:
 *
 * 1. Aquele relatório não considera os tipos de atendimento #HR (1254/1255), ao
 *    contrário do resto do modelo. Em vez de uma segunda carga da base inteira
 *    para 0,2% dos contratos, `base.sql` marca quem tem algum atendimento da
 *    lista dele e o filtro usa essa marca — mesmo conjunto, sem custo extra.
 *
 * 2. O filtro de período do relatório é a DATA DO CONTRATO, mas o gráfico mensal
 *    agrupa por CADASTRO DO CLIENTE. As duas só coincidem em 70% dos casos, então
 *    a diferença é real; mantemos como está lá e dizemos no título do visual qual
 *    data cada um usa.
 */
export function painelCanceladas(flt) {
  const canceladas = rows('vendas', flt).filter(
    (f) => f.statusContrato === 'Cancelado' && !f.dtAtiv && f.temTipoPadrao,
  );

  // Duas séries, e a razão é prática: o relatório agrupa por cadastro do cliente,
  // mas o cliente pode ter se cadastrado anos antes de fechar o contrato. Num
  // único mês de vendas isso espalha o gráfico por 47 meses, quase todos com uma
  // barra de valor 1 e um pico no fim — ilegível. A série por data da venda é a
  // coerente com o filtro de período e vira o padrão; a do cadastro fica a um
  // clique, para quem precisa conferir contra o Power BI.
  const agrupar = (campo) => {
    const m = new Map();
    for (const f of canceladas) {
      const d = f[campo];
      const k = d ? monthKey(d) : '(sem data)';
      const cur = m.get(k) || { periodo: k, canceladas: 0, valor: 0 };
      cur.canceladas += 1;
      cur.valor += Number(f.valor) || 0;
      m.set(k, cur);
    }
    return [...m.values()].sort((a, b) => a.periodo.localeCompare(b.periodo));
  };

  // "por valor": mesma ideia dos planos, agrupando pelo valor do contrato
  const porValor = new Map();
  for (const f of canceladas) {
    const v = Number(f.valor) || 0;
    const cur = porValor.get(v) || { valor: v, qtd: 0 };
    cur.qtd += 1;
    porValor.set(v, cur);
  }

  const detalhe = canceladas
    .slice()
    .sort((a, b) => (b.dtVenda || '').localeCompare(a.dtVenda || ''))
    .slice(0, 2000)
    .map((f) => ({
      dtVenda: f.dtVenda,
      horaVenda: f.horaVenda,
      contrato: f.contrato,
      cliente: f.cliente,
      cidade: f.cidade,
      vendedor: f.vendedor,
      situacao: f.situacao,
      statusContrato: f.statusContrato,
      statusCancelamento: f.statusCancelamento,
      valor: f.valor,
      tecnologia: f.tecnologia,
    }));

  return {
    kpis: {
      total: canceladas.length,
      valor: soma(canceladas),
      ticketMedio: canceladas.length ? soma(canceladas) / canceladas.length : 0,
    },
    serie: agrupar('dtVenda'),
    serieCadastro: agrupar('dtCadastroCliente'),
    porMotivo: groupCount(canceladas, (f) => f.statusCancelamento || '(sem motivo informado)', { limit: 20 }),
    porCidade: groupCount(canceladas, (f) => f.cidade, { limit: 20 }),
    porTecnologia: groupCount(canceladas, (f) => f.tecnologia),
    porEquipe: groupCount(canceladas, (f) => f.equipe || '(sem equipe)', { limit: 20 }),
    porSituacao: groupCount(canceladas, (f) => f.situacao || '(sem situação)'),
    porVendedor: groupCount(canceladas, (f) => f.vendedor, { limit: 30 }),
    porTipo: groupCount(canceladas, (f) => f.tipoSolicitacao || '(sem tipo)'),
    porValor: [...porValor.values()].sort((a, b) => b.qtd - a.qtd).slice(0, 25),
    detalhe,
    detalheTotal: canceladas.length,
  };
}

/** Um painel por id de tela — usado pelo motor de insights. */
export const PAINEIS = {
  diretoria: (flt, g) => painelDiretoria(flt, g),
  vendas: (flt, g) => painelVendas(flt, g),
  ativacoes: (flt, g) => painelAtivacoes(flt, g),
  'primeiro-pagamento': (flt, g) => painelPrimeiroPagamento(flt, g),
  rampagem: (flt, g) => rampagem(flt, g),
  premiacoes: (flt) => premiacoes(flt),
  'vendas-canceladas': (flt) => painelCanceladas(flt),
  'vendas-historico': (flt) => painelHistorico('vendas', flt, granularidadeHistorico(null, flt)),
  'ativacoes-historico': (flt) => painelHistorico('ativos', flt, granularidadeHistorico(null, flt)),
};
