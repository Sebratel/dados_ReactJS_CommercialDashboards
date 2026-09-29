/**
 * CAMPANHAS — o funil e o rateio do investimento.
 *
 * O risco desta tela não é errar uma conta: é somar a mesma campanha em várias
 * linhas e mostrar um investimento maior do que o que foi gasto. Uma tag casa com
 * várias campanhas e uma campanha é alcançada por vários grupos, então o total só
 * fecha se o rateio conservar. É isso que se segura aqui.
 */
import assert from 'node:assert/strict';
import test, { beforeEach } from 'node:test';

process.env.AUTH_ENABLED = 'false';

const {
  construirCampanhas, parseFiltrosCampanhas, setFonteCampanhas,
} = await import('../src/model/campanhas.js');
const {
  funil, painelCampanhasAtendimentos, painelCampanhasPlataforma, painelCampanhasVisaoGeral,
} = await import('../src/model/paineis-campanhas.js');

const diaGoogle = (campanha, dia, custo, cliques = 10) => ({
  campanha, campanha_id: `G-${campanha}`, dia, custo_txt: custo,
  cliques, impressoes: 100, conversoes_txt: '1', estado: 'Ativa',
});
const diaMeta = (campanha, dia, gasto, resultados = 5) => ({
  campanha, campanha_id: `M-${campanha}`, dia, gasto,
  resultados, impressoes: 1000, alcance: 800, estado: 'Ativa',
});
const atendimento = (codigo, entrada, tags, classificacao = null) => ({
  codigo, protocolo: `P${codigo}`, data_entrada: `${entrada} 10:00:00`,
  data_atendimento: `${entrada} 10:05:00`, data_finalizacao: `${entrada} 10:30:00`,
  classificacao, canal: 'Whatsapp', ativo_receptivo: 'Receptivo',
  atendente: 'ANA', contato: 'Cliente', num_telefone: '5551999', cpf: '', tags,
});

/**
 * Cenário: a campanha comercial do Meta cobre as seis cidades (uma campanha só), e
 * o Google roda uma por cidade. Os atendimentos são tagueados dos dois jeitos —
 * com cidade e sem — que é exatamente o que a base real tem.
 */
function montar() {
  setFonteCampanhas('google', [
    diaGoogle('RP - Felicidade Ilimitada - Canoas', '2026-03-10', '1.000,00'),
    diaGoogle('RP - Felicidade Ilimitada - Canoas', '2026-03-11', '500,50'),
  ]);
  setFonteCampanhas('meta', [
    diaMeta('[W] [CP-02] [ENG] [WHATSAPP] [COMERCIAL] [01-05-2026]', '2026-06-01', 800),
    diaMeta('[W] [CP-04] [ENG] [WHATSAPP] [VAGAS] [CIDADES] [01-05-2026]', '2026-06-01', 5000),
  ]);
  setFonteCampanhas('matrix', [
    // era antiga: a tag não diz plataforma, só cidade
    atendimento(1, '2026-03-10', 'marketing_campanha_macro_canoas', 'VENDA CONCLUÍDA'),
    atendimento(2, '2026-03-11', '"marketing_campanha_macro_canoas"'),
    // era nova: com e sem cidade, as duas para a mesma campanha comercial
    atendimento(3, '2026-06-01', 'marketing_comercial_meta', 'VENDA CONCLUÍDA'),
    atendimento(4, '2026-06-02', 'marketing_comercial_meta_canoas'),
    atendimento(5, '2026-06-03', 'marketing_comercial_meta_canoas,ISA_VENDAS_RECEPTIVAS',
      'FALTA DE CONTATO (SEM RETORNO CLIENTE)'),
    // orgânico: existe atendimento e não existe anúncio atrás
    atendimento(6, '2026-06-04', 'marketing_site_organico_planos', 'VENDA CONCLUÍDA'),
  ]);
  construirCampanhas();
}

beforeEach(montar);
const tudo = () => parseFiltrosCampanhas({});

test('o investimento da tela não estoura o que foi gasto de verdade', () => {
  const p = painelCampanhasVisaoGeral(tudo());
  // 1.000,50 + 500,00 do Google + 800 do Meta comercial. Vagas fica de fora.
  assert.equal(Number(p.kpis.investimento.toFixed(2)), 2300.5);
  assert.equal(
    Number(p.kpis.investimentoGoogle.toFixed(2)), 1500.5,
    'o custo do Google é texto em português; 1.000,00 tem de virar mil, não um',
  );
});

test('o rateio conserva: a soma das linhas do funil nunca passa do total', () => {
  const p = painelCampanhasVisaoGeral(tudo());
  const somaLinhas = p.funil.reduce((a, l) => a + l.investimento, 0);
  const semAtend = p.semAtendimento.reduce((a, c) => a + c.investimento, 0);
  assert.ok(
    somaLinhas <= p.kpis.investimento + 0.01,
    `funil soma ${somaLinhas} contra total ${p.kpis.investimento} — campanha contada em dois grupos`,
  );
  assert.equal(
    Number((somaLinhas + semAtend).toFixed(2)), Number(p.kpis.investimento.toFixed(2)),
    'o que não entrou no funil tem de aparecer como campanha sem atendimento, e não sumir',
  );
});

test('a tag com cidade e a sem cidade caem no MESMO grupo, sem duplicar a campanha', () => {
  const f = funil(tudo());
  const comercial = f.linhas.find((l) => l.chave === 'meta|comercial');
  assert.equal(comercial.atendimentos, 3, 'os três atendimentos comerciais, com e sem cidade');
  assert.equal(
    Number(comercial.investimento.toFixed(2)), 800,
    'a campanha comercial é uma só; contada por grupo, não por variação de tag',
  );
});

test('o atendimento da era macro encontra a campanha pela cidade, e a tela diz isso', () => {
  const f = funil(tudo());
  const macro = f.linhas.find((l) => l.chave === '?|macro');
  assert.equal(macro.atendimentos, 2);
  assert.equal(
    macro.confianca, 'cidade',
    'é o degrau mais frouxo do cruzamento; a linha precisa carregar o aviso',
  );
  assert.equal(Number(macro.investimento.toFixed(2)), 1500.5);
});

test('recrutamento fica fora da conta por padrão, e some do funil', () => {
  const sem = painelCampanhasVisaoGeral(tudo());
  const com = painelCampanhasVisaoGeral(parseFiltrosCampanhas({ crec: '1' }));
  assert.equal(Number(com.kpis.investimento.toFixed(2)), 7300.5);
  assert.equal(
    Number((com.kpis.investimento - sem.kpis.investimento).toFixed(2)), 5000,
    'vaga de emprego dentro do custo por lead comercial foi o que inflou o relatório de origem',
  );
  assert.ok(!sem.funil.some((l) => l.recrutamento));
});

test('o orgânico aparece com atendimento e investimento zero, em vez de sumir', () => {
  const f = funil(tudo());
  const site = f.linhas.find((l) => l.chave === 'site|site_organico');
  assert.ok(site, 'é 1/3 dos atendimentos tagueados da base real');
  assert.equal(site.investimento, 0);
  assert.equal(site.ligada, false, 'não há anúncio atrás — e é isso que o torna interessante');
});

test('campanha que gastou e não gerou atendimento tagueado é mostrada, não descartada', () => {
  setFonteCampanhas('google', [diaGoogle('RP - Felicidade Ilimitada - Esteio', '2026-03-10', '999,00')]);
  setFonteCampanhas('meta', []);
  setFonteCampanhas('matrix', [atendimento(1, '2026-03-10', 'marketing_site_organico_planos')]);
  construirCampanhas();
  const p = painelCampanhasVisaoGeral(tudo());
  assert.equal(p.semAtendimento.length, 1);
  assert.equal(Number(p.semAtendimento[0].investimento.toFixed(2)), 999);
});

test('o período recorta o dia do anúncio e a entrada do atendimento', () => {
  const p = painelCampanhasVisaoGeral(parseFiltrosCampanhas({ cde: '2026-06-01', cate: '2026-06-30' }));
  assert.equal(Number(p.kpis.investimento.toFixed(2)), 800, 'o Google rodou em março');
  assert.equal(p.kpis.atendimentos, 4);
});

test('o frescor diz até quando cada fonte tem dado', () => {
  const p = painelCampanhasVisaoGeral(tudo());
  assert.deepEqual(p.frescor, { google: '2026-03-11', meta: '2026-06-01', matrix: '2026-06-04' });
});

test('classificação vazia vira uma categoria só, e não três', () => {
  const p = painelCampanhasAtendimentos(tudo());
  const semClass = p.porClassificacao.filter((c) => /sem classifica/i.test(c.key));
  assert.equal(
    semClass.length, 1,
    'a base grava NULL, a string "null" e a string vazia — três fatias para a mesma coisa',
  );
  assert.equal(semClass[0].valor, 2);
});

test('a página de uma plataforma só mostra o investimento dela', () => {
  const g = painelCampanhasPlataforma('google', tudo());
  assert.equal(Number(g.kpis.investimento.toFixed(2)), 1500.5);
  assert.equal(g.kpis.campanhas, 1);
  const m = painelCampanhasPlataforma('meta', tudo());
  assert.equal(Number(m.kpis.investimento.toFixed(2)), 800, 'vagas fora por padrão');
});
