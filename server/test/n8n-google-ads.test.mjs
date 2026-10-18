/**
 * n8n · Google Ads → DB_Marketing — o código do nó "Validar lote e montar SQL".
 *
 * O nó roda dentro do n8n, onde ninguém olha antes de ir para o banco. Este teste
 * executa o MESMO arquivo, com um `$input` falso, e segura as três coisas que
 * estragariam a tabela em silêncio: formato diferente do da carga manual, escape
 * de texto e lote ruim chegando ao INSERT.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const codigo = fs.readFileSync(path.join(AQUI, '../../n8n/google-ads/validar-e-montar-sql.js'), 'utf8');

/** Roda o código do nó Code como o n8n roda: corpo de função com `$input`. */
function rodar(body) {
  const $input = { first: () => ({ json: { body } }) };
  return new Function('$input', codigo)($input).map((i) => i.json);
}

const ontem = new Date(Date.now() - 864e5).toISOString().slice(0, 10);
const linha = (extra = {}) => ({
  campanha: '[W] [CP-02] [RP-CONEXÃO GARANTIDA] [CACHOEIRINHA] [09-05-2026] #2',
  campanhaId: '23861266458',
  estado: 'ENABLED',
  tipo: 'SEARCH',
  dia: ontem,
  moeda: 'BRL',
  cliques: 115,
  impressoes: 643,
  ctr: 0.1788491,
  cpcMedio: 1.886521,
  custo: 216.95,
  impressaoTopoAbsoluto: 0.4712,
  impressaoTopo: 0.8822,
  conversoes: 8,
  conversoesVisualizacao: 0,
  custoPorConversao: 27.11875,
  taxaConversao: 0.0696,
  ...extra,
});

test('grava no mesmo formato da carga manual do Google Ads', () => {
  const [r] = rodar({ linhas: [linha()] });
  assert.equal(r.valido, true);
  assert.match(r.query, /^INSERT INTO DB_Marketing\.marketing_google_ads \(`Campanha`, `ID da campanha`/);
  assert.ok(r.query.includes(
    "('[W] [CP-02] [RP-CONEXÃO GARANTIDA] [CACHOEIRINHA] [09-05-2026] #2', 23861266458, 'Ativada', 'Pesquisa', "
    + `'${ontem} 00:00:00', 115, 643, '17,88%', 'BRL', '1,89', '216,95', '47,12%', '88,22%', '8', 0, '27,12', '6,96%')`,
  ), r.query);
  assert.match(r.query, /ON DUPLICATE KEY UPDATE `Campanha` = VALUES\(`Campanha`\)/);
  assert.ok(!/`ID da campanha` = VALUES/.test(r.query), 'a chave não entra no UPDATE');
});

test('decimal sem zero à direita e zero como "0", como a tabela já tem', () => {
  const [r] = rodar({ linhas: [linha({ ctr: 0.175, conversoes: 6.5, custoPorConversao: 0, taxaConversao: 0 })] });
  assert.ok(r.query.includes("'17,5%'"));
  assert.ok(r.query.includes("'6,5'"));
  assert.ok(r.query.includes("'0', '0%')"));
});

test('métrica de parcela de impressão ausente vira NULL, não "0%"', () => {
  const [r] = rodar({ linhas: [linha({ impressaoTopoAbsoluto: null, impressaoTopo: undefined })] });
  assert.ok(r.query.includes("'BRL', '1,89', '216,95', NULL, NULL, '8'"));
});

test('aspa e barra invertida no nome da campanha são escapadas', () => {
  const [r] = rodar({ linhas: [linha({ campanha: "Camp. D'Ávila \\ teste'); DROP TABLE x; --" })] });
  assert.ok(r.query.includes("('Camp. D\\'Ávila \\\\ teste\\'); DROP TABLE x; --'"));
});

test('as linhas do SQL têm espaço antes da quebra — o nó MySQL apaga a quebra', () => {
  const [r] = rodar({ linhas: [linha()] });
  for (const quebra of r.query.matchAll(/\n/g)) {
    assert.equal(r.query[quebra.index - 1], ' ');
  }
});

test('lote grande vira um comando por bloco de 200 linhas', () => {
  const linhas = Array.from({ length: 450 }, (_, i) => linha({ campanhaId: String(1000 + i) }));
  const r = rodar({ conta: '709-747-1936', linhas });
  assert.equal(r.length, 3);
  assert.ok(r.every((b) => b.total === 450 && b.campanhas === 450 && b.conta === '709-747-1936'));
});

test('lote ruim é recusado com o motivo, e nada vai para o banco', () => {
  const recusa = (body) => {
    const r = rodar(body);
    assert.equal(r.length, 1);
    assert.equal(r[0].valido, false);
    return r[0].erro;
  };
  assert.match(recusa({}), /linhas/);
  assert.match(recusa({ linhas: [] }), /vazio/);
  assert.match(recusa({ linhas: [linha({ campanhaId: '12a' })] }), /Linha 1: "campanhaId"/);
  assert.match(recusa({ linhas: [linha({ dia: '18/10/2026' })] }), /AAAA-MM-DD/);
  assert.match(recusa({ linhas: [linha({ dia: '2099-01-01' })] }), /fora da janela/);
  assert.match(recusa({ linhas: [linha(), linha({ custo: -1 })] }), /Linha 2: "custo"/);
  assert.match(recusa({ linhas: [linha({ cliques: 'muitos' })] }), /"cliques" inválido/);
});
