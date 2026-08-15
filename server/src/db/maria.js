import mysql from 'mysql2/promise';
import { config } from '../config.js';

export const pool = mysql.createPool({
  host: config.maria.host,
  user: config.maria.user,
  password: config.maria.password,
  port: config.maria.port,
  waitForConnections: true,
  connectionLimit: config.maria.connectionLimit,
  connectTimeout: 20000,
  charset: 'utf8mb4',
  dateStrings: ['DATE', 'DATETIME'],
});

export async function query(sql, params = []) {
  const started = Date.now();
  const [rows] = await pool.query(sql, params);
  return { rows, ms: Date.now() - started };
}
