/**
 * Metas comerciais por cidade — o alvo contra o qual o RELATÓRIO DIÁRIO compara.
 *
 * No relatório de origem elas são constantes escritas dentro de medidas DAX.
 *
 * DE ONDE VEM CADA UMA, hoje:
 *
 *   ativação  ->  `DB_Applicattion.Comercial_Metas`, uma linha por cidade por MÊS.
 *                 É o que a área mantém de verdade, e muda todo mês.
 *   venda     ->  tela de administração (o cofre), com a `SEMENTE` abaixo de piso.
 *   rádio     ->  idem; a tabela não tem meta de rádio.
 *
 * A `SEMENTE` abaixo é uma cópia do conjunto `##` do Power BI feita na construção
 * da tela — e, conferido contra a tabela, ela é exatamente **julho/2026**. Como a
 * área revisou a meta em agosto, setembro e outubro e ninguém mexeu no código, o
 * relatório diário vinha comparando o realizado de outubro contra o alvo de julho
 * (Canoas 898 em vez de 870, Cachoeirinha 498 em vez de 423). Ler da tabela
 * resolve a classe inteira do problema: número de negócio não envelhece dentro do
 * código se o código não for dono dele.
 *
 * A semente continua aqui como ÚLTIMO recurso — mês que a tabela não cobre, ou
 * tabela fora do ar. Melhor um alvo velho e declarado do que alvo zero, que faz o
 * percentual dividir por zero e a cidade parecer meta batida.
 *
 * DUAS SÉRIES CONFLITANTES NA ORIGEM
 * O modelo tem dois conjuntos de meta de ATIVAÇÃO, e eles não batem:
 *
 *   cidade            [# ATIVOS_META]   [## ATIVOS_META_BASE]
 *   Canoas                      1100                     898
 *   São Leopoldo                 600                     598
 *   Novo Hamburgo                650                     498
 *   Sapucaia do Sul              400                     349
 *   Esteio                       250                     149
 *   Cachoeirinha          (não existe)                    498
 *
 * As tabelas da tela usam o segundo (`##`), que é também o único que soma
 * corretamente quando há mais de uma cidade selecionada — o primeiro usa
 * SELECTEDVALUE e devolve 0 com duas cidades marcadas. A semente aqui é o `##`, e a
 * tela de administração mostra o conjunto alternativo para quem precisar comparar.
 */
import * as cofre from './cofre.js';

/** Semente: o conjunto `##`, que é o que as tabelas do relatório realmente usam. */
export const SEMENTE = {
  vendas: {
    Canoas: 1540,
    'Sapucaia do Sul': 560,
    Esteio: 350,
    'São Leopoldo': 840,
    'Novo Hamburgo': 910,
    Cachoeirinha: 100,
  },
  ativos: {
    Canoas: 898,
    'Sapucaia do Sul': 349,
    Esteio: 149,
    'São Leopoldo': 598,
    'Novo Hamburgo': 498,
    Cachoeirinha: 498,
  },
  // Rádio não é por cidade na origem: é um número só, para o total.
  vendasRadio: 200,
  ativosRadio: 100,
};

/** O conjunto que a tela mostra como alternativa, para conferência. */
export const CONJUNTO_ALTERNATIVO = {
  rotulo: '# ATIVOS_META (a série mais alta, não usada pelas tabelas)',
  ativos: {
    Canoas: 1100,
    'Sapucaia do Sul': 400,
    Esteio: 250,
    'São Leopoldo': 600,
    'Novo Hamburgo': 650,
  },
};

function ler() {
  return cofre.ler('metas', null);
}

const numero = (v) => {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : null;
};

/** Metas em vigor. */
/**
 * A META DE ATIVAÇÃO VEM DA TABELA, não daqui.
 *
 * `DB_Applicattion.Comercial_Metas` tem uma linha por cidade por MÊS, e é o que a
 * área mantém de verdade. A `SEMENTE` acima é uma cópia de julho/2026 feita na
 * construção da tela — e, como a área revisou a meta em agosto, setembro e
 * outubro, o dashboard vinha comparando o realizado de outubro contra o alvo de
 * julho (Canoas 898 em vez de 870) sem nada na tela dizendo isso.
 *
 * Carregada pelo ETL (grupo `rel`), não consultada por requisição.
 */
const daTabela = { porMes: new Map(), carregadoEm: null, erro: null };

/** O mês de uma data ISO ou de um Date do driver. */
const mesDe = (v) => {
  if (!v) return null;
  const s = typeof v === 'string' ? v : new Date(v).toISOString();
  return s.slice(0, 7);
};

export function setMetasDeCidade(linhas) {
  const porMes = new Map();
  for (const l of linhas || []) {
    const mes = mesDe(l.mes);
    const cidade = String(l.cidade || '').trim();
    // vazio tem de ser DESCARTADO, não virar zero: `Number(null)` é 0, e alvo
    // zero faz o percentual dividir por zero e a cidade parecer meta batida.
    // O SQL já filtra `Meta IS NOT NULL`, mas a defesa é barata e a confusão não.
    const bruto = l.meta;
    const valor = bruto === null || bruto === undefined || bruto === '' ? null : numero(bruto);
    if (!mes || !cidade || valor === null) continue;
    if (!porMes.has(mes)) porMes.set(mes, {});
    porMes.get(mes)[cidade] = valor;
  }
  daTabela.porMes = porMes;
  daTabela.carregadoEm = new Date().toISOString();
  daTabela.erro = null;
}

export function setMetasDeCidadeErro(err) {
  daTabela.erro = String(err?.message || err);
}

/**
 * Estado da tabela, no formato que o ETL espera de um `construir`: ele loga
 * `buildMs` e a versao. Aqui nao ha o que construir -- `setMetasDeCidade` ja
 * indexou --, mas o contrato do ETL e um so, e inventar excecao para esta
 * fonte custaria mais do que devolver o objeto.
 */
export function estadoMetasDeCidade() {
  let cidades = 0;
  for (const doMes of daTabela.porMes.values()) cidades = Math.max(cidades, Object.keys(doMes).length);
  daTabela.versao = (daTabela.versao || 0) + 1;
  return {
    versao: daTabela.versao,
    buildMs: 0,
    meses: daTabela.porMes.size,
    cidades,
  };
}

/** Os meses que um período [de, ate] toca. Sem período, o mês corrente. */
export function mesesDoPeriodo(de, ate) {
  const hoje = new Date().toISOString().slice(0, 7);
  const ini = mesDe(de) || hoje;
  const fim = mesDe(ate) || ini;
  const out = [];
  let [a, m] = ini.split('-').map(Number);
  for (let guarda = 0; guarda < 120; guarda += 1) {
    const atual = `${a}-${String(m).padStart(2, '0')}`;
    out.push(atual);
    if (atual >= fim) break;
    m += 1;
    if (m > 12) { m = 1; a += 1; }
  }
  return out;
}

/**
 * Meta de ativação da tabela para os meses do período, somada por cidade.
 *
 * Somar faz sentido porque a meta é MENSAL: um período de dois meses tem o alvo
 * dos dois. Devolve `null` quando a tabela não cobre nenhum dos meses — aí quem
 * chama cai para a tela e, depois, para a semente.
 */
function ativosDaTabela(meses) {
  const soma = {};
  let achou = false;
  for (const mes of meses) {
    const doMes = daTabela.porMes.get(mes);
    if (!doMes) continue;
    achou = true;
    for (const [cidade, valor] of Object.entries(doMes)) {
      soma[cidade] = (soma[cidade] || 0) + valor;
    }
  }
  return achou ? soma : null;
}

/**
 * As metas em vigor. `periodo` é o recorte da tela que está perguntando — a de
 * ativação depende dele, porque a tabela é mensal.
 *
 * A cadeia de origem, por campo:
 *   ativos  -> tabela (Comercial_Metas) -> tela -> semente
 *   vendas  -> tela -> semente            (a tabela não tem meta de venda)
 *   rádio   -> tela -> semente            (nem de rádio)
 */
export function metas(periodo = {}) {
  const salvo = ler();
  const meses = mesesDoPeriodo(periodo.de, periodo.ate);
  const daBase = ativosDaTabela(meses);

  const limpar = (obj, padrao) => {
    const saida = {};
    for (const [cidade, valor] of Object.entries(obj || {})) {
      const n = numero(valor);
      if (n !== null) saida[cidade] = n;
    }
    return Object.keys(saida).length ? saida : padrao;
  };

  const ativosDaTela = salvo ? limpar(salvo.ativos, null) : null;

  return {
    vendas: salvo ? limpar(salvo.vendas, SEMENTE.vendas) : SEMENTE.vendas,
    ativos: daBase || ativosDaTela || SEMENTE.ativos,
    vendasRadio: (salvo && numero(salvo.vendasRadio)) ?? SEMENTE.vendasRadio,
    ativosRadio: (salvo && numero(salvo.ativosRadio)) ?? SEMENTE.ativosRadio,
    origem: salvo ? 'tela' : 'semente',
    /** De onde a meta de ATIVAÇÃO saiu, para a tela poder dizer. */
    origemAtivos: daBase ? 'tabela' : (ativosDaTela ? 'tela' : 'semente'),
    mesesDaMeta: daBase ? meses.filter((m) => daTabela.porMes.has(m)) : [],
    tabela: {
      carregadoEm: daTabela.carregadoEm,
      erro: daTabela.erro,
      meses: [...daTabela.porMes.keys()].sort(),
    },
    atualizadoEm: salvo?.atualizadoEm || null,
    atualizadoPor: salvo?.atualizadoPor || null,
  };
}

export function estadoMetas() {
  return { ...metas(), semente: SEMENTE, alternativo: CONJUNTO_ALTERNATIVO };
}

/**
 * Grava. Cidade sem meta não é erro — é meta zero, e a tela mostra a cidade com
 * alvo em branco em vez de esconder a linha. Esconder faria a venda daquela cidade
 * desaparecer do total.
 */
export function definirMetas({ vendas, ativos, vendasRadio, ativosRadio }, porQuem) {
  const validar = (obj, rotulo) => {
    const saida = {};
    for (const [cidade, valor] of Object.entries(obj || {})) {
      const nome = String(cidade).trim();
      if (!nome) throw new Error(`${rotulo}: há uma linha sem cidade.`);
      const n = numero(valor);
      if (n === null) throw new Error(`${rotulo} de ${nome}: use um número igual ou maior que zero.`);
      if (n > 1000000) throw new Error(`${rotulo} de ${nome}: ${n} é grande demais para ser meta.`);
      saida[nome] = n;
    }
    return saida;
  };
  const radio = (v, rotulo) => {
    const n = numero(v);
    if (n === null) throw new Error(`${rotulo}: use um número igual ou maior que zero.`);
    return n;
  };

  const novo = {
    vendas: validar(vendas, 'Meta de vendas'),
    ativos: validar(ativos, 'Meta de ativações'),
    vendasRadio: radio(vendasRadio, 'Meta de vendas de rádio'),
    ativosRadio: radio(ativosRadio, 'Meta de ativações de rádio'),
    atualizadoEm: new Date().toISOString(),
    atualizadoPor: String(porQuem || '').toLowerCase(),
  };
  cofre.gravar('metas', novo, novo.atualizadoPor || null);
  return estadoMetas();
}

export function restaurarMetas() {
  cofre.apagar('metas');
  return estadoMetas();
}
