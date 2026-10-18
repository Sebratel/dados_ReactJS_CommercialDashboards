/**
 * O VOCABULÁRIO DE CAMPANHAS — o que se lê do nome de uma campanha de anúncio.
 *
 * Google e Meta não têm campo de tipo de campanha nem de cidade: está tudo no
 * nome. Este módulo traduz o nome para
 *
 *     { plataforma, familia, cidade }
 *
 *   campanha Meta   [W] [CP-21] [REC] [ALCANCE+BOTÃO WHATSAPP] [CACHOEIRINHA] [04-06-2026]
 *   identidade      { plataforma: 'meta', familia: 'alcance', cidade: 'CACHOEIRINHA' }
 *
 * e acha a cidade em qualquer texto — também no título do anúncio e na mensagem
 * do lead do rastreamento.
 *
 * Até out/2026 este módulo também traduzia as TAGS de marketing do Matrix e ligava
 * tag a campanha por semelhança. Essa ponte saiu junto com a tag: o lead agora vem
 * do rastreamento de posts (ver model/campanhas.js).
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
 * `sao leopodo` não é engano de digitação meu: é como a cidade foi escrita em
 * parte das fontes durante seis meses. Precisa casar com "SÃO LEOPOLDO", senão a
 * mesma cidade aparece duas vezes, cada metade com um número.
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
