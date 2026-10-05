/**
 * Os painéis da tela de CAMPANHAS.
 *
 * Quatro, espelhando as quatro páginas de dados do relatório de origem — visão
 * geral, Google, Meta e o detalhamento dos entrantes — mais o FUNIL, que é o que
 * o Power BI não consegue montar: lá as três tabelas não têm relação entre si,
 * só com o calendário.
 */
import { monthKey } from './dates.js';
import {
  atendimentosFiltrados, anunciosFiltrados, getEstadoCampanhas,
} from './campanhas.js';
import {
  FAMILIAS_RECRUTAMENTO, FAMILIA_ROTULO, PLATAFORMAS, chaveSemCidade, cruzar,
} from './vocabulario.js';

const soma = (l, f) => l.reduce((a, x) => a + (f(x) || 0), 0);
const div = (a, b) => (b ? a / b : 0);

/** Série mensal de uma lista, por uma data e um conjunto de somas. */
function porMes(lista, dataDe, medidas) {
  const m = new Map();
  for (const x of lista) {
    const d = dataDe(x);
    if (!d) continue;
    const k = monthKey(d);
    let cur = m.get(k);
    if (!cur) { cur = { periodo: k }; for (const n of Object.keys(medidas)) cur[n] = 0; m.set(k, cur); }
    for (const [n, f] of Object.entries(medidas)) cur[n] += f(x) || 0;
  }
  return [...m.values()].sort((a, b) => a.periodo.localeCompare(b.periodo));
}

/** Agrupa e conta, no formato que as tabelas da casa esperam. */
function contar(lista, chave, { limit = 0 } = {}) {
  const m = new Map();
  for (const x of lista) {
    const k = chave(x);
    if (k === null || k === undefined) continue;
    m.set(k, (m.get(k) || 0) + 1);
  }
  const out = [...m].map(([key, valor]) => ({ key, valor })).sort((a, b) => b.valor - a.valor);
  return limit ? out.slice(0, limit) : out;
}

/**
 * O FUNIL — uma linha por grupo de campanha (plataforma + família).
 *
 * POR QUE O GRUPO, E NÃO A CAMPANHA. Uma tag casa com várias campanhas: a
 * `marketing_alcance_meta_canoas` encontra as 29 campanhas de alcance que
 * rodaram no período, porque o Meta não separa alcance por cidade. Linha por
 * campanha obrigaria a partir o atendimento em 29 pedaços de 0,034 — número que
 * ninguém consegue conferir. Linha por grupo mantém atendimento inteiro.
 *
 * COMO O INVESTIMENTO É RATEADO. Uma campanha pode ser alcançada por mais de um
 * grupo (a campanha comercial do Meta é achada tanto pela tag sem cidade quanto
 * pelas seis com cidade). O gasto dela é dividido entre os grupos na proporção
 * dos atendimentos de cada um — assim a soma das linhas devolve o gasto real, e
 * não um múltiplo dele. Era o risco óbvio de somar sem pensar: com a campanha
 * comercial contada em sete grupos, o "investimento total" apareceria 7x maior.
 */
export function funil(flt) {
  const estado = getEstadoCampanhas();
  const atendimentos = atendimentosFiltrados(flt);
  const anuncios = anunciosFiltrados(flt);

  // gasto por campanha DENTRO do período filtrado (o índice é do período todo)
  const gastoDaCampanha = new Map();
  for (const a of anuncios) {
    const k = `${a.plataforma}|${a.campanhaId || a.campanha}`;
    let g = gastoDaCampanha.get(k);
    if (!g) { g = { investimento: 0, impressoes: 0, cliques: 0, resultados: 0, alcance: 0 }; gastoDaCampanha.set(k, g); }
    g.investimento += a.investimento;
    g.impressoes += a.impressoes;
    g.cliques += a.cliques;
    g.resultados += a.resultados;
    g.alcance += a.alcance;
  }

  // ---- 1ª passada: contar atendimentos por grupo e anotar as campanhas alcançadas
  const grupos = new Map();
  const grupoDe = (id) => {
    const k = chaveSemCidade(id);
    let g = grupos.get(k);
    if (!g) {
      g = {
        chave: k,
        plataforma: id.plataforma,
        familia: id.familia,
        rotulo: `${PLATAFORMAS[id.plataforma] || id.plataforma} · ${FAMILIA_ROTULO[id.familia] || id.familia}`,
        recrutamento: FAMILIAS_RECRUTAMENTO.has(id.familia),
        atendimentos: 0, vendas: 0, abandonos: 0,
        cidades: new Set(),
        campanhas: new Map(),   // chave da campanha -> confiança
        investimento: 0, impressoes: 0, cliques: 0, resultados: 0, alcance: 0,
      };
      grupos.set(k, g);
    }
    return g;
  };

  for (const at of atendimentos) {
    const vistos = new Set();
    for (const id of at.identidades) {
      const k = chaveSemCidade(id);
      if (vistos.has(k)) continue;   // duas tags do mesmo grupo não contam duas vezes
      vistos.add(k);
      const g = grupoDe(id);
      g.atendimentos += 1;
      if (at.venda) g.vendas += 1;
      if (at.abandono) g.abandonos += 1;
      if (id.cidade) g.cidades.add(id.cidade);
      const achou = cruzar(id, estado.indice);
      if (!achou) continue;
      for (const c of achou.campanhas) {
        const ck = `${c.plataforma}|${c.campanhaId || c.campanha}`;
        // fica a MELHOR confiança com que este grupo alcançou esta campanha
        const atual = g.campanhas.get(ck);
        if (!atual || ordemConfianca(achou.confianca) < ordemConfianca(atual)) {
          g.campanhas.set(ck, achou.confianca);
        }
      }
    }
  }

  // ---- 2ª passada: ratear o gasto de cada campanha entre os grupos que a alcançaram
  const pesoPorCampanha = new Map();
  for (const g of grupos.values()) {
    for (const ck of g.campanhas.keys()) {
      pesoPorCampanha.set(ck, (pesoPorCampanha.get(ck) || 0) + g.atendimentos);
    }
  }
  for (const g of grupos.values()) {
    for (const ck of g.campanhas.keys()) {
      const dados = gastoDaCampanha.get(ck);
      if (!dados) continue;              // campanha fora do período filtrado
      const peso = pesoPorCampanha.get(ck) || 0;
      const fatia = peso > 0 ? g.atendimentos / peso : 0;
      g.investimento += dados.investimento * fatia;
      g.impressoes += dados.impressoes * fatia;
      g.cliques += dados.cliques * fatia;
      g.resultados += dados.resultados * fatia;
      g.alcance += dados.alcance * fatia;
    }
  }

  const linhas = [...grupos.values()].map((g) => ({
    chave: g.chave,
    plataforma: g.plataforma,
    plataformaRotulo: PLATAFORMAS[g.plataforma] || g.plataforma,
    familia: g.familia,
    rotulo: g.rotulo,
    recrutamento: g.recrutamento,
    cidades: [...g.cidades].sort((a, b) => a.localeCompare(b, 'pt-BR')),
    investimento: g.investimento,
    impressoes: Math.round(g.impressoes),
    cliques: Math.round(g.cliques),
    resultados: Math.round(g.resultados),
    alcance: Math.round(g.alcance),
    atendimentos: g.atendimentos,
    vendas: g.vendas,
    abandonos: g.abandonos,
    conversao: div(g.vendas, g.atendimentos),
    abandono: div(g.abandonos, g.atendimentos),
    custoPorAtendimento: div(g.investimento, g.atendimentos),
    custoPorVenda: div(g.investimento, g.vendas),
    // a confiança da linha é a PIOR das ligações que a formaram: uma linha que
    // mistura ligação exata com ligação por cidade vale o que vale a mais frouxa
    confianca: piorConfianca([...g.campanhas.values()]),
    ligada: g.campanhas.size > 0,
  })).sort((a, b) => b.atendimentos - a.atendimentos);

  /**
   * As campanhas que NINGUÉM alcançou: rodaram e gastaram, e nenhum atendimento
   * foi tagueado com elas. Não é sobra de conta — é a pergunta mais útil da tela,
   * e no relatório de origem ela não existe porque lá nada liga os dois lados.
   */
  const alcancadas = new Set();
  for (const g of grupos.values()) for (const ck of g.campanhas.keys()) alcancadas.add(ck);
  const semAtendimento = estado.campanhas
    .filter((c) => (flt.incluirRecrutamento || !c.recrutamento))
    .map((c) => ({ c, k: `${c.plataforma}|${c.campanhaId || c.campanha}` }))
    .filter(({ k }) => !alcancadas.has(k) && gastoDaCampanha.has(k))
    .map(({ c, k }) => ({
      campanha: c.campanha,
      plataforma: c.plataforma,
      plataformaRotulo: PLATAFORMAS[c.plataforma] || c.plataforma,
      rotulo: c.rotulo,
      ...gastoDaCampanha.get(k),
    }))
    .sort((a, b) => b.investimento - a.investimento);

  return { linhas, semAtendimento, atendimentosTotal: atendimentos.length };
}

const ORDEM = { id: 0, exata: 1, familia: 2, cidade: 3 };
const ordemConfianca = (c) => ORDEM[c] ?? 9;
const piorConfianca = (lista) => (lista.length
  ? lista.reduce((pior, c) => (ordemConfianca(c) > ordemConfianca(pior) ? c : pior))
  : null);

/**
 * VISÃO GERAL — as três fontes na mesma tela, no mesmo período.
 *
 * É a página que o relatório de origem não tem: lá cada fonte mora numa aba, e
 * comparar exige trocar de página e guardar o número de cabeça.
 */
export function painelCampanhasVisaoGeral(flt) {
  const estado = getEstadoCampanhas();
  const anuncios = anunciosFiltrados(flt);
  const atendimentos = atendimentosFiltrados(flt);
  const f = funil(flt);

  const google = anuncios.filter((a) => a.plataforma === 'google');
  const meta = anuncios.filter((a) => a.plataforma === 'meta');
  const investimento = soma(anuncios, (a) => a.investimento);
  const vendas = atendimentos.filter((a) => a.venda).length;

  return {
    dataRef: estado.geradoEm,
    /** Até quando cada fonte tem dado — ver o comentário em `frescor`. */
    frescor: frescor(),
    kpis: {
      investimento,
      investimentoGoogle: soma(google, (a) => a.investimento),
      investimentoMeta: soma(meta, (a) => a.investimento),
      impressoes: soma(anuncios, (a) => a.impressoes),
      cliques: soma(google, (a) => a.cliques),
      resultados: soma(meta, (a) => a.resultados),
      atendimentos: atendimentos.length,
      vendas,
      conversao: div(vendas, atendimentos.length),
      custoPorAtendimento: div(investimento, atendimentos.length),
      custoPorVenda: div(investimento, vendas),
      campanhasAtivas: new Set(anuncios.map((a) => a.campanha)).size,
    },
    /** Investimento e atendimento no MESMO eixo do tempo — a comparação central. */
    serie: mesclarSeries(
      porMes(anuncios, (a) => a.dia, {
        investimento: (a) => a.investimento,
        impressoes: (a) => a.impressoes,
      }),
      porMes(atendimentos, (a) => a.entrada, {
        atendimentos: () => 1,
        vendas: (a) => (a.venda ? 1 : 0),
      }),
    ),
    funil: f.linhas,
    semAtendimento: f.semAtendimento.slice(0, 20),
    porPlataforma: [...new Map(f.linhas.map((l) => [l.plataforma, l])).keys()].map((p) => {
      const daPlat = f.linhas.filter((l) => l.plataforma === p);
      return {
        key: PLATAFORMAS[p] || p,
        plataforma: p,
        investimento: soma(daPlat, (l) => l.investimento),
        atendimentos: soma(daPlat, (l) => l.atendimentos),
        vendas: soma(daPlat, (l) => l.vendas),
      };
    }).sort((a, b) => b.atendimentos - a.atendimentos),
    porCidade: cidades(atendimentos, anuncios, flt),
    porCanal: contar(atendimentos, (a) => a.canal),
    porClassificacao: contar(atendimentos, (a) => a.classificacao),
  };
}

/** Une duas séries mensais pelo período, preenchendo com zero o que falta. */
function mesclarSeries(a, b) {
  const m = new Map();
  for (const linha of [...a, ...b]) {
    const cur = m.get(linha.periodo) || { periodo: linha.periodo, investimento: 0, impressoes: 0, atendimentos: 0, vendas: 0 };
    Object.assign(cur, { ...cur, ...linha });
    m.set(linha.periodo, cur);
  }
  return [...m.values()].sort((x, y) => x.periodo.localeCompare(y.periodo));
}

/**
 * Por cidade: investimento de um lado, atendimento do outro.
 *
 * A cidade é a dimensão em que as três fontes mais se encontram — é a única que
 * aparece no nome da campanha do Google, no nome de parte das do Meta e na tag do
 * Matrix nas duas eras. Por isso ela ganha visual próprio.
 */
function cidades(atendimentos, anuncios, flt) {
  const m = new Map();
  const linha = (c) => {
    let l = m.get(c);
    if (!l) { l = { key: c, investimento: 0, atendimentos: 0, vendas: 0 }; m.set(c, l); }
    return l;
  };
  for (const a of anuncios) {
    const c = a.identidade.cidade;
    if (c) linha(c).investimento += a.investimento;
  }
  for (const at of atendimentos) {
    const vistas = new Set();
    for (const id of at.identidades) {
      if (!id.cidade || vistas.has(id.cidade)) continue;
      vistas.add(id.cidade);
      const l = linha(id.cidade);
      l.atendimentos += 1;
      if (at.venda) l.vendas += 1;
    }
  }
  return [...m.values()]
    .map((l) => ({ ...l, custoPorAtendimento: div(l.investimento, l.atendimentos) }))
    .sort((a, b) => b.atendimentos - a.atendimentos);
}

/**
 * Até quando cada fonte tem dado.
 *
 * Vai para a tela porque as três param em datas diferentes, e isso muda a leitura
 * de qualquer comparação: hoje o Google e o Meta terminam em 01/07/2026 (as duas
 * tabelas foram carregadas uma vez, em julho, e não têm esteira), enquanto o
 * Matrix segue até ontem. Comparar investimento de julho com atendimento de
 * setembro dá custo por lead zero — e a tela tem de dizer por quê, em vez de
 * mostrar o zero.
 */
export function frescor() {
  const estado = getEstadoCampanhas();
  const max = (l, f) => l.reduce((m, x) => { const v = f(x); return v && (!m || v > m) ? v : m; }, null);
  return {
    google: max(estado.anuncios.filter((a) => a.plataforma === 'google'), (a) => a.dia),
    meta: max(estado.anuncios.filter((a) => a.plataforma === 'meta'), (a) => a.dia),
    matrix: max(estado.atendimentos, (a) => a.entrada),
  };
}

/** GOOGLE ADS / META ADS — a página de uma plataforma só. */
export function painelCampanhasPlataforma(plataforma, flt) {
  const daPlataforma = { ...flt, plataforma: [plataforma] };
  const anuncios = anunciosFiltrados(daPlataforma);
  // o atendimento é atribuído pela TAG, então o recorte de plataforma vale aqui também
  const atendimentos = atendimentosFiltrados(daPlataforma);
  const investimento = soma(anuncios, (a) => a.investimento);
  const vendas = atendimentos.filter((a) => a.venda).length;

  const porCampanha = new Map();
  for (const a of anuncios) {
    const k = a.campanhaId || a.campanha;
    let c = porCampanha.get(k);
    if (!c) {
      c = {
        campanha: a.campanha,
        familia: FAMILIA_ROTULO[a.identidade.familia] || a.identidade.familia,
        cidade: a.identidade.cidade || 'todas',
        de: a.dia, ate: a.dia,
        investimento: 0, impressoes: 0, cliques: 0, resultados: 0, alcance: 0, conversoes: 0,
      };
      porCampanha.set(k, c);
    }
    if (a.dia && a.dia < c.de) c.de = a.dia;
    if (a.dia && a.dia > c.ate) c.ate = a.dia;
    for (const mm of ['investimento', 'impressoes', 'cliques', 'resultados', 'alcance', 'conversoes']) c[mm] += a[mm];
  }

  const tabela = [...porCampanha.values()].map((c) => ({
    ...c,
    ctr: div(c.cliques, c.impressoes),
    cpc: div(c.investimento, c.cliques),
    custoPorResultado: div(c.investimento, c.resultados),
    custoPorMil: div(c.investimento, c.impressoes) * 1000,
  })).sort((a, b) => b.investimento - a.investimento);

  return {
    plataforma,
    plataformaRotulo: PLATAFORMAS[plataforma] || plataforma,
    frescor: frescor()[plataforma] || null,
    kpis: {
      investimento,
      impressoes: soma(anuncios, (a) => a.impressoes),
      cliques: soma(anuncios, (a) => a.cliques),
      resultados: soma(anuncios, (a) => a.resultados),
      alcance: soma(anuncios, (a) => a.alcance),
      campanhas: porCampanha.size,
      atendimentos: atendimentos.length,
      vendas,
      custoPorAtendimento: div(investimento, atendimentos.length),
      custoPorVenda: div(investimento, vendas),
    },
    serie: mesclarSeries(
      porMes(anuncios, (a) => a.dia, {
        investimento: (a) => a.investimento,
        impressoes: (a) => a.impressoes,
        cliques: (a) => a.cliques,
        resultados: (a) => a.resultados,
      }),
      porMes(atendimentos, (a) => a.entrada, {
        atendimentos: () => 1, vendas: (a) => (a.venda ? 1 : 0),
      }),
    ),
    tabela,
    porFamilia: [...new Map(tabela.map((t) => [t.familia, null])).keys()].map((fam) => {
      const daFam = tabela.filter((t) => t.familia === fam);
      return { key: fam, valor: soma(daFam, (t) => t.investimento), campanhas: daFam.length };
    }).sort((a, b) => b.valor - a.valor),
    porCidade: cidades(atendimentos, anuncios, daPlataforma),
  };
}

/** DETALHAMENTO DOS ENTRANTES — a tabela grande, como na página de origem. */
export function painelCampanhasAtendimentos(flt) {
  const atendimentos = atendimentosFiltrados(flt);
  const vendas = atendimentos.filter((a) => a.venda).length;
  const abandonos = atendimentos.filter((a) => a.abandono).length;

  return {
    kpis: {
      atendimentos: atendimentos.length,
      vendas,
      abandonos,
      conversao: div(vendas, atendimentos.length),
      abandono: div(abandonos, atendimentos.length),
      protocolos: new Set(atendimentos.map((a) => a.protocolo).filter(Boolean)).size,
    },
    frescor: frescor(),
    serie: porMes(atendimentos, (a) => a.entrada, {
      atendimentos: () => 1,
      vendas: (a) => (a.venda ? 1 : 0),
      abandonos: (a) => (a.abandono ? 1 : 0),
    }),
    porClassificacao: contar(atendimentos, (a) => a.classificacao),
    porCanal: contar(atendimentos, (a) => a.canal),
    porAtendente: contar(atendimentos, (a) => a.atendente, { limit: 25 }),
    porAtivoReceptivo: contar(atendimentos, (a) => a.ativoReceptivo),
    /**
     * POR ANUNCIO IDENTIFICADO — o agrupamento que so existe por causa do ID.
     *
     * Enquanto a exportacao do Meta nao trouxer o nivel de conjunto, este e o
     * unico lugar da tela em que a atribuicao e EXATA: nao e "campanha parecida
     * com a tag", e o anuncio que o atendimento declarou. Por isso ele fica
     * separado dos demais, e nao misturado no funil.
     */
    porAnuncio: (() => {
      const m = new Map();
      for (const a of atendimentos) {
        for (const id of a.identidades) {
          if (!id.anuncioId) continue;
          let r = m.get(id.anuncioId);
          if (!r) {
            r = {
              anuncioId: id.anuncioId,
              rotulo: `${PLATAFORMAS[id.plataforma] || id.plataforma} · ${FAMILIA_ROTULO[id.familia] || id.familia}${id.cidade ? ` · ${id.cidade}` : ''}`,
              cidade: id.cidade || 'todas',
              atendimentos: 0, vendas: 0, abandonos: 0,
            };
            m.set(id.anuncioId, r);
          }
          r.atendimentos += 1;
          if (a.venda) r.vendas += 1;
          if (a.abandono) r.abandonos += 1;
        }
      }
      return [...m.values()]
        .map((r) => ({ ...r, conversao: r.atendimentos ? r.vendas / r.atendimentos : 0 }))
        .sort((x, y) => y.atendimentos - x.atendimentos);
    })(),
    porCampanha: contar(
      atendimentos.flatMap((a) => {
        const vistas = new Set();
        return a.identidades.map((id) => {
          const r = `${PLATAFORMAS[id.plataforma] || id.plataforma} · ${FAMILIA_ROTULO[id.familia] || id.familia}${id.cidade ? ` · ${id.cidade}` : ''}`;
          if (vistas.has(r)) return null;
          vistas.add(r);
          return r;
        }).filter(Boolean);
      }),
      (x) => x,
      { limit: 30 },
    ),
    total: atendimentos.length,
    // a tela mostra as mais recentes; o CSV leva todas
    detalhe: atendimentos
      .slice().sort((a, b) => (b.entradaHora || '').localeCompare(a.entradaHora || ''))
      .slice(0, 400)
      .map((a) => ({
        protocolo: a.protocolo,
        entrada: a.entrada,
        atendimento: a.atendimento,
        finalizacao: a.finalizacao,
        contato: a.contato,
        telefone: a.telefone,
        canal: a.canal,
        ativoReceptivo: a.ativoReceptivo,
        atendente: a.atendente,
        classificacao: a.classificacao,
        campanhas: a.identidades
          .map((id) => `${PLATAFORMAS[id.plataforma] || id.plataforma} · ${FAMILIA_ROTULO[id.familia] || id.familia}${id.cidade ? ` · ${id.cidade}` : ''}`)
          .join(' | '),
        /**
         * O identificador do anuncio que a tag trouxe. E a resposta exata para
         * "de qual campanha veio este atendimento" -- sem heuristica nenhuma.
         * Texto, nunca numero: 18 digitos nao cabem em double.
         */
        anuncioId: a.identidades.map((id) => id.anuncioId).filter(Boolean).join(' | ') || null,
      })),
  };
}

/** Linhas completas para o CSV do servidor (sem o corte de 400). */
export function linhasAtendimentosCampanhas(flt) {
  return atendimentosFiltrados(flt)
    .slice().sort((a, b) => (b.entradaHora || '').localeCompare(a.entradaHora || ''));
}

/** Linhas completas das campanhas de anúncio, para o CSV. */
export function linhasCampanhasAnuncio(flt) {
  const g = painelCampanhasPlataforma('google', flt).tabela.map((t) => ({ ...t, plataforma: 'Google Ads' }));
  const m = painelCampanhasPlataforma('meta', flt).tabela.map((t) => ({ ...t, plataforma: 'Meta Ads' }));
  return [...g, ...m].sort((a, b) => b.investimento - a.investimento);
}
