import { config } from '../config.js';
import { usuarioDoToken } from './google.js';
import { ehPowerUser, escopoDe, papelDe, peloMenos, podeVerTela } from './access.js';
import { EQUIPE_INEXISTENTE } from '../model/measures.js';

/**
 * Autenticação + autorização.
 *   minPapel:  'viewer' (padrão) | 'dev' | 'admin' — hierárquico
 *   powerUser: exige o atributo de power user, que corre por fora da hierarquia.
 *              É o caso do catálogo de queries: ler o SQL do sistema é atribuição
 *              do DEV, não do administrador — mas quem acumula os dois entra.
 *   tela:      id da tela cujo ACL deve ser respeitado
 *
 * Com AUTH_ENABLED=false o middleware libera tudo — útil para rodar local sem
 * Google, nunca em produção.
 */

/**
 * Aplica o escopo de dados reescrevendo o filtro de equipe da requisição.
 *
 * Fica aqui, e não em cada rota, porque `exigirAuth` é o único caminho por onde
 * toda rota de dados passa: endpoint novo herda o recorte sem ninguém lembrar de
 * aplicá-lo. Como `parseFilters` lê `req.query`, KPIs, gráficos, tabelas,
 * exportações e leitura de IA passam a respeitar o escopo de uma só vez.
 *
 * O pedido é CRUZADO com o permitido, nunca substituído: quem tem escopo em
 * [A, B] e pede a equipe C recebe vazio, não recebe A e B. E registro sem equipe
 * fica de fora por consequência — a lista de equipes permitidas nunca contém ''.
 */
export function aplicarEscopo(req, escopo) {
  if (!escopo?.equipes?.length) return;
  const pedido = String(req.query.equipe || '').split(',').map((x) => x.trim()).filter(Boolean);
  const permitido = escopo.equipes;
  const efetivo = pedido.length ? pedido.filter((x) => permitido.includes(x)) : permitido;
  req.query.equipe = efetivo.length ? efetivo.join(',') : EQUIPE_INEXISTENTE;
}

export function exigirAuth({ minPapel = 'viewer', powerUser = false, tela = null } = {}) {
  return async (req, res, next) => {
    if (!config.auth.habilitado) {
      req.usuario = {
        email: 'dev@local',
        nome: 'Modo sem autenticação',
        papel: 'admin',
        powerUser: true,
      };
      return next();
    }

    const m = /^Bearer (.+)$/.exec(req.headers.authorization || '');
    if (!m) return res.status(401).json({ error: 'Faça login para acessar o dashboard.' });

    let usuario = null;
    try {
      usuario = await usuarioDoToken(m[1]);
    } catch {
      usuario = null;
    }
    if (!usuario) return res.status(401).json({ error: 'Sessão expirada. Entre novamente.' });

    if (config.auth.dominio && !usuario.email.endsWith(`@${config.auth.dominio}`)) {
      return res.status(403).json({ error: `Acesso restrito a contas @${config.auth.dominio}.` });
    }

    const papel = papelDe(usuario.email);
    const power = ehPowerUser(usuario.email);
    // admin é isento: com recorte ele não conseguiria auditar o que liberou
    const escopo = papel === 'admin' ? null : escopoDe(usuario.email);
    req.usuario = { ...usuario, papel, powerUser: power, escopo };
    aplicarEscopo(req, escopo);

    if (powerUser && !power) {
      return res.status(403).json({
        error: 'Área exclusiva de power users (DEV). Peça a um administrador para marcar o seu e-mail como power user.',
      });
    }

    if (!peloMenos(papel, minPapel)) {
      const rotulo = minPapel === 'admin' ? 'administradores' : 'usuários DEV';
      return res.status(403).json({ error: `Área restrita a ${rotulo}. Seu perfil é "${papel}".` });
    }

    if (tela && !podeVerTela(req.usuario, tela)) {
      return res.status(403).json({ error: 'Você não tem acesso a esta tela. Fale com um administrador.' });
    }

    return next();
  };
}
