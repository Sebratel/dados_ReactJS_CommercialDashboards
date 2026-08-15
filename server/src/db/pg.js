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
  connectionTimeoutMillis: 20000,
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
