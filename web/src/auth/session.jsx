/**
 * Sessão do usuário: guarda o access_token do Google (localStorage), consulta o
 * /api/me para saber papel e telas liberadas, e renova o token silenciosamente
 * quando ele expira (~1h) — mesmo padrão do churn_mvp.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';

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
let expiraEm = ler()?.expiraEm || null;
let clientIdAtual = null;
let tokenClient = null;
let scriptPromise = null;
let pendente = null;
let renovando = null;
let timerRenovacao = null;
const ouvintes = new Set();
/** Avisados quando a sessão acaba — o provider usa para voltar ao login. */
const ouvintesFim = new Set();

export const getToken = () => tokenAtual;

function setToken(token, expiresIn) {
  tokenAtual = token;
  expiraEm = token && expiresIn ? Date.now() + expiresIn * 1000 : null;
  gravar(token ? { token, expiraEm } : null);
  ouvintes.forEach((fn) => fn(token));
  agendarRenovacao();
}

/**
 * Renova sozinho antes de expirar, em vez de esperar a primeira requisição
 * falhar. O token do Google dura ~1h; renovando cinco minutos antes, quem está
 * com a tela aberta não percebe a troca.
 */
function agendarRenovacao() {
  clearTimeout(timerRenovacao);
  if (!tokenAtual || !expiraEm) return;
  const emQuanto = Math.max(5000, expiraEm - Date.now() - 5 * 60 * 1000);
  timerRenovacao = setTimeout(() => {
    renovarToken().catch(() => encerrarSessao('expirada'));
  }, emQuanto);
}

/**
 * Encerra a sessão e avisa a interface. É o que faltava: sem isso a renovação
 * podia falhar, as requisições passavam a devolver 401 e a tela continuava
 * montada com o usuário antigo — todos os números em branco e nenhum caminho
 * de volta a não ser sair e entrar na mão.
 */
export function encerrarSessao(motivo = 'expirada') {
  if (!tokenAtual && !ler()) return; // já encerrada: não avisa duas vezes
  clearTimeout(timerRenovacao);
  setToken(null);
  gravar(null);
  ouvintesFim.forEach((fn) => fn(motivo));
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
        setToken(resp.access_token, Number(resp.expires_in) || 3600);
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

/** Saída deliberada, pelo menu do perfil: encerra sem alarde. */
export function limparSessao() {
  clearTimeout(timerRenovacao);
  setToken(null);
  gravar(null);
}

// ---- contexto React ------------------------------------------------------
export function SessionProvider({ children }) {
  const [config, setConfig] = useState(null);      // { clientId, dominio, habilitado }
  const [usuario, setUsuario] = useState(null);    // { email, nome, foto, papel, powerUser, telas }
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState(null);
  const [token, setTokenState] = useState(tokenAtual);
  const [motivoSaida, setMotivoSaida] = useState(null);
  const montado = useRef(true);
  const qc = useQueryClient();

  useEffect(() => {
    ouvintes.add(setTokenState);
    return () => { ouvintes.delete(setTokenState); montado.current = false; };
  }, []);

  // sessão encerrada por expiração: volta ao login e joga fora o que estava em
  // cache, para ninguém reencontrar os números de outra conta ao entrar depois
  useEffect(() => {
    const aoEncerrar = (motivo) => {
      setUsuario(null);
      setMotivoSaida(motivo);
      qc.clear();
    };
    ouvintesFim.add(aoEncerrar);
    return () => ouvintesFim.delete(aoEncerrar);
  }, [qc]);

  // configuração pública + sessão existente
  useEffect(() => {
    (async () => {
      try {
        const cfg = await fetch('/api/auth/config').then((r) => r.json());
        setConfig(cfg);
        if (cfg.clientId) await garantirClient(cfg.clientId).catch(() => {});
        if (!cfg.habilitado) {
          setUsuario({ email: 'dev@local', nome: 'Modo sem autenticação', papel: 'admin', powerUser: true, telas: null });
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
    setMotivoSaida(null);
    setUsuario(me);
    return me;
  }, [config]);

  const sair = useCallback(() => {
    limparSessao();
    setMotivoSaida(null);
    setUsuario(null);
    qc.clear();
  }, [qc]);

  const recarregarMe = useCallback(async () => {
    const me = await buscarMe();
    if (me) setUsuario(me);
    return me;
  }, []);

  const valor = useMemo(() => ({
    config, usuario, carregando, erro, token, entrar, sair, recarregarMe, motivoSaida,
    ehAdmin: usuario?.papel === 'admin',
    // Power user corre por fora da hierarquia: o catálogo de queries é atribuição
    // do DEV, não do admin — mas quem acumula os dois papéis continua enxergando.
    ehDev: !!usuario?.powerUser,
    podeVer: (tela) => !usuario?.telas || usuario.telas.includes(tela) || usuario.papel === 'admin',
  }), [config, usuario, carregando, erro, token, entrar, sair, recarregarMe, motivoSaida]);

  return <Ctx.Provider value={valor}>{children}</Ctx.Provider>;
}

async function buscarMe() {
  if (!tokenAtual) return null;
  const res = await fetch('/api/me', { headers: { Authorization: `Bearer ${tokenAtual}` } });
  if (res.status === 401) {
    try {
      await renovarToken();
      const r2 = await fetch('/api/me', { headers: { Authorization: `Bearer ${tokenAtual}` } });
      if (r2.ok) return r2.json();
      encerrarSessao('expirada');
      return null;
    } catch {
      encerrarSessao('expirada');
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
