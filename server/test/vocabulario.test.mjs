/**
 * O VOCABULÁRIO — o que se lê do nome de uma campanha de anúncio.
 *
 * Cada caso aqui é um nome REAL, copiado da base: os nomes de campanha do Google
 * e os do Meta. A parte que traduzia as tags do Matrix saiu em out/2026, junto com
 * a tag como base de leads (ver campanhas.test.mjs).
 */
import assert from 'node:assert/strict';
import test from 'node:test';

const {
  cidadeDe, identidadeDaCampanha, numeroBR, FAMILIAS_RECRUTAMENTO,
} = await import('../src/model/vocabulario.js');

// ---------------------------------------------- os nomes de campanha do anúncio

test('a campanha nova do Google diz família, cidade e o código CP', () => {
  const g = identidadeDaCampanha('[W] [CP-01] [RP-CONEXÃO GARANTIDA] [CANOAS] [09-05-2026] #2', 'google');
  assert.equal(g.cidade, 'CANOAS');
  assert.equal(g.familia, 'conexao_garantida');
  assert.equal(g.cp, 'CP-01');
});

test('a campanha antiga do Google também é lida', () => {
  const g = identidadeDaCampanha('RP - Felicidade Ilimitada - São Leopoldo', 'google');
  assert.equal(g.familia, 'felicidade_ilimitada');
  assert.equal(g.cidade, 'SÃO LEOPOLDO');
  assert.equal(g.cp, null);
});

test('a campanha comercial do Meta é comercial e cobre todas as cidades', () => {
  const m = identidadeDaCampanha('[W] [CP-02] [ENG] [WHATSAPP] [COMERCIAL] [01-05-2026]', 'meta');
  assert.equal(m.familia, 'comercial');
  assert.equal(m.cidade, null);
});

test('a campanha de alcance por cidade diz a cidade', () => {
  const m = identidadeDaCampanha('[W] [CP-21] [REC] [ALCANCE+BOTÃO WHATSAPP] [CACHOEIRINHA] [04-06-2026]', 'meta');
  assert.equal(m.familia, 'alcance');
  assert.equal(m.cidade, 'CACHOEIRINHA');
});

test('[CIDADES] quer dizer todas, e não uma cidade chamada Cidades', () => {
  const m = identidadeDaCampanha('[W] [CP-31] [REC] [ALCANCE+WHATSAPP] [CIDADES] [JUNHO-2026] [19-06-2026]', 'meta');
  assert.equal(m.cidade, null);
});

test('VAGAS é recrutamento, e não pode cair no custo por lead comercial', () => {
  for (const nome of [
    '[W] [CP-04] [ENG] [WHATSAPP] [VAGAS] [CIDADES] [01-05-2026]',
    'Campanha Vagas - Abr.26 (Men. Whats)',
    'Camp. Vaga Fusionista - Canoas - Jan.26 (Men. Whats)',
    'Camp. Vaga Inst. de Internet - São Léo - Fev.26 (Men. Whats)',
  ]) {
    const id = identidadeDaCampanha(nome, 'meta');
    assert.equal(id.familia, 'vagas', nome);
    assert.ok(FAMILIAS_RECRUTAMENTO.has(id.familia));
  }
});

test('vagas vence whatsapp e cidades, que também aparecem no mesmo nome', () => {
  // '[VAGAS] [CIDADES]' casaria com 'cidades' e com o rótulo de comercial se a
  // ordem das famílias fosse alfabética — R$ 202 mil de recrutamento no lugar errado
  const id = identidadeDaCampanha('[W] [CP-23] [ENG] [WHATSAPP] [VAGAS] [CIDADES] [04-06-2026]', 'meta');
  assert.equal(id.familia, 'vagas');
});

test('a campanha de tráfego para landing page não vira comercial', () => {
  const id = identidadeDaCampanha('[W] [CP-10] [TRAF] [LP-CAPTURA] [CACHOEIRINHA]  [REGIÃO 3] [MAIO-2026] [12-05-2026]', 'meta');
  assert.equal(id.familia, 'trafego');
  assert.equal(id.cidade, 'CACHOEIRINHA');
});

test('"Reconhecimento" é alcance, e não comercial', () => {
  // o Meta trocou a nomenclatura: hoje a campanha de awareness se chama assim, e
  // o `[WPP]` no mesmo nome fazia ela cair como campanha de conversa
  const id = identidadeDaCampanha('[Vendas][Reconhecimento][WPP][Todas Cidades]', 'meta');
  assert.equal(id.familia, 'alcance');
  assert.equal(
    identidadeDaCampanha('[Vendas][Engajamento][WPP][Todas Cidades]', 'meta').familia, 'comercial',
    'engajamento por WhatsApp continua sendo campanha de conversa',
  );
});

test('o ID da campanha fica como TEXTO — 18 dígitos não cabem em double', () => {
  const id = identidadeDaCampanha('[CP-27] [COMERCIAL]', 'meta', '120248421965250047');
  assert.strictEqual(id.anuncioId, '120248421965250047');
  assert.notEqual(String(Number(id.anuncioId)), id.anuncioId);
});

// --------------------------------------------------------------- as cidades

test('"São Léo" abreviado e o typo "Sao Leopodo" são São Leopoldo', () => {
  assert.equal(identidadeDaCampanha('Camp. Vaga Fusionista - São Léo - Dez.25 (Men. Whats)', 'meta').cidade, 'SÃO LEOPOLDO');
  assert.equal(cidadeDe('campanha macro sao leopodo'), 'SÃO LEOPOLDO');
});

test('cidade só casa como palavra inteira', () => {
  assert.equal(cidadeDe('RP - Felicidade Ilimitada'), null, '"nh" não está escondido em "Ilimitada"');
});

test('a cidade é achada no título do anúncio e na mensagem do lead', () => {
  assert.equal(cidadeDe('Novo Hamburgo: contrate agora!'), 'NOVO HAMBURGO');
  assert.equal(cidadeDe('Vi seu anúncio em Sapucaia, quero saber mais sobre seus planos de internet!'), 'SAPUCAIA DO SUL');
  assert.equal(cidadeDe('Gostaria de saber mais sobre os planos de internet em São Leopoldo.'), 'SÃO LEOPOLDO');
  assert.equal(cidadeDe('Contrate agora!'), null);
});

// ------------------------------------------------------- números em português

test('o texto em português do Google vira número, e não NaN nem valor truncado', () => {
  assert.equal(numeroBR('142,49'), 142.49, 'Number() daria NaN e zeraria o custo total');
  assert.equal(numeroBR('13,36%'), 13.36);
  assert.equal(numeroBR('1.234,56'), 1234.56, 'parseFloat daria 1 — o separador de milhar é ponto');
  assert.equal(numeroBR(''), 0);
  assert.equal(numeroBR(null), 0);
  assert.equal(numeroBR(42.5), 42.5);
});
