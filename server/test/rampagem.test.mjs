/**
 * RAMPAGEM — o período seleciona pessoas, não fatos.
 *
 * O filtro desta tela recorta vendedores pela data de ADMISSÃO e mostra os 90 dias
 * inteiros de cada um. O que estes testes seguram é justamente o que é fácil alguém
 * "consertar" de volta: a venda de março de quem entrou em janeiro TEM de aparecer
 * quando o filtro é janeiro. Recortar os fatos pela mesma data do slicer devolve o
 * comportamento antigo e nenhum outro teste reclama.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

process.env.AUTH_ENABLED = 'false';
process.env.DB_VOALLE_HOST = 'inexistente';
process.env.DB_VOALLE_DATABASE = 'inexistente';
process.env.DB_MARIA_HOST = 'inexistente';

const { build, setSource } = await import('../src/model/store.js');
const { parseFilters, rampagem } = await import('../src/model/measures.js');
const { addDays, today } = await import('../src/model/dates.js');

const venda = (vendedor, data, contrato) => ({
  clientes: `CLIENTE ${contrato}`,
  contrato: String(contrato),
  protocolo: null,
  cidade: 'CANOAS',
  bairro: 'CENTRO',
  vendedor,
  regiao_vendedor: 'CAPITAL',
  status_contrato: 'Normal',
  status_cancelamento: '',
  canal: 'PAP',
  tecnologia: 'FIBRA',
  tipo_solicitacao: 'Instalacao',
  tem_tipo_padrao: true,
  valor: 99.9,
  data_criacao_contrato: data,
  hora_criacao: '10:20',
  cadastro_cliente: data,
  data_cancelado: null,
  created_key: `K-${contrato}`,
});

const equipe = (vendedores) => vendedores.map((v) => ({
  vendedores: v, equipes: 'EQUIPE A', situacao: 'PROPRIO', ativo: 'TRUE',
}));

/** `sellers` + `senior` precisam casar pelo nome: a admissão só vale se vier do RH. */
const admissoes = (pares) => ({
  sellers: pares.map(([nome, data]) => ({ vendedor: nome, email: '', admissao: data })),
  senior: pares.map(([nome, data]) => ({
    seller: nome, email: '', admission_date: data, position: 'CONSULTOR',
  })),
});

const ANA = 'ANA NOVATA';       // admitida 05/01/2026 — rampagem até 05/04/2026
const CARLA = 'CARLA SEM VENDA'; // admitida 20/01/2026, nunca vendeu
const BRUNO = 'BRUNO VETERANO';  // admitido em 2025, fora de qualquer janeiro de 2026

function montarCenario() {
  const { sellers, senior } = admissoes([
    [ANA, '2026-01-05'],
    [CARLA, '2026-01-20'],
    [BRUNO, '2025-01-05'],
  ]);
  setSource('base', [
    venda(ANA, '2026-01-20', 9001),   // dentro do mês do filtro
    venda(ANA, '2026-03-10', 9002),   // FORA do mês, dentro dos 90 dias
    venda(ANA, '2026-06-01', 9003),   // depois do 90º dia: nunca é rampagem
    venda(BRUNO, '2026-01-15', 9004), // janeiro, mas admitido em 2025
  ]);
  setSource('aloc', []);
  setSource('phone', []);
  setSource('pagto', []);
  setSource('teams', equipe([ANA, CARLA, BRUNO]));
  setSource('sellers', sellers);
  setSource('senior', senior);
  build();
}

const janeiro = () => parseFilters({ de: '2026-01-01', ate: '2026-01-31' });
const linha = (r, nome) => r.tabela.find((t) => t.vendedor === nome);

test('a venda fora do mês do filtro continua contando, se está dentro dos 90 dias', () => {
  montarCenario();
  const r = rampagem(janeiro());
  assert.equal(
    r.kpis.vendas, 2,
    'filtrando janeiro, a venda de março de quem entrou em janeiro faz parte da rampagem',
  );
  assert.equal(linha(r, ANA).vendas, 2);
});

test('o 91º dia não entra — a janela é a rampagem, não a carreira', () => {
  montarCenario();
  const r = rampagem(janeiro());
  const meses = r.serie.map((m) => m.periodo);
  assert.ok(meses.includes('2026-03'), 'a série tem de alcançar os meses seguintes à admissão');
  assert.ok(!meses.includes('2026-06'), 'venda depois do 90º dia não é rampagem');
});

test('quem foi admitido fora do período não aparece, mesmo tendo vendido dentro dele', () => {
  montarCenario();
  const r = rampagem(janeiro());
  assert.equal(linha(r, BRUNO), undefined);
  assert.ok(!r.novatos.some((n) => n.vendedor === BRUNO));
});

test('novato que não vendeu nada aparece zerado, em vez de sumir', () => {
  montarCenario();
  const r = rampagem(janeiro());
  const c = linha(r, CARLA);
  assert.ok(c, 'a tabela é a lista de quem entrou, não a de quem vendeu');
  assert.equal(c.vendas, 0);
  assert.equal(c.mediaVendas, 0);
  assert.equal(r.kpis.novatos, 2, 'Ana e Carla entraram em janeiro; Bruno não');
});

test('os dias medem a rampagem inteira, não o pedaço que o filtro mostra', () => {
  montarCenario();
  // Ana entrou em 05/01 e o filtro vai até 31/01; antes a conta parava no fim do
  // filtro e dava 26 dias ao lado das vendas dos 90. A janela é a rampagem dela.
  const r = rampagem(janeiro());
  assert.equal(linha(r, ANA).diasContratado, 90);
});

test('sem período, a tela é sobre quem está em rampagem hoje', () => {
  const recente = addDays(today(), -10);
  const { sellers, senior } = admissoes([['DUDA RECENTE', recente], [BRUNO, '2025-01-05']]);
  setSource('base', [venda('DUDA RECENTE', recente, 9101), venda(BRUNO, recente, 9102)]);
  setSource('aloc', []); setSource('phone', []); setSource('pagto', []);
  setSource('teams', equipe(['DUDA RECENTE', BRUNO]));
  setSource('sellers', sellers); setSource('senior', senior);
  build();

  const r = rampagem(parseFilters({}));
  assert.equal(r.kpis.novatos, 1, 'só quem ainda está dentro dos 90 dias');
  assert.equal(linha(r, 'DUDA RECENTE').vendas, 1);
  assert.equal(linha(r, BRUNO), undefined, 'veterano vendendo hoje não é rampagem');
});

test('readmitido: a rampagem começa no vínculo novo, não na carreira inteira', () => {
  // O RH mantém só o vínculo vigente, então quem saiu e voltou tem admissão nova. Sem
  // piso na janela, as vendas do vínculo anterior — todas anteriores à admissão —
  // entravam como rampagem. Na base real eram 4 vendedores e 511 vendas.
  const nome = 'RENATA READMITIDA';
  const { sellers, senior } = admissoes([[nome, '2026-01-28']]);
  setSource('base', [
    venda(nome, '2025-01-24', 9201), // vínculo antigo
    venda(nome, '2025-06-10', 9202), // vínculo antigo
    venda(nome, '2026-02-10', 9203), // rampagem de verdade
  ]);
  setSource('aloc', []); setSource('phone', []); setSource('pagto', []);
  setSource('teams', equipe([nome]));
  setSource('sellers', sellers); setSource('senior', senior);
  build();

  const r = rampagem(janeiro());
  assert.equal(r.kpis.vendas, 1, 'venda anterior à admissão não é rampagem do vínculo novo');
  assert.deepEqual(r.serie.map((m) => m.periodo), ['2026-02']);
});

test('o clique no gráfico continua recortando por data', () => {
  montarCenario();
  const r = rampagem({ ...janeiro(), zoom: { de: '2026-03-01', ate: '2026-03-31' } });
  assert.equal(r.kpis.vendas, 1, 'o zoom é sobre o eixo do tempo, e esse segue valendo');
  assert.equal(
    r.serie.length, 2,
    'o gráfico que originou o clique mostra o período inteiro, sem o próprio zoom',
  );
});
