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
  rows, serie, serieDiaria, serieDiariaPorTecnologia, soma,
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
  return {
    kpis: {
      totalAtivos: ativos.length,
      mediaAtivos: mediaPonderada(ativos, 'dtAtiv'),
      valor: soma(ativos),
    },
    granularidade: g,
    serie: serie(ativos, 'dtAtiv', g).map((m) => ({ periodo: m.periodo, ativacoes: m.qtd, valor: m.valor })),
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

/** Um painel por id de tela — usado pelo motor de insights. */
export const PAINEIS = {
  diretoria: (flt, g) => painelDiretoria(flt, g),
  vendas: (flt, g) => painelVendas(flt, g),
  ativacoes: (flt, g) => painelAtivacoes(flt, g),
  'primeiro-pagamento': (flt, g) => painelPrimeiroPagamento(flt, g),
  rampagem: (flt, g) => rampagem(flt, g),
  premiacoes: (flt) => premiacoes(flt),
  'vendas-historico': (flt) => painelHistorico('vendas', flt, granularidadeHistorico(null, flt)),
  'ativacoes-historico': (flt) => painelHistorico('ativos', flt, granularidadeHistorico(null, flt)),
};
