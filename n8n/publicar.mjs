/**
 * Publica os fluxos de n8n deste repositório pela API REST do n8n.
 *
 *   node n8n/publicar.mjs --env=<.env com N8N_*>                 # ensaio: mostra, não escreve
 *   node n8n/publicar.mjs --env=<...> --aplicar                   # cria ou atualiza o fluxo
 *   node n8n/publicar.mjs --env=<...> --credenciais               # cria as credenciais (uma vez)
 *
 * `N8N_BASE_URL` e `N8N_API_KEY` vêm do ambiente ou do arquivo em `--env`.
 * As credenciais do MariaDB vêm do `dashboard/.env` (DB_MARIA_*), as mesmas que o
 * dashboard usa.
 *
 * NUNCA ATIVA NADA. Criar o fluxo parado é inofensivo; ligar é decisão de quem
 * opera, olhando a primeira execução. A ativação fica na tela do n8n.
 *
 * POR QUE ISTO EXISTE. A sincronização git ↔ n8n é recurso Enterprise. Sem ela,
 * publicar vira hábito manual, e hábito manual falha em silêncio: o repositório
 * passa a descrever um fluxo que não é o que está rodando.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { montarFluxo, NOME } from './google-ads/fluxo.mjs';

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const ENV_DASHBOARD = path.join(AQUI, '..', '.env');
const ARQ_CREDENCIAIS = path.join(AQUI, 'credenciais.json');
const APLICAR = process.argv.includes('--aplicar');
const CREDENCIAIS = process.argv.includes('--credenciais');

/** O fluxo de erro que 53 fluxos da instância já usam (AUT_GLOBAL_ERR). */
const FLUXO_DE_ERRO = 'YQflxrNGhAmVwu96';

function lerEnv(arquivo) {
  const out = {};
  if (!fs.existsSync(arquivo)) return out;
  for (const linha of fs.readFileSync(arquivo, 'utf8').split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(linha);
    if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, '').trim();
  }
  return out;
}

const envArg = process.argv.find((a) => a.startsWith('--env='));
const envN8n = envArg ? lerEnv(envArg.slice(6)) : {};
const BASE = (process.env.N8N_BASE_URL || envN8n.N8N_BASE_URL || '').replace(/\/+$/, '');
const KEY = process.env.N8N_API_KEY || envN8n.N8N_API_KEY || '';
if (!BASE || !KEY) {
  console.error('Faltam N8N_BASE_URL e N8N_API_KEY (ambiente ou --env=).');
  process.exit(1);
}

async function api(caminho, opcoes = {}) {
  const r = await fetch(`${BASE}/api/v1${caminho}`, {
    ...opcoes,
    headers: { 'X-N8N-API-KEY': KEY, 'Content-Type': 'application/json', Accept: 'application/json' },
    signal: AbortSignal.timeout(60000),
  });
  const txt = await r.text();
  if (!r.ok) throw new Error(`${r.status} ${r.statusText} em ${caminho}: ${txt.slice(0, 300)}`);
  return txt ? JSON.parse(txt) : null;
}

async function criarCredenciais() {
  if (fs.existsSync(ARQ_CREDENCIAIS)) {
    console.log(`Credenciais já criadas (${path.basename(ARQ_CREDENCIAIS)}). Nada a fazer.`);
    return;
  }
  const db = lerEnv(ENV_DASHBOARD);
  for (const k of ['DB_MARIA_HOST', 'DB_MARIA_USER', 'DB_MARIA_PASSWORD']) {
    if (!db[k]) throw new Error(`Falta ${k} em ${ENV_DASHBOARD}.`);
  }
  if (!APLICAR) {
    console.log('[ensaio] criaria: "dbMaria_DB_Marketing" (MySQL) e "MKT · Google Ads · chave do webhook" (cabeçalho).');
    return;
  }
  const mysql = await api('/credentials', {
    method: 'POST',
    body: JSON.stringify({
      name: 'dbMaria_DB_Marketing',
      type: 'mySql',
      data: {
        host: db.DB_MARIA_HOST,
        database: 'DB_Marketing',
        user: db.DB_MARIA_USER,
        password: db.DB_MARIA_PASSWORD,
        port: Number(db.DB_MARIA_PORT || 3306),
        connectTimeout: 10000,
        ssl: false,
        sshTunnel: false,
      },
    }),
  });

  // a chave fica no .env do dashboard (fora do git) para colar no script do Google Ads
  const chave = crypto.randomBytes(32).toString('base64url');
  const cabecalho = await api('/credentials', {
    method: 'POST',
    body: JSON.stringify({
      name: 'MKT · Google Ads · chave do webhook',
      type: 'httpHeaderAuth',
      data: { name: 'X-Chave-Carga', value: chave },
    }),
  });
  fs.appendFileSync(
    ENV_DASHBOARD,
    `\n# ---- chave do webhook do n8n que recebe o Google Ads (vai no script do Google Ads) ----\nGOOGLE_ADS_CHAVE_WEBHOOK=${chave}\n`,
  );
  fs.writeFileSync(ARQ_CREDENCIAIS, `${JSON.stringify({
    mySql: { id: mysql.id, name: mysql.name },
    httpHeaderAuth: { id: cabecalho.id, name: cabecalho.name },
  }, null, 2)}\n`);
  console.log(`Criadas: ${mysql.name} (${mysql.id}) e ${cabecalho.name} (${cabecalho.id}).`);
  console.log('A chave do webhook foi gravada em dashboard/.env como GOOGLE_ADS_CHAVE_WEBHOOK.');
}

async function todosWorkflows() {
  const out = [];
  let cursor = null;
  for (let i = 0; i < 30; i += 1) {
    const p = await api(`/workflows?limit=100${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`);
    out.push(...(p.data ?? []));
    if (!p.nextCursor) break;
    cursor = p.nextCursor;
  }
  return out;
}

/**
 * A TRAVA. Só sobrescreve um fluxo de mesmo nome se ao menos metade dos nós dele
 * existir no arquivo — senão é fluxo de outra pessoa com o nome igual, e o update
 * apagaria o trabalho dela.
 */
function pareceNosso(remoto, local) {
  const nossos = new Set(local.nodes.map((n) => n.name));
  const funcionais = (remoto.nodes ?? []).filter((n) => !/stickyNote/i.test(n.type));
  if (!funcionais.length) return true;
  return funcionais.filter((n) => nossos.has(n.name)).length >= funcionais.length / 2;
}

async function publicarFluxo() {
  if (!fs.existsSync(ARQ_CREDENCIAIS)) throw new Error('Rode antes com --credenciais --aplicar.');
  const cred = JSON.parse(fs.readFileSync(ARQ_CREDENCIAIS, 'utf8'));
  const fluxo = montarFluxo({ credMySql: cred.mySql, credChave: cred.httpHeaderAuth, fluxoDeErro: FLUXO_DE_ERRO });
  fs.writeFileSync(path.join(AQUI, 'google-ads', 'fluxo.json'), `${JSON.stringify(fluxo, null, 2)}\n`);

  const existente = (await todosWorkflows()).find((w) => w.name === NOME);
  if (existente && !pareceNosso(existente, fluxo)) {
    throw new Error(`Já existe um fluxo "${NOME}" (${existente.id}) que não parece ser este. Recusado.`);
  }
  if (!APLICAR) {
    console.log(`[ensaio] ${existente ? `atualizaria ${existente.id}` : 'criaria'} "${NOME}" com ${fluxo.nodes.length} nós.`);
    return;
  }
  const corpo = JSON.stringify({ name: fluxo.name, nodes: fluxo.nodes, connections: fluxo.connections, settings: fluxo.settings });
  const r = existente
    ? await api(`/workflows/${existente.id}`, { method: 'PUT', body: corpo })
    : await api('/workflows', { method: 'POST', body: corpo });
  console.log(`${existente ? 'Atualizado' : 'Criado'}: "${r.name}" (${r.id}) — ativo: ${r.active}. Ative pela tela do n8n.`);
}

try {
  if (CREDENCIAIS) await criarCredenciais();
  else await publicarFluxo();
} catch (err) {
  console.error(err.message);
  process.exit(1);
}
