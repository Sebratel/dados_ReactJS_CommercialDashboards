/**
 * EXPORTAÇÃO DE TABELA COM AMOSTRA — o CSV leva TODAS as linhas do filtro.
 *
 * A reclamação que originou estes testes (10/11/2026): uma tabela com mais de 1.300
 * linhas exportava um arquivo com 400. A tabela de contratos dos Relatórios Comercial
 * mostra só as 400 mais recentes (o DOM não aguenta 100 mil linhas), e o botão de
 * exportar montava o CSV no navegador a partir dessa amostra — enquanto o subtítulo
 * prometia "o CSV traz tudo". O mesmo valia para cesta, fila, pesquisas, leads de
 * campanha, condomínios, produtividade e planos.
 *
 * O que se segura aqui:
 *   1. o arquivo tem o total do filtro, não o tamanho da amostra;
 *   2. o arquivo respeita os filtros da tela (nem mais, nem menos linhas que ela conta);
 *   3. esses conjuntos não aparecem na tela de Exportações, que não tem os filtros deles.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

process.env.AUTH_ENABLED = 'false';
process.env.DB_VOALLE_HOST = 'inexistente';
process.env.DB_VOALLE_DATABASE = 'inexistente';
process.env.DB_MARIA_HOST = 'inexistente';
process.env.UMOV_AJUSTE_HORAS = '0';

const { build, setSource } = await import('../src/model/store.js');
const {
  construirRelatorios, painelGeral, painelPesquisa, parseFiltrosGeral, parseFiltrosPesquisa,
  setFonteRelatorios,
} = await import('../src/model/relatorios.js');
const {
  CONJUNTOS, conjuntoPronto, filtrosDoConjunto, gerarCSV, listarConjuntos,
} = await import('../src/model/exportar.js');
const {
  _reiniciarSla, construirSla, painelSlaBko, parseFiltrosSla, setFonteSla,
} = await import('../src/model/slaBko.js');

const EM_CANOAS = 1300;
const EM_ESTEIO = 250;

/** Contrato do Voalle no formato da consulta `base`. */
const contrato = (n, cidade, dia) => ({
  clientes: `CLIENTE ${n}`,
  contrato: String(n),
  protocolo: String(50000 + n),
  cidade,
  bairro: 'CENTRO',
  vendedor: 'ANA VENDEDORA',
  regiao_vendedor: 'CAPITAL',
  status_contrato: 'Normal',
  status_cancelamento: null,
  data_cancelado: null,
  canal: 'PAP',
  tecnologia: 'FIBRA',
  tipo_solicitacao: 'Instalacao',
  tem_tipo_padrao: true,
  valor: 99.9,
  data_criacao_contrato: dia,
  hora_criacao: '10:20',
  cadastro_cliente: dia,
  created_key: `K-${n}`,
});

/** Dia de outubro/2026 espalhado, para a ordenação por data ter o que ordenar. */
const diaDe = (n) => `2026-10-${String((n % 28) + 1).padStart(2, '0')}`;

function montarCenario() {
  const linhas = [];
  for (let i = 0; i < EM_CANOAS; i += 1) linhas.push(contrato(10000 + i, 'CANOAS', diaDe(i)));
  for (let i = 0; i < EM_ESTEIO; i += 1) linhas.push(contrato(20000 + i, 'ESTEIO', diaDe(i)));
  setSource('base', linhas);
  setSource('aloc', []);
  setSource('phone', []);
  setSource('pagto', []);
  setSource('teams', [{
    vendedores: 'ANA VENDEDORA', equipes: 'EQUIPE A', situacao: 'Interno', ativo: 'TRUE',
  }]);
  setSource('sellers', []);
  setSource('senior', []);
  build();

  // um item de cesta e um protocolo na fila por contrato
  setFonteRelatorios('cesta', linhas.map((l) => ({
    contrato: l.contrato,
    tipo_contrato: 'Residencial',
    valor_plano: 99.9,
    status_contrato: 'Normal',
    etiqueta: 'INTERNET',
    servico_principal: 'FIBRA 500',
    codigo_servico_principal: 'F500',
    unidades: 1,
    valor: 99.9,
    adicionado_em: l.data_criacao_contrato,
    situacao_item: 'Ativo',
  })));
  setFonteRelatorios('backlog', linhas.map((l) => ({
    protocolo: l.protocolo,
    tipo_id: 1,
    tipo_protocolo: 'Instalação',
    equipe: 'EQUIPE A',
    cidade: l.cidade,
    status: 'Aberto',
    criado: l.data_criacao_contrato,
    no_detalhe: true,
  })));
  // uma pesquisa de cancelamento por contrato, com duas perguntas cada
  setFonteRelatorios('cancelamento', linhas.map((l, i) => ({
    protocolo: `P${i}`,
    numero_protocolo: `PESQ-${i}`,
    status: 'Encerrado',
    criado: l.data_criacao_contrato,
    encerrado_por: 'BKO',
    cliente: l.clientes,
    etiqueta: 'CANCELAMENTO',
    contrato: l.contrato,
    data_cancelamento: l.data_criacao_contrato,
    motivo_cancelamento: 'MUDANÇA DE ENDEREÇO',
    cidade: l.cidade,
    rua: 'RUA A',
    numero: '10',
    bairro: 'CENTRO',
    checklist: JSON.stringify([{ order: 1, label: 'Indicaria?', value: '1' }, { order: 2, label: 'Voltaria?', value: '0' }]),
  })));
  setFonteRelatorios('base', []);
  setFonteRelatorios('ponte', []);
  construirRelatorios();
}

/** Linhas de dados de um CSV (sem o BOM, sem o cabeçalho, sem a quebra final). */
const linhasDoCsv = (csv) => csv.replace(/^﻿/, '').split('\r\n').filter(Boolean).slice(1);

/** Exporta pelo mesmo caminho da rota: query da tela → filtros do conjunto → CSV. */
const exportar = (id, query) => gerarCSV(id, filtrosDoConjunto(CONJUNTOS[id], query));

test('contratos: a tabela mostra 400, o CSV leva os 1.300 do filtro', () => {
  montarCenario();
  const cidade = painelGeral(parseFiltrosGeral({})).contratos.amostra.find((l) => /canoas/i.test(l.cidade)).cidade;
  const query = { rcidade: cidade };

  const tela = painelGeral(parseFiltrosGeral(query));
  assert.equal(tela.contratos.total, EM_CANOAS);
  assert.equal(tela.contratos.amostra.length, 400, 'a tela continua mostrando a amostra');

  const { csv, linhas, nome } = exportar('relatorios-contratos', query);
  assert.equal(linhas, EM_CANOAS, 'o arquivo leva o total do filtro, não a amostra');
  const dados = linhasDoCsv(csv);
  assert.equal(dados.length, EM_CANOAS);
  assert.ok(dados.every((l) => l.includes(`;${cidade};`)), 'nenhuma linha de fora do filtro de cidade');
  assert.equal(new Set(dados.map((l) => l.split(';')[2])).size, EM_CANOAS, 'um contrato por linha, sem repetir');
  assert.equal(nome, 'contratos_completo.csv');
});

test('contratos: o período da tela recorta o arquivo e dá nome a ele', () => {
  montarCenario();
  const query = { rde: '2026-10-01', rate: '2026-10-10' };
  const tela = painelGeral(parseFiltrosGeral(query));
  const { linhas, nome } = exportar('relatorios-contratos', query);
  assert.ok(tela.contratos.total > 400 && tela.contratos.total < EM_CANOAS + EM_ESTEIO);
  assert.equal(linhas, tela.contratos.total, 'o arquivo tem exatamente o que a tela conta');
  assert.equal(nome, 'contratos_2026-10-01_a_2026-10-10.csv');
});

test('cesta e fila de instalação também saem inteiras', () => {
  montarCenario();
  const tela = painelGeral(parseFiltrosGeral({}));
  assert.equal(tela.cesta.amostra.length, 400);
  assert.equal(tela.fila.amostra.length, 400);

  assert.equal(exportar('relatorios-cesta', {}).linhas, tela.cesta.total);
  assert.equal(tela.cesta.total, EM_CANOAS + EM_ESTEIO);
  assert.equal(exportar('relatorios-fila', {}).linhas, tela.fila.total);
  assert.equal(tela.fila.total, EM_CANOAS + EM_ESTEIO);
});

test('pesquisas de cancelamento: um protocolo por linha, todos os do filtro', () => {
  montarCenario();
  const tela = painelPesquisa(parseFiltrosPesquisa({}));
  assert.equal(tela.protocolos.amostra.length, 400);
  const { csv, linhas } = exportar('relatorios-pesquisas', {});
  assert.equal(linhas, tela.protocolos.total);
  assert.equal(linhas, EM_CANOAS + EM_ESTEIO, 'as duas perguntas não duplicam o protocolo');
  assert.equal(linhasDoCsv(csv).length, linhas);
});

test('a tela de Exportações não lista os conjuntos que só existem para um botão', () => {
  const ids = listarConjuntos(() => true, {}).map((c) => c.id);
  const soNaTela = Object.entries(CONJUNTOS).filter(([, c]) => c.soNaTela).map(([id]) => id);
  assert.ok(soNaTela.length >= 7);
  for (const id of soNaTela) assert.ok(!ids.includes(id), `${id} não tem os filtros da tela de Exportações`);
  assert.ok(ids.includes('vendas'), 'os conjuntos de sempre continuam lá');
});

test('conjunto cujo modelo não carregou não exporta arquivo vazio', () => {
  assert.equal(conjuntoPronto({ pronto: () => false }), false);
  assert.equal(conjuntoPronto({ pronto: () => true }), true);
  assert.equal(conjuntoPronto({}), true, 'quem não declara depende só da carga comercial');
});

test('desempenho: a primeira coluna e o nome do arquivo seguem o "por" da tela', () => {
  const conj = CONJUNTOS['desempenho-produtividade'];
  const porCidade = filtrosDoConjunto(conj, { por: 'cidade', dlde: '2026-10-01' });
  assert.equal(porCidade.por, 'cidade');
  assert.equal(conj.colunas(porCidade)[0].titulo, 'CIDADE');
  assert.equal(conj.arquivo(porCidade), 'desempenho-por-cidade');
  assert.deepEqual(conj.periodo(porCidade), ['2026-10-01', null]);

  const padrao = filtrosDoConjunto(conj, {});
  assert.equal(padrao.por, 'vendedor', 'sem "por", vendedor — como a rota /desempenho');
  assert.equal(conj.colunas(padrao)[0].titulo, 'VENDEDOR');
});

// ------------------------------------------------------------- SLA BKO
/*
 * A tela do SLA corta rankings em 40/60 nomes, pendentes em 300 e filas em 3.000. O
 * cenário passa de todos os cortes. As datas são relativas a HOJE porque fila e
 * pendentes são retrato do agora (janela de 7 e 30 dias contada a partir do relógio).
 */
const NA_FILA = 3100;
const VENDEDORES = 80;
const ANALISTAS = 50;
const ATENDENTES = 50;

const p2 = (n) => String(n).padStart(2, '0');
/** "aaaa-mm-dd hh:mm:ss" local, `dias` atrás, num horário de expediente. */
function diasAtras(dias, i) {
  const d = new Date();
  d.setDate(d.getDate() - dias);
  return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())} ${p2(9 + (i % 8))}:${p2(i % 60)}:00`;
}
const hoje = () => diasAtras(0, 0).slice(0, 10);
const haUmMes = () => diasAtras(30, 0).slice(0, 10);

function montarSla() {
  _reiniciarSla();
  const tarefas = [];
  // pendentes de análise: entram na fila do uMov e nos pendentes de cadastro
  for (let i = 0; i < NA_FILA; i += 1) {
    tarefas.push({
      id_tarefa: i + 1,
      ultimo_envio: diasAtras(1 + (i % 4), i),
      cpf_cnpj: String(10000000000 + i),
      vendedor: `VENDEDOR ${i % VENDEDORES}`,
      nome_cliente: `CLIENTE ${i}`,
      qtd_envios: 1,
    });
  }
  // analisadas: uma por analista
  for (let i = 0; i < ANALISTAS; i += 1) {
    tarefas.push({
      id_tarefa: 900000 + i,
      ultimo_envio: diasAtras(10, i),
      aprovado_em: diasAtras(9, i),
      analista: `ANALISTA ${i}`,
      cpf_cnpj: String(20000000000 + i),
      vendedor: 'VENDEDOR 0',
      nome_cliente: `APROVADO ${i}`,
    });
  }
  setFonteSla('tarefas', tarefas);
  setFonteSla('ciclos', []);

  const vendas = [];
  // em aberto, sem agendamento: fila do Elleven
  for (let i = 0; i < NA_FILA; i += 1) {
    vendas.push({
      protocolo: `P${i}`, contrato: `C${i}`, cpf_digitos: '', canal: 'Loja',
      criado_em: diasAtras(1 + (i % 4), i), status_protocolo: 'Em andamento', cliente: `CLIENTE ${i}`,
    });
  }
  // agendadas: uma por atendente
  for (let i = 0; i < ATENDENTES; i += 1) {
    vendas.push({
      protocolo: `A${i}`, contrato: `CA${i}`, cpf_digitos: '', canal: 'Loja',
      criado_em: diasAtras(10, i), agendamento_em: diasAtras(9, i),
      atendente_agendamento: `ATENDENTE ${i}`, cliente: `AGENDADO ${i}`,
    });
  }
  setFonteSla('vendas', vendas);
  construirSla();
}

test('SLA BKO: a tela recebe o topo, cada CSV leva todas as linhas', () => {
  montarSla();
  const query = { de: haUmMes(), ate: hoje() };
  const tela = painelSlaBko(parseFiltrosSla(query));

  // o que a tela recebe continua cortado — é o que mantém a página leve
  assert.equal(tela.fila.umov.length, 3000);
  assert.equal(tela.fila.elleven.length, 3000);
  assert.equal(tela.cadastro.pendentes.lista.length, 300);
  assert.equal(tela.triagem.porVendedor.length, 60);
  assert.equal(tela.triagem.porAnalista.length, 40);
  assert.equal(tela.agendamento.porAtendente.length, 40);

  const esperado = {
    'sla-bko-fila-umov': tela.fila.umovTotal,
    'sla-bko-fila-elleven': tela.fila.ellevenTotal,
    'sla-bko-pendentes-cadastro': tela.cadastro.pendentes.total,
    'sla-bko-vendedores': VENDEDORES,
    'sla-bko-analistas': ANALISTAS,
    'sla-bko-atendentes': ATENDENTES,
  };
  assert.equal(tela.fila.umovTotal, NA_FILA);
  assert.equal(tela.fila.ellevenTotal, NA_FILA);
  assert.ok(tela.cadastro.pendentes.total >= NA_FILA);

  for (const [id, total] of Object.entries(esperado)) {
    const { csv, linhas, nome } = exportar(id, query);
    assert.equal(linhas, total, `${id}: o arquivo leva o total, não o corte da tela`);
    assert.equal(linhasDoCsv(csv).length, total, `${id}: uma linha de CSV por linha de dado`);
    assert.ok(nome.startsWith(`${id}_`), nome);
  }
  // fila e pendentes não seguem o período, e o nome do arquivo não finge que seguem
  assert.equal(exportar('sla-bko-fila-umov', query).nome, 'sla-bko-fila-umov_completo.csv');
  assert.equal(exportar('sla-bko-analistas', query).nome, `sla-bko-analistas_${query.de}_a_${query.ate}.csv`);
});

test('SLA BKO: o filtro de canal da tela vale para o arquivo', () => {
  montarSla();
  // "Externo" não tem venda em aberto neste cenário (todas são de loja)
  const query = { de: haUmMes(), ate: hoje(), canal: 'Externo' };
  assert.equal(painelSlaBko(parseFiltrosSla(query)).fila.ellevenTotal, 0);
  assert.equal(exportar('sla-bko-fila-elleven', query).linhas, 0);
  assert.equal(exportar('sla-bko-fila-elleven', { ...query, canal: 'Interno' }).linhas, NA_FILA);
});
