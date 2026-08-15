import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { apiJson } from '../api';
import { useSession } from '../auth/session.jsx';
import { Erro, Loading, Visual } from '../components/ui';
import { Icone } from '../components/Icone';
import { int, labelDataHora } from '../format';

const PAPEL_LABEL = { viewer: 'Visualizador', dev: 'DEV', admin: 'Administrador' };
const PAPEL_AJUDA = {
  viewer: 'Vê as telas liberadas para todos e aquelas em que o e-mail está na lista.',
  dev: 'Enxerga o catálogo de queries do sistema — o SQL que alimenta cada tela.',
  admin: 'Gerencia pessoas e o acesso por tela. Vê todas as telas do dashboard.',
};

// ------------------------------------------------------ usuários e papéis
function AbaUsuarios() {
  const { usuario } = useSession();
  const [dados, setDados] = useState(null);
  const [erro, setErro] = useState(null);
  const [ocupado, setOcupado] = useState(null);
  const [email, setEmail] = useState('');
  const [papel, setPapel] = useState('dev');

  const carregar = useCallback(async () => {
    try {
      setDados(await apiJson('/access/users'));
      setErro(null);
    } catch (e) { setErro(e); }
  }, []);
  useEffect(() => { carregar(); }, [carregar]);

  const executar = async (fn, chave) => {
    setOcupado(chave);
    try { await fn(); await carregar(); setErro(null); }
    catch (e) { setErro(e); }
    finally { setOcupado(null); }
  };

  const conceder = () => {
    const e = email.trim().toLowerCase();
    if (!e.includes('@')) { setErro(new Error('Informe um e-mail válido.')); return; }
    executar(async () => {
      await apiJson(`/access/users/${encodeURIComponent(e)}`, { method: 'PUT', body: { papel } });
      setEmail('');
    }, e);
  };

  if (!dados && !erro) return <Loading texto="Carregando usuários…" />;

  return (
    <div className="cfg-bloco">
      {erro && <Erro erro={erro} />}

      <div className="cfg-form">
        <label>
          <span>E-mail corporativo</span>
          <input
            type="email"
            value={email}
            placeholder="nome@sebratel.com.br"
            onChange={(e) => setEmail(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') conceder(); }}
          />
        </label>
        <label>
          <span>Papel</span>
          <select value={papel} onChange={(e) => setPapel(e.target.value)}>
            <option value="dev">DEV</option>
            <option value="admin">Administrador</option>
          </select>
        </label>
        <button type="button" className="cfg-botao" onClick={conceder} disabled={!!ocupado}>
          <Icone nome="mais" tamanho={14} /> Conceder acesso
        </button>
      </div>

      <div className="tbl-wrap" style={{ maxHeight: 360 }}>
        <table className="pbi">
          <thead>
            <tr>
              <th className="left">E-mail</th>
              <th className="left">Papel</th>
              <th className="left">Origem</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {(dados?.usuarios || []).map((u) => (
              <tr key={u.email}>
                <td className="left">
                  {u.email}
                  {u.email === usuario?.email && <span className="cfg-tag">você</span>}
                </td>
                <td className="left">
                  {u.origem === 'env' ? (
                    <b>{PAPEL_LABEL[u.papel]}</b>
                  ) : (
                    <select
                      value={u.papel}
                      disabled={ocupado === u.email}
                      className="cfg-select-inline"
                      onChange={(e) => executar(
                        () => apiJson(`/access/users/${encodeURIComponent(u.email)}`, { method: 'PUT', body: { papel: e.target.value } }),
                        u.email,
                      )}
                    >
                      {['viewer', 'dev', 'admin'].map((p) => (
                        <option key={p} value={p}>{PAPEL_LABEL[p]}</option>
                      ))}
                    </select>
                  )}
                </td>
                <td className="left">
                  {u.origem === 'env'
                    ? <span className="cfg-tag fixo"><Icone nome="cadeado" tamanho={11} /> semente (.env)</span>
                    : <span className="cfg-tag">definido na tela</span>}
                </td>
                <td className="right">
                  {u.origem === 'arquivo' && (
                    <button
                      type="button"
                      className="cfg-remover"
                      title="Remover — volta a ser visualizador"
                      disabled={ocupado === u.email}
                      onClick={() => executar(
                        () => apiJson(`/access/users/${encodeURIComponent(u.email)}`, { method: 'DELETE' }),
                        u.email,
                      )}
                    >
                      <Icone nome="fechar" tamanho={13} />
                    </button>
                  )}
                </td>
              </tr>
            ))}
            {dados && !dados.usuarios.length && (
              <tr><td colSpan={4} style={{ textAlign: 'center', padding: 24, color: '#605E5C' }}>Ninguém com papel elevado ainda.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      <ul className="cfg-legenda">
        {Object.entries(PAPEL_AJUDA).map(([p, txt]) => (
          <li key={p}><b>{PAPEL_LABEL[p]}:</b> {txt}</li>
        ))}
        <li>
          Quem não está na lista é <b>visualizador</b>. Papéis de semente vêm de
          <code> ADMIN_EMAILS</code> / <code>DEV_EMAILS</code> e não podem ser removidos por aqui.
        </li>
      </ul>
    </div>
  );
}

// ------------------------------------------------------------ acesso/telas
function CampoEmail({ onAdicionar, sugestoes }) {
  const [valor, setValor] = useState('');
  const ref = useRef(null);

  const confirmar = () => {
    const e = valor.trim().toLowerCase();
    if (!e.includes('@')) return;
    onAdicionar(e);
    setValor('');
    ref.current?.focus();
  };

  return (
    <span className="acl-add">
      <input
        ref={ref}
        list="emails-conhecidos"
        value={valor}
        placeholder="nome@sebratel.com.br"
        onChange={(e) => setValor(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); confirmar(); } }}
      />
      <button type="button" onClick={confirmar} disabled={!valor.trim().includes('@')} title="Adicionar">
        <Icone nome="mais" tamanho={13} />
      </button>
      <datalist id="emails-conhecidos">
        {sugestoes.map((s) => <option key={s} value={s} />)}
      </datalist>
    </span>
  );
}

function AbaTelas() {
  const [telas, setTelas] = useState(null);
  const [sugestoes, setSugestoes] = useState([]);
  const [erro, setErro] = useState(null);
  const [salvando, setSalvando] = useState(null);
  const [salvo, setSalvo] = useState(null);
  const [editando, setEditando] = useState(null); // tela em modo lista ainda sem e-mail

  const carregar = useCallback(async () => {
    try {
      const d = await apiJson('/access/screens');
      setTelas(d.telas);
      setErro(null);
    } catch (e) { setErro(e); }
  }, []);

  useEffect(() => {
    carregar();
    apiJson('/access/users')
      .then((d) => setSugestoes((d.usuarios || []).map((u) => u.email)))
      .catch(() => {});
  }, [carregar]);

  const salvar = async (tela, modo, emails) => {
    setSalvando(tela.id);
    try {
      const { tela: atualizada } = await apiJson(`/access/screens/${tela.id}`, {
        method: 'PUT',
        body: { modo, emails },
      });
      setTelas((lista) => lista.map((t) => (t.id === tela.id ? atualizada : t)));
      setErro(null);
      setSalvo(tela.id);
      setTimeout(() => setSalvo((s) => (s === tela.id ? null : s)), 1800);
    } catch (e) { setErro(e); } finally { setSalvando(null); }
  };

  const trocarModo = (tela, modo) => {
    if (modo === tela.modo) return;
    if (modo === 'lista') {
      // só grava quando o primeiro e-mail entrar (o servidor exige lista não vazia)
      setEditando(tela.id);
      return;
    }
    setEditando(null);
    salvar(tela, 'todos', []);
  };

  const resumo = useMemo(() => {
    if (!telas) return null;
    const restritas = telas.filter((t) => t.modo === 'lista').length;
    return { total: telas.length, restritas, livres: telas.length - restritas };
  }, [telas]);

  if (!telas && !erro) return <Loading texto="Carregando telas…" />;

  return (
    <div className="cfg-bloco">
      {erro && <Erro erro={erro} />}

      <div className="acl-resumo">
        <p>
          Toda conta <b>@sebratel.com.br</b> enxerga as telas marcadas como <b>Todos</b>.
          Em <b>Restrito</b>, só os e-mails da lista — administradores sempre entram.
        </p>
        {resumo && (
          <span className="acl-contagem">
            <b>{resumo.livres}</b> {resumo.livres === 1 ? 'liberada' : 'liberadas'}
            {' · '}
            <b>{resumo.restritas}</b> {resumo.restritas === 1 ? 'restrita' : 'restritas'}
          </span>
        )}
      </div>

      <div className="tbl-wrap acl-wrap">
        <table className="pbi acl">
          <thead>
            <tr>
              <th className="left">Tela</th>
              <th className="left" style={{ width: 190 }}>Acesso</th>
              <th className="left">Quem pode ver</th>
              <th className="left" style={{ width: 190 }}>Última alteração</th>
            </tr>
          </thead>
          <tbody>
            {(telas || []).map((t) => {
              const emLista = t.modo === 'lista' || editando === t.id;
              return (
                <tr key={t.id} className={emLista ? 'restrita' : ''}>
                  <td className="left">
                    <b>{t.label}</b>
                    <span className="acl-desc">{t.descricao}</span>
                  </td>

                  <td className="left">
                    <span className="acl-modo">
                      <button
                        type="button"
                        className={!emLista ? 'on' : ''}
                        onClick={() => trocarModo(t, 'todos')}
                        disabled={salvando === t.id}
                      >
                        Todos
                      </button>
                      <button
                        type="button"
                        className={emLista ? 'on' : ''}
                        onClick={() => trocarModo(t, 'lista')}
                        disabled={salvando === t.id}
                      >
                        Restrito
                      </button>
                    </span>
                    {salvo === t.id && <span className="acl-salvo"><Icone nome="ok" tamanho={12} /> salvo</span>}
                  </td>

                  <td className="left">
                    {!emLista ? (
                      <span className="acl-livre">todos os usuários do domínio</span>
                    ) : (
                      <div className="acl-emails">
                        {t.emails.map((e) => (
                          <span className="acl-chip" key={e}>
                            {e}
                            <button
                              type="button"
                              title="Remover"
                              disabled={salvando === t.id}
                              onClick={() => {
                                const restantes = t.emails.filter((x) => x !== e);
                                if (!restantes.length) salvar(t, 'todos', []);
                                else salvar(t, 'lista', restantes);
                              }}
                            >
                              <Icone nome="fechar" tamanho={11} />
                            </button>
                          </span>
                        ))}
                        <CampoEmail
                          sugestoes={sugestoes}
                          onAdicionar={(email) => {
                            if (t.emails.includes(email)) return;
                            setEditando(null);
                            salvar(t, 'lista', [...t.emails, email]);
                          }}
                        />
                        {!t.emails.length && (
                          <span className="acl-aviso">adicione ao menos um e-mail</span>
                        )}
                      </div>
                    )}
                  </td>

                  <td className="left acl-quando">
                    {t.atualizadoEm
                      ? <>{labelDataHora(t.atualizadoEm)}<span>{t.atualizadoPor}</span></>
                      : '—'}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- queries
function AbaQueries() {
  const [dados, setDados] = useState(null);
  const [erro, setErro] = useState(null);
  const [aberta, setAberta] = useState(null);
  const [amostra, setAmostra] = useState({});
  const [testando, setTestando] = useState(null);

  useEffect(() => { apiJson('/queries').then(setDados).catch(setErro); }, []);

  const testar = async (q) => {
    setTestando(q.id);
    try {
      const r = await apiJson(`/queries/${q.id}/test`, { method: 'POST', body: { limite: 20 } });
      setAmostra((s) => ({ ...s, [q.id]: r }));
      setErro(null);
    } catch (e) { setErro(e); } finally { setTestando(null); }
  };

  if (!dados && !erro) return <Loading texto="Carregando catálogo…" />;

  return (
    <div className="cfg-bloco">
      {erro && <Erro erro={erro} />}
      <p className="cfg-nota">
        Todas as consultas que alimentam o dashboard, como são enviadas ao banco. O recorte
        histórico é <code>{dados?.since}</code> (telefonia a partir de <code>{dados?.phoneSince}</code>).
        O botão <b>testar</b> executa com <code>LIMIT 20</code>, sem alterar nada.
      </p>

      {(dados?.queries || []).map((q) => (
        <article key={q.id} className="cfg-query">
          <header onClick={() => setAberta(aberta === q.id ? null : q.id)}>
            <div className="cfg-query-id">
              <span className={`cfg-banco ${q.banco}`}>{q.bancoLabel}</span>
              <b>{q.titulo}</b>
              <code>{q.id}</code>
            </div>
            <div className="cfg-query-stats">
              {q.erro
                ? <span className="cfg-erro">falhou: {q.erro}</span>
                : (
                  <>
                    <span>{q.linhas != null ? `${int(q.linhas)} linhas` : '—'}</span>
                    <span>{q.ms != null ? `${int(q.ms)} ms` : ''}</span>
                    <span>{q.ultimaExecucao ? labelDataHora(q.ultimaExecucao) : 'nunca'}</span>
                  </>
                )}
              <Icone nome={aberta === q.id ? 'cima' : 'baixo'} tamanho={13} className="cfg-chevron" />
            </div>
          </header>

          {aberta === q.id && (
            <div className="cfg-query-corpo">
              <p>{q.descricao}</p>
              <div className="cfg-query-meta">
                <span>origem no Power BI: <b>{q.origemPbi}</b></span>
                {!!q.params.length && <span>parâmetros: <code>{q.params.join(', ')}</code></span>}
                {q.incrementos != null && <span>cargas incrementais: <b>{int(q.incrementos)}</b></span>}
              </div>

              <pre className="cfg-sql">{q.sql}</pre>

              <div className="cfg-query-acoes">
                <button type="button" className="cfg-botao" disabled={testando === q.id} onClick={() => testar(q)}>
                  <Icone nome="play" tamanho={13} /> {testando === q.id ? 'executando…' : 'testar (LIMIT 20)'}
                </button>
                <button type="button" className="cfg-botao ghost" onClick={() => navigator.clipboard?.writeText(q.sql)}>
                  <Icone nome="copiar" tamanho={13} /> copiar SQL
                </button>
              </div>

              {amostra[q.id] && (
                <div className="tbl-wrap" style={{ maxHeight: 300, marginTop: 10 }}>
                  <table className="pbi">
                    <thead>
                      <tr>{amostra[q.id].colunas.map((c) => <th key={c} className="left">{c}</th>)}</tr>
                    </thead>
                    <tbody>
                      {amostra[q.id].linhas.map((l, i) => (
                        <tr key={i}>
                          {amostra[q.id].colunas.map((c) => (
                            <td key={c} className="left">{l[c] === null || l[c] === undefined ? '—' : String(l[c])}</td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </article>
      ))}
    </div>
  );
}

// ------------------------------------------------------------------ página
export default function Configuracoes() {
  const { ehAdmin, ehDev, usuario } = useSession();
  const abas = [
    ...(ehAdmin ? [
      { id: 'usuarios', label: 'Usuários e papéis', icone: 'pessoas' },
      { id: 'telas', label: 'Acesso por tela', icone: 'tela' },
    ] : []),
    ...(ehDev ? [{ id: 'queries', label: 'Queries do sistema', icone: 'banco' }] : []),
  ];
  const [aba, setAba] = useState(abas[0]?.id);

  if (!abas.length) {
    return (
      <main className="page">
        <div className="banner error">Esta área é restrita a administradores e usuários DEV.</div>
      </main>
    );
  }

  return (
    <main className="page">
      <Visual
        title="Configurações"
        sub={`${usuario?.email} · ${PAPEL_LABEL[usuario?.papel] || '—'}`}
        className="v-auto"
      >
        <div className="cfg-abas">
          {abas.map((a) => (
            <button key={a.id} type="button" className={aba === a.id ? 'on' : ''} onClick={() => setAba(a.id)}>
              <Icone nome={a.icone} tamanho={14} /> {a.label}
            </button>
          ))}
        </div>

        {aba === 'usuarios' && <AbaUsuarios />}
        {aba === 'telas' && <AbaTelas />}
        {aba === 'queries' && <AbaQueries />}
      </Visual>
    </main>
  );
}
