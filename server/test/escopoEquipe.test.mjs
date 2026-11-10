/**
 * ESCOPO DE EQUIPE nas telas que não leem o `equipe` da query comercial.
 *
 * Pedido do IC (Escopo "Fixação de times", 21/10/2026): supervisor e coordenador
 * enxergam só as próprias equipes em TODAS as telas comerciais, inclusive Relatórios
 * Comercial e SLA BKO — nos totais, filtros, detalhes, exportações e leitura por IA.
 * As telas comerciais clássicas já recortavam (o middleware reescreve `equipe`); estas
 * duas não, porque têm campo de equipe próprio (Relatórios) ou nenhum (SLA).
 *
 * Quem não tem escopo continua vendo tudo (decisão do IC, 10/11/2026).
 */
import assert from 'node:assert/strict';
import test from 'node:test';

process.env.AUTH_ENABLED = 'false';
process.env.DB_VOALLE_HOST = 'inexistente';
process.env.DB_VOALLE_DATABASE = 'inexistente';
process.env.DB_MARIA_HOST = 'inexistente';
process.env.UMOV_AJUSTE_HORAS = '0';

const { build, setSource } = await import('../src/model/store.js');
const { EQUIPE_INEXISTENTE, equipesNoEscopo } = await import('../src/model/measures.js');
const rel = await import('../src/model/relatorios.js');
const { CONJUNTOS, filtrosDoConjunto, gerarCSV } = await import('../src/model/exportar.js');
const { recortarVisual } = await import('../src/ia/visuais.js');
const sla = await import('../src/model/slaBko.js');

const A = 'EQUIPE A';
const B = 'EQUIPE B';

test('o cruzamento pedido × permitido segue a regra do middleware', () => {
  assert.deepEqual(equipesNoEscopo([], null), [], 'sem escopo e sem pedido: todas');
  assert.deepEqual(equipesNoEscopo([B], null), [B], 'sem escopo: o pedido');
  assert.deepEqual(equipesNoEscopo([], [A]), [A], 'com escopo e sem pedido: as permitidas');
  assert.deepEqual(equipesNoEscopo([A, B], [A]), [A], 'pedido parcialmente fora: só o que pode');
  assert.deepEqual(
    equipesNoEscopo([B], [A]), [EQUIPE_INEXISTENTE],
    'pedido todo fora: vazio — nunca "tudo o que pode"',
  );
});

// ------------------------------------------------------------ Relatórios
const contrato = (n, vendedor, dia) => ({
  clientes: `CLIENTE ${n}`, contrato: String(n), protocolo: String(70000 + n), cidade: 'CANOAS',
  bairro: 'CENTRO', vendedor, regiao_vendedor: 'CAPITAL', status_contrato: 'Normal',
  status_cancelamento: null, data_cancelado: null, canal: 'PAP', tecnologia: 'FIBRA',
  tipo_solicitacao: 'Instalacao', tem_tipo_padrao: true, valor: 100,
  data_criacao_contrato: dia, hora_criacao: '10:00', cadastro_cliente: dia, created_key: `K-${n}`,
});

function montarComercial() {
  const linhas = [
    contrato(1, 'ANA VENDEDORA', '2026-10-05'),
    contrato(2, 'ANA VENDEDORA', '2026-10-06'),
    contrato(3, 'BETO VENDEDOR', '2026-10-07'),
  ];
  setSource('base', linhas);
  for (const n of ['aloc', 'phone', 'pagto', 'sellers', 'senior']) setSource(n, []);
  setSource('teams', [
    { vendedores: 'ANA VENDEDORA', equipes: A, situacao: 'Externo', ativo: 'TRUE' },
    { vendedores: 'BETO VENDEDOR', equipes: B, situacao: 'Externo', ativo: 'TRUE' },
  ]);
  build();
  rel.setFonteRelatorios('cesta', linhas.map((l) => ({
    contrato: l.contrato, tipo_contrato: 'Residencial', valor_plano: 100, status_contrato: 'Normal',
    etiqueta: 'INTERNET', servico_principal: 'FIBRA', codigo_servico_principal: 'F', unidades: 1,
    valor: 100, adicionado_em: l.data_criacao_contrato, situacao_item: 'Ativo',
  })));
  rel.setFonteRelatorios('backlog', linhas.map((l) => ({
    protocolo: l.protocolo, tipo_id: 1, tipo_protocolo: 'Instalação', equipe: 'CAMPO',
    cidade: 'CANOAS', status: 'Aberto', criado: l.data_criacao_contrato, no_detalhe: true,
  })));
  for (const n of ['cancelamento', 'base', 'ponte']) rel.setFonteRelatorios(n, []);
  rel.construirRelatorios();
}

const contratos = (p) => p.contratos.amostra.map((l) => l.contrato).sort();

test('Relatórios › Geral: com escopo, só os contratos, a cesta e a fila das equipes da pessoa', () => {
  montarComercial();
  const todos = rel.painelGeral(rel.parseFiltrosGeral({}));
  assert.deepEqual(contratos(todos), ['1', '2', '3'], 'sem escopo continua vendo tudo');

  const soA = rel.painelGeral(rel.parseFiltrosGeral({}, [A]));
  assert.deepEqual(contratos(soA), ['1', '2']);
  assert.equal(soA.cartoes.contratos, 2, 'o cartão é o total do recorte, não da base');
  assert.equal(soA.cesta.total, 2, 'a cesta segue os contratos do escopo');
  assert.equal(soA.fila.total, 2, 'a fila também');

  const pedindoB = rel.painelGeral(rel.parseFiltrosGeral({ requipe: B }, [A]));
  assert.equal(pedindoB.cartoes.contratos, 0, 'pedir a equipe do colega devolve vazio, não a própria');
});

test('Relatórios: Resumo, Quadro de equipes e Diário recortam igual', () => {
  montarComercial();
  const q = { vde: '2026-10-01', vate: '2026-10-31' };
  assert.equal(rel.painelResumo(rel.parseFiltrosResumo(q, [A])).cartoes.contratos, 2);
  assert.equal(rel.painelResumo(rel.parseFiltrosResumo(q)).cartoes.contratos, 3);

  const quadro = rel.painelEquipes(rel.parseFiltrosEquipes({ qde: '2026-10-01', qate: '2026-10-31' }, [A]));
  assert.deepEqual(quadro.linhas.map((l) => l.vendedor), ['ANA VENDEDORA'], 'o colega não aparece na tabela');

  const diario = rel.parseFiltrosDiario({ dequipe: B }, [A]);
  assert.deepEqual(diario.equipes, [EQUIPE_INEXISTENTE]);
});

test('Relatórios: os seletores só oferecem as equipes e os vendedores do escopo', () => {
  montarComercial();
  const f = rel.filtrosGeral([A]);
  assert.deepEqual(f.equipes, [A]);
  assert.deepEqual(f.vendedores, ['ANA VENDEDORA'], 'o nome do colega não vaza pela lista');
  assert.deepEqual(rel.filtrosEquipes([A]).vendedores, ['ANA VENDEDORA']);
  assert.deepEqual(rel.filtrosDiario([A]).equipes, [A]);
  assert.deepEqual(rel.filtrosGeral().equipes, [A, B], 'sem escopo: todas');
});

test('Relatórios: o CSV e a leitura por IA não veem mais que a tela', () => {
  montarComercial();
  const conj = CONJUNTOS['relatorios-contratos'];
  assert.equal(gerarCSV('relatorios-contratos', filtrosDoConjunto(conj, {}, [A])).linhas, 2);
  assert.equal(gerarCSV('relatorios-contratos', filtrosDoConjunto(conj, {})).linhas, 3);

  const ia = recortarVisual('relatorios:equipes', { qde: '2026-10-01', qate: '2026-10-31' }, [A]);
  assert.deepEqual(ia.dados.vendedores.map((l) => l.vendedor), ['ANA VENDEDORA']);
});

// --------------------------------------------------------------- SLA BKO
const AGORA = '2026-10-20 18:00:00';
const PERIODO = { de: '2026-10-01', ate: '2026-10-31' };

function montarSla() {
  montarComercial(); // a equipe do vendedor vem da Comercial_Teams
  sla._reiniciarSla();
  sla.setFonteSla('ciclos', []);
  sla.setFonteSla('tarefas', [
    // grafia do uMov: caixa e acento diferentes do cadastro
    { id_tarefa: 1, ultimo_envio: '2026-10-19 09:00:00', vendedor: 'Ana Vendedora', cpf_cnpj: '11111111111', nome_cliente: 'C1' },
    { id_tarefa: 2, ultimo_envio: '2026-10-19 10:00:00', vendedor: 'Beto Vendedor', cpf_cnpj: '22222222222', nome_cliente: 'C2' },
    { id_tarefa: 3, ultimo_envio: '2026-10-19 11:00:00', vendedor: 'Carlos Fantasma', cpf_cnpj: '33333333333', nome_cliente: 'C3' },
  ]);
  sla.setFonteSla('vendas', [
    { protocolo: 'P1', contrato: 'C1', canal: 'Loja', vendedor: 'ána  vendedora', criado_em: '2026-10-15 09:00:00', agendamento_em: '2026-10-15 15:00:00', atendente_agendamento: 'ATENDENTE DA ANA' },
    { protocolo: 'P2', contrato: 'C2', canal: 'Loja', vendedor: 'BETO VENDEDOR', criado_em: '2026-10-15 09:00:00', agendamento_em: '2026-10-15 15:00:00', atendente_agendamento: 'ATENDENTE DO BETO' },
    { protocolo: 'P3', contrato: 'C3', canal: 'Loja', vendedor: 'ANA VENDEDORA', criado_em: '2026-10-19 09:00:00', status_protocolo: 'Em andamento' },
    { protocolo: 'P4', contrato: 'C4', canal: 'Loja', vendedor: 'BETO VENDEDOR', criado_em: '2026-10-19 09:00:00', status_protocolo: 'Em andamento' },
    { protocolo: 'P5', contrato: 'C5', canal: 'Loja', vendedor: 'Carlos Fantasma', criado_em: '2026-10-19 09:00:00', status_protocolo: 'Em andamento' },
  ]);
  sla.construirSla();
}

test('SLA BKO: o vendedor casa com o cadastro sem caixa, acento nem espaço duplo', () => {
  montarSla();
  assert.equal(sla.equipeDoVendedor('ána  vendedora'), A);
  assert.equal(sla.equipeDoVendedor('Beto Vendedor'), B);
  assert.equal(sla.equipeDoVendedor('Carlos Fantasma'), '', 'fora do cadastro: sem equipe');
});

test('SLA BKO: com escopo, só o que veio dos vendedores da equipe — rankings inclusive', () => {
  montarSla();
  const todos = sla.painelSlaBko(sla.parseFiltrosSla(PERIODO), AGORA);
  const soA = sla.painelSlaBko(sla.parseFiltrosSla(PERIODO, [A]), AGORA);

  assert.equal(todos.agendamento.vendas, 5);
  assert.equal(soA.agendamento.vendas, 2, 'P1 e P3, as duas da Ana');
  assert.deepEqual(
    soA.agendamento.porAtendente.map((l) => l.nome), ['ATENDENTE DA ANA'],
    'o ranking de atendentes conta só as vendas da equipe (decisão do IC)',
  );
  assert.deepEqual(soA.fila.elleven.map((l) => l.protocolo), ['P3']);
  assert.deepEqual(soA.fila.umov.map((l) => l.vendedor), ['Ana Vendedora']);
  assert.deepEqual(soA.cadastro.pendentes.lista.map((l) => l.vendedor), ['Ana Vendedora']);
  assert.equal(soA.cadastro.pendentes.total, 1, 'os totais do card fecham com a lista recortada');
  assert.equal(soA.triagem.porVendedor.length, 1);

  // vendedor fora do cadastro não aparece para quem tem escopo, e a tela diz quantos são
  assert.ok(!soA.fila.elleven.some((l) => l.protocolo === 'P5'));
  assert.deepEqual(todos.qualidade.vendedoresSemEquipe, { vendedores: 1, vendas: 1 });
});

test('SLA BKO: detalhamento e CSVs seguem o mesmo recorte', () => {
  montarSla();
  const det = sla.detalheSlaBko(sla.parseFiltrosDetalhe(PERIODO, [A]), AGORA);
  assert.deepEqual(det.todas.map((l) => l.protocolo).sort(), ['P1', 'P3']);
  assert.equal(sla.detalheSlaBko(sla.parseFiltrosDetalhe(PERIODO), AGORA).total, 5);

  const conj = CONJUNTOS['sla-bko-fila-elleven'];
  const flt = filtrosDoConjunto(conj, PERIODO, [A]);
  assert.deepEqual(flt.equipes, [A], 'o arquivo recebe o escopo de quem baixa');
  assert.deepEqual(filtrosDoConjunto(conj, PERIODO).equipes, null, 'sem escopo: sem recorte');
});
