import { config } from '../config.js';
import { usuarioDoToken } from './google.js';
import { papelDe, peloMenos, podeVerTela } from './access.js';

/**
 * Autenticação + autorização.
 *   minPapel: 'viewer' (padrão) | 'dev' | 'admin' — hierárquico
 *   papeis:   lista de papéis exatos (não hierárquico). É o caso do catálogo de
 *             queries, que é atribuição do DEV e não do administrador.
 *   tela:     id da tela cujo ACL deve ser respeitado
 *
 * Com AUTH_ENABLED=false o middleware libera tudo — útil para rodar local sem
 * Google, nunca em produção.
 */
export function exigirAuth({ minPapel = 'viewer', papeis = null, tela = null } = {}) {
  return async (req, res, next) => {
    if (!config.auth.habilitado) {
      req.usuario = {
        email: 'dev@local',
        nome: 'Modo sem autenticação',
        papel: papeis ? papeis[0] : 'admin',
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
    req.usuario = { ...usuario, papel };

    if (papeis && !papeis.includes(papel)) {
      const rotulo = papeis.includes('dev') ? 'usuários DEV' : papeis.join(' ou ');
      return res.status(403).json({ error: `Área exclusiva de ${rotulo}. Seu perfil é "${papel}".` });
    }

    if (!papeis && !peloMenos(papel, minPapel)) {
      const rotulo = minPapel === 'admin' ? 'administradores' : 'usuários DEV';
      return res.status(403).json({ error: `Área restrita a ${rotulo}. Seu perfil é "${papel}".` });
    }

    if (tela && !podeVerTela(req.usuario, tela)) {
      return res.status(403).json({ error: 'Você não tem acesso a esta tela. Fale com um administrador.' });
    }

    return next();
  };
}
