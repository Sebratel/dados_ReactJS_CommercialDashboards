/**
 * O CONECTOR DO DATA HUB — e a pergunta que o erro precisa responder.
 *
 * Num 401/403 só interessa saber QUEM recusou: a API, ou alguém no caminho até
 * ela. A resposta está no formato do corpo — a API do Data Hub responde sempre
 * JSON, um proxy responde HTML — e a versao anterior deste arquivo lancava
 * "confira DATAHUB_TOKEN" ANTES de ler o corpo, jogando fora a prova.
 *
 * Em 14/09/2026 esse mesmo sintoma custou uma investigacao inteira de credencial
 * no Dashboard_IA, e em 01/10/2026 de novo na tela de SLA BKO: o openresty de
 * data-hub.sebratel.net.br bloqueia por ORIGEM e devolve 403 para o servidor,
 * enquanto a mesma chamada passa de fora. O token estava certo nas duas vezes.
 */
import assert from 'node:assert/strict';
import test, { afterEach } from 'node:test';

process.env.AUTH_ENABLED = 'false';
process.env.DATAHUB_TOKEN = 'token-de-teste-123';
process.env.DATAHUB_URL = 'http://datahub-de-teste/api/public/v1/datasets';
process.env.DATAHUB_RETRY_MS = '0';

const { lerConjunto } = await import('../src/datahub.js');

const fetchOriginal = globalThis.fetch;
afterEach(() => { globalThis.fetch = fetchOriginal; });

/** Uma resposta de mentira, no formato que o `fetch` global devolveria. */
const responder = ({ status = 200, tipo = 'application/json', corpo = '' }) => {
  globalThis.fetch = async () => ({
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (h) => (h.toLowerCase() === 'content-type' ? tipo : null) },
    text: async () => corpo,
    json: async () => JSON.parse(corpo),
  });
};

const erroDe = async (slug = 'umuvme-sls-bko') => {
  try {
    await lerConjunto(slug);
    return null;
  } catch (e) {
    return e.message;
  }
};

test('403 com HTML é PROXY: a mensagem não manda conferir o token', async () => {
  responder({
    status: 403,
    tipo: 'text/html',
    corpo: '<html><head><title>403 Forbidden</title></head><body><center><h1>403 Forbidden</h1></center><hr><center>openresty</center></body></html>',
  });
  const msg = await erroDe();
  assert.match(msg, /não foi a API/i, 'tem de dizer que quem respondeu não foi o Data Hub');
  assert.match(msg, /DATAHUB_URL/, 'e apontar para o endereço, que é o que se muda');
  assert.doesNotMatch(
    msg, /confira DATAHUB_TOKEN/,
    'mandar conferir o token aqui é exatamente o que fez a investigação ir para o lado errado',
  );
});

test('401 com JSON é a API: aí sim o token é o suspeito', async () => {
  responder({ status: 401, corpo: '{"error":"Token inválido ou revogado."}' });
  const msg = await erroDe();
  assert.match(msg, /DATAHUB_TOKEN/);
  assert.match(msg, /Token inválido ou revogado/, 'o motivo que a API deu tem de aparecer');
  assert.doesNotMatch(msg, /proxy/i);
});

test('403 da API (token sem escopo no conjunto) também aponta para o token', async () => {
  responder({ status: 403, corpo: '{"error":"Este token não tem acesso a este conjunto de dados."}' });
  const msg = await erroDe();
  assert.match(msg, /escopo/i, 'é o caso de token válido mas sem o conjunto');
  assert.doesNotMatch(msg, /proxy/i);
});

test('o token nunca vaza na mensagem, nem quando o servidor o devolve', async () => {
  responder({
    status: 403,
    tipo: 'text/html',
    // um nginx que ecoa a URL na página de erro devolve o token duas vezes
    corpo: '<html>Forbidden: /rows?token=token-de-teste-123 (ref token-de-teste-123)</html>',
  });
  const msg = await erroDe();
  assert.doesNotMatch(msg, /token-de-teste-123/, 'um servidor que ecoa a requisição pode devolver o token no corpo');
  assert.match(msg, /\*\*\*/, 'todas as ocorrências trocadas, não só a primeira');
});

test('sem JSON no content-type, mas com corpo JSON, ainda é a API', async () => {
  // há proxy que reescreve o content-type; o corpo é que manda
  responder({ status: 401, tipo: 'text/plain', corpo: '{"error":"Token inválido ou revogado."}' });
  const msg = await erroDe();
  assert.match(msg, /DATAHUB_TOKEN/);
  assert.doesNotMatch(msg, /não foi a API/i);
});

test('rede fora do ar continua se identificando como rede', async () => {
  globalThis.fetch = async () => {
    const e = new Error('fetch failed');
    e.cause = { code: 'ECONNREFUSED' };
    throw e;
  };
  assert.match(await erroDe(), /inacessível: ECONNREFUSED/);
});

test('o caminho feliz continua lendo e convertendo os BIGINT que vêm como texto', async () => {
  responder({ status: 200, corpo: '{"rows":[{"qtd_envios":"42","cliente":"ANA"}],"total":1}' });
  const { rows, total } = await lerConjunto('umuvme-sls-bko');
  assert.equal(total, 1);
  assert.strictEqual(
    rows[0].qtd_envios, 42,
    'BIGINT chega como texto; quem soma sem converter concatena string sem erro nenhum',
  );
  assert.equal(rows[0].cliente, 'ANA');
});

test('API nova (out/2026): token no cabeçalho X-Api-Token, nunca na URL', async () => {
  const chamadas = [];
  globalThis.fetch = async (url, opts) => {
    chamadas.push({ url, opts });
    return { ok: true, status: 200, headers: { get: () => 'application/json' }, json: async () => ({ rows: [], total: 0 }) };
  };
  await lerConjunto('umuvme-sls-bko');
  assert.equal(chamadas.length, 1);
  assert.equal(chamadas[0].opts.headers['X-Api-Token'], 'token-de-teste-123');
  assert.doesNotMatch(chamadas[0].url, /token/, 'o token saiu da query string');
  assert.match(chamadas[0].url, /\/umuvme-sls-bko\/rows\?limit=\d+&offset=0$/);
});

test('página menor que a pedida (teto da API) não corta o conjunto: segue até o total', async () => {
  const offsets = [];
  globalThis.fetch = async (url) => {
    const offset = Number(new URL(url).searchParams.get('offset'));
    offsets.push(offset);
    const n = Math.min(300, 700 - offset);   // a API devolve no máximo 300 por página
    const rows = Array.from({ length: Math.max(n, 0) }, (_, i) => ({ id: offset + i }));
    return { ok: true, status: 200, headers: { get: () => 'application/json' }, json: async () => ({ rows, total: 700 }) };
  };
  const { rows } = await lerConjunto('umuvme-sls-bko');
  assert.equal(rows.length, 700);
  assert.deepEqual(offsets, [0, 300, 600]);
  assert.equal(new Set(rows.map((r) => r.id)).size, 700, 'sem linha repetida nem pulada');
});

test('conexão recusada uma vez (Data Hub reiniciando) é tentada de novo e a carga sai', async () => {
  let tentativas = 0;
  globalThis.fetch = async () => {
    tentativas += 1;
    if (tentativas === 1) { const e = new Error('fetch failed'); e.cause = { code: 'ECONNREFUSED' }; throw e; }
    return { ok: true, status: 200, headers: { get: () => 'application/json' }, json: async () => ({ rows: [{ a: 1 }], total: 1 }) };
  };
  const { rows } = await lerConjunto('umuvme-sls-bko');
  assert.equal(tentativas, 2);
  assert.equal(rows.length, 1);
});
