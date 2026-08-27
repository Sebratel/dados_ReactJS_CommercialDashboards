/**
 * Equivalentes em JS das medidas DAX do modelo "COM - Gestão Comercial".
 * Cada projeção (vendas / ativos / pagantes) usa a SUA data, exatamente como
 * os relacionamentos do Power BI com a tabela calendar.
 */
import { dayWeight } from './holidays.js';
import { getState } from './store.js';
import { addDays, diffDays, endOfMonth, monthKey, startOfNextMonth, tempoContrato, today } from './dates.js';

export const DATE_FIELD = {
  vendas: 'dtVenda',
  ativos: 'dtAtiv',
  pagantes: 'dtPagto',
};

const asArray = (v) => {
  if (v === undefined || v === null || v === '') return null;
  const arr = Array.isArray(v) ? v : String(v).split(',');
  const out = arr.map((s) => String(s).trim()).filter(Boolean);
  return out.length ? out : null;
};

/**
 * Valor que nenhum registro possui, usado quando o escopo da pessoa não permite
 * nada do que ela pediu. Existe porque `asArray('')` devolve null, e null aqui
 * significa "sem filtro": um escopo vazio escrito como string vazia abriria a
 * base inteira em vez de fechá-la. Falhar fechado tem que ser explícito.
 */
export const EQUIPE_INEXISTENTE = '__sem-acesso__';

export function parseFilters(q = {}) {
  return {
    de: q.de || null,
    ate: q.ate || null,
    vendedor: asArray(q.vendedor),
    equipe: asArray(q.equipe),
    tecnologia: asArray(q.tecnologia),
    situacao: asArray(q.situacao),
    cidade: asArray(q.cidade),
    canal: asArray(q.canal),
    cliente: q.cliente ? String(q.cliente).trim().toUpperCase() : null,
    vendedorAtivo: q.vendedorAtivo || null, // 'TRUE' | 'FALSE'
  };
}

function matchDims(f, flt) {
  if (flt.vendedor && !flt.vendedor.includes(f.vendedor)) return false;
  if (flt.equipe && !flt.equipe.includes(f.equipe)) return false;
  if (flt.tecnologia && !flt.tecnologia.includes(f.tecnologia)) return false;
  if (flt.situacao && !flt.situacao.includes(f.situacao)) return false;
  if (flt.cidade && !flt.cidade.includes(f.cidade)) return false;
  if (flt.canal && !flt.canal.includes(f.canal)) return false;
  if (flt.vendedorAtivo && String(f.vendedorAtivo).toUpperCase() !== flt.vendedorAtivo.toUpperCase()) return false;
  if (flt.cliente && !f.cliente.toUpperCase().includes(flt.cliente)) return false;
  return true;
}

/**
 * Cópia do filtro sem UM campo.
 *
 * É a base do cross-highlight: o visual que MOSTRA um campo não pode ser calculado
 * com o filtro daquele campo aplicado, senão ele colapsa na categoria clicada. O
 * gráfico de cidades continua mostrando todas as cidades — recortadas por vendedor,
 * por tecnologia e pelo período, só não por cidade.
 */
export const semCampo = (flt, campo) => (flt[campo] ? { ...flt, [campo]: null } : flt);

/**
 * Linhas de um dataset ignorando um campo do filtro.
 *
 * `jaFiltrada` é a lista com o filtro CHEIO, que o painel já calculou. Quando o campo
 * não está filtrado as duas listas são idênticas, então devolvemos a que já existe: a
 * varredura extra só acontece quando há clique naquela dimensão. É isso que segura o
 * custo do cross-highlight em uma varredura por dimensão CLICADA, e não uma por visual
 * da tela — sem filtro nenhum, a tela custa exatamente o que custava antes.
 */
export function rowsExceto(dataset, flt, campo, jaFiltrada) {
  if (!flt[campo]) return jaFiltrada;
  return rows(dataset, semCampo(flt, campo));
}

/** Linhas de um dataset (vendas/ativos/pagantes) já filtradas. */
export function rows(dataset, flt) {
  const field = DATE_FIELD[dataset];
  const { de, ate } = flt;
  const out = [];
  for (const f of getState().facts) {
    const d = f[field];
    if (!d) continue;
    if (de && d < de) continue;
    if (ate && d > ate) continue;
    if (!matchDims(f, flt)) continue;
    out.push(f);
  }
  return out;
}

/** MEDIA VENDAS / MEDIA ATIVOS: média ponderada por dia útil. */
export function mediaPonderada(list, field) {
  const porDia = new Map();
  for (const f of list) {
    const d = f[field];
    if (!d) continue;
    porDia.set(d, (porDia.get(d) || 0) + 1);
  }
  let num = 0;
  let den = 0;
  for (const [d, qtd] of porDia) {
    const w = dayWeight(d);
    num += qtd * w;
    den += w;
  }
  return den > 0 ? num / den : 0;
}

export function soma(list, field = 'valor') {
  let t = 0;
  for (const f of list) t += Number(f[field]) || 0;
  return t;
}

/** Agrupamento genérico por chave, devolvendo [{ key, valor, ... }] ordenado. */
export function groupCount(list, keyFn, {
  limit = null, sortBy = 'valor', desc = true, garantir = null,
} = {}) {
  const map = new Map();
  for (const f of list) {
    const k = keyFn(f);
    if (k === null || k === undefined || k === '') continue;
    map.set(k, (map.get(k) || 0) + 1);
  }
  let out = [...map].map(([key, valor]) => ({ key, valor }));
  out.sort((a, b) => (desc ? b[sortBy] - a[sortBy] : a[sortBy] - b[sortBy]) || String(a.key).localeCompare(String(b.key), 'pt-BR'));
  if (limit) {
    const cabeca = out.slice(0, limit);
    /**
     * `garantir` fixa na lista os valores que estão CLICADOS, mesmo fora do topo N.
     * Sem isso, clicar numa cidade que ocupa a 18ª posição a tirava de um gráfico de
     * 15 barras: a tela ficava filtrada por algo que não aparecia em lugar nenhum, e
     * a única pista era o chip. Valor clicado que existe na lista sempre aparece.
     */
    if (garantir && garantir.length) {
      const dentro = new Set(cabeca.map((o) => String(o.key)));
      for (const g of garantir) {
        if (dentro.has(String(g))) continue;
        const achado = out.find((o) => String(o.key) === String(g));
        if (achado) cabeca.push(achado);
      }
    }
    out = cabeca;
  }
  return out;
}

/** Série mensal de um dataset. */
export function serieMensal(list, field) {
  const map = new Map();
  for (const f of list) {
    const k = monthKey(f[field]);
    if (!k) continue;
    const cur = map.get(k) || { mes: k, qtd: 0, valor: 0 };
    cur.qtd += 1;
    cur.valor += Number(f.valor) || 0;
    map.set(k, cur);
  }
  return [...map.values()].sort((a, b) => a.mes.localeCompare(b.mes));
}

/**
 * Série por mês ou por dia — o eixo dos gráficos de coluna.
 * Devolve sempre { periodo, qtd, valor } para o front tratar igual.
 */
export function serie(list, field, granularidade = 'mes') {
  const porDia = granularidade === 'dia';
  const map = new Map();
  for (const f of list) {
    const d = f[field];
    if (!d) continue;
    const k = porDia ? d : monthKey(d);
    const cur = map.get(k) || { periodo: k, qtd: 0, valor: 0 };
    cur.qtd += 1;
    cur.valor += Number(f.valor) || 0;
    map.set(k, cur);
  }
  return [...map.values()].sort((a, b) => a.periodo.localeCompare(b.periodo));
}

/** Lê ?g=dia|mes (padrão: mês). */
export function parseGranularidade(q = {}) {
  return q.g === 'dia' ? 'dia' : 'mes';
}

/** Série diária de um dataset. */
export function serieDiaria(list, field) {
  const map = new Map();
  for (const f of list) {
    const d = f[field];
    if (!d) continue;
    const cur = map.get(d) || { dia: d, qtd: 0, valor: 0 };
    cur.qtd += 1;
    cur.valor += Number(f.valor) || 0;
    map.set(d, cur);
  }
  return [...map.values()].sort((a, b) => a.dia.localeCompare(b.dia));
}

/** Série diária empilhada por tecnologia (gráfico "TOTAL DE VENDAS / DIA"). */
export function serieDiariaPorTecnologia(list, field, destacar = null) {
  const map = new Map();
  for (const f of list) {
    const d = f[field];
    if (!d) continue;
    const cur = map.get(d) || { dia: d, FIBRA: 0, 'RÁDIO': 0, TELEFONIA: 0, total: 0 };
    const tec = f.tecnologia in cur ? f.tecnologia : 'FIBRA';
    cur[tec] += 1;
    // mesma regra do `seriePorTecnologia`: o rótulo do topo acompanha a seleção
    if (!destacar || !destacar.length || destacar.includes(tec)) cur.total += 1;
    map.set(d, cur);
  }
  return [...map.values()].sort((a, b) => a.dia.localeCompare(b.dia));
}

/**
 * Série por período com as colunas separadas por tecnologia.
 *
 * Existe por causa da divergência com o Power BI nas ativações: a fórmula do
 * relatório manda contar a ativação de telefonia, mas a tela dele não as mostra.
 * Separando as faixas, o total continua completo e a parte de fibra/rádio fica
 * diretamente comparável ao relatório antigo, sem esconder nem inflar nada.
 */
export function seriePorTecnologia(list, field, granularidade = 'mes', destacar = null) {
  const map = new Map();
  for (const f of list) {
    const d = f[field];
    if (!d) continue;
    const periodo = granularidade === 'dia' ? d : monthKey(d);
    const cur = map.get(periodo) || {
      periodo, FIBRA: 0, 'RÁDIO': 0, TELEFONIA: 0, total: 0, valor: 0,
    };
    const tec = f.tecnologia in cur ? f.tecnologia : 'FIBRA';
    cur[tec] += 1;
    // `total` é o rótulo em cima da coluna, e ele acompanha a SELEÇÃO: com FIBRA
    // clicada as três faixas continuam desenhadas (as outras esmaecidas), mas o número
    // no topo é o da fibra. Sem isso o rótulo brigava com o cartão de KPI, que é
    // filtrado — dois números da mesma coisa discordando na mesma tela.
    if (!destacar || !destacar.length || destacar.includes(tec)) cur.total += 1;
    cur.valor += Number(f.valor) || 0;
    map.set(periodo, cur);
  }
  return [...map.values()].sort((a, b) => a.periodo.localeCompare(b.periodo));
}

/** Tabela por vendedor com total, média/dia, equipe e sparkline mensal. */
export function porVendedor(list, field, { sparkBy = 'mes' } = {}) {
  const map = new Map();
  for (const f of list) {
    const v = f.vendedor || '(sem vendedor)';
    let cur = map.get(v);
    if (!cur) {
      cur = { vendedor: v, equipe: f.equipe, situacao: f.situacao, total: 0, valor: 0, linhas: [], spark: new Map() };
      map.set(v, cur);
    }
    cur.total += 1;
    cur.valor += Number(f.valor) || 0;
    cur.linhas.push(f);
    const k = sparkBy === 'dia' ? f[field] : monthKey(f[field]);
    cur.spark.set(k, (cur.spark.get(k) || 0) + 1);
  }
  return [...map.values()]
    .map((r) => ({
      vendedor: r.vendedor,
      equipe: r.equipe,
      situacao: r.situacao,
      total: r.total,
      valor: r.valor,
      media: mediaPonderada(r.linhas, field),
      spark: [...r.spark].sort((a, b) => a[0].localeCompare(b[0])).map(([k, v]) => ({ k, v })),
    }))
    .sort((a, b) => b.total - a.total || a.vendedor.localeCompare(b.vendedor, 'pt-BR'));
}

/**
 * Matriz vendedor x dia (páginas "HISTÓRICO").
 * `granularidade`: 'dia' | 'mes' — em períodos longos o agrupamento por mês
 * evita centenas de colunas (e um payload enorme).
 */
export function matriz(list, field, granularidade = 'dia') {
  const colunas = new Set();
  const map = new Map();
  const chave = granularidade === 'mes' ? (d) => d.slice(0, 7) : (d) => d;
  for (const f of list) {
    const d = f[field] && chave(f[field]);
    if (!d) continue;
    colunas.add(d);
    const v = f.vendedor || '(sem vendedor)';
    let linha = map.get(v);
    if (!linha) {
      linha = { vendedor: v, equipe: f.equipe, total: 0, dias: {} };
      map.set(v, linha);
    }
    linha.dias[d] = (linha.dias[d] || 0) + 1;
    linha.total += 1;
  }
  const cols = [...colunas].sort();
  const linhas = [...map.values()].sort((a, b) => b.total - a.total || a.vendedor.localeCompare(b.vendedor, 'pt-BR'));
  const totalPorDia = {};
  for (const c of cols) totalPorDia[c] = linhas.reduce((acc, l) => acc + (l.dias[c] || 0), 0);
  return {
    colunas: cols,
    linhas,
    totalPorDia,
    total: linhas.reduce((acc, l) => acc + l.total, 0),
  };
}

// ---------------------------------------------------------------------------
// PREMIAÇÕES — faixas de premiação (medidas ValorFaixa / FaixaPorPagamento…)
// ---------------------------------------------------------------------------
const FAIXAS_INTERNO = [
  [260, 3393, 8], [230, 3120, 7], [210, 2530, 6], [190, 2100, 5],
  [160, 1520, 4], [130, 1120, 3], [100, 780, 2],
];
const FAIXAS_EXTERNO = [
  [60, 2745, 13], [55, 2520, 12], [50, 2295, 11], [45, 2070, 10], [40, 1845, 9],
  [35, 1620, 8], [30, 1395, 7], [25, 1200, 6], [20, 1000, 5], [15, 600, 4],
  [12, 300, 3], [10, 150, 2],
];

/**
 * @param {number} dias   quantidade de pagamentos (ou ativações) do vendedor
 * @param {string} situacao 'Interno' | 'Externo'
 * @param {string|null} tecnologia tecnologia única selecionada no filtro
 */
export function faixaPremiacao(dias, situacao, tecnologia) {
  const interno = String(situacao).toLowerCase() === 'interno';
  if (String(tecnologia).toUpperCase() === 'TELEFONIA') {
    const taxa = interno ? 4.5 : 7.5;
    const valor = dias <= 1 ? 0 : taxa * dias;
    const faixa = dias <= 1
      ? `Faixa Telefonia ${interno ? 'Interno' : 'Externo'} 1`
      : `Faixa Telefonia ${interno ? 'Interno' : 'Externo'} ${taxa * dias}`;
    return { valor, faixa, numero: null };
  }
  const tabela = interno ? FAIXAS_INTERNO : FAIXAS_EXTERNO;
  for (const [min, valor, numero] of tabela) {
    if (dias > min) return { valor, faixa: `Faixa ${interno ? 'Interno' : 'Externo'} ${numero}`, numero };
  }
  return { valor: 0, faixa: `Faixa ${interno ? 'Interno' : 'Externo'} 1`, numero: 1 };
}

/** ValorPorTempoDeCasa: bônus por tempo de casa (só Externo, faixa >= 4). */
export function bonusTempoDeCasa(faixa, admissaoReal, dataRef) {
  if (!admissaoReal) return null;
  if (!faixa.faixa.startsWith('Faixa Externo') || !faixa.numero || faixa.numero < 4) return 0;
  const dias = diffDays(admissaoReal, dataRef);
  if (dias === null) return 0;
  const meses = Math.trunc(dias / 30);
  if (meses >= 37) return 300;
  if (meses >= 25) return 200;
  if (meses >= 13) return 100;
  return 0;
}

/**
 * Grupo do vendedor na data de referência:
 *   MesViradaPagante > fim do mês de referência -> "Ativos (<=60 dias)"
 *   caso contrário                              -> "Pagantes (>60 dias)"
 */
export function grupoVendedor(seller, dataRef) {
  if (!seller?.mesVirada) return null;
  return seller.mesVirada > endOfMonth(dataRef) ? 'ativos' : 'pagantes';
}

export function premiacoes(flt) {
  const state = getState();
  const dataRef = flt.ate || today();
  const tecUnica = flt.tecnologia && flt.tecnologia.length === 1 ? flt.tecnologia[0] : null;

  const pagantes = rows('pagantes', flt);
  const ativos = rows('ativos', flt);

  const porVend = (list) => {
    const m = new Map();
    for (const f of list) m.set(f.vendedor, (m.get(f.vendedor) || 0) + 1);
    return m;
  };
  const qtdPagantes = porVend(pagantes);
  const qtdAtivos = porVend(ativos);

  const listaPagantes = [];
  const listaAtivos = [];

  // como no relatório: linhas vêm de teams[VENDEDORES] e são separadas pelo
  // GrupoVendedorDinâmico; quem não está no new_sellers (RH) fica de fora.
  for (const [nome, seller] of state.sellersByName) {
    const team = state.teamsByName.get(nome);
    if (!team) continue;
    // Diferença proposital em relação ao Power BI: só entra quem está marcado
    // ATIVO na Comercial_Teams. O corte do Senior (termination_date IS NULL) já
    // vale para todas as telas, mas quem foi recontratado volta a ter registro
    // em aberto e reaparecia aqui mesmo estando fora da operação comercial.
    // Premiação é dinheiro a pagar: o desligado não pode concorrer.
    if (!team.ativo) continue;
    if (flt.vendedor && !flt.vendedor.includes(nome)) continue;
    if (flt.equipe && !flt.equipe.includes(team.equipe)) continue;
    if (flt.situacao && !flt.situacao.includes(team.situacao)) continue;

    const grupo = grupoVendedor(seller, dataRef);
    const situacao = team.situacao || 'Externo';

    if (grupo === 'pagantes') {
      const dias = qtdPagantes.get(nome) || 0;
      if (dias > 0) {
        const faixa = faixaPremiacao(dias, situacao, tecUnica);
        const bonus = bonusTempoDeCasa(faixa, seller?.admissaoReal, dataRef);
        listaPagantes.push({
          vendedor: nome,
          equipe: team?.equipe || '',
          situacao,
          qtd: dias,
          valorFaixa: faixa.valor,
          faixa: faixa.faixa,
          valorTempoDeCasa: bonus,
          valorFinal: faixa.valor + (bonus || 0),
          tempoContrato: tempoContrato(seller?.admissaoReal, dataRef),
          admissaoSenior: seller?.admissaoSenior || null,
          admissao: seller?.dataInicio || null,
        });
      }
    }
    if (grupo === 'ativos') {
      // a tabela dos <=60 dias não filtra por quantidade: o novato aparece
      // mesmo sem ativações no período
      const dias = qtdAtivos.get(nome) || 0;
      {
        const faixa = faixaPremiacao(dias, situacao, tecUnica);
        listaAtivos.push({
          vendedor: nome,
          equipe: team?.equipe || '',
          situacao,
          qtd: dias,
          valorFaixa: faixa.valor,
          faixa: faixa.faixa,
          mesVirada: seller?.mesVirada || null,
          tempoContrato: tempoContrato(seller?.admissaoReal, dataRef),
          admissaoSenior: seller?.admissaoSenior || null,
          admissao: seller?.dataInicio || null,
        });
      }
    }
  }

  const sort = (a, b) => b.valorFaixa - a.valorFaixa || b.qtd - a.qtd || a.vendedor.localeCompare(b.vendedor, 'pt-BR');
  return {
    dataRef,
    tecnologia: tecUnica,
    pagantes: listaPagantes.sort(sort),
    ativos: listaAtivos.sort(sort),
    totalPagantes: listaPagantes.reduce((a, r) => a + r.valorFinal, 0),
    totalAtivos: listaAtivos.reduce((a, r) => a + r.valorFaixa, 0),
  };
}

// ---------------------------------------------------------------------------
// RAMPAGEM — vendedores nos primeiros 90 dias
// ---------------------------------------------------------------------------
export function rampagem(flt, granularidade = 'mes') {
  const state = getState();
  const dataRef = flt.ate || today();

  // vendas/ativações dentro dos 90 dias de rampagem do vendedor
  const vendas = rows('vendas', flt).filter((f) => f.venda90 === 1);
  const ativos = rows('ativos', flt).filter((f) => f.ativo90 === 1);

  const map = new Map();
  const bump = (f, campo) => {
    const nome = f.vendedor;
    if (!nome) return;
    let r = map.get(nome);
    if (!r) {
      const seller = state.sellersByName.get(nome);
      const team = state.teamsByName.get(nome);
      r = {
        vendedor: nome,
        equipe: team?.equipe || '',
        situacao: team?.situacao || '',
        admissaoReal: seller?.admissaoReal || null,
        dataApos90: seller?.dataApos90 || null,
        vendas: 0,
        ativos: 0,
        linhasVendas: [],
        linhasAtivos: [],
      };
      map.set(nome, r);
    }
    r[campo] += 1;
    r[campo === 'vendas' ? 'linhasVendas' : 'linhasAtivos'].push(f);
  };
  vendas.forEach((f) => bump(f, 'vendas'));
  ativos.forEach((f) => bump(f, 'ativos'));

  const tabela = [...map.values()].map((r) => {
    const diasContratado = r.admissaoReal ? diffDays(r.admissaoReal, dataRef) : null;
    let diasTrabalhados = 0;
    if (r.admissaoReal) {
      let d = r.admissaoReal;
      while (d <= dataRef) {
        diasTrabalhados += dayWeight(d);
        d = addDays(d, 1);
      }
    }
    return {
      vendedor: r.vendedor,
      equipe: r.equipe,
      situacao: r.situacao,
      admissaoReal: r.admissaoReal,
      dataApos90: r.dataApos90,
      vendas: r.vendas,
      ativos: r.ativos,
      mediaVendas: mediaPonderada(r.linhasVendas, 'dtVenda'),
      mediaAtivos: mediaPonderada(r.linhasAtivos, 'dtAtiv'),
      diasContratado,
      diasTrabalhados,
      spark: (() => {
        const m = new Map();
        for (const f of r.linhasVendas) m.set(monthKey(f.dtVenda), (m.get(monthKey(f.dtVenda)) || 0) + 1);
        return [...m].sort((a, b) => a[0].localeCompare(b[0])).map(([k, v]) => ({ k, v }));
      })(),
    };
  }).sort((a, b) => b.vendas - a.vendas || a.vendedor.localeCompare(b.vendedor, 'pt-BR'));

  const meses = new Map();
  for (const m of serie(vendas, 'dtVenda', granularidade)) {
    meses.set(m.periodo, { periodo: m.periodo, vendas: m.qtd, ativos: 0 });
  }
  for (const m of serie(ativos, 'dtAtiv', granularidade)) {
    const cur = meses.get(m.periodo) || { periodo: m.periodo, vendas: 0, ativos: 0 };
    cur.ativos = m.qtd;
    meses.set(m.periodo, cur);
  }

  // vendedores em rampagem (admitidos há <= 90 dias na data de referência)
  const novatos = [...state.sellersByName.values()]
    // o RH traz admissões da empresa toda; novato aqui é quem está no comercial
    .filter((s) => state.teamsByName.has(s.vendedor))
    .filter((s) => s.admissaoReal && s.admissaoReal <= dataRef && s.dataApos90 >= dataRef)
    .map((s) => ({
      vendedor: s.vendedor,
      equipe: state.teamsByName.get(s.vendedor)?.equipe || '',
      admissaoReal: s.admissaoReal,
      dataApos90: s.dataApos90,
      diasContratado: diffDays(s.admissaoReal, dataRef),
    }))
    .sort((a, b) => b.admissaoReal.localeCompare(a.admissaoReal));

  return {
    dataRef,
    granularidade,
    kpis: {
      vendas: vendas.length,
      ativos: ativos.length,
      novatos: novatos.length,
    },
    serie: [...meses.values()].sort((a, b) => a.periodo.localeCompare(b.periodo)),
    porCidade: groupCount(vendas, (f) => f.cidade, { limit: 15 }),
    tabela,
    novatos,
  };
}

export function qtdPagantesPorGrupo(flt) {
  const state = getState();
  const dataRef = flt.ate || today();
  const list = rows('pagantes', flt);
  let ativos = 0;
  let pagantes = 0;
  for (const f of list) {
    const seller = state.sellersByName.get(f.vendedor);
    if (grupoVendedor(seller, dataRef) === 'pagantes') pagantes += 1;
    else ativos += 1;
  }
  return { ativos, pagantes, virada: startOfNextMonth(dataRef) };
}
