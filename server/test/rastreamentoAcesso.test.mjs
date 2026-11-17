/**
 * QUEM PODE IMPORTAR O RASTREAMENTO — e por que isto é um teste, e não só um commit.
 *
 * Até 17/11/2026 a rota `/api/campanhas/rastreamento` era `minPapel: 'admin'` e a
 * tela escondia o botão de quem não fosse admin. As duas pontas tinham de combinar:
 * mostrar o botão sem afrouxar o servidor dá 403 no clique, e afrouxar o servidor
 * sem mostrar o botão não serve para nada. É um acoplamento entre dois arquivos que
 * ninguém lembra de conferir — então ele fica aqui.
 *
 * O portão virou ACESSO À TELA (`tela: 'campanhas'`). O motivo de ser admin era
 * "o arquivo traz telefone e às vezes CPF", mas isso não separava ninguém de nada:
 * quem importa baixou o CSV do Matrix (que tem login próprio) e já enxerga esses
 * mesmos leads, com telefone, na tela. O portão não guardava o dado — obrigava o
 * marketing a pedir a um admin que subisse um arquivo que o marketing já tinha.
 *
 * O que o acesso à tela ainda guarda é a ESCRITA: a base é compartilhada, quem
 * importa troca o que todo mundo vê. Daí a autoria registrada (`importado_por`).
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test, { beforeEach } from 'node:test';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'acesso-'));
process.env.ACCESS_PATH = path.join(tmp, 'access.json');
process.env.AUTH_ENABLED = 'false';
process.env.ADMIN_EMAILS = '';

// o cofre sincroniza com o MariaDB em segundo plano; sem isto o teste tentaria
// abrir conexão de verdade com o banco do .env
const { pool } = await import('../src/db/maria.js');
pool.query = async (sql) => (/^SELECT/i.test(String(sql).trim()) ? [[], []] : [{ affectedRows: 1 }, []]);

const cofre = await import('../src/cofre.js');
const { podeVerTela, definirTela, TELAS } = await import('../src/auth/access.js');

const usuario = (email, papel = 'viewer') => ({ email, papel });

// apagar o arquivo não basta: o cofre serve da MEMÓRIA, e um teste que grava ACL
// vazava para o seguinte — que é justamente o que afirma a tela estar aberta
beforeEach(() => { cofre.apagar('access'); });

test('a rota do rastreamento é guardada pela TELA, não pelo papel', () => {
  const fonte = fs.readFileSync(new URL('../src/routes/admin.js', import.meta.url), 'utf8');
  const m = /admin\.post\(\s*'\/campanhas\/rastreamento',\s*exigirAuth\(\{([^}]*)\}\)/.exec(fonte);
  assert.ok(m, 'a rota mudou de forma — confira se o portão continua explícito');
  assert.match(
    m[1], /tela:\s*'campanhas'/,
    'a tela mostra o botão de importar para todo mundo que abre Campanhas; '
    + 'o servidor tem de aceitar os mesmos, senão o clique volta 403',
  );
  assert.doesNotMatch(
    m[1], /minPapel:\s*'admin'/,
    'voltar para admin aqui, sem voltar o `ehAdmin` na tela, quebra o botão em silêncio',
  );
});

test('a tela de Campanhas não mostra mais o botão só para admin', () => {
  const fonte = fs.readFileSync(new URL('../../web/src/pages/Campanhas.jsx', import.meta.url), 'utf8');
  assert.doesNotMatch(
    fonte, /ehAdmin/,
    'o esconderijo do botão saiu junto com o portão do servidor; os dois andam juntos',
  );
  assert.match(fonte, /importar-rastreamento/, 'o campo de arquivo continua existindo');
});

test('quem está na lista da tela importa; quem não está, não', () => {
  definirTela('campanhas', { modo: 'lista', emails: ['ana@sebratel.com.br'] }, 'admin@sebratel.com.br');

  assert.equal(podeVerTela(usuario('ana@sebratel.com.br'), 'campanhas'), true);
  assert.equal(podeVerTela(usuario('ANA@Sebratel.com.BR'), 'campanhas'), true, 'e-mail não diferencia maiúscula');
  assert.equal(podeVerTela(usuario('bruno@sebratel.com.br'), 'campanhas'), false);
  assert.equal(
    podeVerTela(usuario('chefe@sebratel.com.br', 'admin'), 'campanhas'), true,
    'admin passa sempre — é quem conserta quando a lista está errada',
  );
});

/**
 * ATENÇÃO, e é de propósito que isto está escrito como teste: `campanhas` não tem
 * `padrao: 'lista'` na lista de TELAS, então, enquanto ninguém restringir a tela
 * pela tela de Acessos, "todos que veem Campanhas" quer dizer o DOMÍNIO INTEIRO —
 * e agora todos eles podem importar. Fechar isso é uma configuração, não um
 * deploy: Acessos › Campanhas › lista. Se um dia a tela nascer restrita, este
 * teste falha e obriga a releitura da frase acima.
 */
test('hoje Campanhas nasce aberta ao domínio — logo, qualquer um do domínio importa', () => {
  const campanhas = TELAS.find((t) => t.id === 'campanhas');
  assert.equal(campanhas.padrao ?? 'todos', 'todos');
  assert.equal(
    podeVerTela(usuario('qualquer.um@sebratel.com.br'), 'campanhas'), true,
    'sem ACL gravada a tela é aberta; o portão de escrita vale o que a ACL valer',
  );
});
