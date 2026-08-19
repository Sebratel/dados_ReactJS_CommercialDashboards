import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
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

/**
 * Escopo de dados de uma pessoa: as equipes que ela enxerga em TODAS as telas.
 *
 * Fica junto da matriz porque é a outra metade da mesma pergunta — "o que essa
 * pessoa vê" —, mas é outra dimensão: o ACL de tela diz QUAIS telas, o escopo diz
 * QUAL FATIA. Pendurar o escopo em cada tela viraria tela × equipe × pessoa.
 *
 * A escolha abre em diálogo, e não em popover ancorado no botão, porque a célula
 * mora dentro de uma tabela com rolagem: `position: absolute` ali é cortado pela
 * borda do contêiner, e a lista de 36 equipes ainda rolava por dentro. Eram três
 * recortes empilhados para escolher uma equipe. Em diálogo, cabem todas de uma vez.
 */
function DialogoEscopo({ pessoa, equipes, fechar, onAplicar }) {
  const [marcadas, setMarcadas] = useState(() => new Set(pessoa.escopo?.equipes || []));
  const [busca, setBusca] = useState('');
  const [salvando, setSalvando] = useState(false);

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') fechar(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [fechar]);

  const alternar = (eq) => setMarcadas((s) => {
    const n = new Set(s);
    if (n.has(eq)) n.delete(eq); else n.add(eq);
    return n;
  });

  const filtradas = busca.trim()
    ? equipes.filter((e) => e.toLowerCase().includes(busca.trim().toLowerCase()))
    : equipes;

  const aplicar = async () => {
    setSalvando(true);
    try { await onAplicar([...marcadas]); fechar(); } finally { setSalvando(false); }
  };

  return createPortal(
    <>
      <div className="esc-fundo" onClick={fechar} role="presentation" />
      <div className="esc-dialogo" role="dialog" aria-label={`Equipes de ${pessoa.email}`}>
        <header>
          <div>
            <span className="esc-rotulo">Escopo de dados</span>
            <h3>{pessoa.email}</h3>
          </div>
          <button type="button" className="ia-fechar" onClick={fechar} title="Fechar (Esc)">
            <Icone nome="fechar" tamanho={15} />
          </button>
        </header>

        <p className="esc-aviso">
          <Icone nome="alerta" tamanho={13} />
          <span>
            <b>Vale no dashboard inteiro.</b> Recorta todas as visões por equipe de todas as
            telas, mais exportações e leitura de IA — não é filtro de uma tela só. Nenhuma
            marcada = vê todas. Contrato sem equipe fica de fora do recorte.
          </span>
        </p>

        <div className="esc-barra">
          <label className="esc-busca">
            <Icone nome="busca" tamanho={13} />
            <input
              type="text"
              value={busca}
              placeholder={`Buscar entre ${equipes.length} equipes…`}
              onChange={(e) => setBusca(e.target.value)}
            />
          </label>
          <span className="esc-contagem">
            {marcadas.size === 0 ? 'vê todas' : `${marcadas.size} marcada${marcadas.size > 1 ? 's' : ''}`}
          </span>
          {marcadas.size > 0 && (
            <button type="button" className="esc-limpar" onClick={() => setMarcadas(new Set())}>
              limpar
            </button>
          )}
        </div>

        <div className="esc-grade">
          {filtradas.map((eq) => (
            <label key={eq} className={marcadas.has(eq) ? 'on' : ''}>
              <input type="checkbox" checked={marcadas.has(eq)} onChange={() => alternar(eq)} />
              <span>{eq}</span>
            </label>
          ))}
          {!filtradas.length && <p className="esc-vazio">Nenhuma equipe com “{busca}”.</p>}
        </div>

        <footer>
          <button type="button" className="cfg-botao ghost" onClick={fechar}>Cancelar</button>
          <button type="button" className="cfg-botao" onClick={aplicar} disabled={salvando}>
            <Icone nome="ok" tamanho={13} /> {salvando ? 'salvando…' : 'Aplicar'}
          </button>
        </footer>
      </div>
    </>,
    document.body,
  );
}

function SeletorEscopo({ pessoa, equipes, ocupado, onSalvar }) {
  const [aberto, setAberto] = useState(false);

  if (pessoa.veTudo) {
    return (
      <span
        className="esc-todas admin"
        title="Administrador é isento do recorte: sem isso não conseguiria auditar o que liberou"
      >
        isento
      </span>
    );
  }

  const atual = pessoa.escopo?.equipes || [];

  return (
    <>
      <button
        type="button"
        className={`esc-botao${atual.length ? ' on' : ''}`}
        disabled={ocupado}
        title={atual.length ? `Enxerga: ${atual.join(', ')}` : 'Enxerga todas as equipes'}
        onClick={() => setAberto(true)}
      >
        {atual.length ? `${atual.length} ${atual.length === 1 ? 'equipe' : 'equipes'}` : 'todas'}
        <Icone nome="baixo" tamanho={9} />
      </button>
      {aberto && (
        <DialogoEscopo
          pessoa={pessoa}
          equipes={equipes}
          fechar={() => setAberto(false)}
          onAplicar={(lista) => onSalvar(pessoa, lista)}
        />
      )}
    </>
  );
}

// ------------------------------------------------------------ acesso/telas
/**
 * Matriz pessoas x telas.
 *
 * A versão anterior era orientada à tela: para liberar uma pessoa em cinco telas
 * era preciso abrir cinco cartões e digitar o mesmo e-mail em cada um. Quem
 * administra pensa no sentido oposto — "entrou fulano, ele vê isto e isto" — e é
 * esse o sentido que a matriz atende, sem trocar o modelo de dados: a permissão
 * continua guardada por tela, aqui ela só é lida transposta.
 */
function AbaTelas() {
  const { usuario } = useSession();
  const [dados, setDados] = useState(null);
  const [erro, setErro] = useState(null);
  const [ocupado, setOcupado] = useState(null);
  const [novo, setNovo] = useState('');
  const [pendentes, setPendentes] = useState([]); // digitados, ainda sem tela marcada

  const carregar = useCallback(async () => {
    try {
      setDados(await apiJson('/access/matriz'));
      setErro(null);
    } catch (e) { setErro(e); }
  }, []);
  useEffect(() => { carregar(); }, [carregar]);

  const executar = async (chave, fn) => {
    setOcupado(chave);
    try { setDados(await fn()); setErro(null); } catch (e) { setErro(e); } finally { setOcupado(null); }
  };

  /** Um clique manda a linha inteira: o resultado não depende da ordem dos cliques. */
  const alternarTela = (pessoa, telaId) => {
    const atual = new Set(pessoa.telas);
    if (atual.has(telaId)) atual.delete(telaId); else atual.add(telaId);
    executar(`${pessoa.email}:${telaId}`, () => apiJson(
      `/access/users/${encodeURIComponent(pessoa.email)}/telas`,
      { method: 'PUT', body: { telas: [...atual] } },
    ));
  };

  const salvarEscopo = (pessoa, equipes) => executar(`escopo:${pessoa.email}`, () => apiJson(
    `/access/users/${encodeURIComponent(pessoa.email)}/escopo`,
    { method: 'PUT', body: { equipes } },
  ));

  const trocarModo = (tela) => {
    const modo = tela.modo === 'todos' ? 'lista' : 'todos';
    executar(`tela:${tela.id}`, async () => {
      await apiJson(`/access/screens/${tela.id}`, {
        method: 'PUT',
        body: { modo, emails: modo === 'lista' ? tela.emails : [] },
      });
      return apiJson('/access/matriz');
    });
  };

  const adicionar = () => {
    const e = novo.trim().toLowerCase();
    if (!e.includes('@')) { setErro(new Error('Informe um e-mail válido.')); return; }
    const jaTem = (dados?.pessoas || []).some((p) => p.email === e) || pendentes.includes(e);
    if (!jaTem) setPendentes((lista) => [...lista, e]);
    setNovo('');
    setErro(null);
  };

  if (!dados && !erro) return <Loading texto="Carregando acessos…" />;

  const telas = dados?.telas || [];
  const restritas = telas.filter((t) => t.modo === 'lista').length;
  const linhas = [
    ...(dados?.pessoas || []),
    ...pendentes
      .filter((e) => !(dados?.pessoas || []).some((p) => p.email === e))
      .map((email) => ({ email, papel: 'viewer', telas: [], novo: true })),
  ];

  return (
    <div className="cfg-bloco">
      {erro && <Erro erro={erro} />}

      <p className="cfg-nota">
        Duas perguntas diferentes na mesma tabela. As colunas de tela dizem <b>quais telas</b> a
        pessoa abre. A coluna <b>Equipes</b> diz <b>qual fatia dos dados</b> ela enxerga, e essa
        <b> vale no dashboard inteiro</b>: recorta todas as visões por equipe de todas as telas,
        além das exportações e da leitura de IA — não é um filtro de uma tela só. Tudo grava na
        hora. Coluna em <b>todos</b> vale para qualquer conta do domínio, então aparece
        preenchida e sem caixa.
      </p>

      <div className="cfg-form">
        <label>
          <span>Liberar acesso para</span>
          <input
            type="email"
            value={novo}
            placeholder="nome@sebratel.com.br"
            onChange={(e) => setNovo(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') adicionar(); }}
          />
        </label>
        <button type="button" className="cfg-botao" onClick={adicionar}>
          <Icone nome="mais" tamanho={14} /> Adicionar à matriz
        </button>
        <span className="janela-aviso">
          {restritas === 0
            ? 'Nenhuma tela está restrita: hoje todo o domínio vê tudo.'
            : `${restritas} de ${telas.length} ${restritas === 1 ? 'tela restrita' : 'telas restritas'}.`}
        </span>
      </div>

      <div className="tbl-wrap matriz-wrap">
        <table className="pbi matriz">
          <thead>
            <tr>
              <th className="left col-pessoa">Pessoa</th>
              <th className="col-escopo" title="Recorte de dados: vale no dashboard inteiro, não em uma tela só">Equipes</th>
              {telas.map((t) => (
                <th key={t.id} className="col-tela" title={`${t.label} — ${t.descricao}`}>
                  <span className="mt-nome">{t.curto || t.label}</span>
                  <button
                    type="button"
                    className={`mt-modo ${t.modo}`}
                    disabled={ocupado === `tela:${t.id}`}
                    title={t.modo === 'todos'
                      ? 'Visível para todo o domínio. Clique para restringir à lista.'
                      : 'Restrita à lista. Clique para liberar a todo o domínio.'}
                    onClick={() => trocarModo(t)}
                  >
                    {t.modo === 'todos' ? 'todos' : 'restrita'}
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {linhas.map((p) => (
              <tr key={p.email} className={p.novo ? 'linha-nova' : ''}>
                <td className="left col-pessoa" title={p.email}>
                  <span className="mt-email">
                    {p.email}
                    {p.email === usuario?.email && <span className="cfg-tag">você</span>}
                    {p.papel !== 'viewer' && <span className="cfg-tag">{PAPEL_LABEL[p.papel]}</span>}
                  </span>
                </td>
                <td className="col-escopo">
                  <SeletorEscopo
                    pessoa={p}
                    equipes={dados?.equipes || []}
                    ocupado={ocupado === `escopo:${p.email}`}
                    onSalvar={salvarEscopo}
                  />
                </td>
                {telas.map((t) => {
                  const chave = `${p.email}:${t.id}`;
                  const aberta = t.modo === 'todos';
                  const veTudo = p.veTudo;
                  // admin passa por definição, e tela aberta vale para todos:
                  // caixinha nesses casos seria decorativa e enganaria quem clica
                  if (veTudo || aberta) {
                    return (
                      <td key={t.id} className="col-tela">
                        <span
                          className={`mt-implicito${veTudo ? ' admin' : ''}`}
                          title={veTudo
                            ? 'Administrador enxerga todas as telas'
                            : 'Tela liberada para todo o domínio'}
                        >
                          <Icone nome="ok" tamanho={12} />
                        </span>
                      </td>
                    );
                  }
                  return (
                    <td key={t.id} className="col-tela">
                      <input
                        type="checkbox"
                        className="mt-caixa"
                        checked={p.telas.includes(t.id)}
                        disabled={ocupado === chave}
                        title={`${p.telas.includes(t.id) ? 'Remover' : 'Liberar'} ${t.label} para ${p.email}`}
                        onChange={() => alternarTela(p, t.id)}
                      />
                    </td>
                  );
                })}
              </tr>
            ))}
            {!linhas.length && (
              <tr>
                <td colSpan={telas.length + 2} style={{ textAlign: 'center', padding: 22, color: '#605E5C' }}>
                  Ninguém cadastrado ainda. Adicione um e-mail acima.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <ul className="cfg-legenda">
        <li>
          <b>Todos</b> vale para qualquer conta do domínio. <b>Restrita</b> vale só para quem
          estiver marcado — e para os administradores, que entram em tudo.
        </li>
        <li>
          Tela restrita <b>sem ninguém marcado</b> fica só para administradores. É estado válido:
          antes, tirar a última pessoa devolvia a tela ao domínio inteiro, ou seja, uma remoção
          de acesso acabava ampliando o acesso.
        </li>
        <li>
          <b>Equipes (escopo de dados):</b> recorta o dashboard <b>inteiro</b> para aquela pessoa,
          não a tela em que foi configurado. Serve para líder ver as equipes que responde. Quem
          tem recorte enxerga um selo na barra de filtros com as equipes que alcança, e o total
          dele nunca fecha com o total geral — inclusive porque contrato sem equipe fica de fora.
        </li>
        <li>
          O backend confere a permissão <b>em cada endpoint</b>, não só na navegação: esconder o
          item do menu não é o que protege o dado.
        </li>
      </ul>
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

// -------------------------------------------------- catálogo de queries (DEV)
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
