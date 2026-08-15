import dotenv from 'dotenv';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// .env pode estar em dashboard/.env, server/.env ou no diretório de trabalho
for (const candidate of [
  path.resolve(__dirname, '../../.env'),
  path.resolve(__dirname, '../.env'),
  path.resolve(process.cwd(), '.env'),
]) {
  if (fs.existsSync(candidate)) dotenv.config({ path: candidate });
}

const num = (v, d) => (v === undefined || v === '' || Number.isNaN(Number(v)) ? d : Number(v));

export const config = {
  port: num(process.env.PORT, 8080),
  publicDir: process.env.PUBLIC_DIR || path.resolve(__dirname, '../public'),

  // Voalle (PostgreSQL) — dsn=dbVoalle no Power BI
  voalle: {
    host: process.env.DB_VOALLE_HOST || process.env.DB_ELLEVEN_HOST,
    database: process.env.DB_VOALLE_DATABASE || process.env.DB_ELLEVEN_DATABASE,
    user: process.env.DB_VOALLE_USER || process.env.DB_ELLEVEN_USER,
    password: process.env.DB_VOALLE_PASSWORD || process.env.DB_ELLEVEN_PASSWORD,
    port: num(process.env.DB_VOALLE_PORT || process.env.DB_ELLEVEN_PORT, 5432),
    max: num(process.env.DB_VOALLE_POOL, 5),
    statement_timeout: num(process.env.DB_VOALLE_TIMEOUT_MS, 180000),
  },

  // MariaDB — dsn=dbMaria no Power BI
  maria: {
    host: process.env.DB_MARIA_HOST,
    database: process.env.DB_MARIA_DATABASE || 'DB_Applicattion',
    user: process.env.DB_MARIA_USER,
    password: process.env.DB_MARIA_PASSWORD,
    port: num(process.env.DB_MARIA_PORT, 3306),
    connectionLimit: num(process.env.DB_MARIA_POOL, 3),
  },

  // Recorte histórico (mesmo do modelo do Power BI)
  since: process.env.DATA_SINCE || '2024-01-01',
  phoneSince: process.env.PHONE_SINCE || '2024-11-01',

  // Autenticação (Google) e controle de acesso
  auth: {
    habilitado: String(process.env.AUTH_ENABLED ?? 'true').toLowerCase() !== 'false',
    clientId: process.env.GOOGLE_CLIENT_ID || '',
    clientSecret: process.env.GOOGLE_CLIENT_SECRET || '',
    dominio: (process.env.ALLOWED_DOMAIN || 'sebratel.com.br').toLowerCase(),
  },
  // Onde ficam papéis e permissões por tela (volume no Docker)
  accessPath: process.env.ACCESS_PATH
    ? path.resolve(process.env.ACCESS_PATH)
    : path.resolve(__dirname, '../data/access.json'),

  // Janela (em dias) das cargas incrementais
  incrementalDays: num(process.env.INCREMENTAL_DAYS, 60),

  // Frequência de atualização (ms)
  refresh: {
    // janela incremental: vendas, ativações e primeiro pagamento recentes
    hot: num(process.env.REFRESH_HOT_MS, 120000), // 2 min
    // recarga completa desde DATA_SINCE
    full: num(process.env.REFRESH_FULL_MS, 1800000), // 30 min
    // cadastros auxiliares (equipes, RH, usuários)
    dims: num(process.env.REFRESH_DIMS_MS, 900000), // 15 min
  },
};

export function assertConfig() {
  const missing = [];
  if (!config.voalle.host) missing.push('DB_VOALLE_HOST/DB_ELLEVEN_HOST');
  if (!config.voalle.database) missing.push('DB_VOALLE_DATABASE/DB_ELLEVEN_DATABASE');
  if (!config.maria.host) missing.push('DB_MARIA_HOST');
  if (missing.length) {
    throw new Error(`Variáveis de ambiente ausentes: ${missing.join(', ')}`);
  }
}
