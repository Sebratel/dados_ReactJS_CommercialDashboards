import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { apiJson } from '../api';
import { useSession } from '../auth/session.jsx';
import { Erro, Loading, Visual } from '../components/ui';
import { Icone } from '../components/Icone';
import { int, labelDataHora } from '../format';

const PAPEL_LABEL = { viewer: 'Visualizador', dev: 'DEV', admin: 'Administrador' };
const PAPEL_AJUDA = {
  viewer: 'Vê as telas liberadas para todos e aquelas em que o e-mail está na lista.',
  dev: 'Visualizador com o atributo de power user já marcado.',
  admin: 'Gerencia pessoas, acesso por tela e provedor de IA. Vê todas as telas do dashboard.',
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
              <th className="left">Power user</th>
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
                  <label className="cfg-toggle" title={u.powerUserFixo
                    ? 'Vem de DEV_EMAILS no .env — a tela não rebaixa o que vem de lá.'
                    : 'Libera o catálogo de queries do sistema, seja qual for o papel.'}
                  >
                    <input
                      type="checkbox"
                      checked={!!u.powerUser}
                      disabled={u.powerUserFixo || ocupado === u.email}
                      onChange={(e) => executar(
                        () => apiJson(`/access/users/${encodeURIComponent(u.email)}/poweruser`, {
                          method: 'PUT', body: { ativo: e.target.checked },
                        }),
                        u.email,
                      )}
                    />
                    <span>{u.powerUser ? 'sim' : 'não'}</span>
                    {u.powerUserFixo && <Icone nome="cadeado" tamanho={11} />}
                  </label>
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
              <tr><td colSpan={5} style={{ textAlign: 'center', padding: 24, color: '#605E5C' }}>Ninguém com papel elevado ainda.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      <ul className="cfg-legenda">
        {Object.entries(PAPEL_AJUDA).map(([p, txt]) => (
          <li key={p}><b>{PAPEL_LABEL[p]}:</b> {txt}</li>
        ))}
        <li>
          <b>Power user:</b> atributo à parte do papel — é ele, e só ele, que abre o catálogo de
          queries. Ser administrador não concede e não impede: quem acumula os dois continua vendo
          o SQL, e um administrador sem a marcação não vê.
        </li>
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


// ------------------------------------------------------- janela de dados
function AbaJanela() {
  const [estado, setEstado] = useState(null);
  const [erro, setErro] = useState(null);
  const [salvando, setSalvando] = useState(false);
  const [form, setForm] = useState({ since: '', phoneSince: '' });

  const carregar = useCallback(async (sincronizarForm = true) => {
    try {
      const d = await apiJson('/janela');
      setEstado(d);
      if (sincronizarForm) setForm({ since: d.since, phoneSince: d.phoneSince });
      setErro(null);
      return d;
    } catch (e) { setErro(e); return null; }
  }, []);
  useEffect(() => { carregar(); }, [carregar]);

  // enquanto a recarga roda, acompanha até terminar — é o retorno visível da ação
  useEffect(() => {
    if (!estado?.recarga?.rodando) return undefined;
    const t = setInterval(() => carregar(false), 3000);
    return () => clearInterval(t);
  }, [estado?.recarga?.rodando, carregar]);

  const salvar = async () => {
    setSalvando(true);
    setErro(null);
    try {
      setEstado(await apiJson('/janela', { method: 'PUT', body: form }));
    } catch (e) { setErro(e); } finally { setSalvando(false); }
  };

  const restaurar = async () => {
    setSalvando(true);
    setErro(null);
    try {
      const d = await apiJson('/janela/restaurar', { method: 'POST' });
      setEstado(d);
      setForm({ since: d.since, phoneSince: d.phoneSince });
    } catch (e) { setErro(e); } finally { setSalvando(false); }
  };

  if (!estado && !erro) return <Loading texto="Carregando janela de dados…" />;

  const alterado = estado && (form.since !== estado.since || form.phoneSince !== estado.phoneSince);
  const recarga = estado?.recarga || {};

  return (
    <div className="cfg-bloco">
      {erro && <Erro erro={erro} />}

      <p className="cfg-nota">
        Define quanto histórico o dashboard carrega do Voalle. Alcança <b>todas</b> as telas:
        é ele que limita até onde vão as comparações entre meses, as coortes e as projeções.
        Ampliar traz mais histórico e deixa a carga completa mais lenta; reduzir acelera, mas
        encurta a base de comparação.
      </p>

      <div className="cfg-form">
        <label>
          <span>Carregar contratos a partir de</span>
          <input
            type="date"
            value={form.since}
            max={new Date().toISOString().slice(0, 10)}
            onChange={(e) => setForm({ ...form, since: e.target.value })}
          />
        </label>
        <label>
          <span>Ativações de telefonia a partir de</span>
          <input
            type="date"
            value={form.phoneSince}
            max={new Date().toISOString().slice(0, 10)}
            onChange={(e) => setForm({ ...form, phoneSince: e.target.value })}
          />
        </label>
      </div>

      <div className="janela-acoes">
        <button type="button" className="cfg-botao" onClick={salvar} disabled={salvando || !alterado}>
          <Icone nome="ok" tamanho={13} /> {salvando ? 'salvando…' : 'Salvar e recarregar'}
        </button>
        {estado?.origem === 'tela' && (
          <button type="button" className="cfg-botao ghost" onClick={restaurar} disabled={salvando}>
            <Icone nome="atualizar" tamanho={13} /> Voltar ao valor do .env
          </button>
        )}
        {alterado && <span className="janela-aviso">A recarga completa leva cerca de 40 segundos.</span>}
      </div>

      <div className={`janela-estado ${recarga.rodando ? 'rodando' : ''}`}>
        {recarga.rodando ? (
          <>
            <Icone nome="atualizar" tamanho={14} className="spin" />
            <span>
              Recarregando a base com o novo recorte. Os dados anteriores continuam no ar até terminar.
            </span>
          </>
        ) : (
          <>
            <Icone nome={recarga.erro ? 'alerta' : 'banco'} tamanho={14} />
            <span>
              {recarga.erro
                ? `A última recarga falhou: ${recarga.erro}`
                : `${int(estado?.contratos || 0)} contratos carregados${estado?.carregadoEm ? ` · ${labelDataHora(estado.carregadoEm)}` : ''}`}
            </span>
          </>
        )}
      </div>

      <ul className="cfg-legenda">
        <li>
          Em vigor: <b>{estado?.since}</b> (telefonia a partir de <b>{estado?.phoneSince}</b>)
          {estado?.origem === 'env'
            ? ' — valor de semente, vindo do .env.'
            : ` — definido na tela${estado?.atualizadoPor ? ` por ${estado.atualizadoPor}` : ''}${estado?.atualizadoEm ? ` em ${labelDataHora(estado.atualizadoEm)}` : ''}.`}
        </li>
        <li>
          <code>DATA_SINCE</code> e <code>PHONE_SINCE</code> no <code>.env</code> continuam valendo
          como ponto de partida: valem enquanto ninguém definir nada aqui, e o botão acima volta a eles.
        </li>
        <li>
          A telefonia entrou na operação depois do resto, por isso tem data própria — ela não pode
          ser anterior à data inicial da base.
        </li>
      </ul>
    </div>
  );
}

// -------------------------------------------------------- provedor de IA
function AbaIA() {
  const [estado, setEstado] = useState(null);
  const [erro, setErro] = useState(null);
  const [salvando, setSalvando] = useState(false);
  const [testando, setTestando] = useState(false);
  const [teste, setTeste] = useState(null);
  const [modelos, setModelos] = useState([]);
  const [buscandoModelos, setBuscandoModelos] = useState(false);
  const [form, setForm] = useState({ tipo: 'anthropic', modelo: '', chave: '', baseUrl: '', maxTokens: 4000 });

  const carregar = useCallback(async () => {
    try {
      const d = await apiJson('/ia');
      setEstado(d);
      setForm((f) => ({
        ...f,
        tipo: d.tipo || 'anthropic',
        modelo: d.modelo || '',
        baseUrl: d.baseUrl || '',
        maxTokens: d.maxTokens || 4000,
        chave: '',
      }));
      setTeste(d.ultimoTeste || null);
      setErro(null);
    } catch (e) { setErro(e); }
  }, []);
  useEffect(() => { carregar(); }, [carregar]);

  const salvar = async () => {
    setSalvando(true);
    setErro(null);
    try {
      const corpo = {
        tipo: form.tipo,
        modelo: form.modelo,
        baseUrl: form.baseUrl || null,
        maxTokens: Number(form.maxTokens) || 4000,
      };
      if (form.chave.trim()) corpo.chave = form.chave.trim();
      await apiJson('/ia', { method: 'PUT', body: corpo });
      await carregar();
    } catch (e) { setErro(e); } finally { setSalvando(false); }
  };

  const buscarModelos = async () => {
    setBuscandoModelos(true);
    setErro(null);
    try {
      const corpo = { tipo: form.tipo, baseUrl: form.baseUrl || null };
      if (form.chave.trim()) corpo.chave = form.chave.trim();
      const d = await apiJson('/ia/modelos', { method: 'POST', body: corpo });
      setModelos(d.modelos || []);
    } catch (e) { setErro(e); } finally { setBuscandoModelos(false); }
  };

  const testar = async () => {
    setTestando(true);
    setErro(null);
    try {
      setTeste(await apiJson('/ia/testar', { method: 'POST' }));
    } catch (e) { setErro(e); } finally { setTestando(false); }
  };

  const remover = async () => {
    setSalvando(true);
    try {
      await apiJson('/ia', { method: 'DELETE' });
      setModelos([]);
      setTeste(null);
      await carregar();
    } catch (e) { setErro(e); } finally { setSalvando(false); }
  };

  if (!estado && !erro) return <Loading texto="Carregando configuração…" />;

  return (
    <div className="cfg-bloco">
      {erro && <Erro erro={erro} />}

      <p className="cfg-nota">
        A tela de <b>Análise Preditiva</b> calcula os indicadores sozinha, sem IA. O provedor
        cadastrado aqui é usado só para <b>interpretar</b> esses números e sugerir prioridades —
        ele nunca recebe nome de cliente, apenas os agregados.
      </p>

      <div className={`ia-estado ${estado?.configurado ? 'ok' : 'vazio'}`}>
        <Icone nome={estado?.configurado ? 'ok' : 'alerta'} tamanho={15} />
        {estado?.configurado ? (
          <span>
            Configurado: <b>{estado.tipo}</b> · <code>{estado.modelo}</code> · chave {estado.dica}
            {estado.origem === 'env' && ' (vindo do .env)'}
            {estado.atualizadoPor && ` · por ${estado.atualizadoPor}`}
          </span>
        ) : (
          <span>Nenhuma chave cadastrada. A tela preditiva funciona, mas sem a leitura da IA.</span>
        )}
      </div>

      <div className="ia-form">
        <div className="cfg-form">
          <label>
            <span>Provedor</span>
            <select value={form.tipo} onChange={(e) => { setForm({ ...form, tipo: e.target.value }); setModelos([]); }}>
              {(estado?.tipos || []).map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
            </select>
          </label>
          <label>
            <span>Chave de API {estado?.configurado && '(em branco mantém a atual)'}</span>
            <input
              type="password"
              autoComplete="off"
              placeholder={estado?.configurado ? `mantém ${estado.dica}` : 'cole a chave aqui'}
              value={form.chave}
              onChange={(e) => setForm({ ...form, chave: e.target.value })}
            />
          </label>
        </div>

        <div className="cfg-form">
          <label>
            <span>Modelo</span>
            {modelos.length ? (
              <select value={form.modelo} onChange={(e) => setForm({ ...form, modelo: e.target.value })}>
                <option value="">selecione…</option>
                {modelos.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
              </select>
            ) : (
              <input
                type="text"
                placeholder="ex.: claude-sonnet-5"
                value={form.modelo}
                onChange={(e) => setForm({ ...form, modelo: e.target.value })}
              />
            )}
          </label>
          <button type="button" className="cfg-botao ghost" onClick={buscarModelos} disabled={buscandoModelos}>
            <Icone nome="atualizar" tamanho={13} className={buscandoModelos ? 'spin' : ''} />
            {buscandoModelos ? 'buscando…' : 'listar modelos da chave'}
          </button>
        </div>

        <div className="cfg-form">
          <label>
            <span>URL base (opcional — Groq, OpenRouter, Azure, local)</span>
            <input
              type="text"
              placeholder="deixe vazio para o padrão do provedor"
              value={form.baseUrl}
              onChange={(e) => setForm({ ...form, baseUrl: e.target.value })}
            />
          </label>
          <label>
            <span>Teto de tokens</span>
            <input
              type="number"
              min="256"
              max="64000"
              value={form.maxTokens}
              onChange={(e) => setForm({ ...form, maxTokens: e.target.value })}
            />
          </label>
        </div>

        <div className="ia-acoes">
          <button type="button" className="cfg-botao" onClick={salvar} disabled={salvando}>
            <Icone nome="ok" tamanho={13} /> Salvar
          </button>
          <button type="button" className="cfg-botao ghost" onClick={testar} disabled={testando || !estado?.configurado}>
            <Icone nome="play" tamanho={13} /> {testando ? 'testando…' : 'Testar conexão'}
          </button>
          {estado?.origem === 'tela' && (
            <button type="button" className="cfg-botao ghost" onClick={remover} disabled={salvando}>
              <Icone nome="fechar" tamanho={13} /> Remover chave
            </button>
          )}
          {teste && (
            <span className={`ia-teste ${teste.ok ? 'ok' : 'falha'}`}>
              {teste.ok
                ? `conexão ok em ${teste.ms} ms — resposta: "${teste.amostra}"`
                : `falhou: ${teste.erro}`}
            </span>
          )}
        </div>
      </div>

      <ul className="cfg-legenda">
        <li>A chave é gravada <b>cifrada</b> (AES-256-GCM) e nunca volta numa resposta da API — só os quatro últimos caracteres.</li>
        <li><b>OpenAI e compatíveis</b> cobre Groq, OpenRouter, Azure OpenAI, Together e servidores locais: muda só a URL base.</li>
        <li>Defina <code>SECRET_KEY</code> no ambiente para controlar a chave de cifra; sem ela, uma é gerada no volume de dados.</li>
      </ul>
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
      { id: 'janela', label: 'Janela de dados', icone: 'relogio' },
      { id: 'ia', label: 'Provedor de IA', icone: 'ia' },
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
        {aba === 'janela' && <AbaJanela />}
        {aba === 'ia' && <AbaIA />}
        {aba === 'queries' && <AbaQueries />}
      </Visual>
    </main>
  );
}
