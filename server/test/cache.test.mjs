/**
 * Verificação do cache de painéis — `node --test server/test`.
 *
 * Duas partes. A primeira é a chave, que é onde um cache erra feio: se ela ignorar a
 * versão do modelo, a tela congela na carga anterior; se ignorar a query já reescrita
 * pelo escopo, o dado de uma equipe vaza para quem não pode ver.
 *
 * A segunda monta o roteador DE VERDADE sobre uma tabela de fatos sintética e confere
 * o acerto pelo `/meta` — sem isso, dá para escrever um cache perfeito e esquecer de
 * ligá-lo em metade das rotas.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

// o roteador importa `config`, que exige as variáveis do banco só no `assertConfig`
// (chamado pelo index.js, não aqui). A autenticação sai do caminho de propósito: o que
// esta bateria testa é o cache, e o middleware desligado injeta um admin sem escopo.
process.env.AUTH_ENABLED = 'false';
process.env.DB_VOALLE_HOST = 'inexistente';
process.env.DB_VOALLE_DATABASE = 'inexistente';
process.env.DB_MARIA_HOST = 'inexistente';

const { comCache, estatisticasCache, limparCache } = await import('../src/model/cache.js');

test('acerta na segunda chamada com a mesma query', () => {
  limparCache();
  let chamadas = 0;
  const calc = () => { chamadas += 1; return { n: chamadas }; };
  const arg = { nome: 'vendas', versao: 1, query: { de: '2026-01-01', cidade: 'SALVADOR' } };
  assert.deepEqual(comCache(arg, calc), { n: 1 });
  assert.deepEqual(comCache(arg, calc), { n: 1 });
  assert.equal(chamadas, 1);
});

test('a ordem das chaves da query não cria entrada nova', () => {
  limparCache();
  let chamadas = 0;
  const calc = () => { chamadas += 1; return chamadas; };
  comCache({ nome: 'vendas', versao: 1, query: { de: 'x', ate: 'y' } }, calc);
  comCache({ nome: 'vendas', versao: 1, query: { ate: 'y', de: 'x' } }, calc);
  assert.equal(chamadas, 1);
});

test('versão nova do modelo invalida sozinha', () => {
  limparCache();
  let chamadas = 0;
  const calc = () => { chamadas += 1; return chamadas; };
  comCache({ nome: 'vendas', versao: 7, query: { de: 'x' } }, calc);
  comCache({ nome: 'vendas', versao: 8, query: { de: 'x' } }, calc);
  assert.equal(chamadas, 2, 'carga nova tem que recalcular');
});

test('rotas diferentes com a mesma query não se misturam', () => {
  limparCache();
  const q = { de: 'x' };
  assert.equal(comCache({ nome: 'vendas', versao: 1, query: q }, () => 'vendas'), 'vendas');
  assert.equal(comCache({ nome: 'ativacoes', versao: 1, query: q }, () => 'ativacoes'), 'ativacoes');
});

test('escopo diferente é chave diferente (o que impede vazar equipe)', () => {
  limparCache();
  // é exatamente o que `aplicarEscopo` deixa em req.query: a equipe já cruzada
  const daAna = { de: 'x', equipe: 'EQUIPE A' };
  const daBia = { de: 'x', equipe: 'EQUIPE B' };
  assert.equal(comCache({ nome: 'vendas', versao: 1, query: daAna }, () => 'dados da A'), 'dados da A');
  assert.equal(comCache({ nome: 'vendas', versao: 1, query: daBia }, () => 'dados da B'), 'dados da B');
  // e quem chega depois com o escopo da Ana continua recebendo o da Ana
  assert.equal(comCache({ nome: 'vendas', versao: 1, query: daAna }, () => 'NAO DEVIA CALCULAR'), 'dados da A');
});

test('não cresce sem limite: a entrada mais antiga sai', () => {
  limparCache();
  for (let i = 0; i < 400; i++) {
    comCache({ nome: 'vendas', versao: 1, query: { i: String(i) } }, () => i);
  }
  const { entradas } = estatisticasCache();
  assert.ok(entradas <= 240, `entradas=${entradas} passou do teto`);
  // a primeira caiu, a última ficou
  let recalculou = false;
  comCache({ nome: 'vendas', versao: 1, query: { i: '0' } }, () => { recalculou = true; return 0; });
  assert.equal(recalculou, true, 'a mais antiga tinha que ter saído');
  comCache({ nome: 'vendas', versao: 1, query: { i: '399' } }, () => {
    throw new Error('a mais recente não podia ter saído');
  });
});

test('as rotas comerciais respondem do cache', async () => {
  limparCache();
  const express = (await import('express')).default;
  const { getState } = await import('../src/model/store.js');
  const { api } = await import('../src/routes/api.js');

  const st = getState();
  st.facts = Array.from({ length: 500 }, (_, i) => ({
    contrato: String(i), cliente: `CLIENTE ${i}`, cidade: i % 2 ? 'SALVADOR' : 'ILHEUS',
    vendedor: `VENDEDOR ${i % 4}`, equipe: `EQUIPE ${i % 2}`, situacao: 'PROPRIO',
    canal: 'PAP', tecnologia: ['FIBRA', 'RÁDIO', 'TELEFONIA'][i % 3], temTipoPadrao: true,
    valor: 100, dtVenda: '2026-03-10', dtCadastroCliente: '2026-03-10',
    dtAtiv: '2026-03-12', dtAtivFibra: '2026-03-12', dtPagto: '2026-04-05',
    plano: 'PLANO 300', statusContrato: i % 5 === 0 ? 'Cancelado' : 'Normal',
    statusCancelamento: 'Preco', tipoSolicitacao: 'Retencao', vendedorAtivo: true,
    venda90: 0, ativo90: 0,
  }));
  st.version = 1;
  st.teamsByName = new Map();
  st.sellersByName = new Map();

  const app = express();
  app.use('/api', api);
  const server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const pega = async (u) => {
    const r = await fetch(base + u);
    assert.equal(r.status, 200, `${u} devolveu ${r.status}`);
    return r.json();
  };

  try {
    const rotas = ['/api/vendas', '/api/ativacoes', '/api/canceladas', '/api/diretoria',
      '/api/rampagem', '/api/primeiro-pagamento', '/api/historico/vendas'];
    const P = 'de=2026-01-01&ate=2026-12-31';

    // os contadores são acumulados desde que o processo subiu (é diagnóstico de
    // /meta, não placar de teste), então o que se compara aqui é a VARIAÇÃO
    const zero = (await pega('/api/meta')).cache;

    // primeira rodada: tudo falta
    for (const r of rotas) await pega(`${r}?${P}`);
    const primeira = (await pega('/api/meta')).cache;
    assert.equal(primeira.faltas - zero.faltas, rotas.length, 'a primeira rodada tinha que faltar em todas');
    assert.equal(primeira.acertos - zero.acertos, 0);

    // segunda rodada, mesma query: tudo acerta
    for (const r of rotas) await pega(`${r}?${P}`);
    const segunda = (await pega('/api/meta')).cache;
    assert.equal(segunda.acertos - primeira.acertos, rotas.length, 'a segunda rodada tinha que acertar em todas');
    assert.equal(segunda.faltas, primeira.faltas, 'a segunda rodada não podia recalcular nada');

    // com um clique de cross-filter é outra chave, e o número muda de verdade
    const cheio = await pega(`/api/vendas?${P}`);
    const filtrado = await pega(`/api/vendas?${P}&cidade=SALVADOR`);
    assert.ok(filtrado.kpis.totalVendas < cheio.kpis.totalVendas, 'o filtro tinha que reduzir o total');
    assert.equal(
      filtrado.porCidade.length, cheio.porCidade.length,
      'cross-highlight: o gráfico de cidades não pode colapsar',
    );

    // e a carga nova invalida sem ninguém limpar nada
    st.version = 2;
    const antes = (await pega('/api/meta')).cache.faltas;
    await pega(`/api/vendas?${P}`);
    assert.equal((await pega('/api/meta')).cache.faltas, antes + 1, 'versão nova tinha que recalcular');
  } finally {
    server.close();
  }
});
