import { useEffect, useRef, useState } from 'react';
import { NavLink, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { useMeta, useRefreshServidor } from './api';
import { FiltersProvider } from './filters';
import { haQuanto, labelDataHora } from './format';
import { useSession } from './auth/session.jsx';
import LoginPage from './auth/LoginPage.jsx';
import { Loading } from './components/ui';

import Capa from './pages/Capa';
import Diretoria from './pages/Diretoria';
import Vendas from './pages/Vendas';
import VendasHistorico from './pages/VendasHistorico';
import Ativacoes from './pages/Ativacoes';
import AtivacoesHistorico from './pages/AtivacoesHistorico';
import PrimeiroPagamento from './pages/PrimeiroPagamento';
import Rampagem from './pages/Rampagem';
import Premiacoes from './pages/Premiacoes';
import Configuracoes from './pages/Configuracoes';
import Exportacoes from './pages/Exportacoes';
import Preditivo from './pages/Preditivo';
import { Icone } from './components/Icone';

const PAGINAS = [
  { id: 'capa', path: '/capa', label: 'Capa', el: <Capa /> },
  { id: 'diretoria', path: '/diretoria', label: 'Diretoria', el: <Diretoria /> },
  { id: 'primeiro-pagamento', path: '/primeiro-pagamento', label: 'Primeiro Pagamento', el: <PrimeiroPagamento /> },
  { id: 'ativacoes', path: '/ativacoes', label: 'Ativações', el: <Ativacoes /> },
  { id: 'ativacoes-historico', path: '/ativacoes-historico', label: 'Ativações - Histórico', el: <AtivacoesHistorico /> },
  { id: 'vendas', path: '/vendas', label: 'Vendas', el: <Vendas /> },
  { id: 'vendas-historico', path: '/vendas-historico', label: 'Vendas - Histórico', el: <VendasHistorico /> },
  { id: 'rampagem', path: '/rampagem', label: 'Rampagem', el: <Rampagem /> },
  { id: 'premiacoes', path: '/premiacoes', label: 'Premiações', el: <Premiacoes /> },
  { id: 'preditivo', path: '/preditivo', label: 'Análise Preditiva', el: <Preditivo /> },
];

function MenuUsuario() {
  const { usuario, sair, ehAdmin, ehDev } = useSession();
  const [aberto, setAberto] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!aberto) return undefined;
    const fora = (e) => { if (ref.current && !ref.current.contains(e.target)) setAberto(false); };
    document.addEventListener('mousedown', fora);
    return () => document.removeEventListener('mousedown', fora);
  }, [aberto]);

  if (!usuario) return null;
  const inicial = (usuario.nome || usuario.email || '?').trim().charAt(0).toUpperCase();

  return (
    <div className="usermenu" ref={ref}>
      <button type="button" onClick={() => setAberto((a) => !a)} title={usuario.email}>
        {usuario.foto
          ? <img src={usuario.foto} alt="" referrerPolicy="no-referrer" />
          : <span className="inicial">{inicial}</span>}
        <span className="nome">{(usuario.nome || '').split(' ')[0]}</span>
        {usuario.papel !== 'viewer' && <span className="papel">{usuario.papel}</span>}
      </button>

      {aberto && (
        <div className="usermenu-pop">
          <div className="quem">
            <b>{usuario.nome}</b>
            <span>{usuario.email}</span>
          </div>
          {(ehAdmin || ehDev) && (
            <NavLink to="/configuracoes" onClick={() => setAberto(false)} className="com-icone">
              <Icone nome="config" /> Configurações
            </NavLink>
          )}
          <button type="button" className="sair" onClick={sair}>Sair</button>
        </div>
      )}
    </div>
  );
}

function TopBar({ paginas }) {
  const { data: meta } = useMeta();
  const refresh = useRefreshServidor();
  const [carregando, setCarregando] = useState(false);
  const { pathname } = useLocation();
  const { ehAdmin, ehDev } = useSession();

  const atualizado = meta?.sources?.base?.updatedAt;
  const erro = meta && Object.values(meta.sources || {}).some((s) => s?.error);
  const idade = atualizado ? (Date.now() - new Date(atualizado).getTime()) / 1000 : Infinity;
  const classe = erro ? 'error' : idade > ((meta?.refresh?.hot || 120000) / 1000) * 3 ? 'stale' : '';

  const titulo = pathname === '/configuracoes' ? 'Configurações'
    : pathname === '/exportacoes' ? 'Exportações'
    : paginas.find((p) => p.path === pathname)?.label || 'Gestão Comercial';

  const clicar = async () => {
    setCarregando(true);
    try { await refresh('hot'); } finally { setCarregando(false); }
  };

  return (
    <>
      <header className="topbar">
        <div className="logo">
          <img src="/logo-sebratel.svg" alt="Sebratel" />
          <span>COM · GESTÃO COMERCIAL</span>
        </div>
        <h1>{titulo}</h1>
        <div className="updated">
          <span className={`live-dot ${classe}`} title={erro ? 'Falha em alguma fonte' : 'Atualização automática ativa'} />
          <span className="quando" title={`Atualizado em ${labelDataHora(atualizado)}`}>
            {atualizado ? haQuanto(atualizado) : '—'}
          </span>
          <button type="button" className="icon-btn" onClick={clicar} disabled={carregando} title="Atualizar agora">
            <span className={carregando ? 'spin' : ''}><Icone nome="atualizar" tamanho={15} /></span>
          </button>
        </div>
        <MenuUsuario />
      </header>
      <nav className="pagenav">
        {paginas.map((p) => (
          <NavLink
            key={p.path}
            to={{ pathname: p.path, search: window.location.search }}
            className={({ isActive }) => (isActive ? 'active' : '')}
          >
            {p.label}
          </NavLink>
        ))}
        <NavLink to="/exportacoes" className={({ isActive }) => `com-icone${isActive ? ' active' : ''}`}>
          <Icone nome="baixar" tamanho={13} /> Exportações
        </NavLink>
        {(ehAdmin || ehDev) && (
          <NavLink to="/configuracoes" className={({ isActive }) => `com-icone${isActive ? ' active' : ''}`}>
            <Icone nome="config" tamanho={13} /> Configurações
          </NavLink>
        )}
      </nav>
    </>
  );
}

/** Rota de uma tela sem permissão: mensagem em vez de erro cru da API. */
function SemAcesso() {
  return (
    <main className="page">
      <div className="tela-negada">
        <Icone nome="cadeado" tamanho={30} />
        <h2>Tela restrita</h2>
        <p>Você não tem permissão para ver esta tela. Peça a liberação a um administrador.</p>
      </div>
    </main>
  );
}

export default function App() {
  const { usuario, carregando, podeVer, ehAdmin, ehDev } = useSession();

  if (carregando) {
    return <div style={{ height: '100vh' }}><Loading texto="Carregando sessão…" /></div>;
  }
  if (!usuario) return <LoginPage />;

  const permitidas = PAGINAS.filter((p) => podeVer(p.id));
  const inicial = permitidas[0]?.path || (ehAdmin || ehDev ? '/configuracoes' : '/capa');

  return (
    <FiltersProvider>
      <TopBar paginas={permitidas} />
      <Routes>
        {PAGINAS.map((p) => (
          <Route key={p.path} path={p.path} element={podeVer(p.id) ? p.el : <SemAcesso />} />
        ))}
        <Route path="/exportacoes" element={<Exportacoes />} />
        <Route path="/configuracoes" element={ehAdmin || ehDev ? <Configuracoes /> : <SemAcesso />} />
        <Route path="*" element={<Navigate to={inicial} replace />} />
      </Routes>
    </FiltersProvider>
  );
}
