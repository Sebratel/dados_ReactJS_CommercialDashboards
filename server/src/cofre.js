/**
 * O COFRE — onde a configuração do dashboard mora de verdade.
 *
 * Papéis, acesso por tela, escopo de equipe, provedor de IA, janela de dados,
 * metas por cidade e feriados. Tudo que um administrador configura pela tela.
 *
 * POR QUE ISTO EXISTE. Até 02/10/2026 cada um desses vivia num JSON dentro de
 * `/app/data`, um volume nomeado DECLARADO NA STACK. Volume declarado na stack
 * compartilha o ciclo de vida dela: `docker compose up` preserva, mas recriar a
 * stack do zero no Portainer apaga. Aconteceu — a matriz de acesso inteira e a
 * chave do Gemini se perderam, e não havia de onde restaurar.
 *
 * O banco não pertence à stack. É essa a propriedade que se quer aqui, e não a
 * de "estar num banco".
 *
 * COMO SE SERVE SEM QUEBRAR TUDO. As leituras acontecem em lugar SÍNCRONO —
 * `podeVerTela` e `papelDe` rodam no middleware de cada requisição. Tornar isso
 * assíncrono respingaria em toda rota do sistema. Então:
 *
 *   - no boot, `carregar()` traz a tabela inteira para a memória (são alguns KB);
 *   - `ler()` serve da memória, síncrono, como antes;
 *   - `gravar()` grava na memória E no espelho local, síncrono, e empurra para o
 *     banco em seguida.
 *
 * O ESPELHO LOCAL continua existindo, de propósito, mas trocou de papel: era a
 * fonte da verdade, virou rede de segurança. Se o MariaDB estiver fora no boot,
 * o dashboard sobe com a última configuração conhecida em vez de subir sem
 * nenhuma — que é o comportamento que ele já tinha e não se quer perder. E uma
 * escrita feita com o banco fora sobrevive a um restart do contêiner e é
 * reconciliada quando o banco volta.
 */
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';

/**
 * O pool entra SOB DEMANDA, e não como import de topo.
 *
 * `config.js` lê a janela de dados de `janela.js`, que agora lê daqui; se o
 * cofre importasse `db/maria.js` no topo, o ciclo fecharia
 * (config → janela → cofre → maria → config) e `maria.js` rodaria com `config`
 * ainda na zona morta — `ReferenceError` no primeiro import, antes de qualquer
 * linha de negócio. O `import()` dinâmico adia isso para depois do boot dos
 * módulos, e o ESM garante que é a mesma instância.
 */
let poolCache = null;
async function conexao() {
  if (!poolCache) ({ pool: poolCache } = await import('./db/maria.js'));
  return poolCache;
}

/** As cinco chaves. Uma por arquivo da era anterior, mesmo formato de conteúdo. */
export const CHAVES = ['access', 'ia', 'janela', 'metas', 'feriados'];

/**
 * Nome dos arquivos antigos, para a migração automática. Quem já tem o volume
 * populado não redigita nada: o primeiro boot leva o conteúdo para o banco.
 */
const ARQUIVO_ANTIGO = {
  access: 'access.json',
  ia: 'ia.json',
  janela: 'janela.json',
  metas: 'metas.json',
  feriados: 'feriados.json',
};

const BASE = 'DB_ComercialDashboard';
const TABELA = `\`${BASE}\`.\`config\``;

const estado = {
  memoria: new Map(),   // chave -> objeto
  carregado: false,
  banco: { ok: false, erro: null, em: null },
  pendentes: new Set(), // chaves que ainda não chegaram ao banco
};

const diretorio = () => path.dirname(config.accessPath);
const espelho = (chave) => path.join(diretorio(), `${chave}.json`);

// ---------------------------------------------------------------- espelho
function lerEspelho(chave) {
  try {
    const p = espelho(chave);
    if (!fs.existsSync(p)) return undefined;
    const raw = fs.readFileSync(p, 'utf8').trim();
    return raw ? JSON.parse(raw) : undefined;
  } catch {
    return undefined;
  }
}

function gravarEspelho(chave, dados) {
  try {
    fs.mkdirSync(diretorio(), { recursive: true });
    fs.writeFileSync(espelho(chave), `${JSON.stringify(dados, null, 2)}\n`, 'utf8');
  } catch (err) {
    // espelho é rede de segurança, não a fonte: falhar aqui não pode derrubar
    // a gravação, que já está na memória e a caminho do banco
    console.error(`[cofre] espelho de ${chave} falhou: ${err.message}`);
  }
}

// ------------------------------------------------------------------ banco
/**
 * Cria o banco e a tabela se não existirem.
 *
 * Banco PRÓPRIO, e não uma tabela no `DB_Applicattion`: aqui moram a matriz de
 * acesso e a chave da IA cifrada. `DB_Applicattion` é leitura de vários
 * sistemas, e configuração de acesso não deve viajar junto com dado de negócio.
 */
async function garantirEstrutura() {
  const pool = await conexao();
  await pool.query(`CREATE DATABASE IF NOT EXISTS \`${BASE}\`
    CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
  await pool.query(`CREATE TABLE IF NOT EXISTS ${TABELA} (
    chave          VARCHAR(64)  NOT NULL PRIMARY KEY,
    valor          LONGTEXT     NOT NULL,
    atualizado_em  TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    atualizado_por VARCHAR(190) NULL
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
}

async function gravarNoBanco(chave, dados, porQuem = null) {
  const pool = await conexao();
  await pool.query(
    `INSERT INTO ${TABELA} (chave, valor, atualizado_por) VALUES (?, ?, ?)
     ON DUPLICATE KEY UPDATE valor = VALUES(valor), atualizado_por = VALUES(atualizado_por)`,
    [chave, JSON.stringify(dados ?? null), porQuem],
  );
}

/**
 * Empurra para o banco o que ainda não chegou lá.
 *
 * Chamada depois de cada gravação e no boot. Silenciosa no sucesso; no erro
 * mantém a chave pendente, e a tela de Configurações mostra isso — gravação que
 * falha calada é como a configuração se perdeu da primeira vez.
 */
async function sincronizar() {
  if (!estado.pendentes.size) return;
  for (const chave of [...estado.pendentes]) {
    try {
      await gravarNoBanco(chave, estado.memoria.get(chave), estado.memoria.get(`${chave}:por`));
      estado.pendentes.delete(chave);
      estado.banco = { ok: true, erro: null, em: new Date().toISOString() };
    } catch (err) {
      estado.banco = { ok: false, erro: err.message, em: new Date().toISOString() };
      console.error(`[cofre] não consegui gravar "${chave}" no banco: ${err.message}`);
      return; // o próximo ciclo tenta de novo; não adianta insistir nas outras
    }
  }
}

// ------------------------------------------------------------------- API
/**
 * Boot: banco -> memória. Com o banco fora, espelho -> memória.
 *
 * Também MIGRA: chave que não existe no banco mas tem arquivo antigo no volume
 * é levada para lá na primeira subida. É o que faz a instalação existente
 * atravessar sem ninguém redigitar nada.
 */
export async function carregar() {
  let doBanco = new Map();
  try {
    const pool = await conexao();
    await garantirEstrutura();
    const [linhas] = await pool.query(`SELECT chave, valor FROM ${TABELA}`);
    for (const l of linhas) {
      try { doBanco.set(l.chave, JSON.parse(l.valor)); } catch { /* linha corrompida: ignora */ }
    }
    estado.banco = { ok: true, erro: null, em: new Date().toISOString() };
  } catch (err) {
    estado.banco = { ok: false, erro: err.message, em: new Date().toISOString() };
    console.error(`[cofre] banco indisponível no boot (${err.message}) — usando o espelho local`);
    doBanco = new Map();
  }

  for (const chave of CHAVES) {
    if (doBanco.has(chave)) {
      estado.memoria.set(chave, doBanco.get(chave));
      gravarEspelho(chave, doBanco.get(chave));
      continue;
    }
    /**
     * Não está no banco: vale o que houver em disco — mas só SOBE para o banco
     * se alguém pedir.
     *
     * A migração automática parece boa e é uma armadilha: em 02/10/2026 eu subi
     * o servidor na minha máquina apontando para o MariaDB de produção, e ela
     * levou a configuração do MEU ambiente de teste para a tabela de produção —
     * uma matriz de agosto que restringia seis telas a uma única pessoa. Foi
     * desfeito, mas o próximo a rodar local cairia no mesmo buraco.
     *
     * Com `COFRE_MIGRAR=1` o deploy que tem arquivo legado o promove, de
     * propósito e uma vez só. Sem a variável, disco é leitura de emergência e
     * nada mais.
     */
    const local = lerEspelho(chave) ?? lerArquivoAntigo(chave);
    if (local === undefined) continue;
    estado.memoria.set(chave, local);
    if (estado.banco.ok && process.env.COFRE_MIGRAR === '1') estado.pendentes.add(chave);
  }

  estado.carregado = true;
  const migradas = estado.pendentes.size;
  await sincronizar();
  if (migradas) console.log(`[cofre] ${migradas} chave(s) migradas do arquivo para ${BASE}.config`);
  console.log(`[cofre] ${estado.memoria.size} chave(s) em memória · banco ${estado.banco.ok ? 'ok' : 'FORA'}`);
  return estado;
}

/** O JSON da era dos arquivos, se ainda estiver no volume. */
function lerArquivoAntigo(chave) {
  try {
    const p = chave === 'access'
      ? config.accessPath
      : path.join(diretorio(), ARQUIVO_ANTIGO[chave]);
    if (!fs.existsSync(p)) return undefined;
    const raw = fs.readFileSync(p, 'utf8').trim();
    return raw ? JSON.parse(raw) : undefined;
  } catch {
    return undefined;
  }
}

/** Leitura SÍNCRONA, da memória. `padrao` quando a chave nunca foi gravada. */
export function ler(chave, padrao = null) {
  if (!estado.memoria.has(chave)) return padrao;
  const v = estado.memoria.get(chave);
  return v === undefined || v === null ? padrao : v;
}

/**
 * Gravação SÍNCRONA do ponto de vista de quem chama: memória e espelho na hora,
 * banco logo em seguida. O `catch` vazio é proposital — `sincronizar` já guarda
 * o erro em `estado.banco` e mantém a chave pendente.
 */
export function gravar(chave, dados, porQuem = null) {
  estado.memoria.set(chave, dados);
  if (porQuem) estado.memoria.set(`${chave}:por`, porQuem);
  gravarEspelho(chave, dados);
  estado.pendentes.add(chave);
  sincronizar().catch(() => {});
  return dados;
}

/** Remove a chave (volta ao padrão do código). */
export function apagar(chave) {
  estado.memoria.delete(chave);
  try { if (fs.existsSync(espelho(chave))) fs.rmSync(espelho(chave)); } catch { /* idem */ }
  conexao()
    .then((pool) => pool.query(`DELETE FROM ${TABELA} WHERE chave = ?`, [chave]))
    .catch((err) => {
      estado.banco = { ok: false, erro: err.message, em: new Date().toISOString() };
    });
}

/** Saúde do cofre, para a tela de Configurações dizer a verdade. */
export function saude() {
  return {
    base: BASE,
    carregado: estado.carregado,
    chaves: CHAVES.filter((c) => estado.memoria.has(c)),
    banco: estado.banco,
    pendentes: [...estado.pendentes],
  };
}

/** Tudo de uma vez, para o botão de exportar da tela de Configurações. */
export function exportar() {
  const out = { exportadoEm: new Date().toISOString(), versao: 1, config: {} };
  for (const c of CHAVES) if (estado.memoria.has(c)) out.config[c] = estado.memoria.get(c);
  return out;
}

/** O inverso: recarrega a partir de um export. Devolve as chaves aplicadas. */
export function importar(pacote, porQuem = null) {
  const dados = pacote?.config;
  if (!dados || typeof dados !== 'object') throw new Error('Pacote inválido: falta o campo "config".');
  const aplicadas = [];
  for (const c of CHAVES) {
    if (!(c in dados)) continue;
    gravar(c, dados[c], porQuem);
    aplicadas.push(c);
  }
  if (!aplicadas.length) throw new Error('Pacote não traz nenhuma chave conhecida.');
  return aplicadas;
}

/** Só para teste: estado limpo entre casos. */
export function _zerar() {
  estado.memoria.clear();
  estado.pendentes.clear();
  estado.carregado = false;
  estado.banco = { ok: false, erro: null, em: null };
}
