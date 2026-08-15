/**
 * Controle de acesso: papéis (RBAC) + permissão por tela (ACL).
 *
 * Papéis, do menor para o maior:
 *   viewer  → qualquer conta do domínio permitido; vê as telas liberadas.
 *   dev     → power user: além das telas, enxerga o catálogo de queries do sistema.
 *   admin   → tudo, inclusive a tela de configurações e a gestão de acessos.
 *
 * O papel efetivo é o MAIOR entre a semente do .env (ADMIN_EMAILS / DEV_EMAILS)
 * e o que estiver gravado em access.json — assim sempre existe um admin capaz de
 * abrir a tela, mesmo com o arquivo vazio, e a tela não consegue rebaixar quem
 * está no .env.
 *
 * Cada tela tem um modo de acesso:
 *   'todos' → qualquer usuário autenticado do domínio
 *   'lista' → apenas os e-mails informados (admin sempre passa)
 */
import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config.js';

export const PAPEIS = ['viewer', 'dev', 'admin'];
const RANK = { viewer: 0, dev: 1, admin: 2 };

export const rank = (papel) => RANK[papel] ?? 0;
export const peloMenos = (papel, minimo) => rank(papel) >= rank(minimo);

/** Telas do dashboard — a mesma lista alimenta a navegação e a tela de acessos. */
export const TELAS = [
  { id: 'capa', label: 'Capa', rota: '/capa', descricao: 'Página inicial com o objetivo e o status das fontes' },
  { id: 'diretoria', label: 'Diretoria', rota: '/diretoria', descricao: 'Resumo executivo dos três indicadores' },
  { id: 'primeiro-pagamento', label: 'Primeiro Pagamento', rota: '/primeiro-pagamento', descricao: 'Clientes que pagaram a primeira fatura' },
  { id: 'ativacoes', label: 'Ativações', rota: '/ativacoes', descricao: 'Instalações concluídas' },
  { id: 'ativacoes-historico', label: 'Ativações - Histórico', rota: '/ativacoes-historico', descricao: 'Matriz de ativações por vendedor' },
  { id: 'vendas', label: 'Vendas', rota: '/vendas', descricao: 'Contratos criados' },
  { id: 'vendas-historico', label: 'Vendas - Histórico', rota: '/vendas-historico', descricao: 'Matriz de vendas por vendedor' },
  { id: 'rampagem', label: 'Rampagem', rota: '/rampagem', descricao: 'Vendedores nos primeiros 90 dias' },
  { id: 'premiacoes', label: 'Premiações', rota: '/premiacoes', descricao: 'Faixas e valores de premiação (dado sensível)' },
  { id: 'preditivo', label: 'Análise Preditiva', rota: '/preditivo', descricao: 'Projeções, carteira em risco e leitura por IA' },
];

export const TELA_IDS = TELAS.map((t) => t.id);

const csv = (v) => String(v || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
const ENV_ADMINS = new Set(csv(process.env.ADMIN_EMAILS));
const ENV_DEVS = new Set(csv(process.env.DEV_EMAILS || process.env.POWER_USER_EMAILS));

const vazio = () => ({ papeis: {}, telas: {} });

function ler() {
  try {
    if (!fs.existsSync(config.accessPath)) return vazio();
    const raw = fs.readFileSync(config.accessPath, 'utf8').trim();
    if (!raw) return vazio();
    const d = JSON.parse(raw);
    return {
      papeis: d && typeof d.papeis === 'object' ? d.papeis : {},
      telas: d && typeof d.telas === 'object' ? d.telas : {},
    };
  } catch (err) {
    console.warn(`[acesso] não foi possível ler ${config.accessPath}: ${err.message} — usando só o .env`);
    return vazio();
  }
}

function gravar(dados) {
  fs.mkdirSync(path.dirname(config.accessPath), { recursive: true });
  fs.writeFileSync(config.accessPath, `${JSON.stringify(dados, null, 2)}\n`, 'utf8');
}

const normEmail = (e) => String(e || '').trim().toLowerCase();

function papelDoEnv(email) {
  const e = normEmail(email);
  if (ENV_ADMINS.has(e)) return 'admin';
  if (ENV_DEVS.has(e)) return 'dev';
  return 'viewer';
}

/** Papel efetivo = maior entre .env e arquivo. */
export function papelDe(email) {
  const e = normEmail(email);
  const doEnv = papelDoEnv(e);
  const doArquivo = ler().papeis[e];
  const arquivo = RANK[doArquivo] != null ? doArquivo : 'viewer';
  return rank(doEnv) >= rank(arquivo) ? doEnv : arquivo;
}

/** Lista consolidada para a tela de acessos. */
export function listarUsuarios() {
  const { papeis } = ler();
  const out = new Map();
  for (const e of ENV_ADMINS) out.set(e, { email: e, papel: 'admin', origem: 'env' });
  for (const e of ENV_DEVS) if (!out.has(e)) out.set(e, { email: e, papel: 'dev', origem: 'env' });
  for (const [e, papel] of Object.entries(papeis)) {
    if (RANK[papel] == null) continue;
    const efetivo = papelDe(e);
    if (!out.has(e) || rank(efetivo) > rank(out.get(e).papel)) {
      out.set(e, { email: e, papel: efetivo, origem: rank(papelDoEnv(e)) >= rank(papel) ? 'env' : 'arquivo' });
    }
  }
  return [...out.values()].sort((a, b) => rank(b.papel) - rank(a.papel) || a.email.localeCompare(b.email));
}

export function definirPapel(email, papel) {
  const e = normEmail(email);
  if (!e.includes('@')) throw new Error('E-mail inválido.');
  if (!PAPEIS.includes(papel)) throw new Error(`Papel inválido: ${papel}.`);
  const dados = ler();
  if (papel === 'viewer') delete dados.papeis[e];
  else dados.papeis[e] = papel;
  gravar(dados);
  return papelDe(e);
}

export function removerUsuario(email) {
  const e = normEmail(email);
  const dados = ler();
  if (!(e in dados.papeis)) return false;
  delete dados.papeis[e];
  gravar(dados);
  return true;
}

/** Configuração de acesso de todas as telas (com o padrão preenchido). */
export function listarTelas() {
  const { telas } = ler();
  return TELAS.map((t) => {
    const cfg = telas[t.id] || {};
    const modo = cfg.modo === 'lista' ? 'lista' : 'todos';
    return {
      ...t,
      modo,
      emails: Array.isArray(cfg.emails) ? cfg.emails.map(normEmail).filter(Boolean) : [],
      atualizadoEm: cfg.atualizadoEm || null,
      atualizadoPor: cfg.atualizadoPor || null,
    };
  });
}

export function definirTela(id, { modo, emails }, porQuem) {
  if (!TELA_IDS.includes(id)) throw new Error(`Tela desconhecida: ${id}.`);
  if (modo !== 'todos' && modo !== 'lista') throw new Error('Modo inválido (use "todos" ou "lista").');
  const lista = [...new Set((emails || []).map(normEmail).filter((e) => e.includes('@')))];
  if (modo === 'lista' && !lista.length) {
    throw new Error('No modo "lista" informe ao menos um e-mail (senão ninguém além dos admins veria a tela).');
  }
  const dados = ler();
  dados.telas[id] = {
    modo,
    emails: lista,
    atualizadoEm: new Date().toISOString(),
    atualizadoPor: normEmail(porQuem),
  };
  gravar(dados);
  return listarTelas().find((t) => t.id === id);
}

/** O usuário pode abrir a tela? Admin sempre pode. */
export function podeVerTela(usuario, telaId) {
  if (!usuario) return false;
  if (usuario.papel === 'admin') return true;
  const tela = listarTelas().find((t) => t.id === telaId);
  if (!tela) return true; // tela sem ACL definida (ex.: rota nova) → liberada
  if (tela.modo === 'todos') return true;
  return tela.emails.includes(normEmail(usuario.email));
}

/** Telas visíveis para o usuário — o front usa para montar a navegação. */
export function telasDoUsuario(usuario) {
  return listarTelas()
    .filter((t) => podeVerTela(usuario, t.id))
    .map((t) => t.id);
}
