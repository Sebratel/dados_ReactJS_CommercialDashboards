/**
 * A média por dia útil, depois que ela deixou de ponderar o dividendo.
 *
 * O Power BI de origem multiplicava os dois lados da divisão, e isso descontava a
 * produção do sábado e apagava por completo a do domingo e a do feriado. A regra do
 * comercial é sobre o DIVISOR — sábado é meio expediente —, e é isso que estes testes
 * travam: se alguém voltar a ponderar o dividendo, eles quebram.
 *
 * Datas usadas (todas conferidas em holidays.js):
 *   2026-08-03 a 07  segunda a sexta   peso 1
 *   2026-08-01/08    sábados           peso 0,5
 *   2026-08-02       domingo           peso 0
 *   2026-09-07       Independência     peso 0 (feriado numa segunda)
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mediaPorDiaUtil } from '../src/model/measures.js';

/** Monta a lista de fatos: { '2026-08-03': 10 } vira 10 linhas naquele dia. */
const fatos = (porDia) => Object.entries(porDia)
  .flatMap(([d, n]) => Array.from({ length: n }, () => ({ dt: d })));

const media = (porDia) => mediaPorDiaUtil(fatos(porDia), 'dt');

test('dia útil comum: é a média simples', () => {
  // 3 dias de peso 1, 30 registros
  assert.equal(media({ '2026-08-03': 10, '2026-08-04': 10, '2026-08-05': 10 }), 10);
});

test('sábado conta INTEIRO no dividendo e meio no divisor', () => {
  // 100 na segunda + 40 no sábado = 140 registros; divisor 1 + 0,5 = 1,5
  const m = media({ '2026-08-03': 100, '2026-08-01': 40 });
  assert.equal(m, 140 / 1.5);
  // a fórmula antiga (dividendo ponderado) daria (100 + 20) / 1,5 = 80
  assert.notEqual(m, 80);
});

test('venda em domingo entra na conta em vez de evaporar', () => {
  // o domingo não acrescenta divisor, mas os 20 registros dele contam
  const comDomingo = media({ '2026-08-03': 100, '2026-08-02': 20 });
  const semDomingo = media({ '2026-08-03': 100 });
  assert.equal(comDomingo, 120);
  assert.equal(semDomingo, 100);
  assert.ok(comDomingo > semDomingo, 'o domingo tem de mover a média para cima');
});

test('feriado se comporta como domingo, mesmo caindo em dia de semana', () => {
  // 2026-09-07 é uma segunda-feira, e é feriado: peso 0
  assert.equal(media({ '2026-09-08': 50, '2026-09-07': 10 }), 60);
});

test('media x soma dos pesos reproduz o total — a leitura que fecha', () => {
  const porDia = {
    '2026-08-03': 164, '2026-08-04': 173, '2026-08-05': 154,
    '2026-08-06': 167, '2026-08-07': 165,
    '2026-08-01': 66, '2026-08-08': 62,
    '2026-08-02': 9, // domingo
  };
  const total = Object.values(porDia).reduce((a, b) => a + b, 0);
  const pesos = 5 * 1 + 2 * 0.5 + 0; // 6
  assert.equal(media(porDia) * pesos, total);
});

test('dia sem movimento não entra no divisor', () => {
  // terça e quarta não aparecem: o divisor é 1, não 3
  assert.equal(media({ '2026-08-03': 7 }), 7);
});

test('recorte só de domingo devolve 0 — não existe média por dia útil sem dia útil', () => {
  assert.equal(media({ '2026-08-02': 25 }), 0);
});

test('lista vazia e datas nulas não estouram', () => {
  assert.equal(mediaPorDiaUtil([], 'dt'), 0);
  assert.equal(mediaPorDiaUtil([{ dt: null }, { dt: '' }], 'dt'), 0);
  // linha sem data é ignorada, as com data continuam valendo
  assert.equal(mediaPorDiaUtil([{ dt: null }, { dt: '2026-08-03' }], 'dt'), 1);
});
