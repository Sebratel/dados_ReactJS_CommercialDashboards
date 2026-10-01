import { test } from 'node:test';
import assert from 'node:assert/strict';
import { agoraLocal, horasUteis, paraMinutos } from '../src/sla/horasUteis.js';

// feriado fixo para os testes não dependerem do cadastro em disco
const feriados = new Set(['2026-09-07', '2026-12-25']);
const h = (a, b) => horasUteis(a, b, { feriados });

test('mesmo dia útil, dentro do expediente', () => {
  assert.equal(h('2026-09-22 09:00:00', '2026-09-22 11:30:00'), 2.5);
});

test('antes das 8h e depois das 21h não contam', () => {
  assert.equal(h('2026-09-22 06:00:00', '2026-09-22 09:00:00'), 1);
  assert.equal(h('2026-09-22 20:00:00', '2026-09-22 23:59:00'), 1);
});

test('virada de dia útil: 20h de terça até 9h de quarta = 1h + 1h', () => {
  assert.equal(h('2026-09-22 20:00:00', '2026-09-23 09:00:00'), 2);
});

test('dia útil inteiro vale 13 h', () => {
  assert.equal(h('2026-09-22 00:00:00', '2026-09-23 00:00:00'), 13);
});

test('sábado vale 9 h (8h–17h)', () => {
  // 26/09/2026 é sábado
  assert.equal(h('2026-09-26 00:00:00', '2026-09-27 00:00:00'), 9);
  assert.equal(h('2026-09-26 16:00:00', '2026-09-26 19:00:00'), 1);
});

test('domingo pausa: sábado 16h até segunda 9h = 1h + 0 + 1h', () => {
  assert.equal(h('2026-09-26 16:00:00', '2026-09-28 09:00:00'), 2);
});

test('feriado em dia de semana é plantão 8h–17h, não pausa', () => {
  // 07/09/2026 é segunda-feira
  assert.equal(h('2026-09-07 00:00:00', '2026-09-08 00:00:00'), 9);
  assert.equal(h('2026-09-07 18:00:00', '2026-09-07 20:00:00'), 0);
});

test('feriado no domingo segue a regra do domingo', () => {
  const dom = new Set(['2026-09-27']);
  assert.equal(horasUteis('2026-09-27 00:00:00', '2026-09-28 00:00:00', { feriados: dom }), 0);
});

test('fim antes do início é inconsistente (null), não zero', () => {
  assert.equal(h('2026-09-22 10:00:00', '2026-09-22 09:00:00'), null);
  assert.equal(h(null, '2026-09-22 09:00:00'), null);
});

test('semana cheia: 5 × 13 + 9 + 0 = 74 h', () => {
  // segunda 21/09 00:00 até segunda 28/09 00:00
  assert.equal(h('2026-09-21 00:00:00', '2026-09-28 00:00:00'), 74);
});

test('virada de ano funciona com o calendário real de feriados', () => {
  // 31/12/2025 (quarta) 20h → 02/01/2026 (sexta) 09h. 01/01 é feriado nacional = plantão 9h
  assert.equal(horasUteis('2025-12-31 20:00:00', '2026-01-02 09:00:00'), 1 + 9 + 1);
});

test('texto local vira minuto sem depender do fuso da máquina', () => {
  assert.equal(paraMinutos('2026-01-01 00:01:00') - paraMinutos('2026-01-01 00:00:00'), 1);
  assert.match(agoraLocal(new Date('2026-09-22T15:00:00Z')), /^2026-09-22 12:00:00$/);
});
