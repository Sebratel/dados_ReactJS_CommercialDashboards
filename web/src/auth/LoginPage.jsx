import { useState } from 'react';
import { useSession } from './session.jsx';
import { Icone } from '../components/Icone';

function MarcaGoogle() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden>
      <path fill="#EA4335" d="M12 10.2v3.9h5.5c-.25 1.3-1 2.4-2.1 3.1l3.4 2.6c2-1.8 3.1-4.5 3.1-7.7 0-.75-.07-1.5-.2-2.2H12z" />
      <path fill="#34A853" d="M5.8 14.1l-.9.7-2.5 1.9C4.2 20.8 7.9 23 12 23c3 0 5.5-1 7.3-2.7l-3.4-2.6c-.9.6-2.1 1-3.9 1-3 0-5.5-2-6.4-4.7z" />
      <path fill="#FBBC05" d="M5.5 9.3 2.9 7.1C1.1 10.4 1.1 14.3 2.9 17.6l2.6-2c-.4-1.2-.4-2.5 0-3.7z" />
      <path fill="#4285F4" d="M12 5.8c1.7 0 3.2.6 4.4 1.8l3.3-3.3C16.5 2.1 14.4 1 12 1 7.9 1 4.2 3.2 2.9 7.1l2.6 2C6.5 7.4 9.1 5.8 12 5.8z" />
    </svg>
  );
}

export default function LoginPage() {
  const { config, entrar, carregando } = useSession();
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState(null);

  const clicar = async () => {
    setErro(null);
    setOcupado(true);
    try {
      await entrar();
    } catch (e) {
      const msg = String(e?.message || e);
      setErro(msg.includes('popup') || msg.includes('cancel')
        ? 'A janela do Google foi fechada antes de concluir. Tente de novo.'
        : msg);
    } finally {
      setOcupado(false);
    }
  };

  const dominio = config?.dominio || 'sebratel.com.br';

  return (
    <div className="login">
      <div className="login-arte" aria-hidden>
        <div className="brilho brilho-1" />
        <div className="brilho brilho-2" />
        <svg className="malha" viewBox="0 0 1200 780" preserveAspectRatio="xMidYMid slice">
          <path d="M0,520 Q280,380 520,460 T920,400 T1200,360" fill="none" stroke="rgba(217,179,0,0.55)" strokeWidth="1.25" />
          <path d="M80,620 Q420,520 720,560 T1180,480" fill="none" stroke="rgba(230,108,55,0.4)" strokeWidth="1" />
          <path d="M200,180 Q520,280 780,200 T1120,240" fill="none" stroke="rgba(255,255,255,0.18)" strokeWidth="0.9" />
        </svg>
      </div>

      <div className="login-conteudo">
        <section className="login-marca">
          <div className="login-marca-topo">
            <img src="/logo-circular-sebratel.png" alt="" width={46} height={46} />
            <span>Operação Sebratel</span>
          </div>
          <h2>
            A gestão comercial <span>em tempo real.</span>
          </h2>
          <p>
            Vendas, ativações e primeiro pagamento direto do Voalle — os mesmos indicadores
            do Power BI, atualizados a cada dois minutos.
          </p>
        </section>

        <section className="login-card-wrap">
          <div className={`login-card${erro ? ' tremer' : ''}`}>
            <header>
              <span className="etiqueta">COM · Gestão Comercial</span>
              <h1>Acessar o dashboard</h1>
              <p>Entre com a sua conta Google corporativa. As telas liberadas dependem da sua permissão.</p>
            </header>

            <div className="login-aviso">
              <div className="icone"><Icone nome="cadeado" tamanho={17} /></div>
              <div>
                <p>
                  Domínio liberado: <b>@{dominio}</b>
                </p>
                <span>Não é a sua conta? Saia do Google antes de entrar.</span>
              </div>
            </div>

            {erro && (
              <div className="banner error" role="alert"><Icone nome="alerta" tamanho={14} /> {erro}</div>
            )}

            {config && !config.clientId && (
              <div className="banner">
                O servidor está sem <code>GOOGLE_CLIENT_ID</code>. Configure no <code>.env</code> para habilitar o login.
              </div>
            )}

            <button
              type="button"
              className="botao-google"
              onClick={clicar}
              disabled={ocupado || carregando || !config?.clientId}
            >
              <span className="marca">{ocupado ? <span className="spin"><Icone nome="atualizar" tamanho={16} /></span> : <MarcaGoogle />}</span>
              {ocupado ? 'Autenticando…' : 'Entrar com Google'}
            </button>

            <p className="login-rodape">
              Problemas para acessar? Fale com <a href="mailto:intel@sebratel.com.br">intel@sebratel.com.br</a>
            </p>
          </div>
        </section>
      </div>

      <footer className="login-barra">
        <Icone nome="cadeado" tamanho={13} /> Ambiente seguro e monitorado · Inteligência de Dados Sebratel
      </footer>
    </div>
  );
}
