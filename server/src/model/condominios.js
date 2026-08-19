/**
 * Réplica em memória do modelo semântico do Power BI "COM - Condomínios".
 *
 * Fica num estado PRÓPRIO, separado de `store.js`, e a razão é que não existe
 * relação entre os dois: o modelo comercial é um fato por contrato vendido; este
 * é um fato por PORTA de splitter dentro de um condomínio. Pendurar as duas
 * coisas na mesma tabela de fatos obrigaria toda medida comercial a filtrar
 * linhas que não são venda — e a primeira que esquecesse passaria a contar
 * porta de splitter como contrato.
 *
 * Fontes (as duas do Voalle/PostgreSQL, nenhuma conexão nova):
 *   portas   -> sql/splitters.sql          (SPLITTER_(GERAL) do Power Query)
 *   ocupacao -> sql/splitter_ocupacao.sql  (SPLITTER_(OCUPADA_/_DISPONIVEIS)
 *                                           + SPLITTER_(OCUPACAO))
 *
 * O que no Power BI eram colunas DAX vira código aqui:
 *   SPLITTER_CONDOMINIO -> nomeDoCondominio()
 *   CLASSIFICACAO       -> classificar()
 *   TEMPO_DE_VIDA       -> diasDeVida
 *   USUARIO_PERSONALIZADO -> usuario + portaOcupada (sem o emoji do original)
 */
import { diffDays, monthKey, toIso, today } from './dates.js';

/**
 * As cinco cidades que o relatório de origem fixa como filtro nas tabelas de
 * detalhe e na matriz. Aqui NÃO são aplicadas por padrão — a tela mostra todas e
 * oferece este recorte a um clique. Filtro escondido em código é a receita de
 * "o dashboard está com número errado": quem abre não tem como saber que cinco
 * cidades foram escolhidas dentro de uma constante.
 */
export const CIDADES_DO_RELATORIO = [
  'Canoas', 'Novo Hamburgo', 'São Leopoldo', 'Sapucaia do Sul', 'Esteio',
];

export const CLASSIFICACOES = ['CRÍTICO', 'ALERTA', 'OK', 'SEM CAPACIDADE'];

const estado = {
  raw: { portas: [], ocupacao: [] },
  fontes: {},          // { nome: { updatedAt, rows, ms, error } }
  fatos: [],           // uma linha por porta de splitter de condomínio
  splitters: [],       // uma linha por splitter secundário de condomínio
  dims: {
    condominios: [], splitters: [], concentradores: [], pontosAcesso: [],
    sites: [], cidades: [], classificacoes: CLASSIFICACOES,
  },
  versao: 0,
  geradoEm: null,
  buildMs: null,
};

export const getEstadoCondominios = () => estado;
export const condominiosPronto = () => estado.fatos.length > 0;

export function setFonteCondominios(nome, rows, meta = {}) {
  estado.raw[nome] = rows;
  estado.fontes[nome] = {
    updatedAt: new Date().toISOString(),
    rows: rows.length,
    ms: meta.ms ?? null,
    error: null,
  };
}

export function setFonteErroCondominios(nome, err) {
  estado.fontes[nome] = {
    ...(estado.fontes[nome] || {}),
    error: String(err && err.message ? err.message : err),
    failedAt: new Date().toISOString(),
  };
}

const norm = (s) => (s == null ? '' : String(s).trim());
// o driver devolve int8/numeric como texto: capacidade e contagens chegam "8", "3"
const num = (v) => (v === null || v === undefined || v === '' ? 0 : Number(v) || 0);

const MARCAS_CONDOMINIO = ['COND.', 'RES.', 'ED.'];

/**
 * Réplica da coluna DAX SPLITTER_CONDOMINIO: extrai o nome do condomínio de
 * dentro do título do splitter.
 *
 * O título tem a forma "<algo> COND. NOME DO PRÉDIO - <resto técnico>". A regra
 * do DAX é: achar a primeira das três marcas (COND. tem prioridade sobre RES.,
 * que tem prioridade sobre ED., na ordem do SWITCH original), e cortar dali até
 * o primeiro " -" seguinte. O original concatena " -" no fim do texto justamente
 * para o SEARCH nunca falhar quando o hífen não existe — reproduzido aqui.
 *
 * Devolve '' quando o título não é de condomínio. Essa string vazia É o filtro
 * de página do relatório (SPLITTER_CONDOMINIO não nulo).
 */
export function nomeDoCondominio(titulo) {
  const t = norm(titulo);
  if (!t) return '';
  const up = t.toUpperCase();
  let inicio = -1;
  for (const marca of MARCAS_CONDOMINIO) {
    const i = up.indexOf(marca);
    if (i >= 0) { inicio = i; break; }
  }
  if (inicio < 0) return '';
  const fim = `${up} -`.indexOf(' -', inicio);
  return t.slice(inicio, fim).trim();
}

/**
 * Réplica do CASE de CLASSIFICACAO, com os mesmos cortes (90% e 70%) e o mesmo
 * ROUND(...,2) antes de comparar — sem isso 89,996% cairia em ALERTA aqui e em
 * CRÍTICO no Power BI.
 *
 * Os emojis do original (🔴 🟡 🟢) ficaram de fora: renderizam diferente por
 * sistema operacional e desalinham a coluna. Quem carrega a cor é a célula.
 */
export function classificar(capacidade, ocupadas) {
  if (!capacidade) return 'SEM CAPACIDADE';
  const pct = Math.round((100 * ocupadas) / capacidade * 100) / 100;
  if (pct >= 90) return 'CRÍTICO';
  if (pct >= 70) return 'ALERTA';
  return 'OK';
}

const unico = (arr) => [...new Set(arr.filter(Boolean))].sort((a, b) => a.localeCompare(b, 'pt-BR'));

/** Reconstrói os fatos a partir das duas fontes carregadas. */
export function construirCondominios() {
  const iniciou = Date.now();
  const hoje = today();

  // ---- ocupação por splitter --------------------------------------------
  // O Power BI relaciona esta tabela por TÍTULO do equipamento; aqui a chave é o
  // id, que é o que o join deveria ter usado desde o começo. Dois splitters com
  // o mesmo título derrubariam a relação 1:N de lá.
  const ocupacaoPorId = new Map();
  for (const o of estado.raw.ocupacao) {
    const capacidade = num(o.capacidade);
    const ocupadas = num(o.ocupadas);
    ocupacaoPorId.set(Number(o.splitter_id), {
      capacidade,
      ocupadas,
      disponiveis: num(o.disponiveis),
      percentual: capacidade ? ocupadas / capacidade : 0,
      classificacao: classificar(capacidade, ocupadas),
    });
  }

  // ---- fatos: uma linha por porta ---------------------------------------
  const vistos = new Set(); // (splitter, porta) é a chave natural da linha
  const fatos = [];
  const porSplitter = new Map();

  for (const r of estado.raw.portas) {
    const splitterId = Number(r.splitter_id);
    const porta = num(r.porta);
    const chave = `${splitterId} ${porta}`;
    if (vistos.has(chave)) continue;
    vistos.add(chave);

    const splitter = norm(r.splitter);
    const condominio = nomeDoCondominio(splitter);
    if (!condominio) continue; // filtro de página do relatório

    const criado = toIso(r.splitter_criado);
    const ocup = ocupacaoPorId.get(splitterId) || {
      capacidade: num(r.splitter_capacidade),
      ocupadas: 0,
      disponiveis: num(r.splitter_capacidade),
      percentual: 0,
      classificacao: classificar(num(r.splitter_capacidade), 0),
    };

    // aprovado = o que a consulta CONTRATOS do Power BI deixaria passar; fora
    // disso o merge de lá devolvia nulo nestas quatro colunas
    const aprovado = r.contrato_aprovado === true;

    const fato = {
      splitterId,
      splitter,
      splitterCodigo: norm(r.splitter_codigo),
      condominio,
      criado,
      diasDeVida: criado ? diffDays(criado, hoje) : null,
      primarioId: Number(r.splitter_primario_id) || null,
      primario: norm(r.splitter_primario),
      concentrador: norm(r.concentrador),
      pontoAcesso: norm(r.ponto_acesso),
      site: norm(r.site),
      porta,
      // "tem cliente" é o que a consulta de ocupação conta (porta com conexão);
      // é esta a definição usada em todo indicador de cliente desta tela
      temCliente: r.conexao_id != null,
      usuario: norm(r.usuario),
      cliente: norm(r.cliente),
      // cidade do endereço da conexão. NÃO é o campo de filtro — quem filtra é
      // `cidade`, a do equipamento, resolvida no segundo passe abaixo.
      cidadeCliente: norm(r.cidade),
      cidade: '',
      rua: norm(r.rua),
      numero: norm(r.numero),
      bairro: norm(r.bairro),
      clienteLat: norm(r.cliente_lat),
      clienteLng: norm(r.cliente_lng),
      placa: r.placa == null ? null : num(r.placa),
      pon: r.pon == null ? null : num(r.pon),
      contrato: aprovado ? norm(r.contrato) : '',
      dataAprovacao: aprovado ? toIso(r.data_aprovacao) : null,
      statusContrato: aprovado ? norm(r.status_contrato) : '',
      splitterCidade: norm(r.splitter_cidade),
      splitterLat: norm(r.splitter_lat),
      splitterLng: norm(r.splitter_lng),
      capacidade: ocup.capacidade,
      ocupadas: ocup.ocupadas,
      disponiveis: ocup.disponiveis,
      percentual: ocup.percentual,
      classificacao: ocup.classificacao,
    };
    fatos.push(fato);

    if (!porSplitter.has(splitterId)) {
      porSplitter.set(splitterId, {
        splitterId,
        splitter,
        condominio,
        concentrador: fato.concentrador,
        pontoAcesso: fato.pontoAcesso,
        site: fato.site,
        primario: fato.primario,
        criado,
        diasDeVida: fato.diasDeVida,
        cidade: '',                     // resolvida no segundo passe
        cidadesDosClientes: new Map(),  // descartada depois de resolver
        lat: fato.splitterLat,
        lng: fato.splitterLng,
        capacidade: ocup.capacidade,
        ocupadas: ocup.ocupadas,
        disponiveis: ocup.disponiveis,
        percentual: ocup.percentual,
        classificacao: ocup.classificacao,
        portas: 0,
        clientes: 0,
      });
    }
    const s = porSplitter.get(splitterId);
    s.portas += 1;
    if (fato.temCliente) s.clientes += 1;
    if (!s.cidade && fato.splitterCidade) s.cidade = fato.splitterCidade;
    if (fato.cidadeCliente) {
      s.cidadesDosClientes.set(fato.cidadeCliente, (s.cidadesDosClientes.get(fato.cidadeCliente) || 0) + 1);
    }
  }

  /**
   * SEGUNDO PASSE: a cidade de cada splitter, e daí de cada porta.
   *
   * O relatório de origem filtra pela cidade do CLIENTE (CIDADE.1). Isso quebra a
   * tela por um motivo que só aparece com dado real: porta livre não tem conexão,
   * logo não tem cidade — então filtrar por cidade descarta todas as portas
   * livres, e "portas" passa a ser idêntico a "clientes" num painel cujo assunto
   * é justamente quanto ainda cabe. O aviso de que a capacidade contava duas
   * vezes um splitter com clientes em duas cidades vinha do mesmo lugar.
   *
   * Aqui a cidade é do EQUIPAMENTO, e o splitter entra ou sai inteiro do filtro.
   * `authentication_splitters.city` está preenchido em menos de um terço dos
   * casos, então o resto vem da cidade mais frequente entre os clientes daquele
   * splitter — que é o prédio onde ele está. Empate resolve em ordem alfabética,
   * para o resultado não depender da ordem em que o banco devolveu as linhas.
   */
  for (const s of porSplitter.values()) {
    if (!s.cidade && s.cidadesDosClientes.size) {
      s.cidade = [...s.cidadesDosClientes.entries()]
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'pt-BR'))[0][0];
    }
    delete s.cidadesDosClientes;
  }
  for (const f of fatos) {
    f.cidade = porSplitter.get(f.splitterId).cidade;
  }

  estado.fatos = fatos;
  estado.splitters = [...porSplitter.values()];
  estado.dims = {
    condominios: unico(fatos.map((f) => f.condominio)),
    splitters: unico(fatos.map((f) => f.splitter)),
    concentradores: unico(fatos.map((f) => f.concentrador)),
    pontosAcesso: unico(fatos.map((f) => f.pontoAcesso)),
    sites: unico(fatos.map((f) => f.site)),
    cidades: unico(fatos.map((f) => f.cidade)),
    classificacoes: CLASSIFICACOES.filter((c) => fatos.some((f) => f.classificacao === c)),
  };
  estado.versao += 1;
  estado.geradoEm = new Date().toISOString();
  estado.buildMs = Date.now() - iniciou;
  return estado;
}

// --------------------------------------------------------------- FILTROS

const lista = (v) => {
  if (v === undefined || v === null || v === '') return null;
  const arr = (Array.isArray(v) ? v : String(v).split(',')).map((s) => String(s).trim()).filter(Boolean);
  return arr.length ? arr : null;
};

/**
 * Filtros desta tela.
 *
 * A cidade se chama `cidadeCond` de propósito. `cidade` já existe no dashboard
 * comercial com uma lista de valores DIFERENTE — lá é a cidade do cadastro do
 * cliente (`people.city`), aqui é a da conexão (`authentication_contracts.city`)
 * — e como os filtros vivem na URL, o mesmo nome faria a tela herdar da outra um
 * valor que não existe na sua lista: tela vazia, sem explicação nenhuma.
 *
 * O período é a data de criação do splitter, não uma data de venda: é o único
 * eixo de tempo que a rede de splitters tem.
 */
export function parseFiltrosCondominios(q = {}) {
  return {
    de: q.criadoDe || null,
    ate: q.criadoAte || null,
    condominio: lista(q.condominio),
    splitter: lista(q.splitter),
    concentrador: lista(q.concentrador),
    pontoAcesso: lista(q.ponto),
    site: lista(q.site),
    cidade: lista(q.cidadeCond),
    classificacao: lista(q.faixa),
    busca: q.buscaCond ? String(q.buscaCond).trim().toUpperCase() : null,
  };
}

function combina(f, flt) {
  if (flt.de && (!f.criado || f.criado < flt.de)) return false;
  if (flt.ate && (!f.criado || f.criado > flt.ate)) return false;
  if (flt.condominio && !flt.condominio.includes(f.condominio)) return false;
  if (flt.splitter && !flt.splitter.includes(f.splitter)) return false;
  if (flt.concentrador && !flt.concentrador.includes(f.concentrador)) return false;
  if (flt.pontoAcesso && !flt.pontoAcesso.includes(f.pontoAcesso)) return false;
  if (flt.site && !flt.site.includes(f.site)) return false;
  if (flt.cidade && !flt.cidade.includes(f.cidade)) return false;
  if (flt.classificacao && !flt.classificacao.includes(f.classificacao)) return false;
  if (flt.busca) {
    const alvo = `${f.cliente} ${f.usuario} ${f.contrato}`.toUpperCase();
    if (!alvo.includes(flt.busca)) return false;
  }
  return true;
}

export function linhasCondominios(flt) {
  return estado.fatos.filter((f) => combina(f, flt));
}

/**
 * Splitters distintos que sobrevivem ao filtro, sem corte de amostra. É o que a
 * exportação usa — o painel devolve uma amostra ordenada por ocupação, e um CSV
 * chamado "completo" que trouxesse 300 de 3.900 linhas seria mentira.
 */
export function splittersCondominios(flt) {
  const visiveis = new Set(linhasCondominios(flt).map((f) => f.splitterId));
  return estado.splitters
    .filter((s) => visiveis.has(s.splitterId))
    .sort((a, b) => a.condominio.localeCompare(b.condominio, 'pt-BR')
      || a.splitter.localeCompare(b.splitter, 'pt-BR'));
}

/** Opções dos seletores da tela. */
export function filtrosCondominios() {
  let min = null;
  let max = null;
  for (const s of estado.splitters) {
    if (!s.criado) continue;
    if (!min || s.criado < min) min = s.criado;
    if (!max || s.criado > max) max = s.criado;
  }
  return {
    ...estado.dims,
    cidadesDoRelatorio: CIDADES_DO_RELATORIO.filter((c) => estado.dims.cidades.includes(c)),
    periodo: { min, max, hoje: today() },
  };
}

// ---------------------------------------------------------------- PAINEL

/**
 * Tamanho das amostras que vão para a tela. São ~3.900 splitters, 870 condomínios
 * e 55 mil portas: mandar tudo enche o DOM de dezenas de milhares de células que
 * ninguém lê de uma vez, e a ordenação no clique passa a repintar todas. Quem
 * precisa do conjunto inteiro usa o CSV, que não passa por este corte.
 */
const AMOSTRA_SPLITTERS = 300;
const AMOSTRA_CONDOMINIOS = 300;
const AMOSTRA_PORTAS = 400;

/**
 * Agrega por splitter DISTINTO. Capacidade, portas ocupadas e percentual são
 * propriedades do splitter, não da porta: somar linha a linha multiplicaria a
 * capacidade pelo número de portas. É a mesma aritmética que o DAX faz ao somar
 * uma coluna da tabela do lado "1" da relação.
 */
function agregar(fatos, chaveFn) {
  const grupos = new Map();
  for (const f of fatos) {
    const chave = chaveFn(f);
    if (chave === null || chave === undefined || chave === '') continue;
    let g = grupos.get(chave);
    if (!g) {
      g = { key: chave, portas: 0, clientes: 0, splitters: new Set(), capacidade: 0, ocupadas: 0, disponiveis: 0 };
      grupos.set(chave, g);
    }
    g.portas += 1;
    if (f.temCliente) g.clientes += 1;
    if (!g.splitters.has(f.splitterId)) {
      g.splitters.add(f.splitterId);
      g.capacidade += f.capacidade;
      g.ocupadas += f.ocupadas;
      g.disponiveis += f.disponiveis;
    }
  }
  return [...grupos.values()].map((g) => ({
    key: g.key,
    portas: g.portas,
    clientes: g.clientes,
    splitters: g.splitters.size,
    capacidade: g.capacidade,
    ocupadas: g.ocupadas,
    disponiveis: g.disponiveis,
    percentual: g.capacidade ? g.ocupadas / g.capacidade : 0,
    classificacao: classificar(g.capacidade, g.ocupadas),
  }));
}

export function painelCondominios(flt) {
  const fatos = linhasCondominios(flt);
  const idsVisiveis = new Set(fatos.map((f) => f.splitterId));
  const splitters = estado.splitters.filter((s) => idsVisiveis.has(s.splitterId));

  // ---- KPIs (os três cartões do relatório + os dois que a tela pede) ----
  let capacidade = 0;
  let ocupadas = 0;
  let disponiveis = 0;
  for (const s of splitters) {
    capacidade += s.capacidade;
    ocupadas += s.ocupadas;
    disponiveis += s.disponiveis;
  }
  const clientes = fatos.reduce((a, f) => a + (f.temCliente ? 1 : 0), 0);

  // ---- tabela y=484: uma linha por splitter de condomínio ---------------
  // Ordem por ocupação, e não por data de criação como o relatório: são ~3.900
  // splitters, e a tabela mostra uma dúzia por vez. Ordenado por data, os 110
  // splitters lotados ficam perdidos no meio — que é exatamente o que a tela
  // existe para achar. A coluna de data continua clicável.
  const porSplitterOrdenado = splitters
    .map((s) => ({ ...s, __key: `s${s.splitterId}` }))
    .sort((a, b) => b.percentual - a.percentual
      || b.ocupadas - a.ocupadas
      || (b.criado || '').localeCompare(a.criado || ''));

  // ---- tabela y=1144: detalhe porta a porta ----------------------------
  const detalhe = fatos
    .slice()
    .sort((a, b) => (b.dataAprovacao || '').localeCompare(a.dataAprovacao || '')
      || a.splitter.localeCompare(b.splitter, 'pt-BR')
      || a.porta - b.porta)
    .slice(0, AMOSTRA_PORTAS)
    .map((f) => ({
      __key: `${f.splitterId}-${f.porta}`,
      condominio: f.condominio,
      splitter: f.splitter,
      porta: f.porta,
      usuario: f.usuario,
      cliente: f.cliente,
      contrato: f.contrato,
      dataAprovacao: f.dataAprovacao,
      // a do equipamento, a mesma que o filtro usa — assim a coluna concorda com
      // o que está selecionado na barra. O endereço ao lado é o do cliente.
      cidade: f.cidade,
      rua: f.rua,
      numero: f.numero,
      bairro: f.bairro,
      ocupada: f.temCliente,
    }));

  // ---- tabelas y=1759 --------------------------------------------------
  const porCondominioOrdenado = agregar(fatos, (f) => f.condominio)
    .sort((a, b) => b.clientes - a.clientes || a.key.localeCompare(b.key, 'pt-BR'));

  // "(sem cidade)" existe para o total da tabela fechar com o da tela: são os
  // splitters sem cidade cadastrada e sem nenhum cliente de onde deduzi-la.
  const porCidade = agregar(fatos, (f) => f.cidade || '(sem cidade)')
    .sort((a, b) => b.ocupadas - a.ocupadas || a.key.localeCompare(b.key, 'pt-BR'));

  // A faixa é calculada sobre TODOS os splitters do filtro, não sobre a amostra
  // que a tabela mostra — o subtítulo "110 crítico" tem de falar do universo.
  const porClassificacao = CLASSIFICACOES
    .map((c) => {
      const doGrupo = splitters.filter((s) => s.classificacao === c);
      return {
        key: c,
        splitters: doGrupo.length,
        capacidade: doGrupo.reduce((a, s) => a + s.capacidade, 0),
        ocupadas: doGrupo.reduce((a, s) => a + s.ocupadas, 0),
      };
    })
    .filter((c) => c.splitters > 0);

  // ---- matriz y=2567 (esq.): mês de aprovação x cidade -----------------
  // O relatório usa a hierarquia Ano/Mês/Dia sobre DATA APROVACAO. Porta sem
  // contrato não tem data de aprovação e, como lá, fica fora da matriz.
  const cidadesDaMatriz = porCidade
    .filter((c) => c.key !== '(sem cidade)' && c.clientes > 0)
    .slice(0, 12)
    .map((c) => c.key);
  const mapaMatriz = new Map();
  const totalPorCidade = {};
  let totalMatriz = 0;
  for (const f of fatos) {
    if (!f.temCliente || !f.dataAprovacao) continue;
    if (!cidadesDaMatriz.includes(f.cidade)) continue;
    const mes = monthKey(f.dataAprovacao);
    let linha = mapaMatriz.get(mes);
    if (!linha) {
      linha = { periodo: mes, total: 0 };
      for (const c of cidadesDaMatriz) linha[c] = 0;
      mapaMatriz.set(mes, linha);
    }
    linha[f.cidade] += 1;
    linha.total += 1;
    totalPorCidade[f.cidade] = (totalPorCidade[f.cidade] || 0) + 1;
    totalMatriz += 1;
  }

  return {
    kpis: {
      primarios: new Set(fatos.map((f) => f.primarioId)).size,
      portas: fatos.length,
      splitters: splitters.length,
      condominios: new Set(fatos.map((f) => f.condominio)).size,
      clientes,
      capacidade,
      ocupadas,
      disponiveis,
      ocupacao: capacidade ? ocupadas / capacidade : 0,
    },
    // Amostras, não conjuntos: sem o corte a tela chegava a 54 mil células no
    // DOM e cada clique de ordenação repintava todas elas. O CSV do cabeçalho
    // baixa o conjunto inteiro, e cada visual diz no subtítulo o que está vendo.
    porSplitter: porSplitterOrdenado.slice(0, AMOSTRA_SPLITTERS),
    porSplitterTotal: splitters.length,
    detalhe,
    detalheTotal: fatos.length,
    porCondominio: porCondominioOrdenado.slice(0, AMOSTRA_CONDOMINIOS),
    porCondominioTotal: porCondominioOrdenado.length,
    porCidade,
    porClassificacao,
    matriz: {
      colunas: cidadesDaMatriz,
      linhas: [...mapaMatriz.values()].sort((a, b) => a.periodo.localeCompare(b.periodo)),
      totalPorColuna: totalPorCidade,
      total: totalMatriz,
    },
    // Uma série só, como no relatório. Porta livre não tem conexão e portanto não
    // tem cidade, então agrupar por cidade já exclui as livres: a contagem de
    // portas por cidade É a de clientes. Mandar as duas seria desenhar a mesma
    // linha duas vezes com dois nomes.
    // Cidade sem cliente vira barra de altura zero com rótulo ocupando espaço no
    // eixo — inclusive o "(sem cidade)", que existe só para a tabela fechar.
    clientesPorCidade: porCidade
      .filter((c) => c.clientes > 0)
      .map((c) => ({ key: c.key, clientes: c.clientes }))
      .sort((a, b) => b.clientes - a.clientes),
    cidadesDoRelatorio: CIDADES_DO_RELATORIO,
  };
}
