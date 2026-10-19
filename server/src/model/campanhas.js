/**
 * CAMPANHAS DE MARKETING — investimento em anúncio contra os leads que o anúncio
 * trouxe.
 *
 * Estado PRÓPRIO, como condomínios e leads: o fato aqui é um dia de veiculação de
 * anúncio ou um lead de anúncio, e nenhum dos dois é um contrato vendido.
 *
 * Fontes (todas no MariaDB que o dashboard já abre — ver sql/marketing.js):
 *   google        -> DB_Marketing.marketing_google_ads
 *   meta          -> DB_Marketing.marketing_meta_ads
 *   rastreamento  -> DB_Marketing.marketing_matrix_rastreamento (CSV importado)
 *   lotes         -> as importações desse CSV
 *   matrix        -> API_WebDeveloper.db_matrix, só os protocolos do rastreamento
 *
 * O LEAD É O PROTOCOLO DO RASTREAMENTO DE POSTS. Até out/2026 era o atendimento com
 * tag de marketing, e a troca é o que esta versão faz. Em set/2026:
 *   - o rastreamento registrou 2.250 leads de anúncio;
 *   - só 819 tinham tag. A tag depende de a primeira mensagem bater com uma frase
 *     exata ("Vi seu anúncio EM Canoas" não aciona a regra que espera "DE"), e
 *     quem manda "Oi" nunca recebe;
 *   - 805 nem existem no `db_matrix`, porque só falaram com o robô — e os fluxos do
 *     n8n que alimentam a tabela não gravam atendimento sem atendente.
 *
 * O que NÃO dá para saber pelo rastreamento: a campanha. O relatório traz o
 * título do anúncio ("Contrate agora!"), que se repete entre campanhas e cidades,
 * e nenhum ID. Por isso os leads são agrupados por TÍTULO e por CIDADE, e o
 * investimento fica no nível da plataforma — sem ratear gasto por semelhança de
 * nome, que era a heurística da versão por tag. Quando o ID do anúncio vier, ele
 * entra como chave daqui.
 *
 * Outras decisões que continuam valendo:
 *
 * 1. `Leads_Manual = 453` era uma CONSTANTE digitada à mão no Power BI e
 *    alimentava seis medidas de destaque. Aqui o denominador é o lead, que muda
 *    com o filtro.
 *
 * 2. `Custo_Total_META` somava TUDO, inclusive as campanhas de vaga de emprego
 *    (R$ 202.517,74, 43,5% do gasto do Meta). Recrutamento não é captação de
 *    cliente: aqui é a família `vagas`, fora da conta por padrão.
 */
import {
  FAMILIAS_RECRUTAMENTO, FAMILIA_ROTULO, PLATAFORMAS,
  cidadeDe, identidadeDaCampanha, numeroBR, rotuloDaIdentidade,
} from './vocabulario.js';
import { chaveProtocolo } from './rastreamento.js';

export { FAMILIA_ROTULO, PLATAFORMAS };

/**
 * As classificações que contam como venda e como abandono, exatamente como no
 * relatório de origem. O `db_matrix` grava sem prefixo; o CSV do rastreamento
 * grava "STATUS ATENDIMENTO (0800) VENDAS - VENDA CONCLUÍDA" — ver
 * `classificacaoDe`.
 */
export const VENDA = 'VENDA CONCLUÍDA';
export const ABANDONO = 'FALTA DE CONTATO (SEM RETORNO CLIENTE)';

/**
 * O lead que não existe no `db_matrix`. Quase sempre é quem falou só com o robô;
 * pode também ser um atendimento ainda aberto, que o backup diário só grava
 * depois de finalizado.
 */
export const SEM_ATENDENTE = '(NÃO CHEGOU A ATENDENTE)';
export const SEM_CLASSIFICACAO = '(SEM CLASSIFICAÇÃO)';

const estado = {
  raw: { google: [], meta: [], rastreamento: [], lotes: [], matrix: [] },
  fontes: {},
  anuncios: [],      // um dia de veiculação, das duas plataformas
  campanhas: [],     // uma campanha de anúncio, agregada
  atendimentos: [],  // um lead de anúncio (protocolo do rastreamento)
  importacoes: [],   // as últimas importações do CSV
  dims: { plataformas: [], familias: [], cidades: [], anuncios: [], tipos: [], classificacoes: [], atendentes: [] },
  versao: 0,
  geradoEm: null,
  buildMs: null,
};

export const getEstadoCampanhas = () => estado;

/**
 * A tela abre assim que QUALQUER lado carregou, inclusive sem nenhum lead: antes
 * da primeira importação ela precisa abrir para mostrar o botão de importar.
 */
export const campanhasPronto = () => Boolean(estado.geradoEm);

export function setFonteCampanhas(nome, rows, meta = {}) {
  estado.raw[nome] = rows || [];
  estado.fontes[nome] = {
    updatedAt: new Date().toISOString(), rows: (rows || []).length, ms: meta.ms ?? null, error: null,
  };
}

/**
 * Situação de uma carga que não traz linhas para o modelo — hoje, a sincronização
 * do Meta pela API. Vai para `fontes`, que o indicador do topo da tela já lê:
 * falha de token aparece lá em vez de só no log do contêiner.
 */
export function registrarCargaCampanhas(nome, info) {
  estado.fontes[nome] = { ...info, updatedAt: new Date().toISOString(), error: null };
}

export function setFonteErroCampanhas(nome, err) {
  estado.fontes[nome] = {
    ...(estado.fontes[nome] || {}),
    error: String(err && err.message ? err.message : err),
    failedAt: new Date().toISOString(),
  };
}

const texto = (v) => (v == null ? '' : String(v).trim());
/** As datas chegam como 'YYYY-MM-DD HH:MM:SS'; só a data interessa aqui. */
const dia = (v) => texto(v).slice(0, 10) || null;

/**
 * A classificação em uma forma só.
 *
 * Vazio vem em TRÊS sabores no `db_matrix` (NULL, a string 'null' e ''), e o CSV
 * do rastreamento põe o prefixo da árvore antes do nome. Sem normalizar, a mesma
 * classificação aparece em duas fatias do gráfico.
 */
export const classificacaoDe = (v) => {
  const s = texto(v);
  if (!s || s.toLowerCase() === 'null') return null;
  return s.replace(/^STATUS ATENDIMENTO \(0800\) VENDAS\s*-\s*/i, '').trim().toUpperCase() || null;
};

/** `ativo_receptivo` grava 'Receptivo', 'Ativo' e também o número 1 (= receptivo). */
const ativoReceptivoDe = (v) => {
  const s = texto(v).toLowerCase();
  if (s === 'ativo') return 'Ativo';
  if (s === 'receptivo' || s === '1') return 'Receptivo';
  return s ? texto(v) : '(não informado)';
};

/**
 * O título do anúncio como rótulo.
 *
 * O emoji do começo às vezes chega como "?" (o Matrix perde o caractere) e às
 * vezes inteiro, então "? Quero falar no WhatsApp!" e "👉 Quero falar no
 * WhatsApp!" são o mesmo anúncio. Tudo que não é letra ou número no começo sai.
 */
export const tituloDe = (v) => texto(v)
  .replace(/^[^\p{L}\p{N}]+/u, '')
  .replace(/\s+/g, ' ')
  .trim() || '(sem título)';

const TIPO = { ad: 'Anúncio', post: 'Post impulsionado' };

/**
 * Os leads: o rastreamento agrupado por protocolo, com o desfecho do Matrix.
 *
 * O rastreamento tem uma linha por MENSAGEM que o cliente mandou dentro do
 * atendimento rastreado; o lead é o protocolo, e quem o define é a primeira.
 * O `db_matrix` tem uma linha por TRECHO do atendimento (cada transferência abre
 * outro): venda em qualquer trecho conta como venda, e atendente e classificação
 * vêm do último trecho que as tem.
 */
export function montarLeads(rastreamento, matrix) {
  const trechos = new Map();
  for (const r of matrix) {
    const k = chaveProtocolo(r.protocolo);
    if (!k) continue;
    const l = trechos.get(k);
    if (l) l.push(r); else trechos.set(k, [r]);
  }

  const porProtocolo = new Map();
  for (const r of rastreamento) {
    const k = chaveProtocolo(r.protocolo);
    if (!k) continue;
    const l = porProtocolo.get(k);
    if (l) l.push(r); else porProtocolo.set(k, [r]);
  }

  const leads = [];
  for (const [k, msgs] of porProtocolo) {
    msgs.sort((a, b) => texto(a.data_acesso).localeCompare(texto(b.data_acesso)) || Number(a.cod) - Number(b.cod));
    const primeira = msgs[0];
    const doMatrix = (trechos.get(k) || []).slice().sort((a, b) => Number(a.codigo) - Number(b.codigo));
    const noMatrix = doMatrix.length > 0;

    const ultimo = (campo, f = texto) => {
      for (let i = doMatrix.length - 1; i >= 0; i -= 1) {
        const v = f(doMatrix[i][campo]);
        if (v) return v;
      }
      return null;
    };
    const vendeu = doMatrix.some((t) => classificacaoDe(t.classificacao) === VENDA);
    const doCsv = msgs.map((m) => classificacaoDe(m.classificacao)).filter(Boolean).pop() || null;
    const classificacao = vendeu ? VENDA
      : ultimo('classificacao', classificacaoDe) || doCsv || (noMatrix ? SEM_CLASSIFICACAO : SEM_ATENDENTE);

    // a cidade que o anúncio ou o cliente nomeou — título primeiro, depois as mensagens
    const cidade = cidadeDe(primeira.titulo) || msgs.map((m) => cidadeDe(m.mensagem)).find(Boolean) || null;

    leads.push({
      protocolo: texto(primeira.protocolo),
      entrada: dia(primeira.data_acesso),
      entradaHora: texto(primeira.data_acesso),
      titulo: tituloDe(primeira.titulo),
      tipo: TIPO[texto(primeira.tipo).toLowerCase()] || texto(primeira.tipo) || '(não informado)',
      plataforma: 'meta',
      cidade,
      mensagem: texto(primeira.mensagem).slice(0, 300),
      mensagens: msgs.length,
      contato: texto(primeira.contato) || ultimo('contato'),
      telefone: texto(primeira.telefone),
      noMatrix,
      trechos: doMatrix.length,
      classificacao,
      venda: classificacao === VENDA,
      abandono: classificacao === ABANDONO,
      atendente: ultimo('atendente') || (noMatrix ? '(sem atendente)' : SEM_ATENDENTE),
      servico: ultimo('servico') || null,
      ativoReceptivo: noMatrix ? ativoReceptivoDe(ultimo('ativo_receptivo')) : '(não informado)',
      cpf: ultimo('cpf') || '',
      atendimento: noMatrix ? dia(doMatrix[0].data_atendimento) : null,
      finalizacao: noMatrix ? dia(doMatrix[doMatrix.length - 1].data_finalizacao) : null,
    });
  }
  return leads;
}

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
   * alcance.
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
      identidade: identidadeDaCampanha(nome, 'google', texto(r.campanha_id)),
      // as colunas de dinheiro do Google são varchar em português — ver numeroBR
      investimento: numeroBR(r.custo_txt),
      impressoes: Number(r.impressoes) || 0,
      cliques: Number(r.cliques) || 0,
      resultados: 0,
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
      identidade: identidadeDaCampanha(nome, 'meta', texto(r.campanha_id)),
      investimento: Number(r.gasto) || 0,
      impressoes: Number(r.impressoes) || 0,
      cliques: 0,
      resultados: Number(r.resultados) || 0,
      alcance: Number(r.alcance) || 0,
      conversoes: 0,
      estado: texto(r.estado),
    });
  }

  const atendimentos = montarLeads(estado.raw.rastreamento, estado.raw.matrix);

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
  estado.importacoes = estado.raw.lotes || [];
  estado.dims = {
    plataformas: uniq([...anuncios.map((a) => a.plataforma), ...atendimentos.map((a) => a.plataforma)]),
    familias: uniq(campanhas.map((c) => c.identidade.familia)),
    cidades: uniq([...campanhas.map((c) => c.identidade.cidade), ...atendimentos.map((a) => a.cidade)]),
    anuncios: uniq(atendimentos.map((a) => a.titulo)),
    tipos: uniq(atendimentos.map((a) => a.tipo)),
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
 */
export function parseFiltrosCampanhas(q = {}) {
  return {
    de: q.cde || null,
    ate: q.cate || null,
    plataforma: asArray(q.cplat),
    familia: asArray(q.cfam),
    cidade: asArray(q.ccid),
    anuncio: asArray(q.canun),
    tipo: asArray(q.ctipo),
    classificacao: asArray(q.cclass),
    atendente: asArray(q.catend),
    busca: q.cbusca ? String(q.cbusca).trim().toUpperCase() : null,
    incluirRecrutamento: String(q.crec || '') === '1',
  };
}

const noPeriodo = (d, flt) => !d || ((!flt.de || d >= flt.de) && (!flt.ate || d <= flt.ate));

/** Campanhas de anúncio depois dos filtros — o período recorta o DIA veiculado. */
export function anunciosFiltrados(flt) {
  return estado.anuncios.filter((a) => {
    if (!noPeriodo(a.dia, flt)) return false;
    const id = a.identidade;
    if (flt.plataforma && !flt.plataforma.includes(id.plataforma)) return false;
    if (flt.familia && !flt.familia.includes(id.familia)) return false;
    if (flt.cidade && !flt.cidade.includes(id.cidade || '(todas)')) return false;
    if (!flt.incluirRecrutamento && FAMILIAS_RECRUTAMENTO.has(id.familia)) return false;
    return true;
  });
}

/**
 * Leads depois dos filtros — o período recorta a ENTRADA (o primeiro contato).
 *
 * O filtro de TIPO DE CAMPANHA (`familia`) não recorta lead: o rastreamento não
 * diz de qual campanha o lead veio, só o título do anúncio. Fingir que recorta
 * mostraria o mesmo total com outro rótulo. A barra avisa isso.
 */
export function atendimentosFiltrados(flt) {
  return estado.atendimentos.filter((a) => {
    if (!noPeriodo(a.entrada, flt)) return false;
    if (flt.plataforma && !flt.plataforma.includes(a.plataforma)) return false;
    if (flt.cidade && !flt.cidade.includes(a.cidade || '(todas)')) return false;
    if (flt.anuncio && !flt.anuncio.includes(a.titulo)) return false;
    if (flt.tipo && !flt.tipo.includes(a.tipo)) return false;
    if (flt.classificacao && !flt.classificacao.includes(a.classificacao)) return false;
    if (flt.atendente && !flt.atendente.includes(a.atendente)) return false;
    if (flt.busca) {
      const alvo = `${a.contato} ${a.telefone} ${a.protocolo} ${a.cpf}`.toUpperCase();
      if (!alvo.includes(flt.busca)) return false;
    }
    return true;
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
