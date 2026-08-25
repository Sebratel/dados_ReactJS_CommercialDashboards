import dotenv from 'dotenv';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { janela } from './janela.js';

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
    /**
     * Quanto tempo uma consulta espera por uma conexão livre do pool.
     *
     * Eram 20 s, e isso derrubava fonte na carga inicial: são dez consultas para
     * cinco conexões, e as pesadas seguram a conexão por 60 a 85 s. Quem entrava
     * na fila desistia antes da vez — na prática, uma fonte diferente falhava a
     * cada reinício, à sorte de quem chegava por último. Esperar é o
     * comportamento certo: a rajada da carga inicial é conhecida e tem fim.
     */
    connect_timeout: num(process.env.DB_VOALLE_CONNECT_TIMEOUT_MS, 180000),
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

  // Recorte histórico (mesmo do modelo do Power BI). Getter, e não valor fixo:
  // o .env é só a semente, quem manda é o que o admin definiu em Configurações.
  // Todo ponto que monta SQL lê isto de forma preguiçosa, então a carga seguinte
  // já usa o recorte novo — sem reiniciar o processo.
  get since() { return janela().since; },
  get phoneSince() { return janela().phoneSince; },
  // Recorte das consultas de CRM (leads e negociações), definido em
  // Configurações → Janela de dados. Getter pelo mesmo motivo dos outros dois: a
  // carga seguinte já usa o valor novo, sem reiniciar o processo.
  get crmSince() { return janela().crmSince; },

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
    // condomínios: rede de splitters e ocupação das portas. Muda quando alguém
    // instala equipamento ou conecta cliente — dá minutos, não segundos.
    cond: num(process.env.REFRESH_COND_MS, 600000), // 10 min
    // CRM: leads e negociações. Medido no banco de produção, o par de consultas
    // custa ~25 s (68 mil leads e 31 mil negociações, ambas com subconsulta
    // EXISTS por linha). A 5 minutos isso seria 8% do tempo com o Voalle
    // ocupado só com esta tela; a 10 vira 4%, e um lead que entrou agora aparece
    // em no máximo dez minutos — que é o tempo de alguém abrir a tela.
    crm: num(process.env.REFRESH_CRM_MS, 600000), // 10 min
    // relatórios: cesta de produtos, pesquisa de cancelamento, fila de instalação e
    // base de clientes. A cesta é a mais cara do conjunto — 220 mil linhas em ~21 s,
    // medido no banco de produção. A 15 minutos isso é 2% do tempo com o Voalle
    // ocupado por esta tela, e nenhum dos quatro números muda de minuto a minuto.
    rel: num(process.env.REFRESH_REL_MS, 900000), // 15 min
    // clima: a verificação é de hora em hora, mas a BUSCA acontece uma vez por dia —
    // `atualizarClima` só vai à rede se o cache não for de hoje. O intervalo curto
    // existe para o dia virar sem esperar reinício, não para pedir de novo.
    clima: num(process.env.REFRESH_CLIMA_MS, 3600000), // 1 h
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
