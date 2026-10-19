/**
 * META ADS — a tradução da Marketing API para a tabela da carga manual.
 *
 * A carga automática e a manual precisam ser indistinguíveis: a tela lê a mesma
 * tabela. Os casos aqui são respostas REAIS da API (set/2026), conferidas contra
 * a exportação manual do Gerenciador de Anúncios.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

const { atribuicaoDe, estadoDe, janelas, linhaDaTabela } = await import('../src/model/metaAds.js');

const insight = (extra = {}) => ({
  campaign_id: '120242523835230047',
  campaign_name: '[Vendas][Engajamento][WPP][Cachoeirinha]',
  date_start: '2026-09-10',
  date_stop: '2026-09-10',
  reach: '8287',
  impressions: '16173',
  frequency: '1.951611',
  spend: '178.67',
  attribution_setting: '7d_click_1d_view',
  results: [{ indicator: 'actions:onsite_conversion.messaging_conversation_started_7d', values: [{ value: '6' }] }],
  cost_per_result: [{ indicator: 'actions:onsite_conversion.messaging_conversation_started_7d', values: [{ value: '29.77833333' }] }],
  ...extra,
});

test('uma linha da API vira a linha que a exportação manual gravava', () => {
  const l = linhaDaTabela(insight(), { effective_status: 'ACTIVE' });
  assert.equal(l.id, '120242523835230047');
  assert.equal(l.dia, '2026-09-10 00:00:00');
  assert.equal(l.tipoResultado, 'Conversas por mensagem iniciadas');
  assert.equal(l.resultados, 6);
  assert.equal(l.custoPorResultado, 29.77833333);
  assert.equal(l.gasto, 178.67);
  assert.equal(l.atribuicao, 'Clique com 7 dias ou visualização com 1 dia');
  assert.equal(l.estado, 'active');
  assert.equal(l.nivel, 'campaign');
});

test('o ID da campanha continua TEXTO — Number() trocaria ...230047 por ...230050', () => {
  const l = linhaDaTabela(insight());
  assert.strictEqual(typeof l.id, 'string');
  assert.notEqual(String(Number(l.id)), l.id);
});

test('a atribuição é lida em qualquer ordem, como a API devolve', () => {
  assert.equal(atribuicaoDe('1d_view_7d_click'), 'Clique com 7 dias ou visualização com 1 dia');
  assert.equal(atribuicaoDe('7d_click_1d_view'), 'Clique com 7 dias ou visualização com 1 dia');
  assert.equal(
    atribuicaoDe('1d_view_7d_click_1d_ev'),
    'Clique com 7 dias, visualização com 1 dia ou visualização com interação de 1 dia',
  );
  assert.equal(atribuicaoDe('na'), '–');
  assert.equal(atribuicaoDe(null), '–');
});

test('os tipos de resultado da base têm o rótulo da exportação', () => {
  const tipo = (indicator) => linhaDaTabela(insight({ results: [{ indicator, values: [{ value: '1' }] }] })).tipoResultado;
  assert.equal(tipo('reach'), 'Alcance');
  assert.equal(tipo('actions:post_interaction_gross'), 'Interações');
  assert.equal(tipo('actions:omni_landing_page_view'), 'Visualizações da página de destino');
  assert.equal(tipo('mixed'), '', 'a exportação deixa em branco quando o dia mistura tipos');
  assert.equal(tipo('actions:algo_novo'), 'actions:algo_novo', 'indicador desconhecido aparece cru, para ser traduzido');
});

test('sem resultado, a linha grava resultado nulo e tipo vazio', () => {
  const l = linhaDaTabela(insight({ results: undefined, cost_per_result: undefined }));
  assert.equal(l.resultados, null);
  assert.equal(l.custoPorResultado, null);
  assert.equal(l.tipoResultado, '');
});

test('o estado segue o Gerenciador: pausada é inactive, ativa vencida é completed', () => {
  const agora = new Date('2026-10-19T12:00:00Z');
  assert.equal(estadoDe({ effective_status: 'PAUSED' }, agora), 'inactive');
  assert.equal(estadoDe({ effective_status: 'ARCHIVED' }, agora), 'archived');
  assert.equal(estadoDe({ effective_status: 'ACTIVE', stop_time: '2026-09-30T23:59:00-0300' }, agora), 'completed');
  assert.equal(estadoDe({ effective_status: 'ACTIVE', stop_time: '2026-12-31T23:59:00-0300' }, agora), 'active');
  assert.equal(estadoDe(null, agora), null, 'sem a campanha, o estado gravado fica como estava');
});

test('o período é quebrado em janelas de 30 dias, sem buraco nem sobreposição', () => {
  const j = janelas('2026-01-01', '2026-03-15');
  assert.deepEqual(j, [
    { since: '2026-01-01', until: '2026-01-30' },
    { since: '2026-01-31', until: '2026-03-01' },
    { since: '2026-03-02', until: '2026-03-15' },
  ]);
  assert.deepEqual(janelas('2026-10-17', '2026-10-17'), [{ since: '2026-10-17', until: '2026-10-17' }]);
});
