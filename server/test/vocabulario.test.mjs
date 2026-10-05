/**
 * O VOCABULÁRIO — é o que permite as três fontes conversarem sem ID de campanha.
 *
 * Cada caso aqui é um nome REAL, copiado da base: as tags do Matrix, os nomes de
 * campanha do Google e os do Meta. Quando o ID de campanha finalmente existir nas
 * tags, estes testes é que dizem se a ponte heurística concordava com ele.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

const {
  chaveDe, cidadeDe, cruzar, identidadeDaCampanha, identidadeDaTag,
  identidadesDoAtendimento, indexarCampanhas, numeroBR, tagsDe, FAMILIAS_RECRUTAMENTO,
} = await import('../src/model/vocabulario.js');

// ---------------------------------------------------------------- as tags

test('a tag nova diz plataforma, família e cidade sozinha', () => {
  assert.deepEqual(identidadeDaTag('marketing_comercial_meta_canoas'), {
    plataforma: 'meta', familia: 'comercial', cidade: 'CANOAS', origem: 'tag',
    anuncioId: null, bruto: 'marketing_comercial_meta_canoas',
  });
  const alcance = identidadeDaTag('marketing_alcance_meta_cachoeirinha');
  assert.equal(alcance.familia, 'alcance');
  assert.equal(alcance.cidade, 'CACHOEIRINHA');
});

test('a tag sem cidade é a campanha que cobre todas', () => {
  const id = identidadeDaTag('marketing_comercial_meta');
  assert.equal(id.cidade, null);
  assert.equal(chaveDe(id), 'meta|comercial|TODAS');
});

test('o padrão antigo entra sem plataforma, em vez de chutar uma', () => {
  const id = identidadeDaTag('marketing_campanha_macro_canoas');
  assert.equal(id.cidade, 'CANOAS');
  assert.equal(id.familia, 'macro');
  assert.equal(
    id.plataforma, '?',
    'as macro rodavam no Google E no Meta; atribuir a um daria a ele o funil dos dois',
  );
});

test('o typo sao_leopodo é a mesma cidade que SÃO LEOPOLDO do Google', () => {
  assert.equal(identidadeDaTag('marketing_campanha_macro_sao_leopodo').cidade, 'SÃO LEOPOLDO');
  assert.equal(
    cidadeDe('[W] [CP-00] [RP-CONEXÃO GARANTIDA] [SÃO LEOPOLDO] [09-05-2026]'), 'SÃO LEOPOLDO',
    'seis meses de tag com o typo teriam virado uma sétima cidade no funil',
  );
});

test('a ordem invertida da tag de lançamento também é lida', () => {
  // esta vem como marketing_<cidade>_lancamento_meta, e não _<familia>_<plataforma>
  const id = identidadeDaTag('marketing_cachoeirinha_lancamento_meta');
  assert.equal(id.plataforma, 'meta');
  assert.equal(id.familia, 'lancamento');
  assert.equal(id.cidade, 'CACHOEIRINHA');
});

test('tag que não é de marketing não vira campanha', () => {
  assert.equal(identidadeDaTag('ISA_VENDAS_RECEPTIVAS'), null);
  assert.equal(identidadeDaTag('ATENDIMENTO_HUMANO_COMERCIAL_VENDAS_RECEPTIVAS'), null);
});

// -------------------------------------------------- a sopa da coluna tags

test('a coluna tags é quebrada nos dois separadores que a base usa', () => {
  assert.deepEqual(
    tagsDe('marketing_campanha_organica,ISA_VENDAS_RECEPTIVAS,ISA_ERRO_LEAD_ELLEVEN'),
    ['marketing_campanha_organica', 'ISA_VENDAS_RECEPTIVAS', 'ISA_ERRO_LEAD_ELLEVEN'],
  );
  assert.deepEqual(
    tagsDe('"marketing_campanha_organica || ISA_VENDAS_RECEPTIVAS"'),
    ['marketing_campanha_organica', 'ISA_VENDAS_RECEPTIVAS'],
    'a mesma campanha vinha com vírgula numas linhas e com || em outras',
  );
});

test('as aspas em volta não criam uma segunda campanha', () => {
  const comAspas = identidadesDoAtendimento('"marketing_campanha_macro_canoas"');
  const sem = identidadesDoAtendimento('marketing_campanha_macro_canoas');
  assert.equal(
    chaveDe(comAspas[0]), chaveDe(sem[0]),
    'no relatório de origem Canoas aparece partida em quatro linhas por causa disto',
  );
});

test('um atendimento com duas tags de marketing conta para as duas campanhas', () => {
  const ids = identidadesDoAtendimento('marketing_comercial_meta_canoas,marketing_site_organico_planos');
  assert.equal(ids.length, 2);
  assert.deepEqual(ids.map((i) => i.plataforma).sort(), ['meta', 'site']);
});

// ---------------------------------------------- os nomes de campanha do anúncio

test('a campanha nova do Google casa com a tag macro pela cidade', () => {
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

test('a campanha comercial do Meta casa com a tag marketing_comercial_meta', () => {
  const m = identidadeDaCampanha('[W] [CP-02] [ENG] [WHATSAPP] [COMERCIAL] [01-05-2026]', 'meta');
  assert.equal(
    chaveDe(m), chaveDe(identidadeDaTag('marketing_comercial_meta')),
    'é exatamente esta igualdade que liga investimento a atendimento',
  );
});

test('a campanha de alcance por cidade casa com a tag de alcance daquela cidade', () => {
  const m = identidadeDaCampanha('[W] [CP-21] [REC] [ALCANCE+BOTÃO WHATSAPP] [CACHOEIRINHA] [04-06-2026]', 'meta');
  assert.equal(chaveDe(m), chaveDe(identidadeDaTag('marketing_alcance_meta_cachoeirinha')));
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

test('"São Léo" abreviado é São Leopoldo', () => {
  assert.equal(identidadeDaCampanha('Camp. Vaga Fusionista - São Léo - Dez.25 (Men. Whats)', 'meta').cidade, 'SÃO LEOPOLDO');
});

test('cidade só casa como palavra inteira', () => {
  assert.equal(cidadeDe('RP - Felicidade Ilimitada'), null, '"nh" não está escondido em "Ilimitada"');
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

// ------------------------------------------- o ID do anúncio dentro da tag

/**
 * Em outubro/2026 a área passou a escrever o identificador do anúncio na tag.
 * Os casos abaixo são as dez formas que existem na base em 05/10/2026 — note o
 * espaçamento inconsistente entre as duas famílias, que é o motivo de o corte
 * ser "os dígitos do começo" e não uma divisão por `_`.
 */
test('a tag com ID entrega o número e continua dizendo família e cidade', () => {
  const id = identidadeDaTag('120248421965260047_Comercial_Meta_SAO LEOPOLDO');
  assert.equal(id.anuncioId, '120248421965260047');
  assert.equal(id.plataforma, 'meta');
  assert.equal(id.familia, 'comercial');
  assert.equal(id.cidade, 'SÃO LEOPOLDO');
});

test('o espaçamento irregular da família Alcance também é lido', () => {
  const id = identidadeDaTag('120249119020270047_ Alcance_Meta _CANOAS');
  assert.equal(id.anuncioId, '120249119020270047');
  assert.equal(id.familia, 'alcance');
  assert.equal(id.cidade, 'CANOAS');
});

test('o ID fica como TEXTO — 18 dígitos não cabem em double sem arredondar', () => {
  const id = identidadeDaTag('120248421965250047_Comercial_Meta_CANOAS');
  assert.strictEqual(typeof id.anuncioId, 'string');
  assert.notEqual(
    String(Number(id.anuncioId)), id.anuncioId,
    'é justamente por arredondar que este ID não pode virar número em lugar nenhum',
  );
});

test('a tag com ID não precisa do prefixo marketing — ele fica na tag irmã', () => {
  // na base a linha inteira é:
  //   MARKETING_COMERCIAL_META || 1202…_Comercial_Meta_SAO LEOPOLDO || ATENDIMENTO_…
  const ids = identidadesDoAtendimento(
    'MARKETING_COMERCIAL_META || 120248421965260047_Comercial_Meta_SAO LEOPOLDO || ATENDIMENTO_HUMANO_VENDAS_RECEPTIVAS',
  );
  assert.equal(ids.length, 2, 'o rótulo e o ID descrevem a mesma campanha por dois caminhos');
  assert.ok(ids.some((i) => i.anuncioId === '120248421965260047'));
  assert.ok(ids.every((i) => i.plataforma === 'meta' && i.familia === 'comercial'));
});

test('o ID casa com a campanha quando os dois lados o têm, e isso vence a heurística', () => {
  const campanhas = [{
    plataforma: 'meta',
    campanhaId: '120248421964960047',
    identidade: identidadeDaCampanha('[W] [CP-27] [ENG] [WHATSAPP] [COMERCIAL]', 'meta', '120248421964960047'),
  }];
  const indice = indexarCampanhas(campanhas);
  const achou = cruzar(identidadeDaTag('120248421964960047_Comercial_Meta_CANOAS'), indice);
  assert.equal(achou.confianca, 'id', 'com ID dos dois lados não há mais suposição');
  assert.equal(achou.campanhas[0].campanhaId, '120248421964960047');
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
