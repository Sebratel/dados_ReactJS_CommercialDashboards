/**
 * CAMPANHAS — o lead do rastreamento de posts e o desfecho dele no Matrix.
 *
 * O risco desta tela é contar errado o lead: um protocolo tem várias mensagens no
 * rastreamento e vários trechos no `db_matrix`, e olhar uma linha só de cada lado
 * já produziu uma conclusão errada (a de que a tag "se perdia" na transferência).
 * Os testes seguram a junção, a venda em qualquer trecho, o lead que não chegou a
 * atendente e o custo por lead calculado só com o gasto que gerou o lead.
 */
import assert from 'node:assert/strict';
import test, { beforeEach } from 'node:test';

process.env.AUTH_ENABLED = 'false';

const {
  SEM_ATENDENTE, VENDA, classificacaoDe, construirCampanhas, montarLeads,
  parseFiltrosCampanhas, setFonteCampanhas, tituloDe,
} = await import('../src/model/campanhas.js');
const {
  painelCampanhasAtendimentos, painelCampanhasPlataforma, painelCampanhasVisaoGeral,
} = await import('../src/model/paineis-campanhas.js');

const diaGoogle = (campanha, dia, custo) => ({
  campanha, campanha_id: `G-${campanha}`, dia, custo_txt: custo,
  cliques: 10, impressoes: 100, conversoes_txt: '1', estado: 'Ativa',
});
const diaMeta = (campanha, dia, gasto) => ({
  campanha, campanha_id: `M-${campanha}`, dia, gasto,
  resultados: 5, impressoes: 1000, alcance: 800, estado: 'Ativa',
});
let cod = 0;
const msg = (protocolo, quando, titulo, mensagem, extra = {}) => ({
  cod: (cod += 1), protocolo, data_acesso: quando, titulo, tipo: 'ad',
  contato: 'Cliente', telefone: '5551999', classificacao: null, mensagem, ...extra,
});
const trecho = (codigo, protocolo, classificacao, atendente = 'ANA') => ({
  codigo, protocolo, classificacao, atendente, servico: 'VENDAS', ativo_receptivo: 'Receptivo',
  cpf: '', data_entrada: '2026-09-10 10:00:00', data_atendimento: '2026-09-10 10:05:00',
  data_finalizacao: '2026-09-10 10:30:00',
});

/**
 * Cenário de setembro em miniatura:
 *  - A: duas mensagens, dois trechos no Matrix, vendeu no PRIMEIRO trecho;
 *  - B: protocolo com zero à esquerda (o bigint do Matrix perde o zero);
 *  - C: só falou com o robô — não existe no Matrix;
 *  - D: mandou "Oi" num anúncio sem cidade no título, e é de julho.
 */
function montar() {
  setFonteCampanhas('google', [diaGoogle('RP - Felicidade Ilimitada - Canoas', '2026-09-10', '1.000,00')]);
  setFonteCampanhas('meta', [
    diaMeta('[Vendas][Engajamento][WPP][Todas Cidades]', '2026-09-10', 900),
    diaMeta('[W] [CP-04] [ENG] [WHATSAPP] [VAGAS] [CIDADES] [01-05-2026]', '2026-09-10', 5000),
  ]);
  setFonteCampanhas('rastreamento', [
    msg('1111000005430001', '2026-09-10 10:00:00', 'Canoas: contrate agora!', 'Gostaria de saber mais'),
    msg('1111000005430001', '2026-09-10 10:02:00', 'Canoas: contrate agora!', 'Rua tal, 50'),
    msg('0924000005436812', '2026-09-11 09:00:00', '? Quero falar no WhatsApp!', 'Olá! Gostaria de falar com um atendente sobre os planos de Cachoeirinha.'),
    msg('5555000005430003', '2026-09-12 23:00:00', 'Contrate agora!', 'Vi seu anúncio em Esteio, quero saber mais!',
      { classificacao: 'STATUS ATENDIMENTO (0800) VENDAS - FORA DE COBERTURA' }),
    msg('7777000005430004', '2026-07-05 08:00:00', 'Contrate agora!', 'Oi', { tipo: 'post' }),
  ]);
  setFonteCampanhas('matrix', [
    trecho(10, '1111000005430001', 'VENDA CONCLUÍDA', 'ANA'),
    trecho(11, '1111000005430001', 'null', 'BRUNO'),
    trecho(20, '924000005436812', 'FALTA DE CONTATO (SEM RETORNO CLIENTE)', 'CARLA'),
    trecho(40, '7777000005430004', null, null),
  ]);
  setFonteCampanhas('lotes', [{ id: 3, arquivo: 'set.csv', linhas: 5, periodo_de: '2026-07-05', periodo_ate: '2026-09-12' }]);
  return construirCampanhas();
}

beforeEach(() => montar());

const lead = (estado, protocolo) => estado.atendimentos.find((a) => a.protocolo === protocolo);

test('o lead é o PROTOCOLO, não a mensagem: duas mensagens são um lead só', () => {
  const s = montar();
  assert.equal(s.atendimentos.length, 4);
  const a = lead(s, '1111000005430001');
  assert.equal(a.mensagens, 2);
  assert.equal(a.mensagem, 'Gostaria de saber mais', 'quem define o lead é a primeira mensagem');
});

test('venda em QUALQUER trecho do Matrix conta, e o atendente vem do último', () => {
  const a = lead(montar(), '1111000005430001');
  assert.equal(a.classificacao, VENDA, 'a venda estava no primeiro trecho e o último veio sem classificação');
  assert.ok(a.venda);
  assert.equal(a.atendente, 'BRUNO');
  assert.equal(a.trechos, 2);
});

test('o protocolo com zero à esquerda casa com o bigint do Matrix, e mantém o zero na tela', () => {
  const a = lead(montar(), '0924000005436812');
  assert.ok(a.noMatrix, 'o db_matrix grava 924000005436812, sem o zero');
  assert.ok(a.abandono);
  assert.equal(a.cidade, 'CACHOEIRINHA', 'sem cidade no título, vale a cidade da mensagem');
});

test('quem não existe no Matrix vira "não chegou a atendente", ou a classificação do CSV', () => {
  const s = montar();
  const robo = lead(s, '5555000005430003');
  assert.equal(robo.noMatrix, false);
  assert.equal(robo.classificacao, 'FORA DE COBERTURA', 'o prefixo da árvore do CSV sai');
  assert.equal(robo.atendente, SEM_ATENDENTE);

  const s2 = montarLeads([msg('9', '2026-09-01 10:00:00', 'Contrate agora!', 'Oi')], []);
  assert.equal(s2[0].classificacao, SEM_ATENDENTE);
});

test('a classificação do CSV e a do Matrix caem na mesma forma', () => {
  assert.equal(classificacaoDe('STATUS ATENDIMENTO (0800) VENDAS - VENDA CONCLUÍDA'), VENDA);
  assert.equal(classificacaoDe('VENDA CONCLUÍDA'), VENDA);
  assert.equal(classificacaoDe('null'), null);
  assert.equal(classificacaoDe(''), null);
});

test('o emoji perdido no começo do título não cria um segundo anúncio', () => {
  assert.equal(tituloDe('? Quero falar no WhatsApp!'), 'Quero falar no WhatsApp!');
  assert.equal(tituloDe('👉 Quero falar no WhatsApp! '), 'Quero falar no WhatsApp!');
  assert.equal(tituloDe(''), '(sem título)');
});

test('o custo por lead usa só o gasto do Meta, e recrutamento fica fora por padrão', () => {
  montar();
  const g = painelCampanhasVisaoGeral(parseFiltrosCampanhas({ cde: '2026-09-01', cate: '2026-09-30' }));
  assert.equal(g.kpis.leads, 3);
  assert.equal(g.kpis.investimentoMeta, 900, 'os R$ 5.000 de vaga de emprego não entram');
  assert.equal(g.kpis.investimentoGoogle, 1000);
  assert.equal(g.kpis.custoPorLead, 300, 'o lead do rastreamento é do Meta: 900 ÷ 3, sem o Google');

  const comVagas = painelCampanhasVisaoGeral(parseFiltrosCampanhas({ cde: '2026-09-01', cate: '2026-09-30', crec: '1' }));
  assert.equal(comVagas.kpis.investimentoMeta, 5900);
});

test('o custo por lead não divide gasto de mês sem rastreamento importado', () => {
  setFonteCampanhas('meta', [
    diaMeta('[Vendas][Engajamento][WPP][Todas Cidades]', '2026-09-10', 900),
    // março: antes do primeiro lead importado (05/07) — não pode entrar na divisão
    diaMeta('[Vendas][Engajamento][WPP][Todas Cidades]', '2026-03-10', 99000),
  ]);
  construirCampanhas();
  const g = painelCampanhasVisaoGeral(parseFiltrosCampanhas({}));
  assert.equal(g.kpis.investimentoMeta, 99900, 'o cartão de investimento continua inteiro');
  assert.equal(g.kpis.investimentoMetaCoberto, 900);
  assert.equal(g.kpis.custoPorLead, 225, '900 ÷ 4 leads, e não 99.900 ÷ 4');
});

test('o período recorta a entrada do lead', () => {
  montar();
  const jul = painelCampanhasAtendimentos(parseFiltrosCampanhas({ cde: '2026-07-01', cate: '2026-07-31' }));
  assert.equal(jul.kpis.leads, 1);
  assert.equal(jul.detalhe[0].tipo, 'Post impulsionado');
});

test('o filtro de tipo de campanha recorta o investimento, mas não o lead', () => {
  montar();
  const flt = parseFiltrosCampanhas({ cde: '2026-09-01', cate: '2026-09-30', cfam: 'alcance' });
  const g = painelCampanhasVisaoGeral(flt);
  assert.equal(g.kpis.investimentoMeta, 0);
  assert.equal(g.kpis.leads, 3, 'o rastreamento não diz a campanha; recortar fingiria uma atribuição');
});

test('anúncio, cidade e tipo filtram o lead', () => {
  montar();
  const p = (q) => painelCampanhasAtendimentos(parseFiltrosCampanhas(q)).kpis.leads;
  assert.equal(p({ canun: 'Contrate agora!' }), 2);
  assert.equal(p({ ccid: 'CANOAS' }), 1);
  assert.equal(p({ ctipo: 'Post impulsionado' }), 1);
});

test('os leads por anúncio somam o total, e mostram quem não chegou a atendente', () => {
  montar();
  const a = painelCampanhasAtendimentos(parseFiltrosCampanhas({}));
  assert.equal(a.porAnuncio.reduce((s, r) => s + r.leads, 0), a.kpis.leads);
  const contrate = a.porAnuncio.find((r) => r.key === 'Contrate agora!');
  assert.equal(contrate.semAtendente, 1);
  assert.equal(a.kpis.semAtendente, 1);
});

test('a página do Google não recebe lead: o rastreamento só registra anúncio do Meta', () => {
  montar();
  const g = painelCampanhasPlataforma('google', parseFiltrosCampanhas({}));
  assert.equal(g.kpis.investimento, 1000);
  assert.equal(g.kpis.leads, 0);
  const m = painelCampanhasPlataforma('meta', parseFiltrosCampanhas({}));
  assert.equal(m.kpis.leads, 4);
});

test('o frescor diz até quando vai o rastreamento e qual foi a última importação', () => {
  montar();
  const g = painelCampanhasVisaoGeral(parseFiltrosCampanhas({}));
  assert.equal(g.frescor.rastreamento, '2026-09-12');
  assert.equal(g.frescor.rastreamentoDe, '2026-07-05');
  assert.equal(g.frescor.ultimaImportacao.arquivo, 'set.csv');
});

test('sem nenhuma importação a tela abre vazia, em vez de ficar carregando', () => {
  setFonteCampanhas('rastreamento', []);
  setFonteCampanhas('matrix', []);
  setFonteCampanhas('lotes', []);
  const s = construirCampanhas();
  assert.equal(s.atendimentos.length, 0);
  const g = painelCampanhasVisaoGeral(parseFiltrosCampanhas({}));
  assert.equal(g.kpis.leads, 0);
  assert.equal(g.kpis.custoPorLead, 0);
  assert.equal(g.frescor.ultimaImportacao, null);
});
