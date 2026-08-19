/**
 * Controle de acesso: papéis (RBAC) + permissão por tela (ACL).
 *
 * Papéis, do menor para o maior:
 *   viewer  → qualquer conta do domínio permitido; vê as telas liberadas.
 *   dev     → viewer + power user (ver abaixo).
 *   admin   → tudo, inclusive a tela de configurações e a gestão de acessos.
 *
 * O papel efetivo é o MAIOR entre a semente do .env (ADMIN_EMAILS / DEV_EMAILS)
 * e o que estiver gravado em access.json — assim sempre existe um admin capaz de
 * abrir a tela, mesmo com o arquivo vazio, e a tela não consegue rebaixar quem
 * está no .env.
 *
 * POWER USER é um atributo à parte, fora da escada. Administrar pessoas e ler o
 * SQL do sistema são atribuições diferentes: ser admin não concede o atributo —
 * e também não impede. Quem está em DEV_EMAILS, quem tem papel 'dev' ou quem foi
 * marcado na tela enxerga o catálogo de queries, seja qual for o seu papel.
 * Sem essa separação, quem acumula admin e DEV perderia o acesso às queries, já
 * que o papel efetivo pararia em 'admin'.
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
  { id: 'capa', curto: 'Capa', label: 'Capa', rota: '/capa', descricao: 'Página inicial com o objetivo e o status das fontes' },
  { id: 'diretoria', curto: 'Diretoria', label: 'Diretoria', rota: '/diretoria', descricao: 'Resumo executivo dos três indicadores' },
  { id: 'primeiro-pagamento', curto: '1º Pgto', label: 'Primeiro Pagamento', rota: '/primeiro-pagamento', descricao: 'Clientes que pagaram a primeira fatura' },
  { id: 'ativacoes', curto: 'Ativações', label: 'Ativações', rota: '/ativacoes', descricao: 'Instalações concluídas' },
  { id: 'ativacoes-historico', curto: 'Ativ. hist.', label: 'Ativações - Histórico', rota: '/ativacoes-historico', descricao: 'Matriz de ativações por vendedor' },
  { id: 'vendas', curto: 'Vendas', label: 'Vendas', rota: '/vendas', descricao: 'Contratos criados' },
  { id: 'vendas-historico', curto: 'Vendas hist.', label: 'Vendas - Histórico', rota: '/vendas-historico', descricao: 'Matriz de vendas por vendedor' },
  { id: 'rampagem', curto: 'Rampagem', label: 'Rampagem', rota: '/rampagem', descricao: 'Vendedores nos primeiros 90 dias' },
  { id: 'premiacoes', curto: 'Premiações', label: 'Premiações', rota: '/premiacoes', descricao: 'Faixas e valores de premiação (dado sensível)' },
  { id: 'vendas-canceladas', curto: 'Canceladas', label: 'Vendas Canceladas', rota: '/vendas-canceladas', descricao: 'Contratos cancelados que nunca chegaram a ser ativados' },
  { id: 'condominios', curto: 'Condomínios', label: 'Condomínios', rota: '/condominios', descricao: 'Ocupação das portas dos splitters instalados em condomínios' },
  { id: 'preditivo', curto: 'Preditiva', label: 'Análise Preditiva', rota: '/preditivo', descricao: 'Projeções, carteira em risco e leitura por IA' },
];

export const TELA_IDS = TELAS.map((t) => t.id);

const csv = (v) => String(v || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
const ENV_ADMINS = new Set(csv(process.env.ADMIN_EMAILS));
const ENV_DEVS = new Set(csv(process.env.DEV_EMAILS || process.env.POWER_USER_EMAILS));

const normEmail = (e) => String(e || '').trim().toLowerCase();

const vazio = () => ({ papeis: {}, telas: {}, powerUsers: [], escopos: {} });

function ler() {
  try {
    if (!fs.existsSync(config.accessPath)) return vazio();
    const raw = fs.readFileSync(config.accessPath, 'utf8').trim();
    if (!raw) return vazio();
    const d = JSON.parse(raw);
    return {
      papeis: d && typeof d.papeis === 'object' ? d.papeis : {},
      telas: d && typeof d.telas === 'object' ? d.telas : {},
      powerUsers: Array.isArray(d?.powerUsers) ? d.powerUsers.map(normEmail).filter(Boolean) : [],
      escopos: d && typeof d.escopos === 'object' ? d.escopos : {},
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

/**
 * É power user? Independe do papel — some do caminho a pergunta "é dev OU admin".
 * Um admin que não está em nenhuma dessas origens continua sem ver as queries.
 */
export function ehPowerUser(email) {
  const e = normEmail(email);
  if (ENV_DEVS.has(e)) return true;
  const d = ler();
  return d.papeis[e] === 'dev' || d.powerUsers.includes(e);
}

/** Marca/desmarca o atributo sem tocar no papel da pessoa. */
export function definirPowerUser(email, ativo) {
  const e = normEmail(email);
  if (!e.includes('@')) throw new Error('E-mail inválido.');
  const dados = ler();
  const lista = new Set(dados.powerUsers);
  if (ativo) {
    lista.add(e);
  } else {
    if (ENV_DEVS.has(e)) {
      throw new Error('Este e-mail está em DEV_EMAILS no .env — a tela não rebaixa o que vem de lá.');
    }
    lista.delete(e);
    // papel 'dev' é "viewer + power user": tirar o atributo tira também o papel.
    if (dados.papeis[e] === 'dev') delete dados.papeis[e];
  }
  dados.powerUsers = [...lista];
  gravar(dados);
  return ehPowerUser(e);
}

/** Lista consolidada para a tela de acessos. */
export function listarUsuarios() {
  const { papeis, powerUsers } = ler();
  const out = new Map();
  const põe = (e, papel, origem) => out.set(e, { email: e, papel, origem });
  for (const e of ENV_ADMINS) põe(e, 'admin', 'env');
  for (const e of ENV_DEVS) if (!out.has(e)) põe(e, 'dev', 'env');
  for (const [e, papel] of Object.entries(papeis)) {
    if (RANK[papel] == null) continue;
    const efetivo = papelDe(e);
    if (!out.has(e) || rank(efetivo) > rank(out.get(e).papel)) {
      põe(e, efetivo, rank(papelDoEnv(e)) >= rank(papel) ? 'env' : 'arquivo');
    }
  }
  // quem é só power user, sem papel elevado, também precisa aparecer
  for (const e of powerUsers) if (!out.has(e)) põe(e, papelDe(e), 'arquivo');
  return [...out.values()]
    .map((u) => ({ ...u, powerUser: ehPowerUser(u.email), powerUserFixo: ENV_DEVS.has(u.email) }))
    .sort((a, b) => rank(b.papel) - rank(a.papel) || a.email.localeCompare(b.email));
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

/** Tira tudo o que a tela concedeu: o papel e o atributo de power user. */
export function removerUsuario(email) {
  const e = normEmail(email);
  const dados = ler();
  const tinha = e in dados.papeis || dados.powerUsers.includes(e);
  if (!tinha) return false;
  delete dados.papeis[e];
  dados.powerUsers = dados.powerUsers.filter((x) => x !== e);
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
  // Lista vazia em modo restrito é estado válido: a tela fica só para os
  // administradores. Antes isso era recusado, e o efeito colateral era pior que
  // o problema — ao tirar a última pessoa a tela voltava a ser pública, ou seja,
  // uma remoção de acesso ampliava o acesso.
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



/**
 * ESCOPO DE DADOS — a outra metade da permissão.
 *
 * O ACL de tela responde "quais telas você abre". Isto responde "qual fatia dos
 * dados você enxerga", e as duas perguntas são independentes de propósito: o
 * escopo é propriedade do cargo, não da tela. Quem cuida das equipes X, Y e Z
 * cuida delas em Vendas, Ativações e Premiações igualmente, então o escopo vale
 * em TODAS as telas — pendurá-lo em cada tela viraria tela × equipe × pessoa.
 *
 * Sem escopo definido a pessoa vê tudo o que a tela dela mostra: `null` significa
 * "sem recorte", nunca "recorte vazio".
 */
export function escopoDe(email) {
  const e = normEmail(email);
  const cfg = ler().escopos[e];
  const equipes = Array.isArray(cfg?.equipes) ? cfg.equipes.filter(Boolean) : [];
  return equipes.length ? { equipes: [...new Set(equipes)] } : null;
}

/** Lista vazia remove o escopo (volta a ver tudo). */
export function definirEscopo(email, equipes, porQuem) {
  const e = normEmail(email);
  if (!e.includes('@')) throw new Error('E-mail inválido.');
  const lista = [...new Set((equipes || []).map((x) => String(x).trim()).filter(Boolean))];
  // Guardar recorte para quem é isento seria gravar algo sem efeito, que voltaria
  // a valer sozinho no dia em que a pessoa deixasse de ser administradora.
  if (lista.length && papelDe(e) === 'admin') {
    throw new Error('Administrador é isento do recorte de dados — sem isso não conseguiria auditar o que liberou. Rebaixe o papel antes de definir equipes.');
  }
  const dados = ler();
  if (!lista.length) delete dados.escopos[e];
  else {
    dados.escopos[e] = {
      equipes: lista,
      atualizadoEm: new Date().toISOString(),
      atualizadoPor: normEmail(porQuem),
    };
  }
  gravar(dados);
  return escopoDe(e);
}

/**
 * A MESMA permissão vista pelo outro lado.
 *
 * O armazenamento continua por tela (`telas[id] = { modo, emails }`), porque é
 * assim que `podeVerTela` decide a cada requisição. O que muda é a leitura: quem
 * administra pensa em pessoas — "o fulano entrou, libera X, Y e Z" — e não em
 * abrir onze telas para incluir o mesmo e-mail em cada uma.
 *
 * Então a matriz é uma transposição, não um segundo modelo de dados. Não existe
 * estado novo para sair de sincronia com o antigo.
 */
export function matrizDeAcesso() {
  const telas = listarTelas();
  const usuarios = listarUsuarios();

  // Gente que não tem papel elevado mas existe na configuração: aparece nas
  // listas de tela ou tem escopo definido. Sem isto o registro fica gravado e
  // invisível — não haveria como enxergar nem desfazer pela tela.
  const emails = new Map(usuarios.map((u) => [u.email, u]));
  const conhecer = (e) => {
    if (!emails.has(e)) emails.set(e, { email: e, papel: papelDe(e), origem: 'arquivo', powerUser: ehPowerUser(e) });
  };
  for (const t of telas) for (const e of t.emails) conhecer(e);
  for (const e of Object.keys(ler().escopos)) conhecer(normEmail(e));

  const pessoas = [...emails.values()].map((u) => ({
    ...u,
    // admin passa em tudo por definição: marcar caixinha para ele seria mentira
    veTudo: u.papel === 'admin',
    telas: telas.filter((t) => t.emails.includes(u.email)).map((t) => t.id),
    // admin é isento do recorte: sem isso ele não consegue auditar o que liberou
    escopo: u.papel === 'admin' ? null : escopoDe(u.email),
  }));

  pessoas.sort((a, b) => rank(b.papel) - rank(a.papel) || a.email.localeCompare(b.email));
  return { telas, pessoas };
}

/**
 * Grava de uma vez as telas de uma pessoa. É a operação que a matriz usa: um
 * clique numa caixinha manda a linha inteira, então o resultado não depende da
 * ordem em que as telas foram tocadas.
 *
 * Marcar uma tela que está em modo "todos" não faz nada — ela já é visível para
 * todo o domínio. A interface mostra isso em vez de fingir que a caixinha manda.
 */
export function definirTelasDoEmail(email, telaIds, porQuem) {
  const e = normEmail(email);
  if (!e.includes('@')) throw new Error('E-mail inválido.');
  const querAcesso = new Set((telaIds || []).filter((id) => TELA_IDS.includes(id)));

  const dados = ler();
  const agora = new Date().toISOString();
  for (const t of TELAS) {
    const cfg = dados.telas[t.id] || { modo: 'todos', emails: [] };
    if (cfg.modo !== 'lista') continue;            // tela aberta: nada a fazer
    const lista = new Set((cfg.emails || []).map(normEmail));
    const tinha = lista.has(e);
    const quer = querAcesso.has(t.id);
    if (tinha === quer) continue;
    if (quer) lista.add(e); else lista.delete(e);
    dados.telas[t.id] = {
      ...cfg, modo: 'lista', emails: [...lista], atualizadoEm: agora, atualizadoPor: normEmail(porQuem),
    };
  }
  gravar(dados);
  return matrizDeAcesso();
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
