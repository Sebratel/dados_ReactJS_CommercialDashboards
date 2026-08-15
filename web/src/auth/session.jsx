/**
 * Sessão do usuário: guarda o access_token do Google (localStorage), consulta o
 * /api/me para saber papel e telas liberadas, e renova o token silenciosamente
 * quando ele expira (~1h) — mesmo padrão do churn_mvp.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';

const GSI_SRC = 'https://accounts.google.com/gsi/client';
const CHAVE = 'comercial-dashboard-auth';

const Ctx = createContext(null);

function ler() {
  try {
    const raw = localStorage.getItem(CHAVE);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function gravar(dados) {
  try {
    if (dados) localStorage.setItem(CHAVE, JSON.stringify(dados));
    else localStorage.removeItem(CHAVE);
  } catch { /* modo privado */ }
}

// ---- token do Google (compartilhado com o api.js) -------------------------
let tokenAtual = ler()?.token || null;
let clientIdAtual = null;
let tokenClient = null;
let scriptPromise = null;
let pendente = null;
let renovando = null;
const ouvintes = new Set();

export const getToken = () => tokenAtual;

function setToken(token) {
  tokenAtual = token;
  const atual = ler() || {};
  gravar({ ...atual, token });
  ouvintes.forEach((fn) => fn(token));
}

function carregarScript() {
  if (window.google?.accounts?.oauth2) return Promise.resolve();
  if (scriptPromise) return scriptPromise;
  scriptPromise = new Promise((resolve, reject) => {
    const existente = document.querySelector(`script[src="${GSI_SRC}"]`);
    if (existente) {
      existente.addEventListener('load', () => resolve());
      existente.addEventListener('error', () => reject(new Error('Falha ao carregar o Google Sign-In.')));
      return;
    }
    const s = document.createElement('script');
    s.src = GSI_SRC;
    s.async = true;
    s.defer = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error('Falha ao carregar o Google Sign-In.'));
    document.head.appendChild(s);
  });
  return scriptPromise;
}

async function garantirClient(clientId) {
  await carregarScript();
  if (tokenClient && clientIdAtual === clientId) return;
  clientIdAtual = clientId;
  tokenClient = window.google.accounts.oauth2.initTokenClient({
    client_id: clientId,
    scope: 'openid email profile',
    callback: (resp) => {
      const p = pendente;
      pendente = null;
      if (!p) return;
      if (resp.access_token) {
        setToken(resp.access_token);
        p.resolve(resp.access_token);
      } else {
        p.reject(new Error('O Google não devolveu o token de acesso.'));
      }
    },
    error_callback: (err) => {
      const p = pendente;
      pendente = null;
      p?.reject(err instanceof Error ? err : new Error('Login cancelado.'));
    },
  });
}

function pedirToken({ silencioso }) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      if (pendente) {
        pendente = null;
        reject(new Error('Tempo esgotado ao falar com o Google.'));
      }
    }, 20000);
    pendente = {
      resolve: (t) => { clearTimeout(timer); resolve(t); },
      reject: (e) => { clearTimeout(timer); reject(e); },
    };
    try {
      tokenClient.requestAccessToken(silencioso ? { prompt: 'none' } : {});
    } catch (e) {
      clearTimeout(timer);
      pendente = null;
      reject(e);
    }
  });
}

/** Renovação silenciosa (sem popup) usada quando a API devolve 401. */
export function renovarToken() {
  if (!clientIdAtual || !tokenClient) return Promise.reject(new Error('Login não inicializado.'));
  if (renovando) return renovando;
  renovando = pedirToken({ silencioso: true }).finally(() => { renovando = null; });
  return renovando;
}

export function limparSessao() {
  setToken(null);
  gravar(null);
}

// ---- contexto React ------------------------------------------------------
export function SessionProvider({ children }) {
  const [config, setConfig] = useState(null);      // { clientId, dominio, habilitado }
  const [usuario, setUsuario] = useState(null);    // { email, nome, foto, papel, telas }
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState(null);
  const [token, setTokenState] = useState(tokenAtual);
  const montado = useRef(true);

  useEffect(() => {
    ouvintes.add(setTokenState);
    return () => { ouvintes.delete(setTokenState); montado.current = false; };
  }, []);

  // configuração pública + sessão existente
  useEffect(() => {
    (async () => {
      try {
        const cfg = await fetch('/api/auth/config').then((r) => r.json());
        setConfig(cfg);
        if (cfg.clientId) await garantirClient(cfg.clientId).catch(() => {});
        if (!cfg.habilitado) {
          setUsuario({ email: 'dev@local', nome: 'Modo sem autenticação', papel: 'admin', telas: null });
          return;
        }
        if (tokenAtual) {
          const me = await buscarMe();
          if (me) setUsuario(me);
        }
      } catch {
        setErro('Não foi possível falar com o servidor.');
      } finally {
        setCarregando(false);
      }
    })();
  }, []);

  const entrar = useCallback(async () => {
    if (!config?.clientId) throw new Error('GOOGLE_CLIENT_ID não configurado no servidor.');
    await garantirClient(config.clientId);
    await pedirToken({ silencioso: false });
    const me = await buscarMe();
    if (!me) throw new Error('Sua conta não tem acesso a este dashboard.');
    setUsuario(me);
    return me;
  }, [config]);

  const sair = useCallback(() => {
    limparSessao();
    setUsuario(null);
  }, []);

  const recarregarMe = useCallback(async () => {
    const me = await buscarMe();
    if (me) setUsuario(me);
    return me;
  }, []);

  const valor = useMemo(() => ({
    config, usuario, carregando, erro, token, entrar, sair, recarregarMe,
    ehAdmin: usuario?.papel === 'admin',
    // DEV é um papel à parte: o catálogo de queries é atribuição dele, não do admin
    ehDev: usuario?.papel === 'dev',
    podeVer: (tela) => !usuario?.telas || usuario.telas.includes(tela) || usuario.papel === 'admin',
  }), [config, usuario, carregando, erro, token, entrar, sair, recarregarMe]);

  return <Ctx.Provider value={valor}>{children}</Ctx.Provider>;
}

async function buscarMe() {
  if (!tokenAtual) return null;
  const res = await fetch('/api/me', { headers: { Authorization: `Bearer ${tokenAtual}` } });
  if (res.status === 401) {
    try {
      await renovarToken();
      const r2 = await fetch('/api/me', { headers: { Authorization: `Bearer ${tokenAtual}` } });
      return r2.ok ? r2.json() : null;
    } catch {
      limparSessao();
      return null;
    }
  }
  if (!res.ok) return null;
  return res.json();
}

export function useSession() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useSession fora do SessionProvider');
  return ctx;
}
