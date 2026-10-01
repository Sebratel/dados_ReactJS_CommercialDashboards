import { test } from 'node:test';

// os testes usam horário de parede, sem o ajuste de fuso do uMov (que por padrão é −3 h)
process.env.UMOV_AJUSTE_HORAS = '0';
import assert from 'node:assert/strict';
import {
  _reiniciarSla, construirSla, escolherCiclo, normalizarCpf, painelSlaBko,
  parseFiltrosSla, setFonteSla, situacaoVenda,
} from '../src/model/slaBko.js';

test('CPF: só dígitos e zeros à esquerda recuperados', () => {
  assert.equal(normalizarCpf('012.345.678-90'), '01234567890');
  assert.equal(normalizarCpf(1234567890), '01234567890');       // número perdeu o zero
  assert.equal(normalizarCpf('12.345.678/0001-95'), '12345678000195');
  assert.equal(normalizarCpf(''), null);
  assert.equal(normalizarCpf(null), null);
});

test('ciclo escolhido é o de primeiro_input mais recente que não passa do cadastro', () => {
  const lista = [
    { id: 'a', primeiroInput: '2026-03-01 10:00:00' },
    { id: 'b', primeiroInput: '2026-09-20 10:00:00' },
    { id: 'c', primeiroInput: '2026-09-25 10:00:00' },
  ];
  assert.equal(escolherCiclo(lista, '2026-09-21 08:00:00').id, 'b');
  assert.equal(escolherCiclo(lista, '2026-02-01 08:00:00'), null);
  assert.equal(escolherCiclo(undefined, '2026-02-01 08:00:00'), null);
});

test('situação: agendamento vence; cancelada e encerrada saem da conta', () => {
  assert.equal(situacaoVenda({ agendamentoEm: 'x', canceladoEm: 'y' }), 'Agendado');
  assert.equal(situacaoVenda({ canceladoEm: 'y' }), 'Cancelado antes de agendar');
  assert.equal(situacaoVenda({ statusProtocolo: 'Cancelado' }), 'Cancelado antes de agendar');
  assert.equal(situacaoVenda({ statusProtocolo: 'Encerrado' }), 'Encerrado sem relato de agendamento');
  assert.equal(situacaoVenda({ statusProtocolo: 'Em andamento' }), 'Em aberto');
});

test('painel ponta a ponta com dados de exemplo', () => {
  _reiniciarSla();
  setFonteSla('ciclos', [
    // cliente externo: enviou 22/09 09:00, BKO aprovou 22/09 10:00
    { id_ciclo: 'c1', cpf_cnpj_norm: '01234567890', nome_cliente: 'X', vendedor_primeiro_envio: 'Ana',
      primeiro_input: '2026-09-22 09:00:00', ultimo_input: '2026-09-22 09:00:00', ultima_analise: '2026-09-22 10:00:00',
      ciclo_concluido: true, houve_retrabalho: false, rodadas: 1, reenvios: 0, devolucoes: 0 },
    // ciclo de teste: sai
    { id_ciclo: 't', cpf_cnpj_norm: '999', nome_cliente: 'T', vendedor_primeiro_envio: 'Vendedor Teste 1',
      primeiro_input: '2026-09-22 09:00:00' },
  ]);
  setFonteSla('tarefas', [
    { id_tarefa: 1.0, data_hora: '2026-09-22 09:00:00', vendedor: 'Ana', aprovado_em: '2026-09-22 10:00:00', analista: 'Bia' },
    { id_tarefa: 2.0, data_hora: '2026-09-22 09:30:00', vendedor: 'Ana', aprovado_em: '2026-09-22 11:30:00', analista: 'Bia', motivo_reprovacao: 'RG ilegível' },
    { id_tarefa: 3.0, data_hora: '2026-09-22 12:00:00', vendedor: 'Vendedor Teste 1' },
  ]);
  setFonteSla('vendas', [
    // externa casada: A1 09:00, A2 10:05, A3 10:30, A4 15:05
    { protocolo: 'P1', contrato: 'C1', cpf_digitos: '1234567890', canal: 'Vendedor Externo',
      criado_em: '2026-09-22 10:05:00', contato_em: '2026-09-22 10:30:00', agendamento_em: '2026-09-22 15:05:00',
      atendente_agendamento: 'Gisele', atendente_contato: 'Gisele' },
    // interna agendada em 14 h úteis: fora do prazo de 12 h
    { protocolo: 'P2', contrato: 'C2', cpf_digitos: '01234567890', canal: 'Loja',
      criado_em: '2026-09-22 08:00:00', agendamento_em: '2026-09-23 09:00:00' },
    // cancelada antes de agendar: não entra na média
    { protocolo: 'P3', contrato: 'C3', cpf_digitos: '', canal: 'Loja',
      criado_em: '2026-09-22 08:00:00', cancelado_em: '2026-09-22 09:00:00' },
  ]);
  construirSla();
  const p = painelSlaBko(parseFiltrosSla({ de: '2026-09-01', ate: '2026-09-30' }), '2026-09-22 18:00:00');

  // agendamento: P1 = 5 h, P2 = 13 + 1 = 14 h → 1 de 2 no prazo
  assert.equal(p.agendamento.n, 2);
  assert.equal(p.agendamento.noPrazo, 1);
  assert.equal(p.agendamento.pctNoPrazo, 0.5);
  assert.equal(p.agendamento.situacoes.find((s) => s.key === 'Cancelado antes de agendar').valor, 1);

  // 1º contato externo desde o envio no uMov: 09:00 → 10:30 = 1,5 h, dentro das 2 h
  assert.equal(p.primeiroContato.externo.n, 1);
  assert.equal(p.primeiroContato.externo.mediana, 1.5);
  assert.equal(p.primeiroContato.externo.pctNoPrazo, null);   // 1º contato não tem mais meta
  // cadastro − input (A2 − A1): 09:00 → 10:05 = 1h05, acima da meta de 1 h
  assert.equal(p.cadastro.n, 1);
  assert.equal(p.cadastro.mediana, 1.08);
  assert.equal(p.cadastro.pctNoPrazo, 0);
  // total interna = agendamento da interna (14 h)
  assert.equal(p.totalInterna.mediana, 14);
  // a venda interna com o MESMO CPF não herda o ciclo do externo
  assert.equal(p.qualidade.externasComCiclo, 1);
  assert.equal(p.qualidade.externas, 1);

  // total externa: 09:00 → 15:05 = 6,08 h
  assert.equal(p.totalExterna.mediana, 6.08);

  // triagem: teste fora; 1 h e 2 h; uma reprovada
  assert.equal(p.triagem.enviadas, 2);
  assert.equal(p.triagem.reprovadas, 1);
  assert.equal(p.triagem.mediana, 1.5);
  assert.equal(p.triagem.motivosReprovacao[0].key, 'RG ilegível');

  assert.equal(p.ciclos.ciclos, 1);
});

test('filtro de canal Interno esvazia as seções do uMov', () => {
  const p = painelSlaBko(parseFiltrosSla({ de: '2026-09-01', ate: '2026-09-30', canal: 'Interno' }), '2026-09-22 18:00:00');
  assert.equal(p.triagem.enviadas, 0);
  assert.equal(p.agendamento.n, 1);
});

test('aprovado_em no formato brasileiro é lido; análise antes do envio sai da conta', async () => {
  const { chaveMotivo } = await import('../src/model/slaBko.js');
  _reiniciarSla();
  setFonteSla('tarefas', [
    { id_tarefa: 1, data_hora: '2026-09-21 19:00:00', vendedor: 'Ana', aprovado_em: '21/09/2026 20:30', analista: 'Bia' },
    { id_tarefa: 2, data_hora: '2026-09-21 21:31:00', vendedor: 'Ana', aprovado_em: '21/09/2026 20:50', analista: 'Bia', motivo_reprovacao: 'x' },
    { id_tarefa: 4, data_hora: '2026-09-21 19:20:00', vendedor: 'Ana' },
  ]);
  setFonteSla('ciclos', []);
  setFonteSla('vendas', []);
  construirSla();
  const p = painelSlaBko(parseFiltrosSla({ de: '2026-09-01', ate: '2026-09-30' }), '2026-09-22 10:00:00');
  assert.equal(p.triagem.enviadas, 3);
  assert.equal(p.triagem.pendentes, 1);
  assert.equal(p.triagem.n, 1);            // a 2ª tem análise antes do envio: fora da conta
  assert.equal(p.triagem.mediana, 1.5);
  assert.equal(p.qualidade.analisesAntesDoEnvio, 1);
  // o teste de fuso: com o envio 3 h mais cedo, a 2ª deixa de estar "antes"
  assert.equal(p.qualidade.fuso.antesDoEnvio, 1);
  assert.equal(p.qualidade.fuso.antesDoEnvioComMenos3h, 0);

  assert.equal(chaveMotivo('DUPLICIDADE'), chaveMotivo('duplicado'));
  assert.equal(chaveMotivo('TESTE'), null);
  assert.equal(chaveMotivo('Comprovante  inválido!'), chaveMotivo('comprovante invalido'));
});

test('detalhamento: uma linha por protocolo, filtros e CSV', async () => {
  const { detalheSlaBko, parseFiltrosDetalhe, detalheParaCsv } = await import('../src/model/slaBko.js');
  _reiniciarSla();
  setFonteSla('tarefas', []);
  setFonteSla('ciclos', [{ id_ciclo: 'c1', cpf_cnpj_norm: '01234567890', nome_cliente: 'X', vendedor_primeiro_envio: 'Ana',
    primeiro_input: '2026-09-22 09:00:00', ultima_analise: '2026-09-22 09:40:00', ciclo_concluido: true }]);
  setFonteSla('vendas', [
    { protocolo: 'P1', contrato: 'C1', cliente: 'João; Silva', cpf_digitos: '01234567890', canal: 'Vendedor Externo',
      criado_em: '2026-09-22 10:05:00', contato_em: '2026-09-22 14:00:00', agendamento_em: '2026-09-22 14:00:00' },
    { protocolo: 'P2', contrato: 'C2', cliente: 'Maria', canal: 'Loja', criado_em: '2026-09-20 08:00:00' },
  ]);
  construirSla();
  const agora = '2026-09-22 18:00:00';
  const d = detalheSlaBko(parseFiltrosDetalhe({ de: '2026-09-01', ate: '2026-09-30' }), agora);
  assert.equal(d.total, 2);
  const p1 = d.linhas.find((l) => l.protocolo === 'P1');
  assert.equal(Math.round(p1.slaTriagem * 60), 40);          // 09:00 → 09:40
  assert.equal(p1.sla1Contato, 5);             // 09:00 → 14:00, fora das 2 h
  assert.equal(Math.round(p1.slaCadastro * 60), 65);         // 09:00 → 10:05
  assert.equal(p1.foraCadastro, true);
  const p2 = d.linhas.find((l) => l.protocolo === 'P2');
  assert.equal(p2.agendamentoEmAberto, true);  // em aberto: tempo até agora
  assert.equal(p2.foraAgendamento, true);
  assert.equal(detalheSlaBko(parseFiltrosDetalhe({ busca: 'maria' }), agora).total, 1);
  assert.equal(detalheSlaBko(parseFiltrosDetalhe({ canal: 'Externo' }), agora).total, 1);
  const csv = detalheParaCsv(d.todas);
  assert.match(csv, /"João; Silva"/);
  assert.match(csv, /22\/09\/2026 10:05/);
  assert.match(csv, /;01:05:00;/);            // SLA cadastro 09:00 → 10:05 em hh:mm:ss
});

test('fuso do uMov: sem a variável, o padrão é 0 (Data Hub já entrega em Brasília)', async () => {
  delete process.env.UMOV_AJUSTE_HORAS;
  try {
    _reiniciarSla();
    setFonteSla('tarefas', [{ id_tarefa: 9, data_hora: '2026-09-21 18:31:00', vendedor: 'Ana', aprovado_em: '21/09/2026 20:50', analista: 'Bia' }]);
    setFonteSla('ciclos', []);
    setFonteSla('vendas', []);
    construirSla();
    const p = painelSlaBko(parseFiltrosSla({ de: '2026-09-01', ate: '2026-09-30' }), '2026-09-22 10:00:00');
    // envio 18:31 (já em Brasília); análise 20:50 → 2h19
    assert.equal(p.triagem.n, 1);
    assert.equal(p.triagem.mediana, 2.32);
    assert.equal(p.qualidade.fuso.ajusteAtualHoras, 0);
  } finally {
    process.env.UMOV_AJUSTE_HORAS = '0';
  }
});

test('ultimo_envio (já em Brasília) é o envio; fila só com pedido com CPF', async () => {
  process.env.UMOV_AJUSTE_HORAS = '-3'; // mesmo com o −3 h ligado, ultimo_envio não é deslocado
  try {
    _reiniciarSla();
    setFonteSla('tarefas', [
      // analisada: envio 18:31 (Brasília), análise 20:50 → 2h19
      { id_tarefa: 1, data_hora: '2026-09-21 21:31:00', ultimo_envio: '2026-09-21 18:31:00', primeiro_envio: '2026-09-21 18:31:00',
        qtd_envios: 1, cpf_cnpj: '010.594.760-10', vendedor: 'Ana', aprovado_em: '21/09/2026 20:50', analista: 'Bia' },
      // pendente com CPF, reenviada: entra na fila pelo último envio
      { id_tarefa: 2, data_hora: '2026-09-22 11:59:00', ultimo_envio: '2026-09-22 08:59:22', primeiro_envio: '2026-09-20 10:00:00',
        qtd_envios: 2, cpf_cnpj: '06129920079', vendedor: 'Ana' },
      // pendente sem CPF (visita): fora da fila
      { id_tarefa: 3, data_hora: '2026-09-22 12:30:00', ultimo_envio: '2026-09-22 09:30:00', vendedor: 'Ana' },
      // sem histórico ainda: cai no data_hora − 3 h
      { id_tarefa: 4, data_hora: '2026-09-22 12:40:00', cpf_cnpj: '12345678901', vendedor: 'Ana' },
    ]);
    setFonteSla('ciclos', []);
    setFonteSla('vendas', []);
    construirSla();
    const p = painelSlaBko(parseFiltrosSla({ de: '2026-09-01', ate: '2026-09-30' }), '2026-09-22 10:00:00');
    assert.equal(p.triagem.n, 1);
    assert.equal(p.triagem.mediana, 2.32);
    assert.deepEqual(p.fila.umov.map((l) => l.idTarefa).sort(), [2, 4]);
    const t2 = p.fila.umov.find((l) => l.idTarefa === 2);
    assert.equal(t2.envio, '2026-09-22 08:59:22');
    assert.equal(t2.qtdEnvios, 2);
    assert.equal(p.fila.umov.find((l) => l.idTarefa === 4).envio, '2026-09-22 09:40:00');
  } finally {
    process.env.UMOV_AJUSTE_HORAS = '0';
  }
});

test('obs. do cruzamento explica externa sem A1, A1 antigo e interna suspeita', async () => {
  const { detalheSlaBko } = await import('../src/model/slaBko.js');
  _reiniciarSla();
  setFonteSla('tarefas', []);
  setFonteSla('ciclos', [
    { id_ciclo: 'a', cpf_cnpj_norm: '11111111111', nome_cliente: 'A', vendedor_primeiro_envio: 'Ana', primeiro_input: '2026-09-25 10:00:00' },
    { id_ciclo: 'b', cpf_cnpj_norm: '22222222222', nome_cliente: 'B', vendedor_primeiro_envio: 'Ana', primeiro_input: '2026-04-16 12:41:00' },
    { id_ciclo: 'c', cpf_cnpj_norm: '33333333333', nome_cliente: 'C', vendedor_primeiro_envio: 'Giovane', primeiro_input: '2026-09-21 09:00:00', ultimo_input: '2026-09-21 09:00:00' },
  ]);
  const base = { canal: 'Vendedor Externo', criado_em: '2026-09-22 10:00:00' };
  setFonteSla('vendas', [
    { ...base, protocolo: 'P1', contrato: '1', cpf_digitos: '' },
    { ...base, protocolo: 'P2', contrato: '2', cpf_digitos: '99999999999' },
    { ...base, protocolo: 'P3', contrato: '3', cpf_digitos: '11111111111' },
    { ...base, protocolo: 'P4', contrato: '4', cpf_digitos: '22222222222' },
    { ...base, protocolo: 'P5', contrato: '5', cpf_digitos: '33333333333', canal: null },
  ]);
  construirSla();
  const d = detalheSlaBko(parseFiltrosSla({ de: '2026-09-01', ate: '2026-09-30' }), '2026-09-22 12:00:00');
  const obs = Object.fromEntries(d.todas.map((l) => [l.protocolo, l.obsCruzamento]));
  assert.equal(obs.P1, 'Sem CPF no Voalle');
  assert.equal(obs.P2, 'CPF não encontrado no uMov');
  assert.equal(obs.P3, 'Envio no uMov só depois do cadastro (25/09/2026 10:00)');
  assert.equal(obs.P4, 'Envio no uMov antigo (16/04/2026 12:41), de outra venda: desconsiderado');
  const p4 = d.todas.find((l) => l.protocolo === 'P4');
  assert.equal(p4.envioUmov, null);            // não herda o envio de abril
  assert.equal(p4.slaCadastro, null);
  assert.equal(obs.P5, 'Interna com envio no uMov 1 dia antes (vendedor uMov: Giovane)');
  // envio poucas horas antes sai em horas
  setFonteSla('vendas', [{ protocolo: 'P6', contrato: '6', cpf_digitos: '33333333333', canal: null, criado_em: '2026-09-21 12:00:00' }]);
  construirSla();
  const d2 = detalheSlaBko(parseFiltrosSla({ de: '2026-09-01', ate: '2026-09-30' }), '2026-09-22 12:00:00');
  assert.equal(d2.todas[0].obsCruzamento, 'Interna com envio no uMov 3 h antes (vendedor uMov: Giovane)');
});

test('obs.: vendedor que ainda não usava o uMov / nunca usou', async () => {
  const { detalheSlaBko } = await import('../src/model/slaBko.js');
  _reiniciarSla();
  setFonteSla('tarefas', [
    { id_tarefa: 1, ultimo_envio: '2026-09-18 11:49:00', cpf_cnpj: '11111111111', vendedor: 'Amanda Hahn Mengue' },
    { id_tarefa: 2, ultimo_envio: '2026-09-01 10:00:00', vendedor: 'Emilene Silva da Silva' }, // visita, sem CPF
  ]);
  setFonteSla('ciclos', []);
  const base = { canal: 'Vendedor Externo', cpf_digitos: '22222222222' };
  setFonteSla('vendas', [
    { ...base, protocolo: 'A', contrato: '1', vendedor: 'AMANDA HAHN MENGUE', criado_em: '2026-09-10 20:03:00' },
    { ...base, protocolo: 'B', contrato: '2', vendedor: 'AMANDA HAHN MENGUE', criado_em: '2026-09-25 14:26:00' },
    { ...base, protocolo: 'C', contrato: '3', vendedor: 'EMILENE SILVA DA SILVA', criado_em: '2026-09-14 15:33:00' },
  ]);
  construirSla();
  const d = detalheSlaBko(parseFiltrosSla({ de: '2026-09-01', ate: '2026-09-30' }), '2026-09-28 12:00:00');
  const obs = Object.fromEntries(d.todas.map((l) => [l.protocolo, l.obsCruzamento]));
  assert.equal(obs.A, 'Vendedor ainda não usava o uMov (1º pedido dele: 18/09/2026 11:49)');
  assert.equal(obs.B, 'CPF não encontrado no uMov'); // já usava: aí é falha do cruzamento
  assert.equal(obs.C, 'Vendedor sem nenhum pedido no uMov');
});

test('filtro de canal: Sem canal separa quem não tem setor no CRM; Todos soma os três', async () => {
  const { detalheSlaBko } = await import('../src/model/slaBko.js');
  _reiniciarSla();
  setFonteSla('tarefas', []);
  setFonteSla('ciclos', []);
  const base = { cpf_digitos: '', criado_em: '2026-09-22 10:00:00', agendamento_em: '2026-09-22 12:00:00' };
  setFonteSla('vendas', [
    { ...base, protocolo: 'E', contrato: '1', canal: 'Vendedor Externo' },
    { ...base, protocolo: 'I', contrato: '2', canal: 'Vendedor Interno' },
    { ...base, protocolo: 'S', contrato: '3', canal: null },
  ]);
  construirSla();
  const agora = '2026-09-28 12:00:00';
  const prot = (canal) => detalheSlaBko(parseFiltrosSla({ de: '2026-09-01', ate: '2026-09-30', canal }), agora)
    .todas.map((l) => `${l.protocolo}:${l.canal}`).sort().join(',');
  assert.equal(prot(undefined), 'E:Externo,I:Interno,S:Sem canal');
  assert.equal(prot('Interno'), 'I:Interno');
  assert.equal(prot('Sem canal'), 'S:Sem canal');
  const p = painelSlaBko(parseFiltrosSla({ de: '2026-09-01', ate: '2026-09-30', canal: 'Sem canal' }), agora);
  assert.equal(p.agendamento.n, 1);
  // em Todos, o sem canal sai da conta do SLA (só externo + interno)
  const todos = painelSlaBko(parseFiltrosSla({ de: '2026-09-01', ate: '2026-09-30' }), agora);
  assert.equal(todos.agendamento.n, 2);
});

test('pedido reprovado no uMov sem reenvio não vira A1 (caso 1834335)', async () => {
  const { detalheSlaBko } = await import('../src/model/slaBko.js');
  _reiniciarSla();
  setFonteSla('tarefas', [
    { id_tarefa: 703166532, ultimo_envio: '2026-09-26 12:41:01', cpf_cnpj: '11111111111', vendedor: 'Elisangela',
      aprovado_em: '26/09/2026 15:58', motivo_reprovacao: 'Sem viabilidade, excede os 250m da CTO', analista: 'Victoria' },
    { id_tarefa: 2, ultimo_envio: '2026-09-26 10:00:00', cpf_cnpj: '22222222222', vendedor: 'Elisangela',
      aprovado_em: '26/09/2026 11:00', analista: 'Victoria' },
  ]);
  setFonteSla('ciclos', [
    { id_ciclo: 'r', cpf_cnpj_norm: '11111111111', nome_cliente: 'K', vendedor_primeiro_envio: 'Elisangela',
      primeiro_input: '2026-09-26 12:41:01', ultimo_input: '2026-09-26 12:41:01', ultima_analise: '2026-09-26 15:58:00',
      tarefa_primeiro_envio: 703166532, tarefa_ultimo_envio: 703166532 },
    { id_ciclo: 'a', cpf_cnpj_norm: '22222222222', nome_cliente: 'L', vendedor_primeiro_envio: 'Elisangela',
      primeiro_input: '2026-09-26 10:00:00', ultimo_input: '2026-09-26 10:00:00', ultima_analise: '2026-09-26 11:00:00',
      tarefa_primeiro_envio: 2, tarefa_ultimo_envio: 2 },
  ]);
  const base = { canal: 'Vendedor Externo', vendedor: 'Elisangela', criado_em: '2026-09-29 12:02:00' };
  setFonteSla('vendas', [
    { ...base, protocolo: '1834335', contrato: '1', cpf_digitos: '11111111111' },
    { ...base, protocolo: 'OK', contrato: '2', cpf_digitos: '22222222222' },
  ]);
  construirSla();
  const d = detalheSlaBko(parseFiltrosSla({ de: '2026-09-01', ate: '2026-09-30' }), '2026-09-29 14:00:00');
  const l = Object.fromEntries(d.todas.map((x) => [x.protocolo, x]));
  assert.equal(l['1834335'].envioUmov, null);
  assert.equal(l['1834335'].obsCruzamento, 'Pedido no uMov reprovado em 26/09/2026 15:58 (Sem viabilidade, excede os 250m da CTO), sem reenvio: desconsiderado');
  assert.equal(l.OK.envioUmov, '2026-09-26 10:00:00');   // aprovado continua valendo
});

test('card em aberto destaca o que está na equipe Validação de dados - BKO', () => {
  _reiniciarSla();
  setFonteSla('tarefas', []);
  setFonteSla('ciclos', []);
  const base = { cpf_digitos: '', canal: 'Vendedor Interno', criado_em: '2026-09-28 09:00:00', status_protocolo: 'Andamento' };
  setFonteSla('vendas', [
    { ...base, protocolo: '1', contrato: '1', equipe: 'Validação de dados - BKO' },
    { ...base, protocolo: '2', contrato: '2', equipe: 'VALIDACAO DE DADOS - BKO' },
    { ...base, protocolo: '3', contrato: '3', equipe: 'Financeiro' },
  ]);
  construirSla();
  const p = painelSlaBko(parseFiltrosSla({ de: '2026-09-01', ate: '2026-09-30' }), '2026-09-29 18:00:00');
  assert.equal(p.agendamento.abertas, 3);
  assert.equal(p.agendamento.abertasBko, 2);
});

test('A1 = último envio do ciclo até o cadastro; reprovado continua na triagem (caso 1833811)', async () => {
  const { detalheSlaBko } = await import('../src/model/slaBko.js');
  _reiniciarSla();
  const cpf = '33333333333';
  setFonteSla('tarefas', [
    { id_tarefa: 1, ultimo_envio: '2026-09-22 15:08:00', cpf_cnpj: cpf, vendedor: 'Barbara',
      aprovado_em: '22/09/2026 16:00', motivo_reprovacao: 'Documento ilegível', analista: 'Bia' },
    { id_tarefa: 2, ultimo_envio: '2026-09-28 18:58:00', cpf_cnpj: cpf, vendedor: 'Barbara',
      aprovado_em: '28/09/2026 20:35', analista: 'Bia' },
  ]);
  setFonteSla('ciclos', [
    { id_ciclo: 'c', cpf_cnpj_norm: cpf, nome_cliente: 'A', vendedor_primeiro_envio: 'Barbara',
      primeiro_input: '2026-09-22 15:08:00', ultimo_input: '2026-09-28 18:58:00', ultima_analise: '2026-09-28 20:35:00',
      tarefa_primeiro_envio: 1, tarefa_ultimo_envio: 2, rodadas: 2 },
  ]);
  setFonteSla('vendas', [{ protocolo: '1833811', contrato: '1', cpf_digitos: cpf, canal: 'Vendedor Externo',
    vendedor: 'Barbara', criado_em: '2026-09-28 20:42:00', contato_em: '2026-09-28 20:50:00' }]);
  construirSla();
  const flt = parseFiltrosSla({ de: '2026-09-01', ate: '2026-09-30' });
  const l = detalheSlaBko(flt, '2026-09-29 12:00:00').todas[0];
  assert.equal(l.envioUmov, '2026-09-28 18:58:00');
  assert.equal(l.primeiroEnvioUmov, '2026-09-22 15:08:00');
  assert.equal(l.enviosNoCiclo, 2);
  assert.equal(Math.round(l.slaCadastro * 60), 104);      // 18:58 → 20:42 = 1h44
  assert.equal(Math.round(l.slaTriagem * 60), 97);        // 18:58 → 20:35 = 1h37
  // a triagem do resumo é por envio: a reprovação de 22/09 continua contando
  const p = painelSlaBko(flt, '2026-09-29 12:00:00');
  assert.equal(p.triagem.n, 2);
});

test('um pedido do uMov gera uma venda: venda nova do mesmo cliente não herda o envio (caso 1834900)', async () => {
  const { detalheSlaBko } = await import('../src/model/slaBko.js');
  _reiniciarSla();
  const cpf = '44444444444';
  setFonteSla('tarefas', [{ id_tarefa: 1, ultimo_envio: '2026-09-04 13:45:00', cpf_cnpj: cpf, vendedor: 'Ana',
    aprovado_em: '04/09/2026 14:28', analista: 'Bia' }]);
  setFonteSla('ciclos', [{ id_ciclo: 'c', cpf_cnpj_norm: cpf, nome_cliente: 'P', vendedor_primeiro_envio: 'Ana',
    primeiro_input: '2026-09-04 09:25:00', ultimo_input: '2026-09-04 13:45:00', ultima_analise: '2026-09-04 14:28:00',
    tarefa_ultimo_envio: 1, rodadas: 5 }]);
  const base = { canal: 'Vendedor Externo', vendedor: 'Ana', cpf_digitos: cpf };
  setFonteSla('vendas', [
    { ...base, protocolo: '1834900', contrato: '2', criado_em: '2026-09-29 16:00:00' },   // chega primeiro na lista
    { ...base, protocolo: '1804367', contrato: '1', criado_em: '2026-09-04 15:10:00' },
    { ...base, protocolo: 'DUPLO', contrato: '3', criado_em: '2026-09-04 15:20:00' },     // 2º contrato do mesmo pedido
  ]);
  construirSla();
  const d = detalheSlaBko(parseFiltrosSla({ de: '2026-09-01', ate: '2026-09-30' }), '2026-09-30 12:00:00');
  const l = Object.fromEntries(d.todas.map((x) => [x.protocolo, x]));
  assert.equal(l['1804367'].envioUmov, '2026-09-04 13:45:00');
  assert.equal(l.DUPLO.envioUmov, '2026-09-04 13:45:00');
  assert.equal(l['1834900'].envioUmov, null);
  assert.match(l['1834900'].obsCruzamento, /já gerou a venda 1804367/);
});

test('backlog de abertos não segue o período: virada do mês não zera o card', () => {
  _reiniciarSla();
  setFonteSla('tarefas', []);
  setFonteSla('ciclos', []);
  const base = { cpf_digitos: '', canal: 'Vendedor Interno', status_protocolo: 'Andamento', equipe: 'Validação de dados - BKO' };
  setFonteSla('vendas', [
    { ...base, protocolo: 'S1', contrato: '1', criado_em: '2026-09-30 20:52:00' },
    { ...base, protocolo: 'S2', contrato: '2', criado_em: '2026-09-15 10:00:00' },
    { ...base, protocolo: 'O1', contrato: '3', criado_em: '2026-10-01 08:13:00' },
  ]);
  construirSla();
  const p = painelSlaBko(parseFiltrosSla({ de: '2026-10-01', ate: '2026-10-31' }), '2026-10-01 09:00:00');
  assert.equal(p.agendamento.abertas, 1);        // do período (outubro)
  assert.equal(p.agendamento.backlog, 3);        // agora, qualquer mês
  assert.equal(p.agendamento.backlogBko, 3);
  assert.equal(p.agendamento.backlogBkoMaisDe7Dias, 1);
});

test('nome do vendedor casa mesmo com "de/da/dos" diferente entre Voalle e uMov (caso 1827240)', async () => {
  const { chavePessoa } = await import('../src/model/slaBko.js');
  assert.equal(chavePessoa('ADRIANE DE SOUZA ALVES'), chavePessoa('Adriane Souza Alves'));
  assert.equal(chavePessoa('José Matheus Melo de Souza'), chavePessoa('JOSE MATHEUS MELO SOUZA'));
  assert.notEqual(chavePessoa('Ana Souza'), chavePessoa('Ana Silva'));
});

test('vendedor com venda casada por CPF não sai como "sem nenhum pedido no uMov"', async () => {
  const { detalheSlaBko } = await import('../src/model/slaBko.js');
  _reiniciarSla();
  setFonteSla('tarefas', [{ id_tarefa: 1, ultimo_envio: '2026-09-23 11:02:00', cpf_cnpj: '55555555555',
    vendedor: 'Nome Totalmente Diferente', aprovado_em: '23/09/2026 13:37', analista: 'Bia' }]);
  setFonteSla('ciclos', [{ id_ciclo: 'c', cpf_cnpj_norm: '55555555555', nome_cliente: 'X', vendedor_primeiro_envio: 'Nome Totalmente Diferente',
    primeiro_input: '2026-09-23 11:02:00', ultimo_input: '2026-09-23 11:02:00', ultima_analise: '2026-09-23 13:37:00', tarefa_ultimo_envio: 1 }]);
  const base = { canal: 'Vendedor Externo', vendedor: 'ADRIANE DE SOUZA ALVES' };
  setFonteSla('vendas', [
    { ...base, protocolo: 'COM', contrato: '1', cpf_digitos: '55555555555', criado_em: '2026-09-23 14:00:00' },
    { ...base, protocolo: '1827240', contrato: '2', cpf_digitos: '66666666666', criado_em: '2026-09-24 10:00:00' },
  ]);
  construirSla();
  const d = detalheSlaBko(parseFiltrosSla({ de: '2026-09-01', ate: '2026-09-30' }), '2026-09-30 12:00:00');
  const l = Object.fromEntries(d.todas.map((x) => [x.protocolo, x]));
  assert.equal(l['1827240'].obsCruzamento, 'CPF não encontrado no uMov');
});
