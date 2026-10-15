import { test } from 'node:test';
import assert from 'node:assert/strict';
import { categoriaMotivo, SEM_MOTIVO, OUTROS } from '../src/model/motivosBko.js';
import {
  _reiniciarSla, construirSla, painelSlaBko, parseFiltrosSla, setFonteSla,
} from '../src/model/slaBko.js';

test('modelo novo do BKO: a categoria é o que vem antes do " - ("', () => {
  assert.equal(categoriaMotivo('Documento vencido - (Documento com + de 10 anos)'), 'Documento vencido');
  assert.equal(categoriaMotivo('Endereço com pendência - (contrato 123 de 20/07/2025)'), 'Endereço com pendência');
  assert.equal(categoriaMotivo('Multiplas Contratações - (Endereço com contrato ativo)'), 'Multiplas Contratações');
  assert.equal(categoriaMotivo('Múltiplas Contratações - (x)'), 'Multiplas Contratações');
  assert.equal(categoriaMotivo('Sem viabilidade/Área restrita - (rua sem rede)'), 'Sem viabilidade/Área restrita');
  assert.equal(categoriaMotivo('Protocolo ja encerrado - (cliente desistiu)'), 'Protocolo já encerrado');
  assert.equal(categoriaMotivo('Outros - (cliente pediu para aguardar)'), 'Outros');
  // lista revisada em 14/10/2026: o antigo "Encerrado por falta de contato/Desistência" vira Protocolo já encerrado
  assert.equal(categoriaMotivo('Encerrado por falta de contato 3/ Desistencia - (x)'), 'Protocolo já encerrado');
  // "Cliente ativo - … contrato ativo no endereço" é Cliente ativo, não Endereço com pendência
  assert.equal(categoriaMotivo('Cliente ativo - ( 263247 - Contrato ativo no endereço)'), 'Cliente ativo');
});

test('prefixo "Motivo da reprovação" colado antes é ignorado', () => {
  assert.equal(categoriaMotivo('Motivo da reprovação - Erro no cadastro - Falta 1 digito no fone'), 'Erro no cadastro');
  assert.equal(categoriaMotivo('Motivo da reprovação: 210864 - 10/07/2026. Endereço com pendência, análise negada'), 'Endereço com pendência');
});

test('texto livre antigo: palavras-chave recuperam a categoria', () => {
  assert.equal(categoriaMotivo('ENDEREÇO COM PENDÊNCIA. Análise negada. Contrato N 1'), 'Endereço com pendência');
  assert.equal(categoriaMotivo('VENDA DUPLICADA'), 'Duplicado');
  assert.equal(categoriaMotivo('duplicidade'), 'Duplicado');
  assert.equal(categoriaMotivo('POSSUI CLIENTE ATIVO'), 'Cliente ativo');
  assert.equal(categoriaMotivo('CPF COM PENDENCIA'), 'Cliente com pendência no CPF junto a Sebratel');
  assert.equal(categoriaMotivo('Não foi possível abrir os arquivos'), 'Arquivos não estão abrindo');
  assert.equal(categoriaMotivo('Favor corrigir o campo telefone'), 'Erro no cadastro');
  assert.equal(categoriaMotivo('Comprovante de residência não aceito'), 'Comprovante não atende os requisitos');
});

test('vazio, só traço, categoria nova e texto sem padrão', () => {
  assert.equal(categoriaMotivo('-'), SEM_MOTIVO);
  assert.equal(categoriaMotivo('   '), SEM_MOTIVO);
  assert.equal(categoriaMotivo('Motivo da reprovação - '), SEM_MOTIVO);
  // seguiu o modelo, mas com uma categoria fora da lista: vira categoria própria
  assert.equal(categoriaMotivo('Plano indisponível - (região sem o plano)'), 'Plano indisponível');
  assert.equal(categoriaMotivo('olhar com o supervisor'), OUTROS);
});

test('devoluções do BKO: reprovadas ÷ analisadas, com motivos por vendedor', () => {
  _reiniciarSla();
  setFonteSla('tarefas', [
    { id_tarefa: 1, data_hora: '2026-09-10 09:00:00', vendedor: 'Ana', aprovado_em: '10/09/2026 10:00', motivo_reprovacao: 'Erro no cadastro - (fone)' },
    { id_tarefa: 2, data_hora: '2026-09-10 11:00:00', vendedor: 'Ana', aprovado_em: '10/09/2026 12:00' },
    { id_tarefa: 3, data_hora: '2026-09-11 09:00:00', vendedor: 'Bia', aprovado_em: '11/09/2026 10:00', motivo_reprovacao: 'DUPLICADO' },
    { id_tarefa: 4, data_hora: '2026-09-11 09:30:00', vendedor: 'Bia', aprovado_em: '11/09/2026 10:30', motivo_reprovacao: 'Erro no cadastro - (cep)' },
    { id_tarefa: 5, data_hora: '2026-09-12 09:00:00', vendedor: 'Bia' }, // pendente: fora da conta
  ]);
  setFonteSla('ciclos', [
    { id_ciclo: 'a', cpf_cnpj_norm: '11111111111', nome_cliente: 'X', vendedor_primeiro_envio: 'Ana', primeiro_input: '2026-09-10 09:00:00', rodadas: '2', houve_retrabalho: true },
    { id_ciclo: 'b', cpf_cnpj_norm: '22222222222', nome_cliente: 'Y', vendedor_primeiro_envio: 'Bia', primeiro_input: '2026-09-11 09:00:00', rodadas: '1', houve_retrabalho: false },
    { id_ciclo: 'TSK:9#1', cpf_cnpj_norm: null, nome_cliente: 'Z', vendedor_primeiro_envio: 'Bia', primeiro_input: '2026-09-11 09:00:00', rodadas: '1', houve_retrabalho: false },
  ]);
  setFonteSla('vendas', []);
  construirSla();
  const p = painelSlaBko(parseFiltrosSla({ de: '2026-09-01', ate: '2026-09-30' }), '2026-09-22 10:00:00');
  assert.equal(p.triagem.analisadas, 4);
  assert.equal(p.triagem.devolucoes, 3);
  assert.equal(p.triagem.pctDevolucao, 0.75);
  assert.deepEqual(p.triagem.motivosDevolucao, [{ key: 'Erro no cadastro', valor: 2 }, { key: 'Duplicado', valor: 1 }]);
  assert.deepEqual(p.triagem.motivosPorVendedor.Ana, [{ key: 'Erro no cadastro', valor: 1 }]);
  assert.deepEqual(p.triagem.motivosPorVendedor.Bia, [{ key: 'Duplicado', valor: 1 }, { key: 'Erro no cadastro', valor: 1 }]);
  // retrabalho só entre pedidos (ciclo com CPF/CNPJ); o ciclo sem documento fica fora
  assert.equal(p.ciclos.pedidos, 2);
  assert.equal(p.ciclos.pedidosComRetrabalho, 1);
  assert.equal(p.ciclos.pctRetrabalhoPedidos, 0.5);
});

test('pendentes de cadastro agora: em análise + aprovados sem cadastro, relógio desde o envio', () => {
  _reiniciarSla();
  const t = (id, envio, cpf, extra = {}) => ({ id_tarefa: id, ultimo_envio: envio, vendedor: 'Ana', nome_cliente: `C${id}`, cpf_cnpj: cpf, ...extra });
  setFonteSla('tarefas', [
    // A: aprovado, sem venda → pendente e fora do SLA
    t(10, '2026-10-13 09:00:00', '111.111.111-11', { aprovado_em: '13/10/2026 09:30', analista: 'Bia' }),
    // B: aprovado e já com venda depois do envio → fora da lista
    t(20, '2026-10-13 10:00:00', '22222222222', { aprovado_em: '13/10/2026 10:10' }),
    // C: reprovado por último → voltou ao vendedor, não está pendente
    t(30, '2026-10-13 11:00:00', '33333333333', { aprovado_em: '13/10/2026 11:20', motivo_reprovacao: 'Erro no cadastro - (x)' }),
    // D: aprovado há pouco → pendente, ainda dentro da meta
    t(40, '2026-10-14 09:40:00', '44444444444', { aprovado_em: '14/10/2026 09:50' }),
    // E: envio há mais de 30 dias → fora da janela
    t(50, '2026-08-01 09:00:00', '55555555555', { aprovado_em: '01/08/2026 10:00' }),
    // F: ainda sem análise do BKO → pendente "em análise", fora (2 h úteis)
    t(60, '2026-10-14 08:00:00', '66666666666'),
    // G: aprovado, mas a Venda Assistida aberta depois foi CANCELADA (caso Vera Regina) → fora
    t(70, '2026-10-13 15:19:00', '77777777777', { aprovado_em: '13/10/2026 16:02' }),
    // H: sem CPF = visita/lead → nunca é pedido
    t(80, '2026-10-14 07:00:00', ''),
    // I: reprovado e reenviado → vale o reenvio (em análise), ciclo com 2 envios
    t(90, '2026-10-13 14:00:00', '99999999999', { aprovado_em: '13/10/2026 14:30', motivo_reprovacao: 'Duplicado - (x)' }),
    t(91, '2026-10-14 09:30:00', '99999999999'),
    // J: venda cadastrada 2 h ANTES do envio → já resolvido
    t(100, '2026-10-13 12:00:00', '10101010101', { aprovado_em: '13/10/2026 12:10' }),
    // K: venda de um pedido anterior do mesmo CPF (dia 08) não resolve o pedido novo (dia 13)
    t(110, '2026-10-08 10:00:00', '12121212121', { aprovado_em: '08/10/2026 10:30' }),
    t(111, '2026-10-13 09:00:00', '12121212121', { aprovado_em: '13/10/2026 09:20' }),
  ]);
  setFonteSla('ciclos', []);
  const venda = (p2, cpf, quando) => ({ protocolo: p2, contrato: p2, cpf_digitos: cpf, cliente: 'x', vendedor: 'Ana', canal: 'Vendedor Externo', criado_em: quando });
  setFonteSla('vendas', [
    venda('1', '22222222222', '2026-10-13 10:40:00'),
    venda('2', '10101010101', '2026-10-13 10:00:00'),
    venda('3', '12121212121', '2026-10-08 11:00:00'),
  ]);
  setFonteSla('vendasAssistidas', [
    { protocolo: '1819251', cpf_digitos: '77777777777', aberto_em: '2026-10-13 16:02:53', status_id: 8, status: 'Cancelado' },
    // Venda Assistida em aberto não tira ninguém da lista
    { protocolo: '9', cpf_digitos: '11111111111', aberto_em: '2026-10-13 09:31:00', status_id: 1, status: 'Abertura' },
  ]);
  construirSla();
  const p = painelSlaBko(parseFiltrosSla({ de: '2026-10-01', ate: '2026-10-14' }), '2026-10-14 10:00:00');
  const a = p.cadastro.pendentes;
  assert.deepEqual(a.lista.map((l) => l.idTarefa), [10, 111, 60, 91, 40]); // mais antigo primeiro
  assert.equal(a.total, 5);
  assert.equal(a.emAnalise, 2);
  assert.equal(a.aprovados, 3);
  assert.equal(a.fora, 3);           // D (20 min) e o reenvio I (30 min) estão no prazo
  assert.equal(a.foraEmAnalise, 1);
  assert.equal(a.foraAprovados, 2);
  assert.equal(a.mais24h, 2);        // A e K, enviados dia 13 às 09:00
  const porId = Object.fromEntries(a.lista.map((l) => [l.idTarefa, l]));
  assert.equal(porId[60].etapa, 'Em análise no uMov');
  assert.equal(porId[60].esperaHoras, 2);
  assert.equal(porId[10].etapa, 'Aprovado sem cadastro');
  assert.equal(porId[10].analista, 'Bia');
  assert.equal(porId[91].envios, 2);
  assert.equal(porId[91].primeiroEnvio, '2026-10-13 14:00:00');
  assert.equal(porId[111].envios, 1);
  assert.equal(porId[40].fora, false);
  assert.equal(porId[91].fora, false);
  assert.equal(a.umovAte, '2026-10-14 09:50:00');
  // canal Interno: não existe uMov → zerado
  const pi = painelSlaBko(parseFiltrosSla({ de: '2026-10-01', ate: '2026-10-14', canal: 'Interno' }), '2026-10-14 10:00:00');
  assert.equal(pi.cadastro.pendentes.total, 0);
});
