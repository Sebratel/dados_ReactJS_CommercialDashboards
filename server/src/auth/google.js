/**
 * Validação do access_token do Google (mesmo fluxo do churn_mvp): o front usa o
 * Google Identity Services e manda o token no header Authorization; aqui ele é
 * conferido no userinfo do Google, com cache curto para não bater na Google a
 * cada request.
 */
const cache = new Map(); // token -> { usuario, exp }
const TTL_MS = 5 * 60 * 1000;

export async function usuarioDoToken(token) {
  const emCache = cache.get(token);
  if (emCache && emCache.exp > Date.now()) return emCache.usuario;

  let resp;
  try {
    resp = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(10000),
    });
  } catch (err) {
    console.warn('[auth] falha de rede ao validar o token no Google:', err.message);
    return null;
  }

  if (!resp.ok) {
    console.warn(`[auth] userinfo respondeu ${resp.status} (token inválido ou expirado)`);
    return null;
  }

  const p = await resp.json().catch(() => ({}));
  if (!p.email || p.email_verified === false) {
    console.warn('[auth] token sem e-mail verificado');
    return null;
  }

  const usuario = {
    email: String(p.email).toLowerCase(),
    nome: p.name || p.email,
    foto: p.picture || null,
  };
  cache.set(token, { usuario, exp: Date.now() + TTL_MS });
  if (cache.size > 500) {
    for (const [k, v] of cache) if (v.exp <= Date.now()) cache.delete(k);
  }
  return usuario;
}
