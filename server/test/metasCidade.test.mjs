/**
 * METAS DE ATIVAÇÃO — quem manda é a tabela, e ela é MENSAL.
 *
 * O dashboard nasceu com as metas copiadas para dentro do código (`SEMENTE`, o
 * conjunto `##` do Power BI). A cópia é de julho/2026. A área revisou a meta em
 * agosto, setembro e outubro em `DB_Applicattion.Comercial_Metas`, e a tela
 * seguiu comparando o realizado de outubro contra o alvo de julho — Canoas 898
 * em vez de 870 — sem nada avisando.
 *
 * O que se segura aqui é a cadeia de origem: tabela ganha da tela, tela ganha da
 * semente, e nenhuma delas pode sumir quando a de cima falta.
 */
import assert from 'node:assert/strict';
import test, { beforeEach } from 'node:test';

process.env.AUTH_ENABLED = 'false';

const { SEMENTE, mesesDoPeriodo, metas, setMetasDeCidade, setMetasDeCidadeErro } = await import('../src/metas.js');

/** Como as linhas chegam do driver: `Data` vem string por causa do dateStrings. */
const linha = (mes, cidade, meta) => ({ mes: `${mes}-01`, cidade, meta });

beforeEach(() => setMetasDeCidade([]));

test('sem a tabela carregada, a semente continua valendo — a tela não fica sem alvo', () => {
  const m = metas({ de: '2026-10-01', ate: '2026-10-31' });
  assert.equal(m.ativos.Canoas, SEMENTE.ativos.Canoas);
  assert.equal(m.origemAtivos, 'semente');
});

test('com a tabela, a meta é a do MÊS do período, não a de julho', () => {
  setMetasDeCidade([
    linha('2026-07', 'Canoas', 898),
    linha('2026-10', 'Canoas', 870),
    linha('2026-10', 'Esteio', 165),
  ]);
  const out = metas({ de: '2026-10-01', ate: '2026-10-31' });
  assert.equal(out.ativos.Canoas, 870, 'era 898 na semente: três revisões de atraso');
  assert.equal(out.ativos.Esteio, 165);
  assert.equal(out.origemAtivos, 'tabela');
  assert.deepEqual(out.mesesDaMeta, ['2026-10']);
});

test('período de dois meses soma os dois alvos — a meta é mensal', () => {
  setMetasDeCidade([
    linha('2026-09', 'Canoas', 860),
    linha('2026-10', 'Canoas', 870),
  ]);
  const out = metas({ de: '2026-09-15', ate: '2026-10-10' });
  assert.equal(out.ativos.Canoas, 1730);
  assert.deepEqual(out.mesesDaMeta, ['2026-09', '2026-10']);
});

test('mês que a tabela não cobre cai para a tela/semente, em vez de virar zero', () => {
  setMetasDeCidade([linha('2026-10', 'Canoas', 870)]);
  const out = metas({ de: '2026-12-01', ate: '2026-12-31' });
  assert.equal(
    out.ativos.Canoas, SEMENTE.ativos.Canoas,
    'alvo zero faria o percentual estourar e parecer meta batida',
  );
  assert.equal(out.origemAtivos, 'semente');
});

test('venda e rádio NÃO vêm da tabela — ela só tem ativação', () => {
  setMetasDeCidade([linha('2026-10', 'Canoas', 870)]);
  const out = metas({ de: '2026-10-01', ate: '2026-10-31' });
  assert.equal(out.vendas.Canoas, SEMENTE.vendas.Canoas);
  assert.equal(out.vendasRadio, SEMENTE.vendasRadio);
  assert.equal(out.ativosRadio, SEMENTE.ativosRadio);
});

test('falha ao carregar a tabela não derruba a meta, e fica registrada', () => {
  setMetasDeCidadeErro(new Error('ECONNREFUSED'));
  const out = metas({ de: '2026-10-01', ate: '2026-10-31' });
  assert.equal(out.ativos.Canoas, SEMENTE.ativos.Canoas);
  assert.match(out.tabela.erro, /ECONNREFUSED/, 'a tela precisa poder dizer que está na semente');
});

test('cidade que existe na tabela e não na semente entra na conta', () => {
  setMetasDeCidade([linha('2026-10', 'Gravataí', 120)]);
  const out = metas({ de: '2026-10-01', ate: '2026-10-31' });
  assert.equal(out.ativos['Gravataí'], 120, 'cidade nova não pode depender de alguém editar o código');
});

test('os meses do período são contados do começo ao fim, inclusive virando o ano', () => {
  assert.deepEqual(mesesDoPeriodo('2026-10-01', '2026-10-31'), ['2026-10']);
  assert.deepEqual(mesesDoPeriodo('2026-11-20', '2027-01-05'), ['2026-11', '2026-12', '2027-01']);
});

test('linha sem cidade ou sem valor é descartada, em vez de virar meta vazia', () => {
  setMetasDeCidade([
    linha('2026-10', 'Canoas', 870),
    { mes: '2026-10-01', cidade: '', meta: 50 },
    { mes: '2026-10-01', cidade: 'Esteio', meta: null },
  ]);
  const out = metas({ de: '2026-10-01', ate: '2026-10-31' });
  assert.deepEqual(Object.keys(out.ativos), ['Canoas']);
});
