/**
 * CAMPANHAS DE MARKETING — réplica em memória do "MKT - Campanhas de Marketing",
 * com a ponte entre as três fontes que o relatório de origem não tem.
 *
 * Estado PRÓPRIO, como condomínios e leads: o fato aqui é um dia de veiculação de
 * anúncio ou um atendimento tagueado, e nenhum dos dois é um contrato vendido.
 *
 * Fontes (as três no MariaDB que o dashboard já abre — ver sql/marketing.js):
 *   google   -> DB_Marketing.marketing_google_ads
 *   meta     -> DB_Marketing.marketing_meta_ads
 *   matrix   -> API_WebDeveloper.db_matrix, só o que tem tag de marketing
 *
 * O QUE É DIFERENTE DO POWER BI, e por quê:
 *
 * 1. NO MODELO DE ORIGEM AS TRÊS TABELAS NÃO SE RELACIONAM — só com o calendário.
 *    A "comparação entre os três" de lá são três relatórios lado a lado. Aqui elas
 *    se encontram pelo vocabulário (`model/vocabulario.js`), que é heurística
 *    declarada: a tela diz, por linha, em que degrau a ligação foi feita.
 *
 * 2. `Leads_Manual = 453` era uma CONSTANTE digitada à mão, e alimentava seis
 *    medidas de destaque do relatório — investimento efetivo, investimento não
 *    efetivo e taxa de conversão real, nas páginas de Google e de Meta. Aqui não
 *    existe: o denominador é o atendimento que a tag atribuiu à campanha, que muda
 *    com o filtro, como número de dashboard tem de mudar.
 *
 * 3. `Custo_Total_META` somava TUDO, inclusive as 44 campanhas de vaga de emprego
 *    — R$ 202.517,74, 43,5% do gasto do Meta. Recrutamento não é captação de
 *    cliente e estraga qualquer custo por lead. Aqui ele é uma família à parte
 *    (`vagas`), separável por filtro e fora da conta por padrão.
 *
 * 4. O agrupamento de lá era feito na coluna `tags` CRUA, então a mesma campanha
 *    aparecia várias vezes (com aspas, sem aspas, colada por vírgula ou por ` || `).
 *    Aqui a tag é quebrada e normalizada antes de qualquer contagem.
 */
import { monthKey, today } from './dates.js';
import {
  CONFIANCA, FAMILIAS_RECRUTAMENTO, FAMILIA_ROTULO, PLATAFORMAS,
  chaveDe, chaveSemCidade, cruzar, identidadeDaCampanha, identidadesDoAtendimento,
  indexarCampanhas, numeroBR, rotuloDaIdentidade,
} from './vocabulario.js';

export { CONFIANCA, FAMILIA_ROTULO, PLATAFORMAS };

/**
 * A classificação que conta como venda, exatamente como no relatório de origem.
 * O abandono também: é a medida TAXA DE ABANDONO (%) de lá.
 */
const VENDA = 'VENDA CONCLUÍDA';
const ABANDONO = 'FALTA DE CONTATO (SEM RETORNO CLIENTE)';

const estado = {
  raw: { google: [], meta: [], matrix: [] },
  fontes: {},
  anuncios: [],      // um dia de veiculação, das duas plataformas
  campanhas: [],     // uma campanha de anúncio, agregada
  atendimentos: [],  // um atendimento do Matrix com tag de marketing
  grupos: [],        // o funil: uma linha por plataforma+família
  dims: { plataformas: [], familias: [], cidades: [], canais: [], classificacoes: [], atendentes: [] },
  versao: 0,
  geradoEm: null,
  buildMs: null,
};

export const getEstadoCampanhas = () => estado;
export const campanhasPronto = () => estado.anuncios.length > 0 || estado.atendimentos.length > 0;

export function setFonteCampanhas(nome, rows, meta = {}) {
  estado.raw[nome] = rows || [];
  estado.fontes[nome] = {
    updatedAt: new Date().toISOString(), rows: (rows || []).length, ms: meta.ms ?? null, error: null,
  };
}

export function setFonteErroCampanhas(nome, err) {
  estado.fontes[nome] = {
    ...(estado.fontes[nome] || {}),
    error: String(err && err.message ? err.message : err),
    failedAt: new Date().toISOString(),
  };
}

const texto = (v) => (v == null ? '' : String(v).trim());
/** `data_entrada` é varchar 'YYYY-MM-DD HH:MM:SS'; só a data interessa aqui. */
const dia = (v) => texto(v).slice(0, 10) || null;

/**
 * `classificacao` vem em TRÊS sabores de vazio: NULL do banco, a string 'null' e
 * a string vazia. Juntos são 57% dos atendimentos tagueados. Não normalizar faria
 * o gráfico de classificação mostrar três fatias diferentes para "não classificado"
 * — e a de maior volume seria uma delas.
 */
const classificacaoDe = (v) => {
  const s = texto(v);
  return !s || s.toLowerCase() === 'null' ? '(sem classificação)' : s.toUpperCase();
};

/** `ativo_receptivo` grava 'Receptivo', 'Ativo' e também o número 1 (= receptivo). */
const ativoReceptivoDe = (v) => {
  const s = texto(v).toLowerCase();
  if (s === 'ativo') return 'Ativo';
  if (s === 'receptivo' || s === '1') return 'Receptivo';
  return s ? texto(v) : '(não informado)';
};

// ---------------------------------------------------------------------------
// CONSTRUÇÃO
// ---------------------------------------------------------------------------
export function construirCampanhas() {
  const t0 = Date.now();

  /**
   * Um dia de veiculação, das duas plataformas na mesma forma.
   *
   * Google e Meta medem coisas diferentes e isso NÃO é uniformizado à força:
   * o Google entrega clique, o Meta entrega resultado (conversa iniciada) e
   * alcance. Forçar os dois numa coluna "conversões" só faria somar peras com
   * maçãs — o que a tela compara é investimento e atendimento gerado, que os
   * dois têm de verdade.
   */
  const anuncios = [];

  for (const r of estado.raw.google) {
    const nome = texto(r.campanha);
    if (!nome) continue;
    anuncios.push({
      plataforma: 'google',
      campanha: nome,
      campanhaId: texto(r.campanha_id),
      dia: dia(r.dia),
      identidade: identidadeDaCampanha(nome, 'google'),
      // as colunas de dinheiro do Google são varchar em português — ver numeroBR
      investimento: numeroBR(r.custo_txt),
      impressoes: Number(r.impressoes) || 0,
      cliques: Number(r.cliques) || 0,
      resultados: 0,          // o Google desta base não traz resultado de conversa
      alcance: 0,
      conversoes: numeroBR(r.conversoes_txt),
      estado: texto(r.estado),
    });
  }

  for (const r of estado.raw.meta) {
    const nome = texto(r.campanha);
    if (!nome) continue;
    anuncios.push({
      plataforma: 'meta',
      campanha: nome,
      campanhaId: texto(r.campanha_id),
      dia: dia(r.dia),
      identidade: identidadeDaCampanha(nome, 'meta'),
      investimento: Number(r.gasto) || 0,
      impressoes: Number(r.impressoes) || 0,
      cliques: 0,             // o Meta desta base não traz clique
      resultados: Number(r.resultados) || 0,
      alcance: Number(r.alcance) || 0,
      conversoes: 0,
      estado: texto(r.estado),
    });
  }

  /**
   * Um atendimento pode carregar MAIS DE UMA tag de marketing — vimos casos com
   * campanha do Meta e página do site na mesma linha. Ele conta para as duas, e é
   * o certo: as duas tocaram aquele cliente. O total de atendimentos da tela,
   * portanto, é sempre a contagem de LINHAS, nunca a soma das campanhas.
   */
  const atendimentos = [];
  for (const r of estado.raw.matrix) {
    const ids = identidadesDoAtendimento(r.tags);
    if (!ids.length) continue;
    const classificacao = classificacaoDe(r.classificacao);
    atendimentos.push({
      codigo: texto(r.codigo),
      protocolo: texto(r.protocolo),
      entrada: dia(r.data_entrada),
      entradaHora: texto(r.data_entrada),
      atendimento: dia(r.data_atendimento),
      finalizacao: dia(r.data_finalizacao),
      classificacao,
      venda: classificacao === VENDA,
      abandono: classificacao === ABANDONO,
      servico: texto(r.servico),
      canal: texto(r.canal) || '(sem canal)',
      ativoReceptivo: ativoReceptivoDe(r.ativo_receptivo),
      atendente: texto(r.atendente) || '(sem atendente)',
      contato: texto(r.contato),
      telefone: texto(r.telefone),
      cpf: texto(r.cpf),
      identidades: ids,
    });
  }

  // ---- campanhas de anúncio, agregadas
  const porCampanha = new Map();
  for (const a of anuncios) {
    const k = `${a.plataforma}|${a.campanhaId || a.campanha}`;
    let c = porCampanha.get(k);
    if (!c) {
      c = {
        plataforma: a.plataforma,
        campanha: a.campanha,
        campanhaId: a.campanhaId,
        identidade: a.identidade,
        rotulo: rotuloDaIdentidade(a.identidade),
        recrutamento: FAMILIAS_RECRUTAMENTO.has(a.identidade.familia),
        de: a.dia, ate: a.dia, dias: 0,
        investimento: 0, impressoes: 0, cliques: 0, resultados: 0, alcance: 0, conversoes: 0,
      };
      porCampanha.set(k, c);
    }
    c.dias += 1;
    if (a.dia && (!c.de || a.dia < c.de)) c.de = a.dia;
    if (a.dia && (!c.ate || a.dia > c.ate)) c.ate = a.dia;
    for (const m of ['investimento', 'impressoes', 'cliques', 'resultados', 'alcance', 'conversoes']) c[m] += a[m];
  }
  const campanhas = [...porCampanha.values()];

  const uniq = (arr) => [...new Set(arr.filter(Boolean))].sort((a, b) => a.localeCompare(b, 'pt-BR'));

  estado.anuncios = anuncios;
  estado.campanhas = campanhas;
  estado.atendimentos = atendimentos;
  estado.indice = indexarCampanhas(campanhas);
  estado.dims = {
    plataformas: uniq([...anuncios.map((a) => a.plataforma),
      ...atendimentos.flatMap((a) => a.identidades.map((i) => i.plataforma))]),
    familias: uniq([...campanhas.map((c) => c.identidade.familia),
      ...atendimentos.flatMap((a) => a.identidades.map((i) => i.familia))]),
    cidades: uniq([...campanhas.map((c) => c.identidade.cidade),
      ...atendimentos.flatMap((a) => a.identidades.map((i) => i.cidade))]),
    canais: uniq(atendimentos.map((a) => a.canal)),
    classificacoes: uniq(atendimentos.map((a) => a.classificacao)),
    atendentes: uniq(atendimentos.map((a) => a.atendente)),
  };
  estado.versao += 1;
  estado.geradoEm = new Date().toISOString();
  estado.buildMs = Date.now() - t0;
  return estado;
}

// ---------------------------------------------------------------------------
// FILTROS
// ---------------------------------------------------------------------------
const asArray = (v) => {
  if (v === undefined || v === null || v === '') return null;
  const arr = Array.isArray(v) ? v : String(v).split(',');
  const out = arr.map((s) => String(s).trim()).filter(Boolean);
  return out.length ? out : null;
};

/**
 * `incluirRecrutamento` começa DESLIGADO, e é a única opção desta tela que muda
 * um total por omissão — por isso ela aparece na barra, escrita.
 *
 * Deixá-la ligada seria repetir o erro do relatório de origem: R$ 202 mil de
 * campanha de vaga de emprego dentro do custo por lead comercial faz o número
 * quase dobrar, e nada na tela diria por quê.
 */
export function parseFiltrosCampanhas(q = {}) {
  return {
    de: q.cde || null,
    ate: q.cate || null,
    plataforma: asArray(q.cplat),
    familia: asArray(q.cfam),
    cidade: asArray(q.ccid),
    canal: asArray(q.ccanal),
    classificacao: asArray(q.cclass),
    atendente: asArray(q.catend),
    busca: q.cbusca ? String(q.cbusca).trim().toUpperCase() : null,
    incluirRecrutamento: String(q.crec || '') === '1',
  };
}

const noPeriodo = (d, flt) => !d || ((!flt.de || d >= flt.de) && (!flt.ate || d <= flt.ate));

/** Uma identidade passa pelos filtros de campanha? */
const idPassa = (id, flt) => {
  if (flt.plataforma && !flt.plataforma.includes(id.plataforma)) return false;
  if (flt.familia && !flt.familia.includes(id.familia)) return false;
  if (flt.cidade && !flt.cidade.includes(id.cidade || '(todas)')) return false;
  if (!flt.incluirRecrutamento && FAMILIAS_RECRUTAMENTO.has(id.familia)) return false;
  return true;
};

/** Campanhas de anúncio depois dos filtros — o período recorta o DIA veiculado. */
export function anunciosFiltrados(flt) {
  return estado.anuncios.filter((a) => noPeriodo(a.dia, flt) && idPassa(a.identidade, flt));
}

/** Atendimentos depois dos filtros — o período recorta a DATA DE ENTRADA. */
export function atendimentosFiltrados(flt) {
  return estado.atendimentos.filter((a) => {
    if (!noPeriodo(a.entrada, flt)) return false;
    if (flt.canal && !flt.canal.includes(a.canal)) return false;
    if (flt.classificacao && !flt.classificacao.includes(a.classificacao)) return false;
    if (flt.atendente && !flt.atendente.includes(a.atendente)) return false;
    if (flt.busca) {
      const alvo = `${a.contato} ${a.telefone} ${a.protocolo} ${a.cpf}`.toUpperCase();
      if (!alvo.includes(flt.busca)) return false;
    }
    return a.identidades.some((id) => idPassa(id, flt));
  });
}

export function filtrosCampanhas() {
  return {
    ...estado.dims,
    familiasRotulo: FAMILIA_ROTULO,
    plataformasRotulo: PLATAFORMAS,
    recrutamento: [...FAMILIAS_RECRUTAMENTO],
  };
}
