/**
 * Motor de análise preditiva.
 *
 * Regra da casa: TODO número aqui é calculado estatisticamente sobre a base —
 * nada vem de LLM. A IA entra depois, só para interpretar e priorizar o que
 * este módulo apurou. Assim nenhum número exibido pode ser alucinado.
 *
 * As previsões usam janelas de tempo próprias (mês corrente, últimos 14 dias,
 * coortes de 6 meses). Os filtros de vendedor/equipe/tecnologia se aplicam; o
 * filtro de período não, porque cada análise precisa da sua própria janela.
 */
import { getState } from './store.js';
import { dayWeight } from './holidays.js';
import { addDays, diffDays, endOfMonth, monthKey, startOfMonth, today } from './dates.js';

// ------------------------------------------------------------- utilitários
function percentil(valores, p) {
  if (!valores.length) return null;
  const ord = [...valores].sort((a, b) => a - b);
  const i = (ord.length - 1) * p;
  const baixo = Math.floor(i);
  const alto = Math.ceil(i);
  return baixo === alto ? ord[baixo] : ord[baixo] + (ord[alto] - ord[baixo]) * (i - baixo);
}

const mediana = (v) => percentil(v, 0.5);
const media = (v) => (v.length ? v.reduce((a, b) => a + b, 0) / v.length : 0);

function desvioPadrao(valores) {
  if (valores.length < 2) return 0;
  const m = media(valores);
  return Math.sqrt(valores.reduce((s, v) => s + (v - m) ** 2, 0) / (valores.length - 1));
}

/** Soma dos pesos de dia útil entre duas datas (inclusive). */
function pesoDoPeriodo(de, ate) {
  let total = 0;
  let d = de;
  let guarda = 0;
  while (d <= ate && guarda < 500) {
    total += dayWeight(d);
    d = addDays(d, 1);
    guarda += 1;
  }
  return total;
}

/** Aplica só os filtros de dimensão (o período é decidido por cada análise). */
function dimensoes(flt) {
  return (f) => {
    if (flt.vendedor && !flt.vendedor.includes(f.vendedor)) return false;
    if (flt.equipe && !flt.equipe.includes(f.equipe)) return false;
    if (flt.tecnologia && !flt.tecnologia.includes(f.tecnologia)) return false;
    if (flt.situacao && !flt.situacao.includes(f.situacao)) return false;
    if (flt.cidade && !flt.cidade.includes(f.cidade)) return false;
    if (flt.canal && !flt.canal.includes(f.canal)) return false;
    return true;
  };
}

// ------------------------------------------------- 1. projeção do mês atual
function projecao(fatos, hoje) {
  const inicio = startOfMonth(hoje);
  const fim = endOfMonth(hoje);
  const decorrido = pesoDoPeriodo(inicio, hoje);
  const totalMes = pesoDoPeriodo(inicio, fim);

  const doMes = fatos.filter((f) => f.dtVenda >= inicio && f.dtVenda <= hoje);
  const realizado = doMes.length;

  // ritmo diário de cada dia útil, para medir a variabilidade
  const porDia = new Map();
  for (const f of doMes) porDia.set(f.dtVenda, (porDia.get(f.dtVenda) || 0) + 1);
  const ritmos = [...porDia.entries()]
    .filter(([d]) => dayWeight(d) > 0)
    .map(([d, q]) => q / dayWeight(d));

  const ritmo = decorrido > 0 ? realizado / decorrido : 0;
  const restante = Math.max(0, totalMes - decorrido);
  const projetado = Math.round(realizado + ritmo * restante);
  // margem: desvio do ritmo diário propagado pelos dias que faltam
  const margem = Math.round(desvioPadrao(ritmos) * Math.sqrt(Math.max(restante, 0)));

  // mesmo ponto do mês anterior e fechamento dele
  const inicioAnterior = startOfMonth(addDays(inicio, -1));
  const fimAnterior = endOfMonth(inicioAnterior);
  const pesoIgual = decorrido;
  let acumulado = 0;
  let ateOndeAnterior = inicioAnterior;
  let d = inicioAnterior;
  while (d <= fimAnterior && acumulado < pesoIgual) {
    acumulado += dayWeight(d);
    ateOndeAnterior = d;
    d = addDays(d, 1);
  }
  const anteriorMesmoPonto = fatos.filter((f) => f.dtVenda >= inicioAnterior && f.dtVenda <= ateOndeAnterior).length;
  const anteriorFechado = fatos.filter((f) => f.dtVenda >= inicioAnterior && f.dtVenda <= fimAnterior).length;

  return {
    mes: monthKey(hoje),
    realizado,
    projetado,
    margem,
    ritmoDiario: Number(ritmo.toFixed(2)),
    diasUteisDecorridos: Number(decorrido.toFixed(1)),
    diasUteisTotais: Number(totalMes.toFixed(1)),
    percentualDecorrido: totalMes ? Math.round((decorrido / totalMes) * 100) : 0,
    anteriorMesmoPonto,
    anteriorFechado,
    variacaoMesmoPonto: anteriorMesmoPonto
      ? Number((((realizado - anteriorMesmoPonto) / anteriorMesmoPonto) * 100).toFixed(1)) : null,
    variacaoProjetada: anteriorFechado
      ? Number((((projetado - anteriorFechado) / anteriorFechado) * 100).toFixed(1)) : null,
  };
}

// -------------------------------------------- 2. funil, defasagem e coortes
function funil(fatos, hoje) {
  const limite = addDays(hoje, -180);
  const recentes = fatos.filter((f) => f.dtVenda >= limite);

  const lagAtivacao = recentes
    .filter((f) => f.dtAtiv && f.dtVenda)
    .map((f) => diffDays(f.dtVenda, f.dtAtiv))
    .filter((d) => d !== null && d >= 0 && d < 365);

  const lagPagamento = recentes
    .filter((f) => f.dtAtiv && f.dtPagto)
    .map((f) => diffDays(f.dtAtiv, f.dtPagto))
    .filter((d) => d !== null && d >= 0 && d < 365);

  // conversão por coorte de venda (só coortes maduras: > p90 de dias)
  const p90Ativ = Math.round(percentil(lagAtivacao, 0.9) ?? 30);
  const p90Pag = Math.round(percentil(lagPagamento, 0.9) ?? 45);

  const coortes = new Map();
  for (const f of fatos) {
    const k = monthKey(f.dtVenda);
    if (!k || k < monthKey(addDays(hoje, -400))) continue;
    const c = coortes.get(k) || { mes: k, vendas: 0, ativados: 0, pagantes: 0 };
    c.vendas += 1;
    if (f.dtAtiv) c.ativados += 1;
    if (f.dtPagto) c.pagantes += 1;
    coortes.set(k, c);
  }
  const lista = [...coortes.values()]
    .sort((a, b) => a.mes.localeCompare(b.mes))
    .map((c) => ({
      ...c,
      taxaAtivacao: c.vendas ? Number(((c.ativados / c.vendas) * 100).toFixed(1)) : 0,
      taxaPagamento: c.ativados ? Number(((c.pagantes / c.ativados) * 100).toFixed(1)) : 0,
      // a coorte só é comparável depois de decorrido o prazo típico
      madura: diffDays(endOfMonth(`${c.mes}-01`), hoje) >= p90Ativ + p90Pag,
    }));

  const maduras = lista.filter((c) => c.madura);
  const ultimas3 = maduras.slice(-3);
  const anteriores3 = maduras.slice(-6, -3);
  const mediaAtiv = (arr) => (arr.length ? media(arr.map((c) => c.taxaAtivacao)) : null);
  const mediaPag = (arr) => (arr.length ? media(arr.map((c) => c.taxaPagamento)) : null);

  return {
    lagAtivacao: {
      mediana: Math.round(mediana(lagAtivacao) ?? 0),
      p90: p90Ativ,
      amostra: lagAtivacao.length,
    },
    lagPagamento: {
      mediana: Math.round(mediana(lagPagamento) ?? 0),
      p90: p90Pag,
      amostra: lagPagamento.length,
    },
    coortes: lista,
    tendenciaAtivacao: ultimas3.length && anteriores3.length
      ? Number((mediaAtiv(ultimas3) - mediaAtiv(anteriores3)).toFixed(1)) : null,
    tendenciaPagamento: ultimas3.length && anteriores3.length
      ? Number((mediaPag(ultimas3) - mediaPag(anteriores3)).toFixed(1)) : null,
  };
}

// ------------------------------------------------------ 3. carteira em risco
function riscos(fatos, hoje, prazos) {
  const cancelado = (f) => String(f.statusContrato).toLowerCase().includes('cancel');

  const semAtivar = fatos.filter((f) => !f.dtAtiv && !cancelado(f)
    && diffDays(f.dtVenda, hoje) > prazos.p90Ativ
    && diffDays(f.dtVenda, hoje) < 365);

  const semPagar = fatos.filter((f) => f.dtAtiv && !f.dtPagto && !cancelado(f)
    && diffDays(f.dtAtiv, hoje) > prazos.p90Pag
    && diffDays(f.dtAtiv, hoje) < 365);

  const agrupa = (lista, chave) => {
    const m = new Map();
    for (const f of lista) {
      const k = f[chave] || '(sem informação)';
      m.set(k, (m.get(k) || 0) + 1);
    }
    return [...m].map(([nome, qtd]) => ({ nome, qtd })).sort((a, b) => b.qtd - a.qtd).slice(0, 8);
  };

  const amostra = (lista, campoData) => lista
    .slice()
    .sort((a, b) => (a[campoData] || '').localeCompare(b[campoData] || ''))
    .slice(0, 25)
    .map((f) => ({
      contrato: f.contrato,
      cliente: f.cliente,
      vendedor: f.vendedor,
      cidade: f.cidade,
      tecnologia: f.tecnologia,
      valor: f.valor,
      data: f[campoData],
      diasParado: diffDays(f[campoData], hoje),
    }));

  return {
    semAtivar: {
      total: semAtivar.length,
      valor: Number(semAtivar.reduce((s, f) => s + (Number(f.valor) || 0), 0).toFixed(2)),
      prazo: prazos.p90Ativ,
      porVendedor: agrupa(semAtivar, 'vendedor'),
      porCidade: agrupa(semAtivar, 'cidade'),
      casos: amostra(semAtivar, 'dtVenda'),
    },
    semPagar: {
      total: semPagar.length,
      valor: Number(semPagar.reduce((s, f) => s + (Number(f.valor) || 0), 0).toFixed(2)),
      prazo: prazos.p90Pag,
      porVendedor: agrupa(semPagar, 'vendedor'),
      porCidade: agrupa(semPagar, 'cidade'),
      casos: amostra(semPagar, 'dtAtiv'),
    },
  };
}

// ------------------------------------------------- 4. tendência por vendedor
function tendencias(fatos, hoje) {
  const inicioRecente = addDays(hoje, -13);
  const inicioBase = addDays(hoje, -55);
  const fimBase = addDays(hoje, -14);
  const pesoRecente = pesoDoPeriodo(inicioRecente, hoje);
  const pesoBase = pesoDoPeriodo(inicioBase, fimBase);

  const m = new Map();
  for (const f of fatos) {
    if (!f.vendedor) continue;
    const r = m.get(f.vendedor) || { vendedor: f.vendedor, equipe: f.equipe, recente: 0, base: 0 };
    if (f.dtVenda >= inicioRecente && f.dtVenda <= hoje) r.recente += 1;
    else if (f.dtVenda >= inicioBase && f.dtVenda <= fimBase) r.base += 1;
    m.set(f.vendedor, r);
  }

  const lista = [...m.values()]
    .map((r) => {
      const ritmoRecente = pesoRecente ? r.recente / pesoRecente : 0;
      const ritmoBase = pesoBase ? r.base / pesoBase : 0;
      const variacao = ritmoBase > 0 ? ((ritmoRecente - ritmoBase) / ritmoBase) * 100 : null;
      return {
        ...r,
        ritmoRecente: Number(ritmoRecente.toFixed(2)),
        ritmoBase: Number(ritmoBase.toFixed(2)),
        variacao: variacao === null ? null : Number(variacao.toFixed(1)),
      };
    })
    // corta o ruído: quem tinha menos de 5 vendas na base não gera sinal
    .filter((r) => r.base >= 5);

  const emQueda = lista.filter((r) => r.variacao !== null && r.variacao <= -30)
    .sort((a, b) => a.variacao - b.variacao);
  const emAlta = lista.filter((r) => r.variacao !== null && r.variacao >= 30)
    .sort((a, b) => b.variacao - a.variacao);
  const pararam = lista.filter((r) => r.recente === 0);

  return {
    janelaRecente: `${inicioRecente} a ${hoje}`,
    janelaBase: `${inicioBase} a ${fimBase}`,
    avaliados: lista.length,
    emQueda: emQueda.slice(0, 12),
    emAlta: emAlta.slice(0, 8),
    pararam: pararam.slice(0, 12),
  };
}

// ------------------------------------------------ 5. previsão dos novatos
function novatos(fatos, hoje) {
  const estado = getState();
  // só quem está no time comercial: o RH traz admissões de toda a empresa, e
  // suporte/administrativo entrando na lista distorceria a referência
  const emRampagem = [...estado.sellersByName.values()]
    .filter((s) => estado.teamsByName.has(s.vendedor))
    .filter((s) => s.admissaoReal && s.admissaoReal <= hoje && s.dataApos90 >= hoje);

  // referência: quantas vendas os veteranos fizeram nos 90 primeiros dias
  const historico = [];
  for (const s of estado.sellersByName.values()) {
    if (!estado.teamsByName.has(s.vendedor)) continue;
    if (!s.admissaoReal || s.dataApos90 >= hoje) continue;
    if (s.admissaoReal < addDays(hoje, -540)) continue;
    const n = fatos.filter((f) => f.vendedor === s.vendedor
      && f.dtVenda >= s.admissaoReal && f.dtVenda <= s.dataApos90).length;
    if (n > 0) historico.push(n);
  }
  const referencia = Math.round(mediana(historico) ?? 0);

  const lista = emRampagem.map((s) => {
    const vendas = fatos.filter((f) => f.vendedor === s.vendedor
      && f.dtVenda >= s.admissaoReal && f.dtVenda <= hoje).length;
    const decorrido = pesoDoPeriodo(s.admissaoReal, hoje);
    const total = pesoDoPeriodo(s.admissaoReal, s.dataApos90);
    const ritmo = decorrido > 0 ? vendas / decorrido : 0;
    const projetado = Math.round(ritmo * total);
    return {
      vendedor: s.vendedor,
      equipe: estado.teamsByName.get(s.vendedor)?.equipe || '',
      admissao: s.admissaoReal,
      fimRampagem: s.dataApos90,
      diasRestantes: diffDays(hoje, s.dataApos90),
      vendas,
      projetado,
      referencia,
      // relação com a mediana histórica: 1 = no ritmo esperado
      indice: referencia ? Number((projetado / referencia).toFixed(2)) : null,
    };
  }).sort((a, b) => (a.indice ?? 9) - (b.indice ?? 9));

  return {
    referencia,
    amostraHistorica: historico.length,
    total: lista.length,
    abaixo: lista.filter((n) => n.indice !== null && n.indice < 0.7).length,
    lista,
  };
}

// ------------------------------------------------------- 6. sazonalidade
function sazonalidade(fatos, hoje) {
  const limite = addDays(hoje, -180);
  const nomes = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];
  const soma = Array(7).fill(0);
  const dias = Array(7).fill(0);
  const vistos = new Set();
  for (const f of fatos) {
    if (!f.dtVenda || f.dtVenda < limite || f.dtVenda > hoje) continue;
    const dow = new Date(`${f.dtVenda}T00:00:00Z`).getUTCDay();
    soma[dow] += 1;
    if (!vistos.has(f.dtVenda)) {
      vistos.add(f.dtVenda);
      dias[dow] += 1;
    }
  }
  return nomes.map((nome, i) => ({
    dia: nome,
    media: dias[i] ? Number((soma[i] / dias[i]).toFixed(1)) : 0,
    total: soma[i],
  }));
}

// -------------------------------------------------- 7. cancelamento precoce
function cancelamento(fatos, hoje) {
  const cancelado = (f) => String(f.statusContrato).toLowerCase().includes('cancel');
  const coortes = new Map();
  for (const f of fatos) {
    const k = monthKey(f.dtVenda);
    if (!k || k < monthKey(addDays(hoje, -400))) continue;
    const c = coortes.get(k) || { mes: k, vendas: 0, cancelados: 0 };
    c.vendas += 1;
    if (cancelado(f)) c.cancelados += 1;
    coortes.set(k, c);
  }
  const lista = [...coortes.values()]
    .sort((a, b) => a.mes.localeCompare(b.mes))
    .map((c) => ({ ...c, taxa: c.vendas ? Number(((c.cancelados / c.vendas) * 100).toFixed(1)) : 0 }));

  const motivos = new Map();
  for (const f of fatos) {
    if (!cancelado(f) || !f.statusCancelamento) continue;
    if (f.dtVenda < addDays(hoje, -180)) continue;
    motivos.set(f.statusCancelamento, (motivos.get(f.statusCancelamento) || 0) + 1);
  }

  return {
    coortes: lista,
    motivos: [...motivos].map(([motivo, qtd]) => ({ motivo, qtd }))
      .sort((a, b) => b.qtd - a.qtd).slice(0, 8),
  };
}

// ------------------------------------------------------- 8. concentração
function concentracao(fatos, hoje) {
  const limite = addDays(hoje, -90);
  const m = new Map();
  for (const f of fatos) {
    if (f.dtVenda < limite || !f.vendedor) continue;
    m.set(f.vendedor, (m.get(f.vendedor) || 0) + 1);
  }
  const ord = [...m.values()].sort((a, b) => b - a);
  const total = ord.reduce((a, b) => a + b, 0);
  const fatia = (n) => (total ? Number(((ord.slice(0, n).reduce((a, b) => a + b, 0) / total) * 100).toFixed(1)) : 0);
  return {
    vendedoresAtivos: ord.length,
    total,
    top5: fatia(5),
    top10: fatia(10),
    top20: fatia(20),
  };
}

// ---------------------------------------------------------------- fachada
export function analisar(flt) {
  const hoje = today();
  const passa = dimensoes(flt);
  const fatos = getState().facts.filter((f) => f.dtVenda && passa(f));

  const f = funil(fatos, hoje);
  const prazos = { p90Ativ: f.lagAtivacao.p90, p90Pag: f.lagPagamento.p90 };

  return {
    geradoEm: new Date().toISOString(),
    hoje,
    universo: fatos.length,
    projecao: projecao(fatos, hoje),
    funil: f,
    riscos: riscos(fatos, hoje, prazos),
    tendencias: tendencias(fatos, hoje),
    novatos: novatos(fatos, hoje),
    sazonalidade: sazonalidade(fatos, hoje),
    cancelamento: cancelamento(fatos, hoje),
    concentracao: concentracao(fatos, hoje),
  };
}

/**
 * Resumo enxuto para mandar à IA. Sem nomes de clientes — o modelo não precisa
 * deles para interpretar, e é dado pessoal saindo para fora da rede.
 */
export function resumoParaIA(a) {
  return {
    hoje: a.hoje,
    contratosNaAnalise: a.universo,
    projecaoDoMes: a.projecao,
    funil: {
      diasAteAtivar: a.funil.lagAtivacao,
      diasAtePrimeiroPagamento: a.funil.lagPagamento,
      coortesRecentes: a.funil.coortes.slice(-8),
      variacaoTaxaAtivacao: a.funil.tendenciaAtivacao,
      variacaoTaxaPagamento: a.funil.tendenciaPagamento,
    },
    carteiraEmRisco: {
      semAtivar: {
        total: a.riscos.semAtivar.total,
        valor: a.riscos.semAtivar.valor,
        prazoConsiderado: a.riscos.semAtivar.prazo,
        concentracaoPorVendedor: a.riscos.semAtivar.porVendedor,
        concentracaoPorCidade: a.riscos.semAtivar.porCidade,
      },
      semPagar: {
        total: a.riscos.semPagar.total,
        valor: a.riscos.semPagar.valor,
        prazoConsiderado: a.riscos.semPagar.prazo,
        concentracaoPorVendedor: a.riscos.semPagar.porVendedor,
      },
    },
    tendenciaVendedores: {
      avaliados: a.tendencias.avaliados,
      emQueda: a.tendencias.emQueda.slice(0, 8),
      emAlta: a.tendencias.emAlta.slice(0, 5),
      pararamDeVender: a.tendencias.pararam.slice(0, 8),
    },
    novatosEmRampagem: {
      referenciaHistorica: a.novatos.referencia,
      total: a.novatos.total,
      abaixoDoEsperado: a.novatos.abaixo,
      piores: a.novatos.lista.slice(0, 6),
    },
    sazonalidadeSemanal: a.sazonalidade,
    cancelamento: a.cancelamento,
    concentracaoDaOperacao: a.concentracao,
  };
}
