import { test } from 'node:test';
import assert from 'node:assert/strict';
import { filaFiltrada } from '../src/model/relatorios.js';

const vazio = {
  de: '', ate: '', cidades: [], bairros: [], vendedores: [], equipes: [], situacoes: [],
  status: [], tecnologias: [], servicos: [], etiquetas: [], situacoesItem: [], busca: '',
};
const fatos = new Map([
  ['100', { protocolo: 100, contrato: 'A1', cliente: 'Ana', cidade: 'Canoas', bairro: 'Fátima', vendedor: 'V1', situacao: 'Interno', statusContrato: 'Normal', tecnologia: 'FIBRA', dtVenda: '2025-01-10' }],
  ['200', { protocolo: 200, contrato: 'B2', cliente: 'Bia', cidade: 'Esteio', bairro: 'Centro', vendedor: 'V2', situacao: 'Externo', statusContrato: 'Cancelado', tecnologia: 'FIBRA', dtVenda: '2026-10-01' }],
]);
const fila = [{ protocolo: 100 }, { protocolo: '200' }, { protocolo: 300 }];

test('sem filtro: a fila inteira, inclusive o protocolo sem contrato', () => {
  assert.equal(filaFiltrada(fila, fatos, vazio).length, 3);
});

test('status do contrato filtra a fila', () => {
  const r = filaFiltrada(fila, fatos, { ...vazio, status: ['Cancelado'] });
  assert.deepEqual(r.map((l) => l.contrato), ['B2']);
});

test('cidade e busca filtram a fila', () => {
  assert.deepEqual(filaFiltrada(fila, fatos, { ...vazio, cidades: ['Canoas'] }).map((l) => l.contrato), ['A1']);
  assert.deepEqual(filaFiltrada(fila, fatos, { ...vazio, busca: 'bia' }).map((l) => l.contrato), ['B2']);
});

test('o período NÃO recorta a fila (retrato do agora)', () => {
  assert.equal(filaFiltrada(fila, fatos, { ...vazio, de: '2026-10-01', ate: '2026-10-07' }).length, 3);
});
