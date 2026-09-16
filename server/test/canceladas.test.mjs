/**
 * VENDAS CANCELADAS — a tela tem DUAS datas, e elas se cruzam.
 *
 * `de`/`ate` recortam a data da VENDA; `cancDe`/`cancAte` a do CANCELAMENTO. As duas
 * perguntas são diferentes e as duas são feitas: "das vendas de agosto, quantas se
 * perderam" e "quantos contratos caíram em agosto" — a segunda inclui a venda de
 * março cancelada agora, que o período da venda joga fora.
 *
 * O que estes testes seguram é a armadilha do cruzamento: transformar `cancDe` em
 * `de` faria a tela responder sempre a primeira pergunta, e ninguém repararia — os
 * números continuariam plausíveis.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

process.env.AUTH_ENABLED = 'false';
process.env.DB_VOALLE_HOST = 'inexistente';
process.env.DB_VOALLE_DATABASE = 'inexistente';
process.env.DB_MARIA_HOST = 'inexistente';

const { build, setSource } = await import('../src/model/store.js');
const { parseFilters } = await import('../src/model/measures.js');
const { painelCanceladas } = await import('../src/model/paineis.js');
const { CONJUNTOS } = await import('../src/model/exportar.js');

/** Contrato cancelado e nunca ativado — o recorte da página. */
const cancelada = (contrato, dtVenda, dtCancelado) => ({
  clientes: `CLIENTE ${contrato}`,
  contrato: String(contrato),
  protocolo: null,
  cidade: 'CANOAS',
  bairro: 'CENTRO',
  vendedor: 'ANA VENDEDORA',
  regiao_vendedor: 'CAPITAL',
  status_contrato: 'Cancelado',
  status_cancelamento: 'DESISTENCIA',
  data_cancelado: dtCancelado,
  canal: 'PAP',
  tecnologia: 'FIBRA',
  tipo_solicitacao: 'Instalacao',
  tem_tipo_padrao: true,
  valor: 100,
  data_criacao_contrato: dtVenda,
  hora_criacao: '10:20',
  cadastro_cliente: dtVenda,
  created_key: `K-${contrato}`,
});

function montarCenario() {
  setSource('base', [
    // vendida em março, cancelada em agosto: só o período de CANCELAMENTO a encontra
    cancelada(8001, '2026-03-10', '2026-08-12'),
    // vendida e cancelada em agosto: os dois períodos a encontram
    cancelada(8002, '2026-08-05', '2026-08-20'),
    // vendida em agosto, cancelada em setembro: só o período da VENDA a encontra
    cancelada(8003, '2026-08-07', '2026-09-02'),
    // cancelada sem data registrada — existe na base do Voalle
    cancelada(8004, '2026-08-08', null),
  ]);
  setSource('aloc', []);
  setSource('phone', []);
  setSource('pagto', []);
  setSource('teams', [{
    vendedores: 'ANA VENDEDORA', equipes: 'EQUIPE A', situacao: 'Interno', ativo: 'TRUE',
  }]);
  setSource('sellers', []);
  setSource('senior', []);
  build();
}

const contratos = (p) => p.detalhe.map((d) => d.contrato).sort();

test('sem o período de cancelamento, a tela continua exatamente como era', () => {
  montarCenario();
  const p = painelCanceladas(parseFilters({ de: '2026-08-01', ate: '2026-08-31' }));
  assert.deepEqual(contratos(p), ['8002', '8003', '8004'], 'recorta pela data da venda');
  assert.equal(p.kpis.total, 3);
  assert.equal(p.semDataCancelamento, 0, 'sem o filtro ligado, não há ninguém deixado de fora');
});

test('o período de cancelamento acha a venda antiga que caiu agora', () => {
  montarCenario();
  const p = painelCanceladas(parseFilters({ cancDe: '2026-08-01', cancAte: '2026-08-31' }));
  assert.deepEqual(
    contratos(p), ['8001', '8002'],
    'a venda de março cancelada em agosto entra; a cancelada em setembro não',
  );
  assert.equal(p.kpis.total, 2);
});

test('os dois períodos se cruzam, e nenhum substitui o outro', () => {
  montarCenario();
  const p = painelCanceladas(parseFilters({
    de: '2026-08-01', ate: '2026-08-31', cancDe: '2026-08-01', cancAte: '2026-08-31',
  }));
  assert.deepEqual(contratos(p), ['8002'], 'só quem foi vendido E cancelado em agosto');
});

test('quem não tem data de cancelamento sai do filtro, e a tela sabe quantos são', () => {
  montarCenario();
  const p = painelCanceladas(parseFilters({
    de: '2026-08-01', ate: '2026-08-31', cancAte: '2026-12-31',
  }));
  assert.ok(!contratos(p).includes('8004'), 'sem a data, não há como afirmar que está no período');
  assert.equal(
    p.semDataCancelamento, 1,
    'o número existe para a tela avisar, em vez de deixar o total encolher calado',
  );
});

test('a série por mês de cancelamento agrupa pela data certa', () => {
  montarCenario();
  const p = painelCanceladas(parseFilters({}));
  const porCancelamento = Object.fromEntries(
    p.serieCancelamento.map((m) => [m.periodo, m.canceladas]),
  );
  assert.equal(porCancelamento['2026-08'], 2, '8001 e 8002 caíram em agosto');
  assert.equal(porCancelamento['2026-09'], 1);
  assert.equal(porCancelamento['(sem data)'], 1, 'o sem data aparece, em vez de sumir do gráfico');

  const porVenda = Object.fromEntries(p.serie.map((m) => [m.periodo, m.canceladas]));
  assert.equal(porVenda['2026-03'], 1, 'a série por venda continua sendo a da venda');
});

test('o CSV completo obedece ao mesmo recorte da tela', () => {
  montarCenario();
  const flt = parseFilters({ cancDe: '2026-08-01', cancAte: '2026-08-31' });
  const linhas = CONJUNTOS['vendas-canceladas'].linhas(flt).map((f) => f.contrato).sort();
  assert.deepEqual(
    linhas, ['8001', '8002'],
    'CSV com linha que a tela não mostra é total que ninguém consegue reproduzir',
  );
});
