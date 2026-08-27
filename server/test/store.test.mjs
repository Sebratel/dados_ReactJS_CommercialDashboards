/**
 * Junções do modelo em memória — `npm test` no server.
 *
 * Existe por causa de uma limpeza: as chaves dos três mapas de junção (ativação de
 * fibra, ativação de telefonia e primeiro pagamento) usavam um byte NUL literal dentro
 * do template, o que fazia o git tratar `store.js` como binário. O byte virou o escape
 * `\x00`, que é a mesma string em JS — e este teste é o que prova que as chaves
 * continuam casando, em vez de confiar na leitura do diff.
 *
 * De quebra cobre o que nenhum teste cobria: a deduplicação por cliente+contrato e o
 * fato de a data de ativação vir de fonte diferente quando a tecnologia é TELEFONIA.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

process.env.AUTH_ENABLED = 'false';
process.env.DB_VOALLE_HOST = 'inexistente';
process.env.DB_VOALLE_DATABASE = 'inexistente';
process.env.DB_MARIA_HOST = 'inexistente';

const { build, getState, setSource } = await import('../src/model/store.js');

const linhaBase = (over = {}) => ({
  clientes: 'MARIA DE SOUZA',
  contrato: '4001',
  protocolo: null,
  cidade: 'SALVADOR',
  bairro: 'BARRA',
  vendedor: 'ANA SOUZA',
  regiao_vendedor: 'CAPITAL',
  status_contrato: 'Normal',
  status_cancelamento: '',
  canal: 'PAP',
  tecnologia: 'FIBRA',
  tipo_solicitacao: 'Instalacao',
  tem_tipo_padrao: true,
  valor: 99.9,
  data_criacao_contrato: '2026-03-10',
  hora_criacao: '10:20',
  cadastro_cliente: '2026-03-01',
  data_cancelado: null,
  created_key: 'K-4001',
  ...over,
});

test('as três junções por chave composta continuam casando', () => {
  setSource('base', [
    linhaBase(),
    // mesmo cliente e mesmo contrato: a segunda linha é descartada
    linhaBase({ valor: 199.9 }),
    // telefonia: a ativação vem da outra fonte, casada por contrato + protocolo
    linhaBase({
      clientes: 'JOAO LIMA', contrato: '4002', tecnologia: 'TELEFONIA',
      protocolo: 777, created_key: 'K-4002',
    }),
  ]);
  setSource('aloc', [{ contrato: '4001', cliente: 'MARIA DE SOUZA', data_ativacao: '2026-03-15' }]);
  setSource('phone', [{ contrato: '4002', protocolo: 777, ativacao: '2026-03-20' }]);
  setSource('pagto', [{
    created_key: 'K-4001', nome: 'MARIA DE SOUZA', pagamento_cliente: '2026-04-05',
    plano: 'PLANO 300', data_vencimento: '2026-04-10',
  }]);
  setSource('teams', [{
    vendedores: 'ANA SOUZA', equipes: 'EQUIPE A', situacao: 'PROPRIO', ativo: 'TRUE',
  }]);
  setSource('sellers', []);
  setSource('senior', []);

  build();
  const { facts } = getState();

  assert.equal(facts.length, 2, 'a linha repetida (cliente+contrato) tinha que sair');

  const fibra = facts.find((f) => f.contrato === '4001');
  assert.equal(fibra.dtAtiv, '2026-03-15', 'ativação de fibra não casou pela chave contrato+cliente');
  assert.equal(fibra.dtPagto, '2026-04-05', 'primeiro pagamento não casou pela chave created_key+nome');
  assert.equal(fibra.plano, 'PLANO 300');
  assert.equal(fibra.equipe, 'EQUIPE A', 'a equipe vem da Comercial_Teams');
  assert.equal(fibra.situacao, 'PROPRIO');
  assert.equal(fibra.vendedorAtivo, true);

  const telefonia = facts.find((f) => f.contrato === '4002');
  assert.equal(
    telefonia.dtAtiv, '2026-03-20',
    'em TELEFONIA a ativação vem da fonte de telefonia, casada por contrato+protocolo',
  );
  assert.equal(telefonia.dtPagto, null, 'sem pagamento na fonte, não pode inventar data');
});

test('chave de junção não confunde contratos que só diferem no corte', () => {
  // O separador existe para isto: sem ele, contrato '40' + cliente '01' colidiria com
  // contrato '4' + cliente '001'. Com dado real é raro; com dado errado, não.
  setSource('base', [
    linhaBase({ clientes: '01', contrato: '40', created_key: 'K-A' }),
    linhaBase({ clientes: '001', contrato: '4', created_key: 'K-B' }),
  ]);
  setSource('aloc', [{ contrato: '40', cliente: '01', data_ativacao: '2026-03-15' }]);
  setSource('phone', []);
  setSource('pagto', []);
  setSource('teams', []);
  setSource('sellers', []);
  setSource('senior', []);

  build();
  const { facts } = getState();
  assert.equal(facts.length, 2);
  assert.equal(facts.find((f) => f.contrato === '40').dtAtiv, '2026-03-15');
  assert.equal(
    facts.find((f) => f.contrato === '4').dtAtiv, null,
    'a ativação do contrato 40 não pode vazar para o contrato 4',
  );
});
