/**
 * O COFRE — a configuração não pode mais morrer com a stack.
 *
 * Em 02/10/2026 a stack do comercial-dashboard foi recriada do zero no
 * Portainer. O volume `comercial-dashboard-data` era declarado DENTRO da stack,
 * então foi junto, e com ele a matriz de acesso inteira, os escopos de equipe e
 * a chave do Gemini. Não havia cópia: o arquivo era a única fonte.
 *
 * O que estes testes seguram são as três propriedades que o conserto precisa
 * ter, e cada uma já foi um jeito de perder dado:
 *
 *   1. o que se grava vai parar no BANCO, que não pertence à stack;
 *   2. a instalação que já existe MIGRA sozinha, sem ninguém redigitar;
 *   3. banco fora NÃO derruba o dashboard nem apaga o que já estava lá.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test, { beforeEach } from 'node:test';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cofre-'));
process.env.ACCESS_PATH = path.join(tmp, 'access.json');
process.env.AUTH_ENABLED = 'false';

/**
 * MariaDB de mentira. `tabela` é o que estaria gravado; `falhar` simula o banco
 * fora — que é o cenário em que quase todo armazenamento de configuração falha
 * feio, apagando o que tinha em vez de manter.
 */
const banco = { tabela: new Map(), falhar: false, escritas: 0 };

const { pool } = await import('../src/db/maria.js');
pool.query = async (sql, params = []) => {
  if (banco.falhar) throw new Error('ECONNREFUSED');
  if (/^CREATE/i.test(sql.trim())) return [[], []];
  if (/^SELECT/i.test(sql.trim())) {
    return [[...banco.tabela].map(([chave, valor]) => ({ chave, valor })), []];
  }
  if (/^INSERT/i.test(sql.trim())) {
    banco.escritas += 1;
    banco.tabela.set(params[0], params[1]);
    return [{ affectedRows: 1 }, []];
  }
  if (/^DELETE/i.test(sql.trim())) {
    banco.tabela.delete(params[0]);
    return [{ affectedRows: 1 }, []];
  }
  return [[], []];
};

const cofre = await import('../src/cofre.js');

/** Espera a gravação assíncrona no banco acontecer. */
const assentar = () => new Promise((r) => setTimeout(r, 10));

beforeEach(() => {
  banco.tabela.clear();
  banco.falhar = false;
  banco.escritas = 0;
  cofre._zerar();
  for (const f of fs.readdirSync(tmp)) fs.rmSync(path.join(tmp, f), { force: true });
});

test('o que se grava vai para o banco, não só para o disco', async () => {
  await cofre.carregar();
  cofre.gravar('access', { papeis: { 'ana@x.com': 'admin' } }, 'misael@x.com');
  await assentar();
  assert.ok(banco.tabela.has('access'), 'é o banco que não pertence à stack');
  assert.deepEqual(JSON.parse(banco.tabela.get('access')), { papeis: { 'ana@x.com': 'admin' } });
});

test('a leitura continua SÍNCRONA — o middleware de cada requisição depende disso', async () => {
  banco.tabela.set('access', JSON.stringify({ papeis: { 'bia@x.com': 'dev' } }));
  await cofre.carregar();
  const lido = cofre.ler('access');          // sem await, de propósito
  assert.equal(lido.papeis['bia@x.com'], 'dev');
});

test('com COFRE_MIGRAR=1 a instalação antiga sobe o arquivo para o banco', async () => {
  // é o estado de quem já rodava a versão de arquivo
  fs.writeFileSync(process.env.ACCESS_PATH, JSON.stringify({ papeis: { 'ana@x.com': 'admin' } }));
  fs.writeFileSync(path.join(tmp, 'metas.json'), JSON.stringify({ CANOAS: { vendas: 10 } }));

  process.env.COFRE_MIGRAR = '1';
  await cofre.carregar();
  await assentar();
  delete process.env.COFRE_MIGRAR;

  assert.ok(banco.tabela.has('access'), 'ninguém deveria precisar redigitar a matriz de acesso');
  assert.ok(banco.tabela.has('metas'));
  assert.equal(cofre.ler('metas').CANOAS.vendas, 10);
});

/**
 * A migração automática já levou a configuração de uma máquina de DESENVOLVIMENTO
 * para a tabela de produção (02/10/2026): bastou subir o servidor local apontando
 * para o MariaDB de produção. Por isso ela é opt-in.
 */
test('sem a variável, o arquivo local NÃO contamina o banco', async () => {
  fs.writeFileSync(process.env.ACCESS_PATH, JSON.stringify({ papeis: { 'dev@local': 'admin' } }));

  await cofre.carregar();
  await assentar();

  assert.equal(banco.tabela.size, 0, 'rodar local não pode escrever na configuração de produção');
  assert.equal(
    cofre.ler('access').papeis['dev@local'], 'admin',
    'mas em memória o arquivo vale — é o que faz o ambiente local funcionar',
  );
});

test('banco fora no boot: sobe com o espelho local em vez de subir vazio', async () => {
  fs.writeFileSync(path.join(tmp, 'access.json'), JSON.stringify({ papeis: { 'ana@x.com': 'admin' } }));
  banco.falhar = true;

  await cofre.carregar();   // não pode lançar: derrubar o boot é pior que degradar

  assert.equal(
    cofre.ler('access').papeis['ana@x.com'], 'admin',
    'com o banco fora o dashboard tem de abrir com a última configuração conhecida',
  );
  assert.equal(cofre.saude().banco.ok, false, 'e precisa ADMITIR que está degradado');
});

test('gravação com o banco fora não se perde: fica pendente e sincroniza depois', async () => {
  await cofre.carregar();
  banco.falhar = true;
  cofre.gravar('janela', { since: '2026-01-01' }, 'misael@x.com');
  await assentar();

  assert.deepEqual(cofre.saude().pendentes, ['janela'], 'a tela precisa poder avisar que não gravou');
  assert.equal(cofre.ler('janela').since, '2026-01-01', 'mas o valor vale agora mesmo');

  banco.falhar = false;
  cofre.gravar('feriados', { '2026-10-02': 'teste' });  // qualquer escrita puxa a fila
  await assentar();
  assert.ok(banco.tabela.has('janela'), 'o que ficou pendente tem de chegar ao banco sozinho');
  assert.deepEqual(cofre.saude().pendentes, []);
});

test('o espelho local acompanha, para o próximo boot sem banco achar o valor', async () => {
  await cofre.carregar();
  cofre.gravar('metas', { CANOAS: { vendas: 7 } });
  await assentar();
  const doDisco = JSON.parse(fs.readFileSync(path.join(tmp, 'metas.json'), 'utf8'));
  assert.deepEqual(doDisco, { CANOAS: { vendas: 7 } });
});

test('apagar tira do banco, do disco e da memória', async () => {
  await cofre.carregar();
  cofre.gravar('feriados', { '2026-12-25': 'Natal' });
  await assentar();
  cofre.apagar('feriados');
  await assentar();
  assert.equal(cofre.ler('feriados', {}).hasOwnProperty('2026-12-25'), false);
  assert.ok(!fs.existsSync(path.join(tmp, 'feriados.json')));
  assert.ok(!banco.tabela.has('feriados'));
});

test('exportar e importar fecham o ciclo — a cópia que não depende de infra', async () => {
  await cofre.carregar();
  cofre.gravar('access', { papeis: { 'ana@x.com': 'admin' } });
  cofre.gravar('metas', { CANOAS: { vendas: 10 } });
  const pacote = exportarEClonar();
  // deixa a sincronização terminar: sem isto ela grava no banco DEPOIS do clear
  // abaixo, e o "zerado" não estaria zerado
  await assentar();

  // stack recriada do zero: volume novo e vazio, banco limpo — o incidente
  cofre._zerar();
  banco.tabela.clear();
  for (const f of fs.readdirSync(tmp)) fs.rmSync(path.join(tmp, f), { force: true });
  await cofre.carregar();
  assert.equal(cofre.ler('access', null), null, 'começou do zero, como numa stack nova');

  const aplicadas = cofre.importar(pacote, 'misael@x.com');
  await assentar();
  assert.deepEqual(aplicadas.sort(), ['access', 'metas']);
  assert.equal(cofre.ler('access').papeis['ana@x.com'], 'admin');
  assert.ok(banco.tabela.has('access'), 'importar também persiste, não fica só em memória');

  function exportarEClonar() {
    return JSON.parse(JSON.stringify(cofre.exportar()));
  }
});

test('importar pacote sem nada reconhecível falha, em vez de apagar tudo', async () => {
  await cofre.carregar();
  cofre.gravar('access', { papeis: { 'ana@x.com': 'admin' } });
  assert.throws(() => cofre.importar({ config: { nada: 1 } }), /nenhuma chave conhecida/);
  assert.throws(() => cofre.importar({}), /Pacote inválido/);
  assert.equal(cofre.ler('access').papeis['ana@x.com'], 'admin', 'o que estava lá continua lá');
});
