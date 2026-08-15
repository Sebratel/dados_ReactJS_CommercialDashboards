/**
 * Catálogo das consultas que alimentam o dashboard — é o que a tela de
 * configurações mostra para os usuários DEV. Cada item traz o SQL real, o banco,
 * os parâmetros e as estatísticas da última execução do ETL.
 */
import { config } from '../config.js';
import { loadSql, pool as pgPool } from '../db/pg.js';
import * as maria from '../db/maria.js';
import { SENIOR_SQL, TEAMS_SQL } from '../sql/maria.js';
import { getState } from './store.js';

export const CATALOGO = [
  {
    id: 'base',
    titulo: 'Vendas / contratos',
    descricao: 'Réplica da tabela "general" do Power BI: um registro por contrato criado a partir do recorte histórico. É a base de tudo.',
    banco: 'voalle',
    fonte: 'base',
    origemPbi: 'general (dsn=dbVoalle)',
    params: () => [config.since],
  },
  {
    id: 'aloc',
    titulo: 'Ativações de fibra e rádio',
    descricao: 'Data de ativação pela saída do equipamento; ignora os casos em que o equipamento voltou no mesmo dia.',
    banco: 'voalle',
    fonte: 'aloc',
    origemPbi: 'ALOCAÇÃO/ATIVAÇÃO',
    params: () => [config.since],
  },
  {
    id: 'phone',
    titulo: 'Ativações de telefonia',
    descricao: 'Data de conclusão do relatório técnico das instalações de telefonia.',
    banco: 'voalle',
    fonte: 'phone',
    origemPbi: 'phone activation',
    params: () => [config.phoneSince],
  },
  {
    id: 'pagto',
    titulo: 'Primeiro pagamento',
    descricao: 'Primeiro pagamento de cada cliente por contrato (DISTINCT ON no lugar do ROW_NUMBER do Power Query).',
    banco: 'voalle',
    fonte: 'pagto',
    origemPbi: 'PAGAMENTO',
    params: () => [config.since],
  },
  {
    id: 'sellers',
    titulo: 'Vendedores (usuários do Voalle)',
    descricao: 'Usuários do sistema usados como vendedores; a admissão vem do RH quando existe.',
    banco: 'voalle',
    fonte: 'sellers',
    origemPbi: 'new_sellers',
    params: () => [],
  },
  {
    id: 'teams',
    titulo: 'Equipes comerciais',
    descricao: 'Vendedor, equipe e situação (Interno/Externo) — alimenta os filtros e as faixas de premiação.',
    banco: 'maria',
    fonte: 'teams',
    origemPbi: 'teams (dsn=dbMaria)',
    sql: TEAMS_SQL,
  },
  {
    id: 'senior',
    titulo: 'Colaboradores ativos (RH Senior)',
    descricao: 'Admissão dos colaboradores sem desligamento; define quem entra em Rampagem e Premiações.',
    banco: 'maria',
    fonte: 'senior',
    origemPbi: 'senior_admitted',
    sql: SENIOR_SQL,
  },
];

const sqlDe = (item) => (item.sql != null ? item.sql : loadSql(item.id));

export function listarQueries() {
  const { sources } = getState();
  return CATALOGO.map((item) => {
    const s = sources[item.fonte] || {};
    return {
      id: item.id,
      titulo: item.titulo,
      descricao: item.descricao,
      banco: item.banco,
      bancoLabel: item.banco === 'voalle' ? 'Voalle · PostgreSQL' : 'MariaDB',
      origemPbi: item.origemPbi,
      sql: sqlDe(item).trim(),
      params: item.params ? item.params() : [],
      ultimaExecucao: s.updatedAt || null,
      linhas: s.rows ?? null,
      ms: s.ms ?? null,
      erro: s.error || null,
      incrementos: s.incrementais ?? null,
    };
  });
}

/** Executa a consulta com LIMIT para o DEV inspecionar o resultado. */
export async function testarQuery(id, limite = 20) {
  const item = CATALOGO.find((q) => q.id === id);
  if (!item) throw new Error(`Query desconhecida: ${id}`);
  const lim = Math.min(Math.max(Number(limite) || 20, 1), 200);
  const sql = sqlDe(item).trim().replace(/;\s*$/, '');
  const envolvido = `SELECT * FROM (${sql}) AS amostra LIMIT ${lim}`;
  const inicio = Date.now();

  if (item.banco === 'voalle') {
    const res = await pgPool.query(envolvido, item.params ? item.params() : []);
    return {
      colunas: res.fields.map((f) => f.name),
      linhas: res.rows,
      ms: Date.now() - inicio,
      limite: lim,
    };
  }

  const { rows } = await maria.query(envolvido);
  return {
    colunas: rows.length ? Object.keys(rows[0]) : [],
    linhas: rows,
    ms: Date.now() - inicio,
    limite: lim,
  };
}
