/**
 * META ADS — tradução da Marketing API para a tabela `DB_Marketing.marketing_meta_ads`.
 *
 * Módulo PURO: recebe o que a API devolve e devolve linhas no formato da tabela.
 * A chamada à API e a gravação ficam em `src/metaAds.js`.
 *
 * A TABELA NASCEU DA EXPORTAÇÃO MANUAL do Gerenciador de Anúncios (nível
 * campanha, um dia por linha), em português. A carga automática grava no MESMO
 * formato — "Conversas por mensagem iniciadas", "Clique com 7 dias ou
 * visualização com 1 dia", estado em minúsculo — para a carga manual e a
 * automática serem indistinguíveis e nada na tela precisar mudar.
 *
 * Conferido contra a exportação manual em 19/10/2026: o campo `results` da API é
 * o "Resultados" do Gerenciador (6 conversas a R$ 29,78 nos dois lados), e o
 * gasto de setembro bate no centavo (R$ 87.304,77).
 */

/**
 * O indicador de resultado da API -> o "Tipo de resultado" da exportação.
 * Indicador fora desta lista é gravado cru, para aparecer e ser traduzido aqui,
 * em vez de virar um rótulo errado.
 */
const TIPO_RESULTADO = {
  'actions:onsite_conversion.messaging_conversation_started_7d': 'Conversas por mensagem iniciadas',
  reach: 'Alcance',
  'actions:post_engagement': 'Interações',
  'actions:post_interaction_gross': 'Interações',
  'actions:landing_page_view': 'Visualizações da página de destino',
  'actions:omni_landing_page_view': 'Visualizações da página de destino',
  'actions:offsite_conversion.fb_pixel_lead': 'Leads no site',
  // campanha com mais de um tipo de resultado no dia: a exportação deixa em branco
  mixed: '',
  'actions:link_click': 'Cliques na ligação',
  'actions:video_thruplay_watched': 'ThruPlay',
  video_thruplay_watched_actions: 'ThruPlay',
  'actions:instagram_profile_visit': 'Visitas ao perfil do Instagram',
  'profile_visit_view': 'Visitas ao perfil do Instagram',
  impressions: 'Impressões',
  'actions:lead': 'Leads',
  'actions:onsite_conversion.lead_grouped': 'Leads',
};

/**
 * O `attribution_setting` da API -> a "Definição de atribuição" da exportação.
 *
 * A API escreve as janelas em ordem variável (`1d_view_7d_click` e
 * `7d_click_1d_view` são a mesma coisa), então a chave é normalizada antes:
 * partes ordenadas. `na` é "sem atribuição", que a exportação mostra como '–'.
 */
const ATRIBUICAO = {
  '1d_view_7d_click': 'Clique com 7 dias ou visualização com 1 dia',
  '1d_click': 'Clique com 1 dia',
  '7d_click': 'Clique com 7 dias',
  '1d_click_1d_view': 'Clique com 1 dia ou visualização com 1 dia',
  '1d_ev_1d_view_7d_click': 'Clique com 7 dias, visualização com 1 dia ou visualização com interação de 1 dia',
  '1d_view': 'Visualização com 1 dia',
  na: '–',
};

export function atribuicaoDe(v) {
  if (!v) return '–';
  const s = String(v).toLowerCase();
  const chave = (s.match(/\d+d_[a-z]+/g) || [s]).sort().join('_');
  return ATRIBUICAO[chave] || ATRIBUICAO[s] || s;
}

/**
 * O estado da campanha como o Gerenciador mostra na exportação (minúsculo).
 * A API dá `effective_status`; "completed" não existe nela — é a campanha ativa
 * cuja data de término já passou, e é assim que a exportação a chama.
 */
export function estadoDe(campanha, agora = new Date()) {
  if (!campanha) return null;
  const s = String(campanha.effective_status || '').toUpperCase();
  if (campanha.stop_time && new Date(campanha.stop_time) < agora && s === 'ACTIVE') return 'completed';
  return {
    ACTIVE: 'active',
    PAUSED: 'inactive',
    CAMPAIGN_PAUSED: 'inactive',
    ADSET_PAUSED: 'inactive',
    ARCHIVED: 'archived',
    DELETED: 'deleted',
    IN_PROCESS: 'active',
    WITH_ISSUES: 'not_delivering',
  }[s] || (s ? s.toLowerCase() : null);
}

/** `results` / `cost_per_result` vêm como lista de indicador com valores. */
function primeiroResultado(lista) {
  const r = Array.isArray(lista) ? lista[0] : null;
  if (!r) return { indicador: null, valor: null };
  const v = r.values?.[0]?.value;
  return { indicador: r.indicator || null, valor: v === undefined || v === null ? null : Number(v) };
}

const dataHora = (iso) => (iso ? String(iso).replace('T', ' ').slice(0, 19) : null);
const num = (v) => (v === undefined || v === null || v === '' ? null : Number(v));

/**
 * Uma linha de insights (campanha × dia) -> uma linha da tabela.
 *
 * `campaign_id` FICA TEXTO do começo ao fim: são 18 dígitos, e um Number()
 * arredonda — o ...230047 do Meta virava ...230050 e casava com outra campanha.
 */
export function linhaDaTabela(insight, campanha = null) {
  const resultado = primeiroResultado(insight.results);
  const custo = primeiroResultado(insight.cost_per_result);
  const tipo = resultado.indicador ? (TIPO_RESULTADO[resultado.indicador] ?? resultado.indicador) : '';
  return {
    nome: String(insight.campaign_name || '').slice(0, 128),
    id: String(insight.campaign_id),
    dia: `${insight.date_start} 00:00:00`,
    estado: estadoDe(campanha),
    nivel: 'campaign',
    alcance: num(insight.reach),
    impressoes: num(insight.impressions),
    frequencia: num(insight.frequency),
    atribuicao: atribuicaoDe(insight.attribution_setting),
    tipoResultado: tipo.slice(0, 200),
    resultados: resultado.valor === null ? null : Math.round(resultado.valor),
    gasto: num(insight.spend) ?? 0,
    custoPorResultado: custo.valor,
    inicio: dataHora(campanha?.start_time),
    fim: dataHora(campanha?.stop_time),
    inicioRelatorio: insight.date_start,
    fimRelatorio: insight.date_stop || insight.date_start,
  };
}

/**
 * Janelas de até `dias` dias entre duas datas (AAAA-MM-DD, inclusive).
 * A API aceita intervalos longos com `time_increment=1`, mas um ano inteiro de
 * campanha × dia estoura o tempo da requisição; janelas de 30 dias não.
 */
export function janelas(de, ate, dias = 30) {
  const out = [];
  let t = Date.parse(`${de}T00:00:00Z`);
  const fim = Date.parse(`${ate}T00:00:00Z`);
  while (t <= fim) {
    const t2 = Math.min(t + (dias - 1) * 864e5, fim);
    out.push({ since: new Date(t).toISOString().slice(0, 10), until: new Date(t2).toISOString().slice(0, 10) });
    t = t2 + 864e5;
  }
  return out;
}
