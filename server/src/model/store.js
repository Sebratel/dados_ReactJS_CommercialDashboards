/**
 * Réplica em memória do modelo semântico do Power BI.
 *
 * Fontes (cada uma com sua própria frequência de atualização):
 *   base    -> tabela "general" (Voalle)              — contratos/vendas
 *   aloc    -> "ALOCAÇÃO/ATIVAÇÃO" (Voalle)           — ativação fibra/rádio
 *   phone   -> "phone activation" (Voalle)            — ativação telefonia
 *   pagto   -> "PAGAMENTO" (Voalle)                   — primeiro pagamento
 *   sellers -> "new_sellers" (Voalle users)           — admissão do vendedor
 *   teams   -> Comercial_Teams (MariaDB)              — equipe/situação
 *   senior  -> db_senior_collaborators (MariaDB)      — admissão no RH
 *
 * A tabela de fatos resultante equivale a "general"; CADASTRO, ATIVOS e
 * PRIMEIRO PAGAMENTO são projeções dela (cada uma com sua própria data),
 * exatamente como no modelo original.
 */
import { addDays, startOfNextMonth, toIso } from './dates.js';

const state = {
  raw: {
    base: [], aloc: [], phone: [], pagto: [], sellers: [], teams: [], senior: [],
  },
  sources: {}, // { nome: { updatedAt, ms, rows, error } }
  facts: [],
  sellersByName: new Map(),
  teamsByName: new Map(),
  dims: {
    vendedores: [], equipes: [], tecnologias: [], canais: [], situacoes: [], cidades: [],
  },
  version: 0,
  builtAt: null,
};

export function getState() {
  return state;
}

export function setSource(name, rows, meta = {}) {
  state.raw[name] = rows;
  state.sources[name] = {
    updatedAt: new Date().toISOString(),
    rows: rows.length,
    ms: meta.ms ?? null,
    error: null,
  };
}

/**
 * Aplica uma carga incremental (janela dos últimos N dias) sobre o que já está
 * em memória, sem reler a base inteira.
 */
export function mergeSource(name, rows, meta = {}) {
  const atual = state.raw[name] || [];
  if (name === 'base') {
    // a janela devolve TODOS os contratos criados a partir do corte
    const corte = meta.cutoff;
    state.raw.base = atual.filter((r) => !(r.data_criacao_contrato >= corte)).concat(rows);
  } else if (name === 'aloc') {
    // mantém sempre a ativação mais antiga (equivalente ao MIN da consulta cheia)
    const map = new Map(atual.map((r) => [`${r.contrato}${r.cliente}`, r]));
    for (const r of rows) {
      const k = `${r.contrato}${r.cliente}`;
      const prev = map.get(k);
      if (!prev || !prev.data_ativacao || (r.data_ativacao && r.data_ativacao < prev.data_ativacao)) {
        map.set(k, r);
      }
    }
    state.raw.aloc = [...map.values()];
  } else if (name === 'pagto') {
    // a janela é por data de criação do contrato: o primeiro pagamento devolvido
    // já considera todos os pagamentos daquele contrato
    const map = new Map(atual.map((r) => [`${r.nome}${r.contrato}`, r]));
    for (const r of rows) map.set(`${r.nome}${r.contrato}`, r);
    state.raw.pagto = [...map.values()];
  } else {
    state.raw[name] = rows;
  }

  const anterior = state.sources[name] || {};
  state.sources[name] = {
    ...anterior,
    updatedAt: new Date().toISOString(),
    rows: state.raw[name].length,
    incrementais: (anterior.incrementais || 0) + 1,
    ultimoIncremento: rows.length,
    ms: meta.ms ?? null,
    error: null,
  };
}

export function setSourceError(name, err) {
  state.sources[name] = {
    ...(state.sources[name] || {}),
    error: String(err && err.message ? err.message : err),
    failedAt: new Date().toISOString(),
  };
}

const norm = (s) => (s == null ? '' : String(s).trim());

/** Reconstrói a tabela de fatos a partir das fontes carregadas. */
export function build() {
  const started = Date.now();
  const { base, aloc, phone, pagto, sellers, teams, senior } = state.raw;

  // ---- teams (MariaDB) --------------------------------------------------
  const teamsByName = new Map();
  for (const t of teams) {
    const nome = norm(t.vendedores);
    if (!nome) continue;
    teamsByName.set(nome, {
      equipe: norm(t.equipes),
      situacao: norm(t.situacao),
      ativo: norm(t.ativo).toUpperCase() === 'TRUE',
    });
  }

  // ---- new_sellers ------------------------------------------------------
  // users (Voalle) + admissão do Senior; o modelo original mantém apenas os
  // vendedores que existem no RH (admissao senior <> null).
  /**
   * COMO O VOALLE ENCONTRA A PESSOA NO RH.
   *
   * Era por NOME, e nome quebra. "JÉSSICA ARAÚJO TEIXEIRA" no Voalle contra "JESSICA
   * ARAUJO TEIXEIRA" no Senior é a mesma pessoa e não casava — ela ficava sem
   * admissão, e como este modelo mantém só quem existe no RH, desaparecia de
   * Rampagem e de Premiações sem deixar rastro.
   *
   * Agora são três tentativas, nesta ordem, e o motivo da ordem importa:
   *
   *   1. E-MAIL — chave de verdade, é o que o relatório de origem passou a usar.
   *   2. NOME EXATO — para quem não tem e-mail cadastrado; medido, são 303 usuários
   *      do Voalle e 151 registros do Senior sem e-mail. Trocar SÓ para e-mail
   *      perderia 157 pessoas que hoje casam pelo nome.
   *   3. NOME SEM ACENTO E SEM PONTUAÇÃO — resolve a mesma classe de problema para
   *      quem não tem e-mail em nenhum dos dois lados.
   *
   * O e-mail não sai daqui: é chave de junção, e não vai para nenhuma resposta de
   * API nem para a tela.
   */
  const semAcento = (v) => norm(v)
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, ' ')
    .trim();

  /**
   * As duas grafias são da MESMA pessoa?
   *
   * Precisa existir porque e-mail nem sempre identifica gente: há conta reaproveitada
   * e conta genérica nas duas bases. Medido, com o e-mail como chave única, 13 pares
   * casaram com nomes diferentes — e três deles são pessoas distintas de verdade:
   *
   *   SEM AUXILIAR                   -> GUSTAVO LEITE DOS SANTOS
   *   LUKAS FRANCISCO MELO CAVALIM   -> IGOR SOARES SCHUMACHER DA SILVA
   *   JOAO BATISTA GOMES DE OLIVEIRA -> JOAO VITOR GOMES DA SILVA
   *
   * Aceitar esses três colocou 'SEM AUXILIAR' na tela de Rampagem herdando a
   * admissão do Gustavo. Um vendedor que não existe, com data de outra pessoa.
   *
   * A REGRA, e o limite dela foi medido, não escolhido: os nomes são da mesma pessoa
   * quando, ignorando acento e partícula, TRÊS QUARTOS ou mais dos pedaços do nome
   * mais curto aparecem no outro (com tolerância de uma letra por pedaço).
   *
   * Com 50% passavam quatro impostores que compartilham primeiro nome e último
   * sobrenome e diferem no do meio — o padrão de e-mail reaproveitado:
   *
   *   ANDRE LUIS DOS SANTOS          -> ANDRE FERNANDO DOS SANTOS      (2 de 3)
   *   VANESSA GARCIA DA SILVA        -> VANESSA CUNHA DA SILVA         (2 de 3)
   *   CARLOS DAVI RODRIGUES DA SILVA -> CARLOS EDUARDO DA SILVA        (2 de 3)
   *   JOAO BATISTA GOMES DE OLIVEIRA -> JOAO VITOR GOMES DA SILVA      (2 de 4)
   *
   * Com 75% eles caem e continuam passando os casos legítimos:
   *
   *   DARWIN JOSE BAIRROS RODRIGUES  -> DARWIN JOSE BARRIOS RODRIGUEZ  (3 de 4)
   *   LUCIANO TELLES VIEIRA          -> LUCIANO TELLES VIERA           (3 de 3)
   *   RAFAEL SILVA DOS SANTOS - COR  -> RAFAEL SILVA DOS SANTOS        (3 de 3)
   *
   * Passa também quem só aparece truncado: a coluna `name` do Senior corta em 40
   * caracteres, e é daí que vem metade dos pares divergentes ('VIANNELLY NAZARETH DE
   * CARMEN RAMIREZ SEIJAS' contra '... RAMIREZ SEI').
   */
  const PARTICULAS = new Set(['DE', 'DA', 'DO', 'DAS', 'DOS', 'E']);
  const pedacos = (v) => semAcento(v).split(' ').filter((t) => t && !PARTICULAS.has(t));

  /**
   * Duas palavras diferem por no máximo uma letra? (distância de edição com teto 1.)
   *
   * Teto 1 e não distância completa porque o teto é o que dá para justificar: uma
   * letra é erro de digitação, duas já podem ser outro sobrenome. Conferido contra
   * nove pares reais das duas bases — VIEIRA/VIERA e RODRIGUES/RODRIGUEZ passam,
   * GARCIA/CUNHA e LUIS/FERNANDO não.
   */
  const ate1 = (a, b) => {
    if (a === b) return true;
    const [c, d] = a.length <= b.length ? [a, b] : [b, a];
    if (d.length - c.length > 1) return false;
    let i = 0;
    let j = 0;
    let erros = 0;
    while (i < c.length && j < d.length) {
      if (c[i] === d[j]) { i += 1; j += 1; continue; }
      erros += 1;
      if (erros > 1) return false;
      if (c.length === d.length) { i += 1; j += 1; } else { j += 1; }
    }
    return erros + (d.length - j) + (c.length - i) <= 1;
  };

  /**
   * As duas grafias são da MESMA pessoa?
   *
   * Precisa existir porque e-mail nem sempre identifica gente: há conta genérica e
   * conta reaproveitada nas duas bases. Com o e-mail como chave única, oito pares
   * casaram com nome de OUTRA pessoa — incluindo 'SEM AUXILIAR' herdando a admissão
   * de um colaborador e 'ISA - AGENTE VIRTUAL SEBRATEL', que é robô. O primeiro
   * chegou a aparecer na tela de Rampagem antes desta barreira.
   *
   * Três níveis, e cada um resolve um problema medido nas bases:
   *
   *   1. IGUAIS ignorando acento — o caso da Jéssica, que é o motivo de tudo isto.
   *   2. UM É PREFIXO DO OUTRO (12 caracteres ou mais) — a coluna `name` do Senior
   *      corta em 40 caracteres, e daí vinha metade dos pares "divergentes":
   *      'VIANNELLY NAZARETH DE CARMEN RAMIREZ SEIJAS' contra '... RAMIREZ SEI'.
   *   3. TRÊS QUARTOS dos pedaços do nome mais curto batendo, com tolerância de uma
   *      letra. Aceita DARWIN JOSE BAIRROS RODRIGUES / BARRIOS RODRIGUEZ (3 de 4) e
   *      recusa os impostores que compartilham só primeiro nome e último sobrenome:
   *      ANDRE LUIS DOS SANTOS / ANDRE FERNANDO DOS SANTOS (2 de 3).
   *
   * O limite de 3/4 foi medido, não escolhido: com 1/2 passavam quatro impostores.
   */
  const mesmaPessoa = (a, b) => {
    const fa = semAcento(a);
    const fb = semAcento(b);
    if (fa === fb) return true;
    const menorNome = fa.length <= fb.length ? fa : fb;
    const maiorNome = fa.length <= fb.length ? fb : fa;
    if (menorNome.length >= 12 && maiorNome.startsWith(menorNome)) return true;

    const pa = pedacos(a);
    const pb = pedacos(b);
    if (!pa.length || !pb.length) return false;
    const menor = pa.length <= pb.length ? pa : pb;
    const maior = pa.length <= pb.length ? pb : pa;
    const iguais = menor.filter((t) => maior.some((o) => ate1(o, t))).length;
    return iguais / menor.length >= 0.75;
  };

  const seniorPorEmail = new Map();
  const seniorPorNome = new Map();
  const seniorPorNomeSimples = new Map();
  for (const s of senior) {
    const nome = norm(s.seller);
    if (!nome) continue;
    const adm = toIso(s.admission_date);
    const reg = { nome, admissao: adm, cargo: norm(s.position) };
    // mesmo colaborador pode ter mais de um registro: fica o de admissão mais antiga
    const melhor = (mapa, chave) => {
      if (!chave) return;
      const prev = mapa.get(chave);
      if (!prev || (adm && (!prev.admissao || adm < prev.admissao))) mapa.set(chave, reg);
    };
    melhor(seniorPorEmail, norm(s.email).toLowerCase());
    melhor(seniorPorNome, nome);
    melhor(seniorPorNomeSimples, semAcento(nome));
  }

  /** Quantos casaram por cada via, e os casamentos de e-mail que merecem conferência. */
  const juncao = {
    porEmail: 0, porNome: 0, porNomeSemAcento: 0, semRh: 0,
    // e-mail igual, nome com grafia diferente, aceito como a mesma pessoa
    divergentes: [],
    // e-mail igual, nome de OUTRA pessoa: casamento recusado
    recusados: [],
  };

  const sellersByName = new Map();
  for (const u of sellers) {
    const nome = norm(u.vendedor);
    if (!nome) continue;
    const dataInicio = toIso(u.admissao);
    const email = norm(u.email).toLowerCase();

    let sr = email ? seniorPorEmail.get(email) : null;
    let via = 'email';
    // e-mail igual com nome de outra pessoa não é a mesma pessoa: descarta o
    // casamento e tenta pelo nome, que é o caminho honesto nesse caso.
    if (sr && !mesmaPessoa(nome, sr.nome)) {
      juncao.recusados.push({ voalle: nome, senior: sr.nome });
      sr = null;
    }
    if (!sr) { sr = seniorPorNome.get(nome); via = 'nome'; }
    if (!sr) { sr = seniorPorNomeSimples.get(semAcento(nome)); via = 'nomeSemAcento'; }

    // o modelo original mantém só quem existe no RH (Senior):
    //   Table.SelectRows(..., each [admissao senior] <> null)
    if (!sr?.admissao) { juncao.semRh += 1; continue; }

    if (via === 'email') {
      juncao.porEmail += 1;
      // Mesmo e-mail e nomes que não são o mesmo nome nem ignorando acento: ou é
      // conta compartilhada, ou é erro de cadastro numa das bases. O casamento vale
      // (é o que a origem faz), mas fica registrado para conferência — é assim que
      // 'SEM AUXILIAR' herdaria a admissão de outra pessoa sem ninguém notar.
      if (semAcento(nome) !== semAcento(sr.nome)) {
        juncao.divergentes.push({ voalle: nome, senior: sr.nome, via });
      }
    } else if (via === 'nome') juncao.porNome += 1;
    else juncao.porNomeSemAcento += 1;

    const admissaoReal = sr.admissao || dataInicio;
    if (!admissaoReal) continue;
    const prev = sellersByName.get(nome);
    // mesmo vendedor pode ter mais de um usuário: mantém o mais antigo
    if (prev && prev.dataInicio && dataInicio && prev.dataInicio <= dataInicio) continue;
    sellersByName.set(nome, {
      vendedor: nome,
      dataInicio,                                   // users.created
      admissaoSenior: sr?.admissao || null,         // RH
      admissaoReal,                                 // admissao real
      cargo: sr?.cargo || null,
      noRh: Boolean(sr),
      viaJuncao: via,                               // email | nome | nomeSemAcento
      dataFim: dataInicio ? addDays(dataInicio, 90) : null,
      fimRampagem: addDays(admissaoReal, 90),       // Fim rampagem
      dataApos90: addDays(admissaoReal, 90),        // Data_apos_90_dias
      data60: addDays(admissaoReal, 60),            // Data60Dias
      mesVirada: startOfNextMonth(addDays(admissaoReal, 60)), // MesViradaPagante
    });
  }

  // ---- índices auxiliares ----------------------------------------------
  const alocByKey = new Map();
  for (const a of aloc) {
    if (!a.data_ativacao) continue;
    alocByKey.set(`${norm(a.contrato)}\x00${norm(a.cliente)}`, toIso(a.data_ativacao));
  }

  const phoneByKey = new Map();
  for (const p of phone) {
    if (!p.ativacao) continue;
    phoneByKey.set(`${norm(p.contrato)}\x00${p.protocolo ?? ''}`, toIso(p.ativacao));
  }

  const pagtoByKey = new Map();
  for (const p of pagto) {
    // join do Power Query: [DATA/HORA CRIAÇÃO CONTRATO, CLIENTES] x [DATA CRIAÇÃO, NOME]
    pagtoByKey.set(`${p.created_key}\x00${norm(p.nome)}`, p);
  }

  // ---- tabela de fatos ("general") --------------------------------------
  const seen = new Set(); // Table.Distinct({CLIENTES, CONTRATO})
  const facts = [];
  for (const r of base) {
    const cliente = norm(r.clientes);
    const contrato = norm(r.contrato);
    const dedupe = `${cliente}\x00${contrato}`;
    if (seen.has(dedupe)) continue;
    seen.add(dedupe);

    const vendedor = norm(r.vendedor);
    const team = teamsByName.get(vendedor);
    const seller = sellersByName.get(vendedor);

    const dtAtivFibra = alocByKey.get(`${contrato}\x00${cliente}`) || null;
    const dtAtivTel = phoneByKey.get(`${contrato}\x00${r.protocolo ?? ''}`) || null;
    const tecnologia = norm(r.tecnologia);
    const dtAtiv = tecnologia === 'TELEFONIA' ? dtAtivTel : dtAtivFibra;
    const pg = pagtoByKey.get(`${r.created_key}\x00${cliente}`);
    const dtVenda = toIso(r.data_criacao_contrato);

    facts.push({
      // 'voalle' aqui e nao no modelo de relatorios: la, acrescentar o campo custava
      // clonar 120 mil objetos (92 MB medidos). Um campo a mais no objeto que ja
      // existe custa nada, e o modelo de relatorios passa a apontar para estes.
      origem: 'voalle',
      contrato,
      cliente,
      protocolo: r.protocolo ?? null,
      cidade: norm(r.cidade),
      // bairro e data de cancelamento existem para a tela de Relatorios (tabela
      // GERAL). Nenhuma outra tela usa; sao dois campos a mais por fato.
      bairro: norm(r.bairro),
      dtCancelado: toIso(r.data_cancelado),
      vendedor,
      regiao: norm(r.regiao_vendedor),
      statusContrato: norm(r.status_contrato),
      statusCancelamento: norm(r.status_cancelamento),
      canal: norm(r.canal),
      tecnologia,
      tipoSolicitacao: norm(r.tipo_solicitacao),
      temTipoPadrao: r.tem_tipo_padrao !== false,
      valor: Number(r.valor) || 0,
      dtVenda,
      horaVenda: r.hora_criacao || null,
      dtCadastroCliente: toIso(r.cadastro_cliente),
      dtAtivFibra,
      dtAtivTel,
      dtAtiv,
      dtPagto: pg ? toIso(pg.pagamento_cliente) : null,
      plano: pg ? norm(pg.plano) : '',
      dtVencimento: pg ? toIso(pg.data_vencimento) : null,
      // dimensões vindas de teams / new_sellers
      equipe: team?.equipe || '',
      situacao: team?.situacao || '',
      vendedorAtivo: team?.ativo ?? null,
      admissaoReal: seller?.admissaoReal || null,
      fimRampagem: seller?.fimRampagem || null,
      // colunas calculadas de rampagem (VENDAS_RAMPAGEM / ATIVOS_RAMPAGEM)
      venda90: seller?.fimRampagem && dtVenda && dtVenda <= seller.fimRampagem ? 1 : 0,
      ativo90: seller?.fimRampagem && dtAtivFibra && dtAtivFibra <= seller.fimRampagem ? 1 : 0,
    });
  }

  // ---- dimensões para os slicers ---------------------------------------
  const uniq = (arr) => [...new Set(arr.filter(Boolean))].sort((a, b) => a.localeCompare(b, 'pt-BR'));

  state.facts = facts;
  state.teamsByName = teamsByName;
  state.sellersByName = sellersByName;
  state.juncaoSellers = juncao;
  state.dims = {
    vendedores: uniq([...teamsByName.keys()]),
    equipes: uniq([...teamsByName.values()].map((t) => t.equipe)),
    situacoes: uniq([...teamsByName.values()].map((t) => t.situacao)),
    tecnologias: ['FIBRA', 'RÁDIO', 'TELEFONIA'],
    canais: uniq(facts.map((f) => f.canal)),
    cidades: uniq(facts.map((f) => f.cidade)),
  };
  state.version += 1;
  state.builtAt = new Date().toISOString();
  state.buildMs = Date.now() - started;

  return state;
}

export function isReady() {
  return state.facts.length > 0;
}
