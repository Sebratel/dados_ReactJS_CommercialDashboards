/**
 * VALIDAR O LOTE E MONTAR O SQL
 * Fluxo: MKT · Google Ads → DB_Marketing (carga diária)
 *
 * Recebe o lote que o script do Google Ads envia (uma linha por campanha e dia)
 * e devolve os comandos de gravação em `DB_Marketing.marketing_google_ads`.
 *
 * CONTRATO DE ENTRADA (corpo JSON do webhook)
 *   { conta, geradoEm, de, ate, linhas: [ {
 *       campanha, campanhaId, estado, tipo, dia (AAAA-MM-DD), moeda,
 *       cliques, impressoes, ctr (fração), cpcMedio, custo,
 *       impressaoTopoAbsoluto (fração|null), impressaoTopo (fração|null),
 *       conversoes, conversoesVisualizacao, custoPorConversao,
 *       taxaConversao (fração)
 *   } ] }
 *
 * SAÍDA
 *   Lote inválido: um item { valido: false, erro } — o fluxo responde 400.
 *   Lote válido:   um item por bloco de até 200 linhas
 *                  { valido: true, query, total, campanhas, de, ate }.
 *
 * POR QUE SQL MONTADO AQUI, E NÃO A OPERAÇÃO NATIVA "UPSERT"
 *   1. A chave da tabela é COMPOSTA (ID da campanha + Dia). O upsert nativo do
 *      nó MySQL casa por UMA coluna: casando só pelo ID, cada dia sobrescreveria
 *      o anterior e a tabela ficaria com uma linha por campanha.
 *   2. Nesta instância o `queryReplacement` não vincula os `?` (medido em
 *      06/10/2026). Por isso os valores são ESCAPADOS aqui, um a um, e todos
 *      passam por validação de tipo antes — número é número, data é data, ID é
 *      só dígitos.
 *
 * POR QUE OS NÚMEROS VIRAM TEXTO EM PORTUGUÊS
 *   A tabela nasceu da exportação manual do Google Ads: custo, CTR, CPC e
 *   conversões são varchar no formato brasileiro ('216,95', '17,5%'), e a tela
 *   de Campanhas do dashboard lê assim. Gravar no mesmo formato deixa a carga
 *   automática e a manual indistinguíveis — e nada no dashboard precisa mudar.
 *
 * As linhas do SQL são unidas com ' \n': o nó MySQL desta instância apaga a
 * quebra de linha sem pôr espaço, e "VALUES\n(" virava "VALUES(" — ou pior,
 * colava duas palavras.
 */
const TABELA = 'DB_Marketing.marketing_google_ads';
const LINHAS_POR_COMANDO = 200;
const MAX_LINHAS = 20000;
const DIAS_PARA_TRAS = 400;

const ESTADO = { ENABLED: 'Ativada', PAUSED: 'Pausada', REMOVED: 'Removida' };
const TIPO = {
  SEARCH: 'Pesquisa',
  DISPLAY: 'Display',
  PERFORMANCE_MAX: 'Performance Max',
  VIDEO: 'Vídeo',
  DEMAND_GEN: 'Geração de demanda',
  SHOPPING: 'Shopping',
  MULTI_CHANNEL: 'Multicanal',
  LOCAL: 'Local',
  SMART: 'Inteligente',
};

const COLUNAS = [
  'Campanha', 'ID da campanha', 'Estado da campanha', 'Tipo de campanha', 'Dia',
  'Cliques', 'Impr.', 'CTR', 'Código da moeda', 'CPC méd.', 'Custo',
  '% de impr. (1ª posição)', '% de impr. (parte sup.)', 'Conversões',
  'Conv. de visualização', 'Custo / conv.', 'Taxa de conv.',
];

const recusar = (erro) => [{ json: { valido: false, erro } }];

const corpo = $input.first().json.body || {};
const linhas = Array.isArray(corpo.linhas) ? corpo.linhas : null;
if (!linhas) return recusar('O corpo precisa trazer "linhas" como uma lista.');
if (!linhas.length) return recusar('Lote vazio: nenhuma linha recebida.');
if (linhas.length > MAX_LINHAS) return recusar(`Lote grande demais: ${linhas.length} linhas (máximo ${MAX_LINHAS}).`);

const hoje = new Date().toISOString().slice(0, 10);
const limite = new Date(Date.now() - DIAS_PARA_TRAS * 864e5).toISOString().slice(0, 10);

/** Número não negativo; vazio vira 0, ou null quando a métrica pode não existir. */
function numero(v, campo, n, aceitaNulo = false) {
  if (v === null || v === undefined || v === '') return aceitaNulo ? null : 0;
  const x = Number(v);
  if (!Number.isFinite(x) || x < 0) throw new Error(`Linha ${n}: "${campo}" inválido (${v}).`);
  return x;
}

/** 216.95 -> '216,95'; 17.5 -> '17,5'; 0 -> '0'. Até duas casas, sem zero à direita. */
const br = (x) => (x === null ? null : String(Number(x.toFixed(2))).replace('.', ','));
const pct = (fracao) => (fracao === null ? null : `${br(fracao * 100)}%`);

/** Literal SQL de texto, escapado. Barra invertida primeiro, depois a aspa. */
const texto = (v) => (v === null || v === undefined
  ? 'NULL'
  : `'${String(v).replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`);

const tuplas = [];
const campanhas = new Set();
let de = null;
let ate = null;

try {
  linhas.forEach((l, i) => {
    const n = i + 1;
    const id = String(l.campanhaId ?? '').trim();
    if (!/^\d{1,19}$/.test(id)) throw new Error(`Linha ${n}: "campanhaId" precisa ser só dígitos (${l.campanhaId}).`);
    const dia = String(l.dia ?? '').trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dia)) throw new Error(`Linha ${n}: "dia" precisa ser AAAA-MM-DD (${l.dia}).`);
    if (dia > hoje || dia < limite) throw new Error(`Linha ${n}: "dia" fora da janela aceita (${dia}).`);
    const nome = String(l.campanha ?? '').trim().slice(0, 128);
    if (!nome) throw new Error(`Linha ${n}: "campanha" vazia.`);

    const cliques = Math.round(numero(l.cliques, 'cliques', n));
    const impressoes = Math.round(numero(l.impressoes, 'impressoes', n));
    const visualizacao = Math.round(numero(l.conversoesVisualizacao, 'conversoesVisualizacao', n));

    campanhas.add(id);
    if (!de || dia < de) de = dia;
    if (!ate || dia > ate) ate = dia;

    tuplas.push(`(${[
      texto(nome),
      id, // validado acima: só dígitos, entra como número sem passar por float
      texto(ESTADO[l.estado] || String(l.estado || '').slice(0, 50) || null),
      texto(TIPO[l.tipo] || String(l.tipo || '').slice(0, 50) || null),
      texto(`${dia} 00:00:00`),
      String(cliques),
      String(impressoes),
      texto(pct(numero(l.ctr, 'ctr', n))),
      texto(String(l.moeda || 'BRL').slice(0, 50)),
      texto(br(numero(l.cpcMedio, 'cpcMedio', n))),
      texto(br(numero(l.custo, 'custo', n))),
      texto(pct(numero(l.impressaoTopoAbsoluto, 'impressaoTopoAbsoluto', n, true))),
      texto(pct(numero(l.impressaoTopo, 'impressaoTopo', n, true))),
      texto(br(numero(l.conversoes, 'conversoes', n))),
      String(visualizacao),
      texto(br(numero(l.custoPorConversao, 'custoPorConversao', n))),
      texto(pct(numero(l.taxaConversao, 'taxaConversao', n))),
    ].join(', ')})`);
  });
} catch (err) {
  return recusar(err.message);
}

const colunas = COLUNAS.map((c) => `\`${c}\``).join(', ');
const atualizar = COLUNAS
  .filter((c) => c !== 'ID da campanha' && c !== 'Dia')
  .map((c) => `\`${c}\` = VALUES(\`${c}\`)`)
  .join(', ');

const blocos = [];
for (let i = 0; i < tuplas.length; i += LINHAS_POR_COMANDO) {
  const query = [
    `INSERT INTO ${TABELA} (${colunas})`,
    'VALUES',
    tuplas.slice(i, i + LINHAS_POR_COMANDO).join(', \n'),
    `ON DUPLICATE KEY UPDATE ${atualizar};`,
  ].join(' \n');
  blocos.push({
    json: {
      valido: true,
      query,
      total: tuplas.length,
      campanhas: campanhas.size,
      de,
      ate,
      conta: corpo.conta || null,
    },
  });
}
return blocos;
