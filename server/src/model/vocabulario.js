/**
 * O VOCABULÁRIO DE CAMPANHAS — o que torna as três fontes comparáveis.
 *
 * Matrix, Google e Meta nomeiam a mesma campanha de três jeitos, e nenhum deles é
 * um ID. Este módulo traduz qualquer um dos três para a MESMA identidade:
 *
 *     { plataforma, familia, cidade }
 *
 *   tag do Matrix   marketing_alcance_meta_cachoeirinha
 *   campanha Meta   [W] [CP-21] [REC] [ALCANCE+BOTÃO WHATSAPP] [CACHOEIRINHA] [04-06-2026]
 *   identidade      { plataforma: 'meta', familia: 'alcance', cidade: 'CACHOEIRINHA' }
 *
 * É uma HEURÍSTICA declarada, não uma chave. Enquanto não existir o ID de campanha
 * nas tags, esta é a ponte — e a tela diz isso em cima do funil, porque número
 * junto com número vira conclusão, e conclusão sobre suposição escondida é a pior
 * espécie de erro de dashboard.
 *
 * DUAS ERAS DE NOMENCLATURA, e o resolvedor conhece as duas:
 *
 *   até jun/2026   marketing_campanha_macro_<cidade>, marketing_campanha_organica
 *                  "RP - Felicidade Ilimitada - <Cidade>", "Camp. Comercial - Abr.26"
 *   de jul/2026    marketing_<familia>_<plataforma>[_<cidade>]
 *                  "[W] [CP-nn] [ENG] [WHATSAPP] [COMERCIAL] [01-05-2026]"
 *
 * A virada é o motivo de o relatório de origem estar cego desde 20/07/2026: ele
 * procura o padrão antigo, que parou de ser escrito. Traduzir as duas para o mesmo
 * vocabulário devolve a série inteira, com a troca de padrão aparecendo como troca
 * de padrão — e não como queda a zero.
 */

/** Sem acento, sem pontuação, minúsculo: a forma em que tudo é comparado. */
export const simples = (v) => String(v ?? '')
  .normalize('NFD').replace(/[̀-ͯ]/g, '')
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, ' ')
  .trim();

/**
 * As seis cidades da operação, com os apelidos que cada fonte usa.
 *
 * `sao_leopodo` não é engano de digitação meu: é como a tag foi gravada no Matrix
 * durante seis meses (310 atendimentos). Corrigir na origem é outro assunto; aqui
 * ela precisa casar com "SÃO LEOPOLDO" do Google, senão a mesma cidade aparece
 * duas vezes no funil, cada metade com um número.
 */
const CIDADES = [
  ['CANOAS', ['canoas']],
  ['NOVO HAMBURGO', ['novo hamburgo', 'nh']],
  ['SÃO LEOPOLDO', ['sao leopoldo', 'sao leopodo', 'sao leo']],
  ['SAPUCAIA DO SUL', ['sapucaia do sul', 'sapucaia']],
  ['ESTEIO', ['esteio']],
  ['CACHOEIRINHA', ['cachoeirinha']],
];

/**
 * Acha a cidade dentro de um texto qualquer.
 *
 * Casa por PALAVRA inteira, e não por `includes`: 'nh' dentro de "Felicidade
 * Ilimitada" não é Novo Hamburgo. Os apelidos longos vêm antes dos curtos porque
 * 'sapucaia do sul' contém 'sapucaia' — o primeiro que casa é o mais específico.
 */
export function cidadeDe(texto) {
  const s = ` ${simples(texto)} `;
  for (const [nome, apelidos] of CIDADES) {
    for (const a of apelidos) if (s.includes(` ${a} `)) return nome;
  }
  return null;
}

/**
 * As famílias de campanha, na ordem em que são testadas.
 *
 * A ORDEM IMPORTA e não é alfabética: `vagas` vem antes de tudo porque
 * "[CP-04] [ENG] [WHATSAPP] [VAGAS] [CIDADES]" também casa com 'whatsapp' e com
 * 'cidades', e classificá-la como comercial jogaria R$ 202 mil de recrutamento
 * dentro do custo por lead comercial.
 *
 * `recrutamento: true` marca o que NÃO é captação de cliente. Medido na base:
 * 44 campanhas e R$ 202.517,74 — 43,5% de todo o gasto do Meta. O relatório de
 * origem soma tudo num `Custo_Total_META` só, então o investimento de marketing
 * que ele mostra vem quase metade de vaga de emprego.
 */
const FAMILIAS = [
  { id: 'vagas', rotulo: 'Vagas (recrutamento)', recrutamento: true, termos: ['vaga', 'vagas'] },
  { id: 'condominios', rotulo: 'Condomínios', termos: ['condominio', 'condominios'] },
  { id: 'lancamento', rotulo: 'Lançamento', termos: ['lancamento'] },
  { id: 'trafego', rotulo: 'Tráfego / captura', termos: ['traf', 'lp captura', 'wpp captura', 'trafego para lp', 'link a', 'link b'] },
  { id: 'alcance', rotulo: 'Alcance', termos: ['alcance', 'rec', 'reconhecimento'] },
  /**
   * COMERCIAL é a campanha de CONVERSA: a que abre um atendimento.
   *
   * Entram os canais de mensagem além da palavra 'comercial', porque é isso que a
   * campanha é — "[CP-03] [ENG] [WHATSAPP] [CACHOEIRINHA]" e "Camp. Comercial -
   * Abr.26 (Mensagem - Whats)" fazem a mesma coisa, e só a segunda tem a palavra.
   *
   * Vem DEPOIS de alcance e tráfego de propósito: "[ALCANCE+BOTÃO WHATSAPP]" e
   * "[WPP-CAPTURA]" também têm whatsapp no nome, e são outra coisa.
   */
  { id: 'comercial', rotulo: 'Comercial', termos: ['comercial', 'whatsapp', 'whats', 'wpp', 'mensagem', 'direct', 'messenger'] },
  { id: 'envolvimento', rotulo: 'Envolvimento', termos: ['envolvimento'] },
  { id: 'video', rotulo: 'Vídeo', termos: ['visualizacao de video', 'video'] },
  { id: 'melhor_plano', rotulo: 'Melhor plano', termos: ['melhor plano'] },
  { id: 'site_organico', rotulo: 'Site (orgânico)', termos: ['site organico'] },
  { id: 'organica', rotulo: 'Orgânica', termos: ['organica', 'organico'] },
  { id: 'macro', rotulo: 'Macro (cidades)', termos: ['campanha macro', 'macro'] },
  { id: 'conexao_garantida', rotulo: 'Conexão Garantida', termos: ['conexao garantida'] },
  { id: 'felicidade_ilimitada', rotulo: 'Felicidade Ilimitada', termos: ['felicidade ilimitada'] },
  { id: 'pontuais', rotulo: 'Pontuais', termos: ['pontuais'] },
  { id: 'copa', rotulo: 'Copa', termos: ['copa'] },
];

export const FAMILIA_ROTULO = Object.fromEntries(FAMILIAS.map((f) => [f.id, f.rotulo]));
export const FAMILIAS_RECRUTAMENTO = new Set(FAMILIAS.filter((f) => f.recrutamento).map((f) => f.id));

function familiaDe(texto) {
  const s = ` ${simples(texto)} `;
  for (const f of FAMILIAS) {
    for (const t of f.termos) if (s.includes(` ${t} `)) return f.id;
  }
  return null;
}

export const PLATAFORMAS = {
  google: 'Google Ads',
  meta: 'Meta Ads',
  site: 'Site',
  organico: 'Orgânico',
  '?': 'Não identificada',
};

/**
 * A identidade de uma TAG do Matrix.
 *
 * O padrão novo põe a plataforma no próprio nome (`..._meta`), e é isso que torna a
 * ponte possível sem ID: `marketing_comercial_meta_canoas` diz, sozinha, que veio
 * do Meta, que é campanha comercial e que é de Canoas.
 *
 * O padrão antigo (`marketing_campanha_macro_canoas`) NÃO diz a plataforma —
 * naquela época o Google e o Meta rodavam as macro juntos e a tag não separava.
 * Por isso a plataforma dele fica '?' em vez de chutar: atribuir a macro ao Meta
 * daria ao Meta um funil que é dos dois.
 */
/**
 * O ID do anúncio dentro da tag — a ponte que a área montou em outubro/2026.
 *
 * A partir daí o atendimento passou a carregar, além do rótulo, o identificador
 * numérico do anúncio no Meta:
 *
 *     120248421965260047_Comercial_Meta_SAO LEOPOLDO
 *     120249119020270047_ Alcance_Meta _CANOAS
 *
 * Note o espaçamento inconsistente entre os dois exemplos — por isso o corte é
 * "os dígitos do começo", e não uma divisão por `_`.
 *
 * ATENÇÃO AO QUE ESSE NÚMERO É. Conferido contra `marketing_meta_ads` em
 * 05/10/2026: nenhum dos dez IDs em uso é um ID de CAMPANHA. Eles são vizinhos
 * imediatos de campanhas reais (o de CACHOEIRINHA difere do
 * `[Vendas][Reconhecimento][WPP][Todas Cidades]` em +10 no 14º dígito, e os cinco
 * `Comercial_Meta_*` compartilham 11 dígitos com o `[CP-27] [COMERCIAL]`), o que
 * os identifica como CONJUNTOS DE ANÚNCIOS — um por cidade, dentro da campanha.
 * A exportação do Meta que temos é de nível `campaign` apenas, então hoje esse
 * ID não encontra par. Guardamos ele mesmo assim: identifica o atendimento com
 * exatidão, agrupa sozinho, e casa automaticamente no dia em que a exportação
 * trouxer o nível de conjunto.
 */
const ID_NA_TAG = /^\s*(\d{10,})[\s_-]+(.*)$/;

export function identidadeDaTag(tag) {
  const bruto = String(tag ?? '');
  const comId = bruto.match(ID_NA_TAG);
  const anuncioId = comId ? comId[1] : null;
  // com ID, o que descreve a campanha é o resto; sem ID, a tag inteira
  const descritor = comId ? comId[2] : bruto;
  const s = simples(descritor);

  // a tag com ID não começa com "marketing" — o prefixo ficou na tag irmã
  if (!anuncioId && !s.startsWith('marketing')) return null;

  let plataforma = '?';
  if (/\bmeta\b/.test(s)) plataforma = 'meta';
  else if (/\bgoogle\b/.test(s)) plataforma = 'google';
  else if (/\bsite\b/.test(s)) plataforma = 'site';
  else if (/\borganic[ao]\b/.test(s)) plataforma = 'organico';

  return {
    plataforma,
    familia: familiaDe(s) || 'outras',
    cidade: cidadeDe(s),
    anuncioId,
    origem: 'tag',
    bruto,
  };
}

/**
 * A identidade de um NOME DE CAMPANHA de anúncio (Google ou Meta).
 *
 * `plataforma` vem de fora, porque é a tabela que diz de onde a linha veio — o nome
 * sozinho não distingue: "[W] [CP-02] ..." existe nas duas.
 *
 * `[CIDADES]` no nome do Meta significa "todas", não uma cidade — vira `null`, que é
 * como a campanha sem recorte de cidade é tratada no cruzamento.
 */
export function identidadeDaCampanha(nome, plataforma, id = null) {
  const s = simples(nome);
  const cp = String(nome ?? '').match(/\[\s*(CP-\d+)\s*\]/i)?.[1]?.toUpperCase() || null;
  return {
    plataforma,
    familia: familiaDe(s) || 'outras',
    cidade: / cidades /.test(` ${s} `) ? null : cidadeDe(s),
    cp,
    anuncioId: id ? String(id) : null,
    origem: 'campanha',
    bruto: String(nome ?? ''),
  };
}

/**
 * A chave com que as três fontes se encontram.
 *
 * Cidade entra como 'TODAS' quando não há: a campanha do Meta chamada
 * "[COMERCIAL]" sem cidade cobre as seis, e é com ela que o atendimento tagueado
 * `marketing_comercial_meta` (também sem cidade) tem de casar.
 */
export const chaveDe = (id) => (id
  ? `${id.plataforma}|${id.familia}|${id.cidade || 'TODAS'}`
  : null);

/** A mesma chave ignorando a cidade — o degrau de fallback do cruzamento. */
export const chaveSemCidade = (id) => (id ? `${id.plataforma}|${id.familia}` : null);

/**
 * O CRUZAMENTO, EM TRÊS DEGRAUS — e cada degrau diz o quanto se pode confiar nele.
 *
 * Um degrau só não serve, e a base mostra por quê:
 *
 *   1. EXATA — plataforma, família e cidade batem.
 *      `marketing_alcance_meta_cachoeirinha` ↔ "[CP-21] [REC] [ALCANCE...] [CACHOEIRINHA]"
 *
 *   2. FAMÍLIA — a tag tem cidade, a campanha cobre todas.
 *      No Meta, a campanha comercial é uma só para as seis cidades
 *      (`[ENG] [WHATSAPP] [COMERCIAL]`), mas a tag do atendimento diz de qual
 *      cidade a pessoa falou (`marketing_comercial_meta_canoas`). Sem este degrau,
 *      1.490 atendimentos achavam a campanha e outros 1.490 não — os mesmos
 *      atendimentos, separados por terem sido tagueados com mais precisão.
 *      O investimento aqui é RATEADO entre as cidades que a campanha atendeu.
 *
 *   3. CIDADE — a tag não diz a plataforma, então vale a cidade.
 *      É a era das macro (jan–jun/2026): `marketing_campanha_macro_canoas` não
 *      distingue Google de Meta porque naquela época os dois rodavam a campanha de
 *      cidade juntos. Casar por cidade junta os dois investimentos, que é
 *      justamente o que aconteceu na realidade — e a tela precisa dizer isso.
 *
 * `confianca` sai junto no resultado, e a tela mostra. Número cruzado por
 * heurística sem dizer qual heurística é como chegou a virar conclusão errada.
 */
export const CONFIANCA = {
  id: 'ID', exata: 'exata', familia: 'família', cidade: 'cidade',
};

/** Índice das campanhas de anúncio, nos recortes que o cruzamento consulta. */
export function indexarCampanhas(campanhas) {
  const porChave = new Map();
  const porFamilia = new Map();
  const porCidade = new Map();
  const porId = new Map();
  const empurrar = (mapa, k, v) => {
    if (!k) return;
    const l = mapa.get(k);
    if (l) l.push(v); else mapa.set(k, [v]);
  };
  for (const c of campanhas) {
    empurrar(porChave, chaveDe(c.identidade), c);
    empurrar(porFamilia, chaveSemCidade(c.identidade), c);
    empurrar(porCidade, c.identidade.cidade, c);
    // o ID vai como TEXTO: estes numeros tem 18 digitos e nao cabem em double.
    // Comparar como numero arredonda e faz IDs diferentes virarem o mesmo.
    if (c.campanhaId) empurrar(porId, String(c.campanhaId), c);
  }
  return { porChave, porFamilia, porCidade, porId };
}

/**
 * As campanhas de anúncio que correspondem a uma identidade de tag.
 * Devolve `{ campanhas, confianca }`, ou `null` quando nenhum degrau alcança.
 */
export function cruzar(idTag, indice) {
  if (!idTag) return null;

  /**
   * DEGRAU 0 — o ID. Quando existe dos dois lados, acabou a heuristica.
   *
   * Hoje ele quase nunca casa, e a razao esta documentada em `identidadeDaTag`:
   * a tag carrega o ID do CONJUNTO de anuncios e a exportacao do Meta so traz o
   * nivel de campanha. O degrau fica aqui pronto, e passa a valer sozinho no dia
   * em que a exportacao trouxer o conjunto -- sem mexer em codigo.
   */
  if (idTag.anuncioId) {
    const porId = indice.porId?.get(String(idTag.anuncioId));
    if (porId?.length) return { campanhas: porId, confianca: 'id' };
  }

  const exata = indice.porChave.get(chaveDe(idTag));
  if (exata?.length) return { campanhas: exata, confianca: 'exata' };

  // a tag tem cidade e a campanha cobre todas — degrau 2
  if (idTag.cidade) {
    const daFamilia = indice.porFamilia.get(chaveSemCidade(idTag));
    if (daFamilia?.length) return { campanhas: daFamilia, confianca: 'familia' };
  }

  // sem plataforma na tag (era das macro), vale a cidade — degrau 3
  if (idTag.plataforma === '?' && idTag.cidade) {
    const daCidade = indice.porCidade.get(idTag.cidade);
    if (daCidade?.length) return { campanhas: daCidade, confianca: 'cidade' };
  }

  return null;
}

/**
 * Rótulo legível de uma identidade, para a tela e para o CSV.
 * "Meta Ads · Alcance · CACHOEIRINHA"
 */
export function rotuloDaIdentidade(id) {
  if (!id) return '(não identificada)';
  return [
    PLATAFORMAS[id.plataforma] || id.plataforma,
    FAMILIA_ROTULO[id.familia] || id.familia,
    id.cidade || 'todas as cidades',
  ].join(' · ');
}

/**
 * Quebra a coluna `tags` do Matrix na lista de tags de verdade.
 *
 * O campo é uma sopa: vem com aspas duplas em volta da string inteira, separador
 * vírgula em umas linhas e ` || ` em outras, e a mesma campanha aparece nas duas
 * formas. Sem normalizar, `marketing_campanha_macro_canoas` e
 * `"marketing_campanha_macro_canoas"` contam como campanhas diferentes — no
 * relatório de origem, Canoas aparece partida em quatro linhas do mesmo gráfico.
 */
export function tagsDe(bruto) {
  if (!bruto) return [];
  return String(bruto)
    .replace(/^"+|"+$/g, '')
    .split(/\s*\|\|\s*|,/)
    .map((t) => t.replace(/^"+|"+$/g, '').trim())
    .filter(Boolean);
}

/** Só as tags de marketing de um atendimento, já traduzidas para identidade. */
export function identidadesDoAtendimento(tagsBrutas) {
  const out = [];
  const vistas = new Set();
  for (const t of tagsDe(tagsBrutas)) {
    const id = identidadeDaTag(t);
    if (!id) continue;
    const k = chaveDe(id);
    if (vistas.has(k)) continue;
    vistas.add(k);
    out.push(id);
  }
  return out;
}

/**
 * Número em português para número de verdade.
 *
 * As colunas de dinheiro do Google são varchar: '142,49', '13,36%', '1.234,56'.
 * `Number('142,49')` é NaN e `parseFloat` devolve 142 — os dois erram calados, um
 * zerando o total e o outro cortando os centavos de 760 linhas.
 */
export function numeroBR(v) {
  if (v === null || v === undefined || v === '') return 0;
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
  const limpo = String(v).replace(/%/g, '').replace(/\s/g, '').replace(/\./g, '').replace(',', '.');
  const n = Number(limpo);
  return Number.isFinite(n) ? n : 0;
}
