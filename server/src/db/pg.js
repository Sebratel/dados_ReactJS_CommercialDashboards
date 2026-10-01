import pg from 'pg';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from '../config.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SQL_DIR = path.resolve(__dirname, '../sql');

// numeric/decimal -> Number (evita strings nos valores monetários)
pg.types.setTypeParser(1700, (v) => (v === null ? null : Number(v)));
// date -> string YYYY-MM-DD (sem fuso, igual ao Power BI)
pg.types.setTypeParser(1082, (v) => v);

export const pool = new pg.Pool({
  host: config.voalle.host,
  database: config.voalle.database,
  user: config.voalle.user,
  password: config.voalle.password,
  port: config.voalle.port,
  max: config.voalle.max,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: config.voalle.connect_timeout,
  statement_timeout: config.voalle.statement_timeout,
  application_name: 'comercial-dashboard',
});

pool.on('error', (err) => {
  console.error('[pg] erro no pool:', err.message);
});

const cache = new Map();
export function loadSql(name) {
  if (!cache.has(name)) {
    cache.set(name, fs.readFileSync(path.join(SQL_DIR, `${name}.sql`), 'utf8'));
  }
  return cache.get(name);
}

export async function queryFile(name, params = []) {
  const started = Date.now();
  const res = await pool.query(loadSql(name), params);
  return { rows: res.rows, ms: Date.now() - started };
}

/**
 * Consulta com statement_timeout próprio, maior que o do pool.
 *
 * Existe para a base do SLA do BKO: ela casa relatos (`reports`) por texto com
 * ILIKE e leva ~3 min no Voalle — o mesmo tamanho do timeout padrão do pool. O
 * `SET LOCAL` vale só dentro da transação, então a conexão volta ao pool com o
 * limite normal e nenhuma outra consulta herda o valor maior.
 */
export async function queryFileLonga(name, params = [], timeoutMs = 600000) {
  const started = Date.now();
  const client = await pool.connect();
  try {
    await client.query('BEGIN READ ONLY');
    await client.query(`SET LOCAL statement_timeout = ${Math.max(1000, Math.round(Number(timeoutMs) || 600000))}`);
    const res = await client.query(loadSql(name), params);
    await client.query('COMMIT');
    return { rows: res.rows, ms: Date.now() - started };
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch { /* conexão já caiu */ }
    throw err;
  } finally {
    client.release();
  }
}
