/**
 * Os painéis da tela de CAMPANHAS.
 *
 * Quatro sub-páginas — visão geral, Google, Meta e o detalhamento dos leads. O
 * lead é o protocolo do RASTREAMENTO DE POSTS do Matrix (ver model/campanhas.js),
 * e não mais o atendimento com tag.
 *
 * O QUE MUDOU NO CRUZAMENTO. A versão por tag montava um funil por campanha
 * ligando tag e nome de anúncio por semelhança (plataforma, família, cidade) e
 * rateando o gasto entre os grupos. O rastreamento não diz a campanha — traz o
 * título do anúncio, repetido entre campanhas — então esse funil virou "leads por
 * anúncio", e o custo por lead é calculado no nível em que a conta é exata: o
 * investimento do Meta contra os leads do Meta. O rastreamento só registra o
 * clique em anúncio do Meta (Click-to-WhatsApp); o Google não aparece nele.
 */
import { monthKey } from './dates.js';
import {
  SEM_ATENDENTE, atendimentosFiltrados, anunciosFiltrados, getEstadoCampanhas,
} from './campanhas.js';
import { FAMILIA_ROTULO, PLATAFORMAS } from './vocabulario.js';

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

/** Une séries mensais pelo período, preenchendo com zero o que falta. */
function mesclarSeries(...series) {
  const m = new Map();
  for (const linha of series.flat()) {
    const cur = m.get(linha.periodo) || { periodo: linha.periodo };
    Object.assign(cur, linha);
    m.set(linha.periodo, cur);
  }
  const chaves = new Set(series.flat().flatMap((l) => Object.keys(l)));
  return [...m.values()]
    .map((l) => { for (const k of chaves) if (l[k] === undefined) l[k] = 0; return l; })
    .sort((x, y) => x.periodo.localeCompare(y.periodo));
}

/** Leads, vendas, abandono e quem não chegou a atendente, por uma chave. */
function desfechoPor(leads, chave) {
  const m = new Map();
  for (const a of leads) {
    const k = chave(a) || '(sem cidade)';
    let r = m.get(k);
    if (!r) { r = { key: k, leads: 0, vendas: 0, abandonos: 0, semAtendente: 0 }; m.set(k, r); }
    r.leads += 1;
    if (a.venda) r.vendas += 1;
    if (a.abandono) r.abandonos += 1;
    if (!a.noMatrix) r.semAtendente += 1;
  }
  return [...m.values()]
    .map((r) => ({
      ...r,
      conversao: div(r.vendas, r.leads),
      abandono: div(r.abandonos, r.leads),
      fatiaSemAtendente: div(r.semAtendente, r.leads),
    }))
    .sort((a, b) => b.leads - a.leads);
}

/**
 * Por cidade: investimento de um lado, leads do outro.
 *
 * A cidade do lead é a que o título do anúncio ou o próprio cliente nomeou; a do
 * investimento é a do nome da campanha. Campanha "todas as cidades" não entra na
 * coluna de investimento — ratear por cidade seria inventar a divisão.
 */
function cidades(leads, anuncios) {
  const m = new Map();
  const linha = (c) => {
    let l = m.get(c);
    if (!l) { l = { key: c, investimento: 0, leads: 0, vendas: 0 }; m.set(c, l); }
    return l;
  };
  for (const a of anuncios) {
    const c = a.identidade.cidade;
    if (c) linha(c).investimento += a.investimento;
  }
  for (const at of leads) {
    const l = linha(at.cidade || '(sem cidade)');
    l.leads += 1;
    if (at.venda) l.vendas += 1;
  }
  return [...m.values()]
    .map((l) => ({ ...l, conversao: div(l.vendas, l.leads) }))
    .sort((a, b) => b.leads - a.leads);
}

/**
 * Até quando cada fonte tem dado, e a última importação do rastreamento.
 *
 * As três param em datas diferentes e isso muda a leitura: investimento de julho
 * contra lead de setembro dá custo zero. O rastreamento, por ser importado à mão,
 * pode simplesmente estar atrasado — a tela diz quando foi a última importação.
 */
export function frescor() {
  const estado = getEstadoCampanhas();
  const max = (l, f) => l.reduce((m, x) => { const v = f(x); return v && (!m || v > m) ? v : m; }, null);
  const min = (l, f) => l.reduce((m, x) => { const v = f(x); return v && (!m || v < m) ? v : m; }, null);
  return {
    google: max(estado.anuncios.filter((a) => a.plataforma === 'google'), (a) => a.dia),
    meta: max(estado.anuncios.filter((a) => a.plataforma === 'meta'), (a) => a.dia),
    rastreamentoDe: min(estado.atendimentos, (a) => a.entrada),
    rastreamento: max(estado.atendimentos, (a) => a.entrada),
    ultimaImportacao: estado.importacoes[0] || null,
  };
}

/**
 * O gasto que PODE ter gerado os leads da tela: só os dias dentro do período que
 * o rastreamento cobre.
 *
 * Sem isto, o custo por lead em "Tudo" dividia o gasto do Meta de janeiro a
 * outubro pelos leads de setembro — o único mês importado — e dava R$ 176 em vez
 * de R$ 22. O investimento continua aparecendo inteiro no seu cartão; só a
 * divisão usa o recorte coberto.
 */
function gastoCoberto(anuncios) {
  const f = frescor();
  if (!f.rastreamentoDe) return 0;
  return soma(anuncios.filter((a) => a.dia && a.dia >= f.rastreamentoDe && a.dia <= f.rastreamento), (a) => a.investimento);
}

/** Os indicadores de desfecho de uma lista de leads. */
function kpisDeLeads(leads) {
  const vendas = leads.filter((a) => a.venda).length;
  const abandonos = leads.filter((a) => a.abandono).length;
  const semAtendente = leads.filter((a) => !a.noMatrix).length;
  return {
    leads: leads.length,
    vendas,
    abandonos,
    semAtendente,
    conversao: div(vendas, leads.length),
    abandono: div(abandonos, leads.length),
    fatiaSemAtendente: div(semAtendente, leads.length),
  };
}

/**
 * VISÃO GERAL — investimento e leads no mesmo período.
 *
 * O custo por lead usa o investimento do META: o rastreamento só registra lead de
 * anúncio do Meta, e dividir o gasto do Google por ele daria um custo que nenhum
 * lead pagou.
 */
export function painelCampanhasVisaoGeral(flt) {
  const estado = getEstadoCampanhas();
  const anuncios = anunciosFiltrados(flt);
  const leads = atendimentosFiltrados(flt);
  const google = anuncios.filter((a) => a.plataforma === 'google');
  const meta = anuncios.filter((a) => a.plataforma === 'meta');
  const investimentoMeta = soma(meta, (a) => a.investimento);
  const metaCoberto = gastoCoberto(meta);
  const k = kpisDeLeads(leads);

  return {
    dataRef: estado.geradoEm,
    frescor: frescor(),
    kpis: {
      ...k,
      investimento: soma(anuncios, (a) => a.investimento),
      investimentoGoogle: soma(google, (a) => a.investimento),
      investimentoMeta,
      impressoes: soma(anuncios, (a) => a.impressoes),
      cliques: soma(google, (a) => a.cliques),
      resultadosMeta: soma(meta, (a) => a.resultados),
      investimentoMetaCoberto: metaCoberto,
      custoPorLead: div(metaCoberto, k.leads),
      custoPorVenda: div(metaCoberto, k.vendas),
      campanhasAtivas: new Set(anuncios.map((a) => a.campanha)).size,
    },
    serie: mesclarSeries(
      porMes(meta, (a) => a.dia, { investimentoMeta: (a) => a.investimento, resultadosMeta: (a) => a.resultados }),
      porMes(google, (a) => a.dia, { investimentoGoogle: (a) => a.investimento }),
      porMes(leads, (a) => a.entrada, { leads: () => 1, vendas: (a) => (a.venda ? 1 : 0) }),
    ),
    porAnuncio: desfechoPor(leads, (a) => a.titulo),
    porTipo: contar(leads, (a) => a.tipo),
    porCidade: cidades(leads, anuncios),
    porClassificacao: contar(leads, (a) => a.classificacao),
  };
}

/** GOOGLE ADS / META ADS — a página de uma plataforma só. */
export function painelCampanhasPlataforma(plataforma, flt) {
  const daPlataforma = { ...flt, plataforma: [plataforma] };
  const anuncios = anunciosFiltrados(daPlataforma);
  // o lead do rastreamento é sempre do Meta: na página do Google a lista sai vazia
  const leads = atendimentosFiltrados(daPlataforma);
  const investimento = soma(anuncios, (a) => a.investimento);
  const vendas = leads.filter((a) => a.venda).length;

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

  const f = frescor();
  return {
    plataforma,
    plataformaRotulo: PLATAFORMAS[plataforma] || plataforma,
    frescor: f[plataforma] || null,
    kpis: {
      investimento,
      impressoes: soma(anuncios, (a) => a.impressoes),
      cliques: soma(anuncios, (a) => a.cliques),
      resultados: soma(anuncios, (a) => a.resultados),
      alcance: soma(anuncios, (a) => a.alcance),
      campanhas: porCampanha.size,
      leads: leads.length,
      vendas,
      custoPorLead: div(gastoCoberto(anuncios), leads.length),
      custoPorVenda: div(gastoCoberto(anuncios), vendas),
    },
    serie: mesclarSeries(
      porMes(anuncios, (a) => a.dia, {
        investimento: (a) => a.investimento,
        impressoes: (a) => a.impressoes,
        cliques: (a) => a.cliques,
        resultados: (a) => a.resultados,
      }),
      porMes(leads, (a) => a.entrada, { leads: () => 1, vendas: (a) => (a.venda ? 1 : 0) }),
    ),
    tabela,
    porFamilia: [...new Map(tabela.map((t) => [t.familia, null])).keys()].map((fam) => {
      const daFam = tabela.filter((t) => t.familia === fam);
      return { key: fam, valor: soma(daFam, (t) => t.investimento), campanhas: daFam.length };
    }).sort((a, b) => b.valor - a.valor),
    porCidade: cidades(leads, anuncios),
  };
}

/** LEADS — o detalhamento, como a página de entrantes do relatório de origem. */
export function painelCampanhasAtendimentos(flt) {
  const leads = atendimentosFiltrados(flt);
  return {
    kpis: kpisDeLeads(leads),
    frescor: frescor(),
    serie: porMes(leads, (a) => a.entrada, {
      leads: () => 1,
      vendas: (a) => (a.venda ? 1 : 0),
      abandonos: (a) => (a.abandono ? 1 : 0),
      semAtendente: (a) => (a.noMatrix ? 0 : 1),
    }),
    porClassificacao: contar(leads, (a) => a.classificacao),
    porAnuncio: desfechoPor(leads, (a) => a.titulo),
    porCidade: desfechoPor(leads, (a) => a.cidade),
    porTipo: contar(leads, (a) => a.tipo),
    porAtendente: contar(leads.filter((a) => a.atendente !== SEM_ATENDENTE), (a) => a.atendente, { limit: 25 }),
    total: leads.length,
    // a tela mostra os mais recentes; o CSV leva todos
    detalhe: leads
      .slice().sort((a, b) => (b.entradaHora || '').localeCompare(a.entradaHora || ''))
      .slice(0, 400)
      .map((a) => ({
        protocolo: a.protocolo,
        entrada: a.entrada,
        contato: a.contato,
        telefone: a.telefone,
        titulo: a.titulo,
        tipo: a.tipo,
        cidade: a.cidade || '—',
        mensagem: a.mensagem,
        atendente: a.atendente,
        classificacao: a.classificacao,
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
