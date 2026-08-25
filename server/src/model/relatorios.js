/**
 * Modelo do relatório "COM - Relatórios Comercial" — o quarto modelo em memória.
 *
 * Os outros três (comercial, condomínios, leads) existem porque o GRÃO é diferente:
 * contrato, porta de splitter, lead. Aqui há quatro grãos novos ao mesmo tempo, e
 * nenhum deles é o contrato:
 *
 *   cesta      — um ITEM de contrato (produto ou serviço avulso)
 *   pesquisa   — uma PERGUNTA respondida numa pesquisa de cancelamento
 *   fila       — um PROTOCOLO de instalação em aberto
 *   base       — um CONTRATO com ponto de autenticação (cliente conectado)
 *
 * O contrato vendido continua vindo do modelo comercial (`store.js`): a consulta
 * `general` deste relatório é a mesma que o `base.sql` já replica. O que este modelo
 * acrescenta ao contrato é a PONTE HISTÓRICA do MariaDB — ver `pontes()` abaixo,
 * onde está medido por que ela entra filtrada e não inteira.
 */
import { getState } from './store.js';
import { clima } from '../clima.js';
import { contarDias } from '../feriados.js';
import { metas } from '../metas.js';

const norm = (v) => (v === null || v === undefined ? '' : String(v).trim());
const toIso = (v) => {
  if (!v) return null;
  if (v instanceof Date) {
    const d = new Date(v.getTime() - v.getTimezoneOffset() * 60000);
    return d.toISOString().slice(0, 10);
  }
  const s = String(v);
  return /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : null;
};
const numero = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

/** Marcas de acentuação, o que sobra depois de decompor em NFD. */
const ACENTOS = /[̀-ͯ]/g;

/** Chave de cidade: sem acento, sem caixa, sem pontuação de borda. */
const chaveCidade = (v) => norm(v)
  .normalize('NFD').replace(ACENTOS, '')
  .toUpperCase()
  .replace(/^[^A-Z0-9]+|[^A-Z0-9]+$/g, '')
  .replace(/\s+/g, ' ');

/**
 * Apelidos de cidade que só existem na ponte histórica do MariaDB, onde o dado foi
 * digitado à mão: '.SAPUCAIA' com ponto na frente, 'NSR' abreviado. Sem isso, a
 * cidade viraria uma linha nova na tabela de metas, com alvo zero — que é exatamente
 * o que acontece no relatório de origem.
 */
const APELIDOS_CIDADE = new Map([
  ['SAPUCAIA', 'Sapucaia do Sul'],
  ['NSR', 'Nova Santa Rita'],
  ['GRAVATAI', 'Gravataí'],
  ['PORTAO', 'Portão'],
]);

let estado = {
  versao: 0,
  geradoEm: null,
  buildMs: null,
  fontes: {},
  fatos: [],
  cesta: [],
  pesquisa: [],
  fila: [],
  base: [],
  clima: [],
  dims: {},
  avisos: {},
};

export const getEstadoRelatorios = () => estado;
export const relatoriosPronto = () => estado.fatos.length > 0;
export const fontePronta = (nome) => Boolean(estado.fontes[nome]?.updatedAt);
export const erroFonte = (nome) => estado.fontes[nome]?.error || null;

const fontesBrutas = {};

export function setFonteRelatorios(nome, rows, meta = {}) {
  fontesBrutas[nome] = rows;
  estado.fontes = {
    ...estado.fontes,
    [nome]: { rows: rows.length, ms: meta.ms ?? null, updatedAt: new Date().toISOString(), error: null },
  };
}

export function setFonteErroRelatorios(nome, err) {
  estado.fontes = {
    ...estado.fontes,
    [nome]: { ...(estado.fontes[nome] || {}), error: err?.message || String(err), updatedAt: new Date().toISOString() },
  };
}

// ---------------------------------------------------------------- a ponte
/**
 * As linhas da ponte histórica (`General_Commercial`, MariaDB) que entram no modelo.
 *
 * MEDIDO NO BANCO, no recorte de 2024: a tabela traz 26.218 linhas, e 25.805 delas
 * (98,4%) são o MESMO cliente na MESMA data que o Voalle já tem. Ela não é uma fonte
 * paralela de venda: é uma ponte da época em que a venda era registrada fora do
 * Voalle, e o período de 2024 está coberto pelos dois lados.
 *
 * As três leituras possíveis, todas medidas:
 *   A) não anexar nada ............................ 120.822 contratos
 *   B) anexar só o que o Voalle não tem ........... 121.266  (+444)
 *   C) literal do relatório de origem ............. 145.838  (+25.016)
 *
 * A origem faz (C): `Table.Combine` e depois `Table.Distinct` por cliente+contrato.
 * Como as linhas da ponte não têm contrato, cada cliente sobrevive como UMA linha de
 * contrato vazio — 25.016 linhas que duplicam venda já contada. É 21% de inflação em
 * 2024, e é por isso que esta tela vai mostrar total MENOR que o Power BI.
 *
 * Aqui fazemos (B): a ponte entra só onde o Voalle não tem aquele cliente naquele
 * dia. Preenche a lacuna real sem contar a mesma venda duas vezes.
 */
function pontes(linhas, fatosVoalle) {
  /**
   * Sem o Voalle carregado não há com o que comparar, e a ponte entraria INTEIRA.
   * Aconteceu na primeira carga: a consulta do MariaDB leva 1,3 s e a do Voalle 77 s,
   * então por um minuto e meio o modelo mostrou 26.211 contratos fantasmas. Esperar
   * a base é o certo — a ponte só existe para preencher lacuna dela.
   */
  if (!fatosVoalle.length) return { linhas: [], descartadas: linhas.length, semBase: true };

  const jaTem = new Set(fatosVoalle.map((f) => `${f.cliente.toUpperCase()}|${f.dtVenda}`));
  const cidadeConhecida = new Map();
  for (const f of fatosVoalle) {
    const k = chaveCidade(f.cidade);
    if (k && !cidadeConhecida.has(k)) cidadeConhecida.set(k, f.cidade);
  }

  const saida = [];
  let descartadas = 0;
  for (const r of linhas) {
    const cliente = norm(r.clientes);
    const dtVenda = toIso(r.data_criacao_contrato);
    if (!cliente || !dtVenda) { descartadas += 1; continue; }
    if (jaTem.has(`${cliente.toUpperCase()}|${dtVenda}`)) { descartadas += 1; continue; }

    const k = chaveCidade(r.cidade);
    const cidade = cidadeConhecida.get(k) || APELIDOS_CIDADE.get(k)
      || (k ? k.charAt(0) + k.slice(1).toLowerCase() : '');

    saida.push({
      origem: 'ponte',
      contrato: '',
      cliente,
      protocolo: null,
      cidade,
      bairro: '',
      vendedor: norm(r.vendedor),
      regiao: '',
      statusContrato: '',
      statusCancelamento: norm(r.status_cancelamento),
      dtCancelado: null,
      canal: '',
      tecnologia: norm(r.tecnologia).toUpperCase(),
      tipoSolicitacao: '',
      valor: numero(r.valor),
      dtVenda,
      horaVenda: null,
      dtCadastroCliente: toIso(r.cadastro_cliente),
      dtAtiv: toIso(r.data_ativacao),
      dtPagto: null,
      plano: '',
      equipe: '',
      situacao: '',
    });
  }
  return { linhas: saida, descartadas };
}

// -------------------------------------------------------------- construção
export function construirRelatorios() {
  const t0 = Date.now();
  const comercial = getState();
  const equipes = comercial.raw?.teams || [];
  const porVendedor = new Map();
  for (const t of equipes) {
    const nome = norm(t.vendedores);
    if (nome) porVendedor.set(nome.toUpperCase(), t);
  }

  // ---- contratos: o modelo comercial + a ponte ----------------------------
  const doVoalle = (comercial.facts || []).map((f) => ({ ...f, origem: 'voalle' }));
  const { linhas: daPonte, descartadas, semBase } = pontes(fontesBrutas.ponte || [], doVoalle);
  const fatos = doVoalle.concat(daPonte);

  // ---- cesta de produtos --------------------------------------------------
  const cesta = (fontesBrutas.cesta || []).map((r) => ({
    contrato: norm(r.contrato),
    tipoContrato: norm(r.tipo_contrato),
    valorPlano: numero(r.valor_plano),
    estagio: norm(r.estagio_contrato),
    statusContrato: norm(r.status_contrato),
    etiqueta: norm(r.etiqueta),
    descricaoEtiqueta: norm(r.descricao_etiqueta),
    servico: norm(r.servico_principal),
    codigoServico: norm(r.codigo_servico_principal),
    unidades: numero(r.unidades),
    valor: numero(r.valor),
    adicionadoEm: toIso(r.adicionado_em),
    situacaoItem: norm(r.situacao_item),
  }));

  // ---- pesquisa de cancelamento: abre o checklist -------------------------
  const pesquisa = [];
  let checklistInvalido = 0;
  for (const r of fontesBrutas.cancelamento || []) {
    const cabecalho = {
      protocolo: norm(r.protocolo),
      numeroProtocolo: norm(r.numero_protocolo),
      status: norm(r.status),
      criado: toIso(r.criado),
      colaborador: norm(r.colaborador),
      encerradoPor: norm(r.encerrado_por),
      cliente: norm(r.cliente),
      etiqueta: norm(r.etiqueta),
      contrato: norm(r.contrato),
      dataCancelamento: toIso(r.data_cancelamento),
      motivoCancelamento: norm(r.motivo_cancelamento),
      cidade: norm(r.cidade),
      rua: norm(r.rua),
      numero: norm(r.numero),
      bairro: norm(r.bairro),
    };
    let itens;
    try {
      itens = JSON.parse(r.checklist);
      if (!Array.isArray(itens)) throw new Error('checklist não é lista');
    } catch {
      // um checklist malformado perde as próprias respostas, não a consulta inteira
      checklistInvalido += 1;
      pesquisa.push({ ...cabecalho, ordem: '', pergunta: '', resposta: 'Vazio' });
      continue;
    }
    for (const it of itens) {
      pesquisa.push({
        ...cabecalho,
        ordem: norm(it?.order),
        pergunta: norm(it?.label),
        // A origem troca por SUBSTRING ('0'->'Não'), o que estragaria resposta em
        // texto livre. Medido: os valores são só null, '', '0' e '1' — então o
        // mapeamento exato dá o mesmo resultado e não tem o risco.
        resposta: it?.value === '1' ? 'Sim' : it?.value === '0' ? 'Não' : 'Vazio',
      });
    }
  }

  // ---- fila de instalação -------------------------------------------------
  const fila = (fontesBrutas.backlog || []).map((r) => ({
    protocolo: norm(r.protocolo),
    tipoId: Number(r.tipo_id) || null,
    tipoProtocolo: norm(r.tipo_protocolo),
    equipe: norm(r.equipe),
    cidade: norm(r.cidade),
    status: norm(r.status),
    criado: toIso(r.criado),
    noDetalhe: r.no_detalhe !== false,
  }));

  // ---- base de clientes ---------------------------------------------------
  const base = (fontesBrutas.base || []).map((r) => ({
    contrato: norm(r.contrato),
    data: toIso(r.data),
    descricao: norm(r.descricao),
    usuario: norm(r.usuario),
    cidade: norm(r.cidade),
    bairro: norm(r.bairro),
    pontoAcesso: norm(r.ponto_acesso),
    valor: numero(r.valor),
    tecnologia: norm(r.tecnologia) || '(sem ponto de acesso)',
  }));

  // ---- dimensões ----------------------------------------------------------
  const unico = (arr) => [...new Set(arr.filter(Boolean))].sort((a, b) => a.localeCompare(b, 'pt-BR'));
  const dims = {
    cidades: unico(fatos.map((f) => f.cidade)),
    bairros: unico(fatos.map((f) => f.bairro)),
    vendedores: unico(fatos.map((f) => f.vendedor)),
    equipes: unico([...fatos.map((f) => f.equipe), ...porVendedor.values()].map((v) => (typeof v === 'string' ? v : norm(v.equipes)))),
    situacoes: unico([...porVendedor.values()].map((t) => norm(t.situacao))),
    tecnologias: unico(fatos.map((f) => f.tecnologia)),
    statusContrato: unico(fatos.map((f) => f.statusContrato)),
    tiposSolicitacao: unico(fatos.map((f) => f.tipoSolicitacao)),
    servicos: unico(cesta.map((c) => c.servico)),
    codigosServico: unico(cesta.map((c) => c.codigoServico)),
    etiquetas: unico(cesta.map((c) => c.etiqueta)),
    tiposContrato: unico(cesta.map((c) => c.tipoContrato)),
    situacoesItem: unico(cesta.map((c) => c.situacaoItem)),
    perguntas: unico(pesquisa.map((p) => p.pergunta)),
    statusPesquisa: unico(pesquisa.map((p) => p.status)),
    cidadesPesquisa: unico(pesquisa.map((p) => p.cidade)),
    etiquetasPesquisa: unico(pesquisa.map((p) => p.etiqueta)),
    equipesFila: unico(fila.map((f) => f.equipe)),
    tiposFila: unico(fila.map((f) => f.tipoProtocolo)),
    cidadesFila: unico(fila.map((f) => f.cidade)),
    cidadesBase: unico(base.map((b) => b.cidade)),
    bairrosBase: unico(base.map((b) => b.bairro)),
    /**
     * Bairros de cada cidade. Existe porque o slicer da origem e uma HIERARQUIA
     * cidade > bairro: escolher Canoas deixa a lista de baixo com os bairros de
     * Canoas. Sem este mapa a lista mostrava os 277 bairros de todas as cidades, e
     * marcar um bairro de outra cidade zerava a tela sem explicacao.
     */
    bairrosPorCidade: Object.fromEntries(
      [...base.reduce((mapa, b) => {
        const cidade = b.cidade || '(sem cidade)';
        if (!mapa.has(cidade)) mapa.set(cidade, new Set());
        if (b.bairro) mapa.get(cidade).add(b.bairro);
        return mapa;
      }, new Map())].map(([cidade, bairros]) => [
        cidade, [...bairros].sort((x, y) => x.localeCompare(y, 'pt-BR')),
      ]),
    ),
    tecnologiasBase: unico(base.map((b) => b.tecnologia)),
    cidadesClima: unico((clima().linhas || []).map((l) => l.cidade)),
  };

  estado = {
    versao: estado.versao + 1,
    geradoEm: new Date().toISOString(),
    buildMs: Date.now() - t0,
    fontes: estado.fontes,
    fatos,
    cesta,
    pesquisa,
    fila,
    base,
    clima: clima().linhas || [],
    dims,
    avisos: {
      pontesUsadas: daPonte.length,
      pontesDescartadas: descartadas,
      pontesEsperandoBase: Boolean(semBase),
      checklistInvalido,
      filaSemDetalhe: fila.filter((f) => !f.noDetalhe).length,
      climaErro: clima().erro || null,
    },
  };
  return estado;
}

// ----------------------------------------------------------------- filtros
const lista = (v) => (v === undefined || v === null || v === '' ? []
  : String(v).split(',').map((s) => s.trim()).filter(Boolean));

const dentro = (data, de, ate) => {
  if (!data) return !de && !ate;
  if (de && data < de) return false;
  if (ate && data > ate) return false;
  return true;
};

const combinaLista = (valor, alvos) => !alvos.length || alvos.includes(valor);

/** Filtros da aba GERAL. */
export function parseFiltrosGeral(q = {}) {
  return {
    de: q.rde || '',
    ate: q.rate || '',
    cidades: lista(q.rcidade),
    bairros: lista(q.rbairro),
    vendedores: lista(q.rvend),
    equipes: lista(q.requipe),
    situacoes: lista(q.rsit),
    status: lista(q.rstatus),
    tecnologias: lista(q.rtec),
    servicos: lista(q.rserv),
    etiquetas: lista(q.retiq),
    situacoesItem: lista(q.ritem),
    busca: norm(q.rbusca).toLowerCase(),
  };
}

/** Filtros da aba RESUMO - VENDAS. */
export function parseFiltrosResumo(q = {}) {
  return {
    de: q.vde || '',
    ate: q.vate || '',
    cidades: lista(q.vcidade),
    vendedores: lista(q.vvend),
    equipes: lista(q.vequipe),
    situacoes: lista(q.vsit),
    status: lista(q.vstatus),
    tecnologias: lista(q.vtec),
    tipos: lista(q.vtipo),
    granularidade: q.vg === 'dia' ? 'dia' : 'mes',
  };
}

/** Filtros da aba QUADRO EQUIPES. */
export function parseFiltrosEquipes(q = {}) {
  return {
    de: q.qde || '',
    ate: q.qate || '',
    vendedores: lista(q.qvend),
    equipes: lista(q.qequipe),
    situacoes: lista(q.qsit),
    tecnologias: lista(q.qtec),
    somenteAtivos: q.qativo === '1',
  };
}

/** Filtros da aba RELATÓRIO DIÁRIO. */
export function parseFiltrosDiario(q = {}) {
  return {
    de: q.dde || '',
    ate: q.date || '',
    cidades: lista(q.dcidade),
    equipes: lista(q.dequipe),
    situacoes: lista(q.dsit),
    tecnologias: lista(q.dtec),
    tipos: lista(q.dtipo),
  };
}

/** Filtros da aba CLIENTES BASE. */
export function parseFiltrosBase(q = {}) {
  return {
    de: q.bde || '',
    ate: q.bate || '',
    cidades: lista(q.bcidade),
    bairros: lista(q.bbairro),
    tecnologias: lista(q.btec),
    busca: norm(q.bbusca).toLowerCase(),
  };
}

/** Filtros da aba PESQUISA CANCELAMENTO. */
export function parseFiltrosPesquisa(q = {}) {
  return {
    de: q.pde || '',
    ate: q.pate || '',
    cidades: lista(q.pcidade),
    etiquetas: lista(q.petiq),
    status: lista(q.pstatus),
    perguntas: lista(q.pperg),
    respostas: lista(q.presp),
    busca: norm(q.pbusca).toLowerCase(),
  };
}

/** Filtros da aba CLIMA. */
export function parseFiltrosClima(q = {}) {
  return { cidades: lista(q.ccidade) };
}

// ------------------------------------------------------------ combinadores
function fatoCombina(f, flt) {
  if (!dentro(f.dtVenda, flt.de, flt.ate)) return false;
  if (!combinaLista(f.cidade, flt.cidades || [])) return false;
  if (!combinaLista(f.bairro, flt.bairros || [])) return false;
  if (!combinaLista(f.vendedor, flt.vendedores || [])) return false;
  if (!combinaLista(f.equipe, flt.equipes || [])) return false;
  if (!combinaLista(f.situacao, flt.situacoes || [])) return false;
  if (!combinaLista(f.statusContrato, flt.status || [])) return false;
  if (!combinaLista(f.tecnologia, flt.tecnologias || [])) return false;
  if (!combinaLista(f.tipoSolicitacao, flt.tipos || [])) return false;
  if (flt.busca) {
    const alvo = `${f.cliente} ${f.contrato} ${f.protocolo || ''}`.toLowerCase();
    if (!alvo.includes(flt.busca)) return false;
  }
  return true;
}

export const fatosFiltrados = (flt) => estado.fatos.filter((f) => fatoCombina(f, flt));

// ------------------------------------------------------------------ apoio
const AMOSTRA = 400;

const contarDistintos = (itens, chave) => new Set(itens.map(chave).filter(Boolean)).size;

const somar = (itens, chave) => itens.reduce((a, i) => a + (chave(i) || 0), 0);

/** Agrupa e ordena por contagem, com dobra da cauda em `limite`. */
function agrupar(itens, chaveFn, { limite = null, rotuloVazio = '(sem informação)' } = {}) {
  const mapa = new Map();
  for (const i of itens) {
    const k = chaveFn(i) || rotuloVazio;
    mapa.set(k, (mapa.get(k) || 0) + 1);
  }
  const linhas = [...mapa.entries()].map(([nome, valor]) => ({ nome, valor }))
    .sort((a, b) => b.valor - a.valor || a.nome.localeCompare(b.nome, 'pt-BR'));
  if (!limite || linhas.length <= limite) return linhas;
  const topo = linhas.slice(0, limite);
  const resto = linhas.slice(limite);
  topo.push({ nome: `Outros (${resto.length} itens)`, valor: resto.reduce((a, l) => a + l.valor, 0), cauda: true });
  return topo;
}

/** Rótulo de período: 'YYYY-MM' ou 'YYYY-MM-DD'. */
const periodoDe = (data, granularidade) => (
  !data ? '' : (granularidade === 'dia' ? data : data.slice(0, 7)));

/**
 * Série temporal com séries nomeadas. Devolve `{ periodos, series }` — a tela recebe
 * a matriz já montada, em vez de reagrupar no navegador.
 */
function serie(itens, { data, categoria = null, granularidade = 'mes', limiteSeries = 6 }) {
  const periodos = new Set();
  const porSerie = new Map();
  for (const i of itens) {
    const p = periodoDe(data(i), granularidade);
    if (!p) continue;
    periodos.add(p);
    const nome = categoria ? (categoria(i) || '(sem informação)') : 'Total';
    if (!porSerie.has(nome)) porSerie.set(nome, new Map());
    const m = porSerie.get(nome);
    m.set(p, (m.get(p) || 0) + 1);
  }
  const ordenados = [...periodos].sort();
  const totalDe = (m) => [...m.values()].reduce((a, v) => a + v, 0);
  let nomes = [...porSerie.keys()].sort((a, b) => totalDe(porSerie.get(b)) - totalDe(porSerie.get(a)));
  let cauda = [];
  if (nomes.length > limiteSeries) {
    cauda = nomes.slice(limiteSeries);
    nomes = nomes.slice(0, limiteSeries);
  }
  const series = nomes.map((nome) => ({
    nome,
    pontos: ordenados.map((p) => porSerie.get(nome).get(p) || 0),
  }));
  if (cauda.length) {
    series.push({
      nome: `Outros (${cauda.length})`,
      cauda: true,
      pontos: ordenados.map((p) => cauda.reduce((a, n) => a + (porSerie.get(n).get(p) || 0), 0)),
    });
  }
  return { periodos: ordenados, series };
}

const contratosDistintos = (fatos) => new Set(fatos.map((f) => f.cliente).filter(Boolean)).size;

/**
 * Índice protocolo -> fato, montado uma vez por chamada.
 *
 * A fila tem 170 linhas hoje e os fatos são 120 mil; procurar o fato de cada linha
 * com `find` seriam 20 milhões de comparações por requisição. O índice troca isso por
 * uma passada.
 */
function indicePorProtocolo() {
  const idx = new Map();
  for (const f of estado.fatos) {
    if (f.protocolo) idx.set(String(f.protocolo), f);
  }
  return idx;
}

// ------------------------------------------------------------ aba GERAL
/**
 * Três tabelas de consulta: contrato, cesta de produtos e fila de instalação.
 *
 * As três vivem na mesma página do relatório de origem e compartilham o recorte de
 * data e de contrato, mas cada uma tem os seus próprios seletores. A cesta e a fila
 * se ligam ao contrato — então, quando um filtro de contrato está ativo, elas
 * respeitam o conjunto de contratos que sobrou.
 */
export function painelGeral(flt) {
  const fatos = fatosFiltrados(flt);
  const contratos = new Set(fatos.map((f) => f.contrato).filter(Boolean));
  const filtrandoContrato = Boolean(
    flt.de || flt.ate || flt.cidades.length || flt.bairros.length || flt.vendedores.length
    || flt.equipes.length || flt.situacoes.length || flt.status.length
    || flt.tecnologias.length || flt.busca,
  );

  const cesta = estado.cesta.filter((c) => (
    combinaLista(c.servico, flt.servicos)
    && combinaLista(c.etiqueta, flt.etiquetas)
    && combinaLista(c.situacaoItem, flt.situacoesItem)
    && (!filtrandoContrato || contratos.has(c.contrato))
  ));

  const porProtocolo = indicePorProtocolo();
  const fila = estado.fila.filter((f) => f.noDetalhe).map((f) => {
    // a fila traz protocolo, não contrato: o encontro é pelo protocolo do fato
    const fato = porProtocolo.get(f.protocolo);
    return {
      ...f,
      contrato: fato?.contrato || '',
      statusContrato: fato?.statusContrato || '',
      cliente: fato?.cliente || '',
      bairro: fato?.bairro || '',
      canal: fato?.canal || '',
      vendedor: fato?.vendedor || '',
    };
  });

  return {
    cartoes: {
      contratos: fatos.length,
      clientes: contratosDistintos(fatos),
      valor: somar(fatos, (f) => f.valor),
      itensCesta: cesta.length,
      naFila: fila.length,
    },
    contratos: {
      total: fatos.length,
      amostra: fatos.slice()
        .sort((a, b) => String(b.dtVenda).localeCompare(String(a.dtVenda)))
        .slice(0, AMOSTRA)
        .map((f) => ({
          dtVenda: f.dtVenda,
          horaVenda: f.horaVenda,
          contrato: f.contrato,
          cliente: f.cliente,
          cidade: f.cidade,
          bairro: f.bairro,
          vendedor: f.vendedor,
          situacao: f.situacao,
          statusContrato: f.statusContrato,
          dtCancelado: f.dtCancelado,
          statusCancelamento: f.statusCancelamento,
          dtAtiv: f.dtAtiv,
          valor: f.valor,
          tecnologia: f.tecnologia,
          origem: f.origem,
        })),
    },
    cesta: {
      total: cesta.length,
      valor: somar(cesta, (c) => c.valor),
      amostra: cesta.slice(0, AMOSTRA),
    },
    fila: { total: fila.length, amostra: fila.slice(0, AMOSTRA) },
    // O detalhe da fila na origem não enxerga a 'Equipe Field Service'; o total, sim.
    filaOculta: estado.avisos.filaSemDetalhe || 0,
    porOrigem: {
      voalle: fatos.filter((f) => f.origem === 'voalle').length,
      ponte: fatos.filter((f) => f.origem === 'ponte').length,
    },
  };
}

// ---------------------------------------------------- aba RESUMO - VENDAS
/** Três colunas do relatório: total no tempo, por tecnologia e por cidade. */
export function painelResumo(flt) {
  const fatos = fatosFiltrados(flt);
  const g = flt.granularidade;
  return {
    cartoes: {
      contratos: fatos.length,
      clientes: contratosDistintos(fatos),
      valor: somar(fatos, (f) => f.valor),
      ticket: fatos.length ? somar(fatos, (f) => f.valor) / fatos.length : 0,
    },
    granularidade: g,
    total: serie(fatos, { data: (f) => f.dtVenda, granularidade: g }),
    porTecnologia: serie(fatos, { data: (f) => f.dtVenda, categoria: (f) => f.tecnologia, granularidade: g }),
    porCidade: serie(fatos, { data: (f) => f.dtVenda, categoria: (f) => f.cidade, granularidade: g, limiteSeries: 6 }),
  };
}

// ---------------------------------------------------- aba QUADRO EQUIPES
/**
 * Vendedor × (cadastro, ativação, primeiro pagamento, churn).
 *
 * O %CHURN da origem é `(cadastros - ativos) / cadastros`: não é cancelamento, é a
 * fração do que foi vendido e NÃO chegou a ativar. O nome engana, então a tela diz
 * a fórmula no cartão — indicador ambíguo virou número errado em apresentação mais
 * de uma vez neste projeto.
 */
export function painelEquipes(flt) {
  const fatos = estado.fatos.filter((f) => (
    combinaLista(f.vendedor, flt.vendedores)
    && combinaLista(f.equipe, flt.equipes)
    && combinaLista(f.situacao, flt.situacoes)
    && combinaLista(f.tecnologia, flt.tecnologias)
    && (!flt.somenteAtivos || f.vendedorAtivo === true)
  ));

  const porVendedor = new Map();
  for (const f of fatos) {
    const nome = f.vendedor || '(sem vendedor)';
    if (!porVendedor.has(nome)) {
      porVendedor.set(nome, {
        vendedor: nome, equipe: f.equipe, situacao: f.situacao,
        cadastros: 0, ativos: 0, pagamentos: 0, valor: 0,
      });
    }
    const l = porVendedor.get(nome);
    if (dentro(f.dtVenda, flt.de, flt.ate)) { l.cadastros += 1; l.valor += f.valor; }
    if (dentro(f.dtAtiv, flt.de, flt.ate) && f.dtAtiv) l.ativos += 1;
    if (dentro(f.dtPagto, flt.de, flt.ate) && f.dtPagto) l.pagamentos += 1;
  }

  const linhas = [...porVendedor.values()]
    .filter((l) => l.cadastros || l.ativos || l.pagamentos)
    .map((l) => ({ ...l, churn: l.cadastros ? (l.cadastros - l.ativos) / l.cadastros : 0 }))
    .sort((a, b) => b.cadastros - a.cadastros || a.vendedor.localeCompare(b.vendedor, 'pt-BR'));

  const totais = linhas.reduce((a, l) => ({
    cadastros: a.cadastros + l.cadastros,
    ativos: a.ativos + l.ativos,
    pagamentos: a.pagamentos + l.pagamentos,
    valor: a.valor + l.valor,
  }), { cadastros: 0, ativos: 0, pagamentos: 0, valor: 0 });

  return {
    linhas,
    totais: { ...totais, churn: totais.cadastros ? (totais.cadastros - totais.ativos) / totais.cadastros : 0 },
    vendedores: linhas.length,
  };
}

// -------------------------------------------------- aba RELATÓRIO DIÁRIO
/** Primeiro e último dia do mês corrente, que é o padrão desta tela. */
function mesCorrente(hoje = new Date().toISOString().slice(0, 10)) {
  const [ano, mes] = hoje.split('-');
  const ultimo = new Date(Date.UTC(Number(ano), Number(mes), 0)).toISOString().slice(0, 10);
  return { de: `${ano}-${mes}-01`, ate: ultimo };
}

/**
 * Uma linha de meta: alvo, realizado, projeção e as duas médias por dia.
 *
 * A régua vem do relatório de origem:
 *   meta/dia  = meta / dias PRODUTIVOS  (o mês inteiro — é alvo, não histórico)
 *   média/dia = realizado / dias TRABALHADOS (só o que já passou)
 *   projeção  = média/dia × dias produtivos
 *
 * Os dois divisores são diferentes de propósito, e é isso que faz a projeção
 * significar algo: ela pega o ritmo do que já aconteceu e estende pelo mês todo.
 */
function linhaMeta(nome, realizado, meta, dias) {
  const mediaDia = dias.uteis ? realizado / dias.uteis : 0;
  return {
    nome,
    meta,
    realizado,
    percentual: meta ? realizado / meta : null,
    metaDia: dias.produtivos ? meta / dias.produtivos : 0,
    mediaDia,
    projecao: Math.round(mediaDia * dias.produtivos),
  };
}

function tabelaMetas(fatos, dataDe, alvos, dias, rotuloTotal = 'Total') {
  const porCidade = new Map();
  for (const f of fatos) {
    const d = dataDe(f);
    if (!d) continue;
    const cidade = f.cidade || '(sem cidade)';
    porCidade.set(cidade, (porCidade.get(cidade) || 0) + 1);
  }
  // cidade com meta e sem realizado também aparece: alvo não cumprido é informação
  for (const cidade of Object.keys(alvos)) {
    if (!porCidade.has(cidade)) porCidade.set(cidade, 0);
  }
  const linhas = [...porCidade.entries()]
    .map(([cidade, realizado]) => linhaMeta(cidade, realizado, alvos[cidade] || 0, dias))
    .sort((a, b) => b.realizado - a.realizado || a.nome.localeCompare(b.nome, 'pt-BR'));

  const realizado = linhas.reduce((a, l) => a + l.realizado, 0);
  const meta = linhas.reduce((a, l) => a + l.meta, 0);
  return { linhas, total: linhaMeta(rotuloTotal, realizado, meta, dias) };
}

/**
 * A tela mais densa do relatório: meta × realizado × projeção, para venda e para
 * ativação, em fibra e em rádio, mais a fila de instalação e o clima.
 */
/**
 * Clientes que o relatório de origem EXCLUI da contagem de ativação, por nome, no
 * filtro de cada visual de ativos. São contratos institucionais que distorcem a
 * conta: entram como uma ativação e valem por um prédio inteiro.
 *
 * Ficam aqui e a tela diz que existem — recorte invisível gera chamado. Não valem
 * para VENDA, só para ATIVAÇÃO, que é como está na origem.
 */
const EXCLUIDOS_DE_ATIVACAO = [
  'Prefeitura Municipal de São Leopoldo/RS',
  'RESIDENCIAL MORRO DO ESPELHO',
];

/**
 * As duas famílias de equipe da fila de instalação, na divisão que a origem faz:
 *
 *   BKO       — 'Validação de dados - BKO': protocolo que ainda não foi para a rua,
 *               parado na conferência de cadastro.
 *   AGENDADOS — as equipes de campo: já tem agenda, falta executar.
 *
 * É a divisão que importa operacionalmente, e não a que eu tinha feito (fibra contra
 * rádio): as duas tabelas respondem "quantos estão presos no escritório" e "quantos
 * estão na fila da rua". O tipo (fibra/rádio) é o outro eixo, e vira o par de baixo.
 */
const EQUIPE_BKO = ['Validação de dados - BKO'];
const EQUIPES_AGENDADAS = [
  'Ativações - Fibra',
  'Instalação [SLE/SPS/NHO/EIO/CAN]',
  'Operacional Fibra – Instalações',
  'Equipe Field Service',
  'Operacional Radio',
  'Instalação [Nova Santa Rita, Esteio]',
  'Instalação [Triunfo]',
];

const TIPO_FIBRA = 'TEC - Instalação de Fibra';
const TIPO_RADIO = 'TEC - Instalação de Rádio';

/**
 * A tela mais densa do relatório de origem: 34 visuais em três blocos de tecnologia.
 *
 * A ESTRUTURA É POR TECNOLOGIA, e isso não é detalhe de layout: cada visual de lá
 * tem `TECNOLOGIA` no próprio filtro, e as metas de rádio são um número único
 * enquanto as de fibra são por cidade. Uma tabela só, somando as três, responderia
 * uma pergunta que ninguém faz.
 *
 *   FIBRA     — vendas e ativações por cidade, contra meta, mais os cartões
 *   RÁDIO     — o mesmo, com meta única (não por cidade)
 *   TELEFONIA — só contagem e média por dia; não tem meta na origem
 */
export function painelDiario(flt) {
  const padrao = mesCorrente();
  const de = flt.de || padrao.de;
  const ate = flt.ate || padrao.ate;
  const dias = contarDias(de, ate);
  const alvos = metas();

  const base = estado.fatos.filter((f) => (
    combinaLista(f.cidade, flt.cidades)
    && combinaLista(f.equipe, flt.equipes)
    && combinaLista(f.situacao, flt.situacoes)
    && combinaLista(f.tipoSolicitacao, flt.tipos)
    && combinaLista(f.tecnologia, flt.tecnologias)
  ));

  const daTecnologia = (tec) => base.filter((f) => f.tecnologia === tec);
  const vendidos = (itens) => itens.filter((f) => dentro(f.dtVenda, de, ate));
  const excluido = new Set(EXCLUIDOS_DE_ATIVACAO.map((n) => n.toUpperCase()));
  const ativados = (itens) => itens.filter((f) => (
    f.dtAtiv && dentro(f.dtAtiv, de, ate) && !excluido.has(f.cliente.toUpperCase())));

  const fibra = daTecnologia('FIBRA');
  const radio = daTecnologia('RÁDIO');
  const telefonia = daTecnologia('TELEFONIA');

  const vendaFibra = vendidos(fibra);
  const ativoFibra = ativados(fibra);
  const vendaRadio = vendidos(radio);
  const ativoRadio = ativados(radio);
  const vendaTelefonia = vendidos(telefonia);

  /** Quantas ativações a exclusão de clientes tirou da conta, para a tela dizer. */
  const tirados = (itens) => itens.filter((f) => (
    f.dtAtiv && dentro(f.dtAtiv, de, ate) && excluido.has(f.cliente.toUpperCase()))).length;

  // ---- fila de instalação: equipe (BKO / agendados) x tipo (fibra / rádio) ----
  const filaDe = (tipo, equipes) => {
    const linhas = estado.fila.filter((f) => (
      f.tipoProtocolo === tipo
      && equipes.includes(f.equipe)
      && combinaLista(f.cidade, flt.cidades)));
    return {
      total: linhas.length,
      porCidade: agrupar(linhas, (f) => f.cidade, { rotuloVazio: '(sem cidade)' }),
    };
  };

  // ---- clima do período, cidade x dia ----------------------------------------
  // Porto Alegre fica fora: é o filtro do visual de origem. A cidade existe na
  // busca da Open-Meteo porque as outras seis são a região metropolitana dela, mas
  // a operação não instala lá.
  const linhasClima = estado.clima.filter((l) => l.data >= de && l.data <= ate
    && l.cidade !== 'Porto Alegre'
    && (!flt.cidades.length || flt.cidades.includes(l.cidade)));
  const diasClima = [...new Set(linhasClima.map((l) => l.data))].sort();
  const cidadesClima = [...new Set(linhasClima.map((l) => l.cidade))]
    .sort((a, b) => a.localeCompare(b, 'pt-BR'));
  const mapaClima = new Map(linhasClima.map((l) => [`${l.cidade}|${l.data}`, l]));

  const porCidadeSimples = (itens) => {
    const mapa = new Map();
    for (const f of itens) {
      const cidade = f.cidade || '(sem cidade)';
      mapa.set(cidade, (mapa.get(cidade) || 0) + 1);
    }
    return [...mapa.entries()]
      .map(([cidade, vendas]) => ({
        nome: cidade, vendas, mediaDia: dias.uteis ? vendas / dias.uteis : 0,
      }))
      .sort((a, b) => b.vendas - a.vendas || a.nome.localeCompare(b.nome, 'pt-BR'));
  };

  return {
    periodo: { de, ate, padrao: !flt.de && !flt.ate },
    dias,
    metasOrigem: alvos.origem,

    fibra: {
      vendas: tabelaMetas(vendaFibra, (f) => f.dtVenda, alvos.vendas, dias),
      ativos: tabelaMetas(ativoFibra, (f) => f.dtAtiv, alvos.ativos, dias),
      cartoes: {
        ativos: ativoFibra.length,
        projecao: linhaMeta('', ativoFibra.length, 0, dias).projecao,
        valor: somar(ativoFibra, (f) => f.valor),
        vendas: vendaFibra.length,
      },
    },
    radio: {
      // Meta de rádio é número único na origem, não por cidade.
      vendas: linhaMeta('Vendas', vendaRadio.length, alvos.vendasRadio, dias),
      ativos: linhaMeta('Ativações', ativoRadio.length, alvos.ativosRadio, dias),
      cartoes: {
        ativos: ativoRadio.length,
        projecao: linhaMeta('', ativoRadio.length, 0, dias).projecao,
        valor: somar(ativoRadio, (f) => f.valor),
        vendas: vendaRadio.length,
      },
    },
    telefonia: {
      // Sem meta na origem: só contagem e média por dia.
      linhas: porCidadeSimples(vendaTelefonia),
      total: {
        nome: 'Total',
        vendas: vendaTelefonia.length,
        mediaDia: dias.uteis ? vendaTelefonia.length / dias.uteis : 0,
      },
    },

    fila: {
      bkoFibra: filaDe(TIPO_FIBRA, EQUIPE_BKO),
      agendadosFibra: filaDe(TIPO_FIBRA, EQUIPES_AGENDADAS),
      bkoRadio: filaDe(TIPO_RADIO, EQUIPE_BKO),
      agendadosRadio: filaDe(TIPO_RADIO, EQUIPES_AGENDADAS),
    },

    clima: {
      dias: diasClima,
      cidades: cidadesClima,
      celulas: cidadesClima.map((c) => ({
        cidade: c,
        dias: diasClima.map((d) => {
          const l = mapaClima.get(`${c}|${d}`);
          return l ? { classificacao: l.classificacao, mm: l.mm, tipo: l.tipo } : null;
        }),
      })),
      erro: estado.avisos.climaErro || null,
    },

    // O recorte que a origem faz sem dizer, agora dito.
    excluidos: {
      clientes: EXCLUIDOS_DE_ATIVACAO,
      ativacoesFibra: tirados(fibra),
      ativacoesRadio: tirados(radio),
    },
  };
}

// ---------------------------------------------------- aba CLIENTES BASE
/**
 * Base acumulada de clientes conectados.
 *
 * A medida da origem (`AcumuladoContratosBase`) é contagem distinta de contrato ATÉ
 * a data — total corrente, não fluxo do dia. É por isso que a matriz cresce sempre:
 * cada coluna é o tamanho da base naquele dia, e não quantos entraram nele.
 */
export function painelBase(flt) {
  const linhas = estado.base.filter((b) => (
    dentro(b.data, flt.de, flt.ate)
    && combinaLista(b.cidade, flt.cidades)
    && combinaLista(b.bairro, flt.bairros)
    && combinaLista(b.tecnologia, flt.tecnologias)
    && (!flt.busca || `${b.contrato} ${b.usuario} ${b.descricao}`.toLowerCase().includes(flt.busca))
  ));

  /** Acumulado distinto de contrato por data, para cada valor de `chave`. */
  function acumulado(chaveFn, { limite = 12 } = {}) {
    const datas = [...new Set(linhas.map((b) => b.data).filter(Boolean))].sort();
    const chaves = agrupar(linhas, chaveFn, { limite }).map((l) => l.nome);
    const naCauda = new Set(chaves.filter((c) => /^Outros \(/.test(c)));
    const vistos = new Map(); // chave -> Set(contrato)
    const porData = new Map(); // data -> Map(chave -> tamanho)
    const ordenadas = linhas.slice().sort((a, b) => String(a.data).localeCompare(String(b.data)));
    let i = 0;
    for (const data of datas) {
      while (i < ordenadas.length && ordenadas[i].data === data) {
        const bruto = chaveFn(ordenadas[i]) || '(sem informação)';
        const k = chaves.includes(bruto) ? bruto : [...naCauda][0] || bruto;
        if (!vistos.has(k)) vistos.set(k, new Set());
        vistos.get(k).add(ordenadas[i].contrato);
        i += 1;
      }
      porData.set(data, new Map([...vistos].map(([k, s]) => [k, s.size])));
    }
    return {
      datas,
      chaves,
      celulas: chaves.map((k) => ({
        nome: k,
        pontos: datas.map((d) => porData.get(d)?.get(k) || 0),
      })),
    };
  }

  const contratos = new Set(linhas.map((b) => b.contrato).filter(Boolean));
  return {
    cartoes: {
      contratos: contratos.size,
      valorTotal: somar(linhas, (b) => b.valor),
      valorMedio: linhas.length ? somar(linhas, (b) => b.valor) / linhas.length : 0,
      cidades: new Set(linhas.map((b) => b.cidade).filter(Boolean)).size,
    },
    porCidade: acumulado((b) => b.cidade, { limite: 10 }),
    // 8 e nao 12: a legenda de doze bairros num card de meia largura come mais
    // altura que o proprio grafico em tela de 1366, e o grafico passava a rolar
    // dentro do card. Quem precisa de um bairro especifico usa o painel lateral.
    porBairro: acumulado((b) => b.bairro, { limite: 8 }),
    porTecnologia: (() => {
      const mapa = new Map();
      for (const b of linhas) {
        const t = b.tecnologia;
        const c = b.cidade || '(sem cidade)';
        if (!mapa.has(t)) mapa.set(t, new Map());
        const m = mapa.get(t);
        if (!m.has(c)) m.set(c, new Set());
        m.get(c).add(b.contrato);
      }
      const cidades = [...new Set(linhas.map((b) => b.cidade || '(sem cidade)'))]
        .sort((a, b) => a.localeCompare(b, 'pt-BR'));
      return {
        cidades,
        linhas: [...mapa.entries()].map(([tecnologia, m]) => ({
          tecnologia,
          valores: cidades.map((c) => m.get(c)?.size || 0),
          total: [...m.values()].reduce((a, s) => a + s.size, 0),
        })).sort((a, b) => b.total - a.total),
      };
    })(),
    total: linhas.length,
  };
}

// ---------------------------------------- aba PESQUISA CANCELAMENTO
/**
 * A pesquisa feita no encerramento do cancelamento.
 *
 * DIVERGÊNCIA QUE VALE LER
 * As medidas da origem (`Qtd Sim2`, `Qtd Não2`, `Qtd Vazio2`) são todas
 * `CALCULATE(DISTINCTCOUNT(Protocolo), ISBLANK(valor) || valor = "<X>")`. O `||`
 * inclui os vazios nas TRÊS colunas — e como 90% das respostas são vazias, as
 * colunas "Sim" e "Não" mostram quase o mesmo número enorme, e nenhuma delas
 * responde à pergunta. É erro de cópia, não intenção.
 *
 * Aqui cada resposta conta na sua coluna, e a coluna de vazios aparece ao lado, para
 * quem quiser conferir que a soma fecha com o total de protocolos.
 */
export function painelPesquisa(flt) {
  const itens = estado.pesquisa.filter((p) => (
    dentro(p.criado, flt.de, flt.ate)
    && combinaLista(p.cidade, flt.cidades)
    && combinaLista(p.etiqueta, flt.etiquetas)
    && combinaLista(p.status, flt.status)
    && combinaLista(p.pergunta, flt.perguntas)
    && combinaLista(p.resposta, flt.respostas)
    && (!flt.busca || `${p.cliente} ${p.contrato} ${p.numeroProtocolo}`.toLowerCase().includes(flt.busca))
  ));

  // cabeçalho: um por protocolo
  const porProtocolo = new Map();
  for (const p of itens) {
    if (!porProtocolo.has(p.numeroProtocolo)) porProtocolo.set(p.numeroProtocolo, p);
  }
  const protocolos = [...porProtocolo.values()]
    .sort((a, b) => String(b.criado).localeCompare(String(a.criado)));

  // por pergunta: Sim / Não / Vazio, contando PROTOCOLO distinto
  const porPergunta = new Map();
  for (const p of itens) {
    if (!p.pergunta) continue;
    const k = `${p.ordem}|${p.pergunta}`;
    if (!porPergunta.has(k)) {
      porPergunta.set(k, { ordem: p.ordem, pergunta: p.pergunta, sim: new Set(), nao: new Set(), vazio: new Set() });
    }
    const l = porPergunta.get(k);
    const caixa = p.resposta === 'Sim' ? l.sim : p.resposta === 'Não' ? l.nao : l.vazio;
    caixa.add(p.numeroProtocolo);
  }
  const perguntas = [...porPergunta.values()]
    .map((l) => {
      const sim = l.sim.size;
      const nao = l.nao.size;
      const respondidas = sim + nao;
      return {
        ordem: l.ordem,
        pergunta: l.pergunta,
        sim,
        nao,
        vazio: l.vazio.size,
        respondidas,
        pctSim: respondidas ? sim / respondidas : null,
      };
    })
    .sort((a, b) => (Number(a.ordem) || 99) - (Number(b.ordem) || 99)
      || a.pergunta.localeCompare(b.pergunta, 'pt-BR'));

  return {
    cartoes: {
      protocolos: contarDistintos(itens, (p) => p.numeroProtocolo),
      clientes: contarDistintos(itens, (p) => p.cliente),
      respostas: itens.filter((p) => p.resposta !== 'Vazio').length,
      itens: itens.length,
    },
    perguntas,
    protocolos: { total: protocolos.length, amostra: protocolos.slice(0, AMOSTRA) },
    respostas: {
      total: itens.length,
      amostra: itens.filter((p) => p.resposta !== 'Vazio').slice(0, AMOSTRA),
    },
    porMotivo: agrupar(protocolos, (p) => p.motivoCancelamento, { limite: 10 }),
    porCidade: agrupar(protocolos, (p) => p.cidade, { limite: 10, rotuloVazio: '(sem cidade)' }),
    checklistInvalido: estado.avisos.checklistInvalido || 0,
  };
}

// ------------------------------------------------------------- aba CLIMA
/** Previsão e histórico de chuva por cidade. */
export function painelClima(flt) {
  const linhas = estado.clima.filter((l) => combinaLista(l.cidade, flt.cidades));
  const hoje = new Date().toISOString().slice(0, 10);
  const cidades = [...new Set(linhas.map((l) => l.cidade))].sort((a, b) => a.localeCompare(b, 'pt-BR'));
  const previsao = linhas.filter((l) => l.data >= hoje).sort((a, b) => a.data.localeCompare(b.data));
  const dias = [...new Set(previsao.map((l) => l.data))].sort();
  const mapa = new Map(previsao.map((l) => [`${l.cidade}|${l.data}`, l]));

  return {
    buscadoEm: clima().buscadoEm,
    erro: estado.avisos.climaErro || null,
    cidades,
    dias,
    previsao: cidades.map((c) => ({
      cidade: c,
      dias: dias.map((d) => {
        const l = mapa.get(`${c}|${d}`);
        return l ? { data: d, classificacao: l.classificacao, mm: l.mm, probabilidade: l.probabilidade } : null;
      }),
    })),
    // chuva acumulada do ano por cidade, que é a leitura que o histórico permite
    acumulado: cidades.map((c) => {
      const doAno = linhas.filter((l) => l.cidade === c && l.data < hoje);
      return {
        cidade: c,
        dias: doAno.length,
        mm: Math.round(somar(doAno, (l) => l.mm) * 10) / 10,
        comChuva: doAno.filter((l) => (l.mm || 0) > 0).length,
        fortes: doAno.filter((l) => l.classificacao === 'Forte').length,
      };
    }),
  };
}

// ------------------------------------------------------- listas de filtro
export const filtrosGeral = () => ({
  cidades: estado.dims.cidades, bairros: estado.dims.bairros, vendedores: estado.dims.vendedores,
  equipes: estado.dims.equipes, situacoes: estado.dims.situacoes, status: estado.dims.statusContrato,
  tecnologias: estado.dims.tecnologias, servicos: estado.dims.servicos,
  etiquetas: estado.dims.etiquetas, situacoesItem: estado.dims.situacoesItem,
});

export const filtrosResumo = () => ({
  cidades: estado.dims.cidades, vendedores: estado.dims.vendedores, equipes: estado.dims.equipes,
  situacoes: estado.dims.situacoes, status: estado.dims.statusContrato,
  tecnologias: estado.dims.tecnologias, tipos: estado.dims.tiposSolicitacao,
});

export const filtrosEquipes = () => ({
  vendedores: estado.dims.vendedores, equipes: estado.dims.equipes,
  situacoes: estado.dims.situacoes, tecnologias: estado.dims.tecnologias,
});

export const filtrosDiario = () => ({
  cidades: estado.dims.cidades, equipes: estado.dims.equipes, situacoes: estado.dims.situacoes,
  tecnologias: estado.dims.tecnologias, tipos: estado.dims.tiposSolicitacao,
});

export const filtrosBase = () => ({
  cidades: estado.dims.cidadesBase,
  bairros: estado.dims.bairrosBase,
  bairrosPorCidade: estado.dims.bairrosPorCidade,
  tecnologias: estado.dims.tecnologiasBase,
});

export const filtrosPesquisa = () => ({
  cidades: estado.dims.cidadesPesquisa, etiquetas: estado.dims.etiquetasPesquisa,
  status: estado.dims.statusPesquisa, perguntas: estado.dims.perguntas,
  respostas: ['Sim', 'Não', 'Vazio'],
});

export const filtrosClima = () => ({ cidades: estado.dims.cidadesClima });
