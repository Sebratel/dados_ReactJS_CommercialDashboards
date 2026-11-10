/**
 * EXPORTAÇÃO EM CSV — o nome do arquivo é parte do produto.
 *
 * Estes testes existem por um bug que ninguém viu por semanas: `baixar(nome, conteudo)`
 * foi chamado com os argumentos trocados na tela inteira de Relatórios Comercial. O
 * arquivo saía sem extensão, batizado com a linha de cabeçalho do CSV
 * ("CONTRATO;TIPO;VALOR DO PLANO;..."), e por dentro trazia o nome que deveria estar
 * na capa. O Windows não sabia com o que abrir.
 *
 * Nada disso dá erro sozinho — `Blob` aceita qualquer string e `a.download` aceita
 * qualquer nome —, então só quem foi olhar a pasta de downloads descobriu. O que se
 * segura aqui é o par (nome, conteúdo): que a ordem errada estoure na hora, e que todo
 * arquivo saia com a mesma cara.
 */
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import test, { beforeEach } from 'node:test';

/** O DOM mínimo que `baixar` usa, para o módulo rodar fora do navegador. */
const baixados = [];
globalThis.URL.createObjectURL = () => 'blob:teste';
globalThis.URL.revokeObjectURL = () => {};
globalThis.document = {
  createElement: () => ({
    set download(v) { this._nome = v; },
    get download() { return this._nome; },
    click() { baixados.push({ nome: this._nome, conteudo: this._blob }); },
    set href(v) { this._href = v; },
    get href() { return this._href; },
  }),
  body: { appendChild() {}, removeChild() {} },
};

const { baixar, baixarCSV, sufixoPeriodo, tabelaParaCSV } = await import('../src/exportar.js');

beforeEach(() => { baixados.length = 0; });

const COLUNAS = [{ key: 'vendedor', titulo: 'VENDEDOR' }, { key: 'qtd', titulo: 'QTD' }];
const LINHAS = [{ vendedor: 'ANA SOUZA', qtd: 3 }];

test('todo arquivo sai como <base>_<periodo>.csv', () => {
  baixarCSV('vendas-por-vendedor', tabelaParaCSV(COLUNAS, LINHAS), '2026-01-01_a_2026-09-16');
  assert.equal(baixados[0].nome, 'vendas-por-vendedor_2026-01-01_a_2026-09-16.csv');
});

test('sem período filtrado o arquivo diz "completo", em vez de ficar sem sufixo', () => {
  baixarCSV('quadro-de-equipes', tabelaParaCSV(COLUNAS, LINHAS));
  assert.equal(baixados[0].nome, 'quadro-de-equipes_completo.csv');
});

test('a base é limpa: sem acento, sem espaço, sem maiúscula, sem .csv repetido', () => {
  baixarCSV('Pesquisa de Cancelamento.csv', tabelaParaCSV(COLUNAS, LINHAS), 'completo');
  assert.equal(
    baixados[0].nome, 'pesquisa-de-cancelamento_completo.csv',
    'o nome tem de sobreviver a anexo de e-mail e a compartilhamento de rede',
  );
});

test('argumentos trocados estouram no clique, em vez de gerar arquivo quebrado', () => {
  const csv = tabelaParaCSV(COLUNAS, LINHAS);
  assert.throws(
    () => baixar(csv, 'vendas.csv'),
    /argumentos vieram trocados/,
    'era exatamente este o bug da tela de Relatórios Comercial',
  );
  assert.equal(baixados.length, 0, 'e nada é baixado');
});

test('a ordem certa continua passando', () => {
  const csv = tabelaParaCSV(COLUNAS, LINHAS);
  baixar('vendas.csv', csv);
  assert.equal(baixados[0].nome, 'vendas.csv');
});

test('o sufixo lê o par de datas da tela, e não sempre o comercial', () => {
  const filtros = { de: '2026-01-01', ate: '2026-09-16', criadoDe: '2019-01-01', criadoAte: '' };
  assert.equal(sufixoPeriodo(filtros), '2026-01-01_a_2026-09-16');
  assert.equal(
    sufixoPeriodo(filtros, ['criadoDe', 'criadoAte']), '2019-01-01',
    'condomínios recorta pela criação do splitter; carimbar o período comercial seria mentira',
  );
  assert.equal(sufixoPeriodo({}, ['leadDe', 'leadAte']), 'completo');
});

test('o CSV em si continua abrindo no Excel em português', () => {
  const csv = tabelaParaCSV(COLUNAS, [{ vendedor: 'ANA; SOUZA', qtd: 3.5 }]);
  assert.ok(csv.startsWith('﻿'), 'sem BOM os acentos quebram no Excel');
  const [cab, linha] = csv.replace(/^﻿/, '').split('\r\n');
  assert.equal(cab, 'VENDEDOR;QTD');
  assert.equal(
    linha, '"ANA; SOUZA";3,50',
    'ponto e vírgula no valor vai entre aspas; decimal é vírgula, com duas casas',
  );
});

/**
 * `tabelaParaCSV` exporta o que a tela RECEBEU. Para tabela com amostra (as 400
 * primeiras de 1.300, por exemplo), isso é um arquivo pela metade que parece completo
 * — foi a reclamação de 10/11/2026. Tabela com amostra baixa pelo servidor
 * (`baixarDoServidor`), que monta o arquivo com todas as linhas do filtro.
 */
test('nenhuma tela monta CSV a partir de uma amostra', async () => {
  const pasta = new URL('../src/pages/', import.meta.url);
  // a chamada inteira, aceitando um nível de parênteses dentro dos argumentos
  const chamada = /tabelaParaCSV\((?:[^()]|\([^()]*\))*\)/g;
  // e o atalho local: a tela de Relatórios passava a amostra por um `exportar(...)`
  // próprio, e só a busca acima não via
  const atalho = /\b(exportar\w*|baixarCSV)\(.*\b(amostra|detalhe)\b/;
  let vistas = 0;
  for (const arquivo of await readdir(pasta)) {
    const fonte = await readFile(new URL(arquivo, pasta), 'utf8');
    for (const c of fonte.match(chamada) || []) {
      vistas += 1;
      assert.doesNotMatch(c, /amostra|detalhe/, `${arquivo}: ${c.replace(/\s+/g, ' ')}`);
    }
    for (const linha of fonte.split('\n')) {
      assert.doesNotMatch(linha, atalho, `${arquivo}: ${linha.trim()}`);
    }
  }
  assert.ok(vistas > 10, 'a busca acha as chamadas (senão o teste passaria sem olhar nada)');
});
