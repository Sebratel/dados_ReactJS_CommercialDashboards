/**
 * Catálogo das consultas que alimentam o dashboard — é o que a tela de
 * configurações mostra para os usuários DEV. Cada item traz o SQL real, o banco,
 * os parâmetros e as estatísticas da última execução do ETL.
 */
import { config } from '../config.js';
import { loadSql, pool as pgPool } from '../db/pg.js';
import * as maria from '../db/maria.js';
import { GENERAL_COMMERCIAL_SQL, SENIOR_SQL, TEAMS_SQL } from '../sql/maria.js';
import { getState } from './store.js';
import { getEstadoCondominios } from './condominios.js';
import { getEstadoLeads } from './leads.js';
import { getEstadoRelatorios } from './relatorios.js';

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
  {
    id: 'splitters',
    titulo: 'Condomínios — portas dos splitters',
    descricao: 'Réplica de SPLITTER_(GERAL): uma linha por porta de splitter secundário instalado em condomínio (título com COND., RES. ou ED.). O recorte de condomínio está no WHERE, não em coluna calculada.',
    banco: 'voalle',
    fonte: 'portas',
    modelo: 'condominios',
    origemPbi: 'SPLITTER_(GERAL) (dsn=dbVoalle)',
    params: () => [],
  },
  {
    id: 'splitter_ocupacao',
    titulo: 'Condomínios — ocupação por splitter',
    descricao: 'Capacidade, portas ocupadas e disponíveis de cada splitter. Uma consulta no lugar das quatro do Power BI (OCUPADA/DISPONIVEIS, OCUPACAO, LOTADOS e ZERADOS): as diferenças eram só colunas derivadas e HAVING.',
    banco: 'voalle',
    fonte: 'ocupacao',
    modelo: 'condominios',
    origemPbi: 'SPLITTER_(OCUPADA_/_DISPONIVEIS) + SPLITTER_(OCUPACAO)',
    params: () => [],
  },
  {
    id: 'leads',
    titulo: 'Leads (CRM)',
    descricao: 'Réplica da consulta "leads": uma linha por pessoa no CRM, com a classificação do lead decidida na mesma ordem de cláusulas do relatório. Os rótulos de situação, tipo de documento e gênero saem prontos do SQL, no lugar dos 16 passos de substituição de texto do Power Query.',
    banco: 'voalle',
    fonte: 'leads',
    modelo: 'leads',
    origemPbi: 'leads (dsn=dbVoalle)',
    params: () => [config.crmSince],
  },
  {
    id: 'negotiations',
    titulo: 'Negociações (CRM)',
    descricao: 'Réplica da consulta "negotiations": uma linha por etapa de venda, com fase do funil, motivo do desfecho, serviço negociado e o primeiro/último relatório técnico, que delimitam a duração da negociação.',
    banco: 'voalle',
    fonte: 'negociacoes',
    modelo: 'leads',
    origemPbi: 'negotiations (dsn=dbVoalle)',
    params: () => [config.crmSince],
  },
  {
    id: 'cesta',
    titulo: 'Cesta de produtos',
    descricao: 'Um item de contrato por linha (produto ou serviço avulso com produto definido). A origem lê a tabela inteira — 452.630 linhas, com contrato datado de 1000-01-01; aqui a consulta obedece à Janela de dados.',
    banco: 'voalle',
    fonte: 'cesta',
    modelo: 'relatorios',
    origemPbi: 'Cesta de Produtos (dsn=dbVoalle)',
    params: () => [config.since],
  },
  {
    id: 'cancelamento',
    titulo: 'Pesquisa de cancelamento',
    descricao: 'Atendimentos de cancelamento cujo checklist final registra a pesquisa. O JSON do checklist viaja inteiro e é aberto em pergunta × resposta no modelo, para que um checklist malformado derrube só a própria linha.',
    banco: 'voalle',
    fonte: 'cancelamento',
    modelo: 'relatorios',
    origemPbi: 'Cancelamento (dsn=dbVoalle)',
    params: () => [config.since],
  },
  {
    id: 'backlog',
    titulo: 'Fila de instalação',
    descricao: 'Instalações de fibra e rádio em aberto, com equipamento ainda em estoque. Uma consulta no lugar das duas da origem (backlog agregada e Consulta1 detalhada): a coluna no_detalhe marca as linhas que o detalhe de lá enxergava, porque a lista de equipes das duas divergia. Sem recorte de data, de propósito.',
    banco: 'voalle',
    fonte: 'backlog',
    modelo: 'relatorios',
    origemPbi: 'backlog + Consulta1 (dsn=dbVoalle)',
    params: () => [],
  },
  {
    id: 'contratos_base',
    titulo: 'Base de clientes conectados',
    descricao: 'Contratos com ponto de autenticação — o que caracteriza cliente conectado. A tecnologia sai pronta do SQL, replicando as vinte comparações de prefixo da coluna DAX de origem, na mesma ordem (ST_NH antes de ST_N, e assim por diante).',
    banco: 'voalle',
    fonte: 'base',
    modelo: 'relatorios',
    origemPbi: 'authentication_contracts (dsn=dbVoalle)',
    params: () => [config.since],
  },
  {
    id: 'ponte',
    titulo: 'Ponte histórica de vendas',
    descricao: 'Venda registrada fora do Voalle, de 2022 a 2024. O relatório de origem anexa esta tabela ao general; medido no banco, 98,4% das linhas de 2024 são o mesmo cliente na mesma data que o Voalle já tem. Por isso aqui ela entra só onde o Voalle não tem — 444 linhas em vez de 26.218.',
    banco: 'maria',
    fonte: 'ponte',
    modelo: 'relatorios',
    origemPbi: 'General_Commercial (dsn=dbMaria)',
    sql: GENERAL_COMMERCIAL_SQL,
    params: () => [config.since],
  },
];

const sqlDe = (item) => (item.sql != null ? item.sql : loadSql(item.id));

export function listarQueries() {
  const { sources } = getState();
  const fontesCond = getEstadoCondominios().fontes;
  const fontesLeads = getEstadoLeads().fontes;
  const fontesRel = getEstadoRelatorios().fontes;
  const POR_MODELO = { condominios: fontesCond, leads: fontesLeads, relatorios: fontesRel };
  return CATALOGO.map((item) => {
    // as estatísticas de execução vivem no modelo que a consulta alimenta
    const s = (item.modelo ? POR_MODELO[item.modelo] : sources)[item.fonte] || {};
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

  // A ponte histórica é a primeira consulta de MariaDB com parâmetro; antes daqui
  // este ramo ignorava `params` e a consulta quebrava no `?` sem valor.
  const { rows } = await maria.query(envolvido, item.params ? item.params() : []);
  return {
    colunas: rows.length ? Object.keys(rows[0]) : [],
    linhas: rows,
    ms: Date.now() - inicio,
    limite: lim,
  };
}
