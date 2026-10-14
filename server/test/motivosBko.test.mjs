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

test('aguardando cadastro: aprovado no uMov, sem venda no Elleven, fora da meta de 1 h', () => {
  _reiniciarSla();
  setFonteSla('tarefas', [
    // A: aprovado, sem venda → aguardando e fora do SLA
    { id_tarefa: 10, data_hora: '2026-10-13 09:00:00', vendedor: 'Ana', nome_cliente: 'A', cpf_cnpj: '111.111.111-11', aprovado_em: '13/10/2026 09:30' },
    // B: aprovado e já com venda depois do envio → fora da lista
    { id_tarefa: 20, data_hora: '2026-10-13 10:00:00', vendedor: 'Ana', nome_cliente: 'B', cpf_cnpj: '22222222222', aprovado_em: '13/10/2026 10:10' },
    // C: reprovado por último → não está aguardando cadastro
    { id_tarefa: 30, data_hora: '2026-10-13 11:00:00', vendedor: 'Bia', nome_cliente: 'C', cpf_cnpj: '33333333333', aprovado_em: '13/10/2026 11:20', motivo_reprovacao: 'Erro no cadastro - (x)' },
    // D: aprovado há pouco → aguardando, ainda dentro da meta
    { id_tarefa: 40, data_hora: '2026-10-14 09:40:00', vendedor: 'Bia', nome_cliente: 'D', cpf_cnpj: '44444444444', aprovado_em: '14/10/2026 09:50' },
    // E: aprovado há mais de 30 dias → fora da janela
    { id_tarefa: 50, data_hora: '2026-08-01 09:00:00', vendedor: 'Bia', nome_cliente: 'E', cpf_cnpj: '55555555555', aprovado_em: '01/08/2026 10:00' },
  ]);
  const ciclo = (id, cpf, ini, tarefa) => ({ id_ciclo: id, cpf_cnpj_norm: cpf, nome_cliente: 'x', vendedor_primeiro_envio: 'Ana', primeiro_input: ini, ultimo_input: ini, tarefa_ultimo_envio: tarefa, rodadas: '1' });
  setFonteSla('ciclos', [
    ciclo('a', '11111111111', '2026-10-13 09:00:00', 10), ciclo('b', '22222222222', '2026-10-13 10:00:00', 20),
    ciclo('c', '33333333333', '2026-10-13 11:00:00', 30), ciclo('d', '44444444444', '2026-10-14 09:40:00', 40),
    ciclo('e', '55555555555', '2026-08-01 09:00:00', 50),
  ]);
  setFonteSla('vendas', [
    { protocolo: '1', contrato: '1', cpf_digitos: '22222222222', cliente: 'B', vendedor: 'Ana', canal: 'Vendedor Externo', criado_em: '2026-10-13 10:40:00' },
  ]);
  construirSla();
  const p = painelSlaBko(parseFiltrosSla({ de: '2026-10-01', ate: '2026-10-14' }), '2026-10-14 10:00:00');
  const a = p.cadastro.abertos;
  assert.equal(a.aguardando, 2);
  assert.deepEqual(a.lista.map((l) => l.idTarefa).sort(), [10, 40]);
  assert.equal(a.foraSla, 1);
  assert.equal(a.mais24h, 1);
  // canal Interno: não existe uMov → zerado
  const pi = painelSlaBko(parseFiltrosSla({ de: '2026-10-01', ate: '2026-10-14', canal: 'Interno' }), '2026-10-14 10:00:00');
  assert.equal(pi.cadastro.abertos.aguardando, 0);
});
