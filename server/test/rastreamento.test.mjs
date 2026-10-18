/**
 * RASTREAMENTO — a leitura do CSV que o Matrix exporta.
 *
 * Os casos são do arquivo real de set/2026: `;`, aspas, mensagem com quebra de
 * linha dentro das aspas, emoji escrito como `##1f60d##`, protocolo começando com
 * zero, e alguns bytes inválidos num arquivo que é UTF-8.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

const {
  chaveProtocolo, contagemDoUpsert, dataHora, decodificar, emojis, lerRastreamento,
} = await import('../src/model/rastreamento.js');

const CABECALHO = 'Cod.;Título do post;Tipo;Conta;Canal;Nome do contato;Número de telefone;Classificação principal do atendimento;Data Acesso;Protocolo;Mensagem';
const bytes = (s) => new TextEncoder().encode(s);

test('lê o formato do Matrix, com quebra de linha e aspas dentro da mensagem', () => {
  const csv = [
    `﻿${CABECALHO}`,
    '106798;"Contrate agora!";ad;;Whatsapp;"ALYFER";5551994796167;;"30/09/2026 20:52:38";4083000005426118;"60182726010',
    '18072007"',
    '106792;"Contrate agora!";ad;;Whatsapp;Márcio;5551993392710;;"30/09/2026 20:02:00";9320000005436704;Oi',
    '105622;"Contrate agora!";ad;;Whatsapp;X;5551;;"23/09/2026 06:20:14";5214000005385442;"APERTE EM ""ENTRADA"" para registrar"',
  ].join('\r\n');
  const r = lerRastreamento(bytes(csv));
  assert.equal(r.linhas.length, 3);
  assert.equal(r.linhas[0].mensagem, '60182726010\r\n18072007');
  assert.equal(r.linhas[1].contato, 'Márcio');
  assert.equal(r.linhas[2].mensagem, 'APERTE EM "ENTRADA" para registrar');
  assert.equal(r.de, '2026-09-23');
  assert.equal(r.ate, '2026-09-30');
});

test('o cabeçalho é casado por nome, não por posição', () => {
  const csv = 'Protocolo;Data Acesso;Cod.;Mensagem\n0924000005436812;"30/09/2026 20:28:44";106794;Oi';
  const [l] = lerRastreamento(bytes(csv)).linhas;
  assert.equal(l.cod, '106794');
  assert.equal(l.protocolo, '0924000005436812', 'o zero à esquerda fica: o protocolo é texto');
  assert.equal(l.titulo, null);
});

test('outro relatório do Matrix é recusado inteiro, dizendo o que falta', () => {
  assert.throws(
    () => lerRastreamento(bytes('id_atendimento;data_entrada\n1;2026-09-01')),
    /rastreamento de posts.*cod, data acesso, protocolo/i,
  );
});

test('linha sem data válida, sem protocolo ou repetida é recusada com o motivo', () => {
  const csv = [
    CABECALHO,
    '1;T;ad;;W;A;1;;"31/02/2026 10:00:00";123;Oi',
    '2;T;ad;;W;A;1;;"01/09/2026 10:00:00";;Oi',
    '3;T;ad;;W;A;1;;"01/09/2026 10:00:00";456;Oi',
    '3;T;ad;;W;A;1;;"01/09/2026 10:00:00";456;Oi de novo',
  ].join('\n');
  const r = lerRastreamento(bytes(csv));
  assert.equal(r.linhas.length, 1);
  assert.deepEqual(
    r.recusadas.map((x) => x.motivo.replace(/ \(.*/, '')),
    ['data inválida', 'sem protocolo', 'código repetido no arquivo'],
    '31/02 passa no formato, mas o MariaDB recusaria e derrubaria o lote inteiro',
  );
});

test('o emoji escrito como código volta a ser emoji', () => {
  assert.equal(emojis('Gostaria ##1f60d## de saber'), 'Gostaria 😍 de saber');
  assert.equal(emojis('##26a0-fe0f##'), '⚠️');
  assert.equal(emojis('##zzzz##'), '##zzzz##');
});

test('a data do Matrix vira a forma do banco', () => {
  assert.equal(dataHora('30/09/2026 23:39:56'), '2026-09-30 23:39:56');
  assert.equal(dataHora('15/09/2026'), '2026-09-15 00:00:00');
  assert.equal(dataHora('2026-09-15'), null);
  assert.equal(dataHora('15/13/2026 10:00:00'), null);
  assert.equal(dataHora('31/02/2026 10:00:00'), null);
});

test('o protocolo é comparado sem os zeros à esquerda, como o bigint do Matrix', () => {
  assert.equal(chaveProtocolo('0924000005436812'), '924000005436812');
  assert.equal(chaveProtocolo(924000005436812n), '924000005436812');
});

test('arquivo UTF-8 com alguns bytes ruins continua UTF-8', () => {
  const ok = bytes(`${CABECALHO}\n1;Fibra óptica;ad;;W;Ana;1;;"01/09/2026 10:00:00";9;Olá`);
  const comLixo = new Uint8Array([...ok, 0x8d, 0x0a]);
  assert.match(decodificar(comLixo), /Fibra óptica/);
});

test('arquivo salvo pelo Excel em Windows-1252 é lido como tal', () => {
  // "Título;Ação" em Windows-1252
  const cp1252 = new Uint8Array([0x54, 0xed, 0x74, 0x75, 0x6c, 0x6f, 0x3b, 0x41, 0xe7, 0xe3, 0x6f]);
  const repetido = new Uint8Array(cp1252.length * 40);
  for (let i = 0; i < 40; i += 1) repetido.set(cp1252, i * cp1252.length);
  assert.match(decodificar(repetido), /^Título;Ação/);
});

test('novas e já existentes saem do texto de resultado do MariaDB', () => {
  assert.deepEqual(contagemDoUpsert({ affectedRows: 500, info: 'Records: 500  Duplicates: 0  Warnings: 0' }, 500), { novas: 500, existentes: 0 });
  // reimportação idêntica: com FOUND_ROWS o affectedRows não separa mudada de igual,
  // então a contagem não tenta — tudo "já existia"
  assert.deepEqual(contagemDoUpsert({ affectedRows: 500, info: 'Records: 500  Duplicates: 500  Warnings: 0' }, 500), { novas: 0, existentes: 500 });
  assert.deepEqual(contagemDoUpsert({ affectedRows: 400, info: 'Records: 500  Duplicates: 200  Warnings: 0' }, 500), { novas: 300, existentes: 200 });
});
