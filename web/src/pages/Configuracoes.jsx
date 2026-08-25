import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { apiJson } from '../api';
import { useSession } from '../auth/session.jsx';
import { Erro, Loading, Visual } from '../components/ui';
import { Icone } from '../components/Icone';
import { int, labelData, labelDataHora } from '../format';

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
 *
 * Confirmar aqui NÃO grava: alimenta o rascunho da matriz, que persiste tudo de
 * uma vez no botão Salvar. Duas gravações em níveis diferentes confundiriam quem
 * está no meio de uma reorganização.
 */
function DialogoEscopo({ pessoa, equipes, marcadas: iniciais, fechar, onConfirmar }) {
  const [marcadas, setMarcadas] = useState(() => new Set(iniciais));
  const [busca, setBusca] = useState('');

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

  const busca_ = busca.trim().toLowerCase();
  const filtradas = busca_ ? equipes.filter((e) => e.toLowerCase().includes(busca_)) : equipes;

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
              placeholder={equipes.length ? `Buscar entre ${equipes.length} equipes…` : 'Carregando equipes…'}
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
          {!filtradas.length && (
            <p className="esc-vazio">
              {!equipes.length
                ? 'A lista de equipes não chegou. Recarregue a página.'
                : `Nenhuma equipe com “${busca}”.`}
            </p>
          )}
        </div>

        <footer>
          <button type="button" className="cfg-botao ghost" onClick={fechar}>Cancelar</button>
          <button
            type="button"
            className="cfg-botao"
            onClick={() => { onConfirmar(pessoa, [...marcadas]); fechar(); }}
          >
            <Icone nome="ok" tamanho={13} /> Confirmar
          </button>
        </footer>
      </div>
    </>,
    document.body,
  );
}

function SeletorEscopo({ pessoa, equipes, marcadas, onConfirmar }) {
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

  return (
    <>
      <button
        type="button"
        className={`esc-botao${marcadas.length ? ' on' : ''}`}
        title={marcadas.length ? `Enxerga: ${marcadas.join(', ')}` : 'Enxerga todas as equipes'}
        onClick={() => setAberto(true)}
      >
        {marcadas.length ? `${marcadas.length} ${marcadas.length === 1 ? 'equipe' : 'equipes'}` : 'todas'}
        <Icone nome="baixo" tamanho={9} />
      </button>
      {aberto && (
        <DialogoEscopo
          pessoa={pessoa}
          equipes={equipes}
          marcadas={marcadas}
          fechar={() => setAberto(false)}
          onConfirmar={onConfirmar}
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
 *
 * As alterações ficam em RASCUNHO até você clicar em Salvar. A versão anterior
 * gravava a cada clique, o que numa tela de uso frequente significa dezenas de
 * requisições, nenhuma confirmação visível e nenhum jeito de desistir no meio de
 * uma reorganização. Agora o que está pendente aparece destacado e some junto.
 */
function AbaTelas() {
  const { usuario } = useSession();
  const [dados, setDados] = useState(null);
  const [erro, setErro] = useState(null);
  const [salvando, setSalvando] = useState(false);
  const [salvo, setSalvo] = useState(false);
  const [novo, setNovo] = useState('');
  const [pendentes, setPendentes] = useState([]); // e-mails digitados, ainda sem nada
  // rascunho: só o que difere do servidor
  const [rasTelas, setRasTelas] = useState({});   // email -> [telaId]
  const [rasEscopo, setRasEscopo] = useState({}); // email -> [equipe]
  const [rasModo, setRasModo] = useState({});     // telaId -> 'todos' | 'lista'

  const carregar = useCallback(async () => {
    try {
      setDados(await apiJson('/access/matriz'));
      setErro(null);
    } catch (e) { setErro(e); }
  }, []);
  useEffect(() => { carregar(); }, [carregar]);

  const limparRascunho = () => { setRasTelas({}); setRasEscopo({}); setRasModo({}); setPendentes([]); };

  if (!dados && !erro) return <Loading texto="Carregando acessos…" />;

  const telas = dados?.telas || [];
  const pessoasServidor = dados?.pessoas || [];

  // leitura efetiva = rascunho quando existe, servidor quando não
  const modoDe = (t) => rasModo[t.id] ?? t.modo;
  const telasDe = (p) => rasTelas[p.email] ?? p.telas;
  const escopoDe = (p) => rasEscopo[p.email] ?? (p.escopo?.equipes || []);

  const linhas = [
    ...pessoasServidor,
    ...pendentes
      .filter((e) => !pessoasServidor.some((p) => p.email === e))
      .map((email) => ({ email, papel: 'viewer', telas: [], novo: true })),
  ];

  const alteracoes = Object.keys(rasTelas).length + Object.keys(rasEscopo).length + Object.keys(rasModo).length;

  const alternarTela = (pessoa, telaId) => {
    const atual = new Set(telasDe(pessoa));
    if (atual.has(telaId)) atual.delete(telaId); else atual.add(telaId);
    setRasTelas((r) => ({ ...r, [pessoa.email]: [...atual] }));
    setSalvo(false);
  };

  const trocarModo = (tela) => {
    setRasModo((r) => ({ ...r, [tela.id]: modoDe(tela) === 'todos' ? 'lista' : 'todos' }));
    setSalvo(false);
  };

  const definirEscopoRascunho = (pessoa, equipes) => {
    setRasEscopo((r) => ({ ...r, [pessoa.email]: equipes }));
    setSalvo(false);
  };

  const adicionar = () => {
    const e = novo.trim().toLowerCase();
    if (!e.includes('@')) { setErro(new Error('Informe um e-mail válido.')); return; }
    if (!linhas.some((p) => p.email === e)) setPendentes((lista) => [...lista, e]);
    setNovo('');
    setErro(null);
  };

  /**
   * Ordem importa: o modo da tela vai primeiro. `definirTelasDoEmail` ignora tela
   * em modo "todos", então marcar alguém numa tela que só agora virou restrita
   * seria descartado se a gravação viesse antes.
   */
  const salvar = async () => {
    setSalvando(true);
    setErro(null);
    try {
      for (const [id, modo] of Object.entries(rasModo)) {
        const tela = telas.find((t) => t.id === id);
        await apiJson(`/access/screens/${id}`, {
          method: 'PUT',
          body: { modo, emails: modo === 'lista' ? (tela?.emails || []) : [] },
        });
      }
      for (const [email, lista] of Object.entries(rasTelas)) {
        await apiJson(`/access/users/${encodeURIComponent(email)}/telas`, { method: 'PUT', body: { telas: lista } });
      }
      for (const [email, equipes] of Object.entries(rasEscopo)) {
        await apiJson(`/access/users/${encodeURIComponent(email)}/escopo`, { method: 'PUT', body: { equipes } });
      }
      limparRascunho();
      await carregar();
      setSalvo(true);
      setTimeout(() => setSalvo(false), 3000);
    } catch (e) { setErro(e); } finally { setSalvando(false); }
  };

  const restritas = telas.filter((t) => modoDe(t) === 'lista').length;

  return (
    <div className="cfg-bloco">
      {erro && <Erro erro={erro} />}

      <p className="cfg-nota">
        Duas perguntas diferentes na mesma tabela. As colunas de tela dizem <b>quais telas</b> a
        pessoa abre. A coluna <b>Equipes</b> diz <b>qual fatia dos dados</b> ela enxerga, e essa
        <b> vale no dashboard inteiro</b>: recorta todas as visões por equipe de todas as telas,
        além das exportações e da leitura de IA — não é um filtro de uma tela só. Coluna em
        <b> todos</b> vale para qualquer conta do domínio, então aparece preenchida e sem caixa.
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
        <button type="button" className="cfg-botao ghost" onClick={adicionar}>
          <Icone nome="mais" tamanho={14} /> Adicionar à matriz
        </button>
        <span className="janela-aviso">
          {restritas === 0
            ? 'Nenhuma tela está restrita: hoje todo o domínio vê tudo.'
            : `${restritas} de ${telas.length} ${restritas === 1 ? 'tela restrita' : 'telas restritas'}.`}
        </span>
      </div>

      {/* nada é gravado até aqui: o que está pendente fica visível e desfazível */}
      <div className={`ras-barra${alteracoes ? ' ativa' : ''}`}>
        {alteracoes ? (
          <>
            <Icone nome="alerta" tamanho={14} />
            <span>
              <b>{alteracoes}</b> {alteracoes === 1 ? 'alteração não salva' : 'alterações não salvas'}
              {' '}— as células pendentes estão destacadas.
            </span>
            <button type="button" className="cfg-botao ghost" onClick={limparRascunho} disabled={salvando}>
              Descartar
            </button>
            <button type="button" className="cfg-botao" onClick={salvar} disabled={salvando}>
              <Icone nome="ok" tamanho={13} /> {salvando ? 'salvando…' : 'Salvar alterações'}
            </button>
          </>
        ) : (
          <>
            <Icone nome={salvo ? 'ok' : 'cadeado'} tamanho={14} />
            <span>{salvo ? 'Alterações salvas.' : 'Nenhuma alteração pendente.'}</span>
          </>
        )}
      </div>

      <div className="tbl-wrap matriz-wrap">
        <table className="pbi matriz">
          <thead>
            <tr>
              <th className="left col-pessoa">Pessoa</th>
              <th className="col-escopo" title="Recorte de dados: vale no dashboard inteiro, não em uma tela só">Equipes</th>
              {telas.map((t) => {
                const modo = modoDe(t);
                return (
                  <th key={t.id} className="col-tela" title={`${t.label} — ${t.descricao}`}>
                    <span className="mt-nome">{t.curto || t.label}</span>
                    <button
                      type="button"
                      className={`mt-modo ${modo}${rasModo[t.id] ? ' pendente' : ''}`}
                      title={modo === 'todos'
                        ? 'Visível para todo o domínio. Clique para restringir à lista.'
                        : 'Restrita à lista. Clique para liberar a todo o domínio.'}
                      onClick={() => trocarModo(t)}
                    >
                      {modo === 'todos' ? 'todos' : 'restrita'}
                    </button>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {linhas.map((p) => {
              const minhasTelas = telasDe(p);
              const escopoPendente = !!rasEscopo[p.email];
              return (
                <tr key={p.email} className={p.novo ? 'linha-nova' : ''}>
                  <td className="left col-pessoa" title={p.email}>
                    <span className="mt-email">
                      {p.email}
                      {p.email === usuario?.email && <span className="cfg-tag">você</span>}
                      {p.papel !== 'viewer' && <span className="cfg-tag">{PAPEL_LABEL[p.papel]}</span>}
                    </span>
                  </td>
                  <td className={`col-escopo${escopoPendente ? ' pendente' : ''}`}>
                    <SeletorEscopo
                      pessoa={p}
                      equipes={dados?.equipes || []}
                      marcadas={escopoDe(p)}
                      onConfirmar={definirEscopoRascunho}
                    />
                  </td>
                  {telas.map((t) => {
                    const aberta = modoDe(t) === 'todos';
                    const veTudo = p.veTudo;
                    // admin passa por definição, e tela aberta vale para todos:
                    // caixinha nesses casos enganaria quem clica
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
                    const marcada = minhasTelas.includes(t.id);
                    const mudou = !!rasTelas[p.email] && p.telas.includes(t.id) !== marcada;
                    return (
                      <td key={t.id} className={`col-tela${mudou ? ' pendente' : ''}`}>
                        <input
                          type="checkbox"
                          className="mt-caixa"
                          checked={marcada}
                          title={`${marcada ? 'Remover' : 'Liberar'} ${t.label} para ${p.email}`}
                          onChange={() => alternarTela(p, t.id)}
                        />
                      </td>
                    );
                  })}
                </tr>
              );
            })}
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
  const [form, setForm] = useState({ since: '', phoneSince: '', crmSince: '', relSince: '' });

  const carregar = useCallback(async (sincronizarForm = true) => {
    try {
      const d = await apiJson('/janela');
      setEstado(d);
      if (sincronizarForm) setForm({ since: d.since, phoneSince: d.phoneSince, crmSince: d.crmSince, relSince: d.relSince });
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
      setForm({ since: d.since, phoneSince: d.phoneSince, crmSince: d.crmSince, relSince: d.relSince });
    } catch (e) { setErro(e); } finally { setSalvando(false); }
  };

  if (!estado && !erro) return <Loading texto="Carregando janela de dados…" />;

  const alterado = estado && (form.since !== estado.since
    || form.phoneSince !== estado.phoneSince
    || form.crmSince !== estado.crmSince
    || form.relSince !== estado.relSince);
  const recarga = estado?.recarga || {};

  return (
    <div className="cfg-bloco">
      {erro && <Erro erro={erro} />}

      <p className="cfg-nota">
        Define quanto histórico o dashboard carrega do Voalle. É ele que limita até onde vão
        as comparações entre meses, as coortes e as projeções. Ampliar traz mais histórico e
        deixa a carga completa mais lenta; reduzir acelera, mas encurta a base de comparação.
      </p>
      <p className="cfg-nota">
        <b>Esta é a alavanca de memória do servidor.</b> A cesta de produtos de Relatórios
        Comercial são 220 mil linhas e 89 MB com o recorte de 2024 — é o conjunto mais pesado
        do dashboard, e aquelas telas respondem &ldquo;onde está este contrato agora&rdquo;,
        raramente sobre 2024. Estreitar a data de Relatórios é o que mais devolve memória sem
        tirar histórico da Diretoria.
      </p>
      <p className="cfg-nota">
        Cada data alcança o seu modelo: a <b>inicial</b> vale para contratos, ativações e
        primeiro pagamento — ou seja, Diretoria, Vendas, Ativações, 1º Pagamento, Rampagem,
        Premiações, Canceladas, Históricos e Preditiva. A de <b>telefonia</b> recorta só as
        ativações de telefonia. A do <b>CRM</b> vale para as quatro sub-páginas de Leads e
        Negociações. A de <b>Relatórios</b> vale para a cesta de produtos, a pesquisa de
        cancelamento, a base de clientes e a ponte histórica — sem valor próprio, ela segue a
        data inicial.
      </p>
      <p className="cfg-nota">
        <b>Condomínios não aparece aqui de propósito.</b> A rede de splitters é um retrato do
        agora, não uma série temporal: cortar por data de criação tiraria da conta equipamento
        que está em operação desde 2019 e a ocupação passaria a mentir. O recorte por data
        daquela tela é o filtro <b>Criação do splitter</b>, na própria barra dela, que só
        esconde linha — não muda a capacidade instalada.
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
        <label>
          <span>Leads e negociações a partir de</span>
          <input
            type="date"
            value={form.crmSince}
            max={new Date().toISOString().slice(0, 10)}
            onChange={(e) => setForm({ ...form, crmSince: e.target.value })}
          />
        </label>
        <label>
          <span>Relatórios Comercial a partir de</span>
          <input
            type="date"
            value={form.relSince}
            max={new Date().toISOString().slice(0, 10)}
            onChange={(e) => setForm({ ...form, relSince: e.target.value })}
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
          Em vigor: <b>{estado?.since}</b> (telefonia a partir de <b>{estado?.phoneSince}</b>,
          {' '}CRM a partir de <b>{estado?.crmSince}</b>, relatórios a partir de{' '}
          <b>{estado?.relSince}</b>)
          {estado?.origem === 'env'
            ? ' — valor de semente, vindo do .env.'
            : ` — definido na tela${estado?.atualizadoPor ? ` por ${estado.atualizadoPor}` : ''}${estado?.atualizadoEm ? ` em ${labelDataHora(estado.atualizadoEm)}` : ''}.`}
        </li>
        <li>
          <code>DATA_SINCE</code>, <code>PHONE_SINCE</code> e <code>CRM_SINCE</code> no
          <code>.env</code> continuam valendo como ponto de partida: valem enquanto ninguém definir
          nada aqui, e o botão acima volta a eles.
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
        histórico é <code>{dados?.since}</code> (telefonia a partir de{' '}
        <code>{dados?.phoneSince}</code>, CRM a partir de <code>{dados?.crmSince}</code>).
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

// ------------------------------------------------------- metas por cidade
/**
 * Metas de venda e de ativação por cidade — o alvo do RELATÓRIO DIÁRIO.
 *
 * No Power BI elas são constantes dentro de medidas DAX, e mudar uma exigia abrir o
 * arquivo e republicar. Meta muda todo ano, e às vezes no meio do ano.
 *
 * Rascunho com Salvar, e não gravação a cada tecla: são doze campos, e gravar em
 * cada um seria doze requisições sem confirmação nenhuma. Nada aqui recarrega o
 * banco — meta é cálculo sobre o que já está em memória, então a próxima abertura da
 * tela já usa o valor novo.
 */
function AbaMetas() {
  const [estado, setEstado] = useState(null);
  const [erro, setErro] = useState(null);
  const [salvando, setSalvando] = useState(false);
  const [form, setForm] = useState(null);

  const carregar = useCallback(async () => {
    try {
      const d = await apiJson('/metas');
      setEstado(d);
      setForm({
        vendas: { ...d.vendas },
        ativos: { ...d.ativos },
        vendasRadio: d.vendasRadio,
        ativosRadio: d.ativosRadio,
      });
      setErro(null);
    } catch (e) { setErro(e); }
  }, []);
  useEffect(() => { carregar(); }, [carregar]);

  const salvar = async () => {
    setSalvando(true);
    setErro(null);
    try {
      const d = await apiJson('/metas', { method: 'PUT', body: form });
      setEstado(d);
      setForm({
        vendas: { ...d.vendas },
        ativos: { ...d.ativos },
        vendasRadio: d.vendasRadio,
        ativosRadio: d.ativosRadio,
      });
    } catch (e) { setErro(e); } finally { setSalvando(false); }
  };

  const restaurar = async () => {
    setSalvando(true);
    setErro(null);
    try {
      const d = await apiJson('/metas/restaurar', { method: 'POST' });
      setEstado(d);
      setForm({
        vendas: { ...d.vendas },
        ativos: { ...d.ativos },
        vendasRadio: d.vendasRadio,
        ativosRadio: d.ativosRadio,
      });
    } catch (e) { setErro(e); } finally { setSalvando(false); }
  };

  if (!form) return <div className="cfg-carregando">Carregando as metas…</div>;

  const cidades = [...new Set([
    ...Object.keys(form.vendas), ...Object.keys(form.ativos),
  ])].sort((a, b) => a.localeCompare(b, 'pt-BR'));

  const alterado = estado && (
    JSON.stringify(form.vendas) !== JSON.stringify(estado.vendas)
    || JSON.stringify(form.ativos) !== JSON.stringify(estado.ativos)
    || Number(form.vendasRadio) !== Number(estado.vendasRadio)
    || Number(form.ativosRadio) !== Number(estado.ativosRadio)
  );

  const trocar = (grupo, cidade, valor) => setForm((f) => ({
    ...f, [grupo]: { ...f[grupo], [cidade]: valor === '' ? '' : Number(valor) },
  }));

  const alt = estado?.alternativo;

  return (
    <div className="cfg-bloco">
      <p className="cfg-nota">
        O alvo contra o qual o <b>Relatório diário</b> compara. A meta por dia é a meta dividida
        pelos dias produtivos do mês (sábado vale meio dia, domingo e feriado zero), então mexer
        nos <b>Feriados</b> também muda a meta por dia.
      </p>
      <p className="cfg-nota">
        <b>O relatório de origem tem duas séries conflitantes para ativação.</b> As tabelas de lá
        usam a que está semeada aqui; a outra, mais alta, está no rodapé desta tela para
        conferência. Se a série alta for a correta, é aqui que se corrige.
      </p>

      {erro && <div className="banner error">{erro.message}</div>}

      <table className="pbi cfg-metas">
        <thead>
          <tr>
            <th className="left">CIDADE</th>
            <th>META DE VENDAS</th>
            <th>META DE ATIVAÇÕES</th>
          </tr>
        </thead>
        <tbody>
          {cidades.map((cidade) => (
            <tr key={cidade}>
              <td className="left">{cidade}</td>
              <td>
                <input
                  type="number"
                  min="0"
                  value={form.vendas[cidade] ?? ''}
                  onChange={(e) => trocar('vendas', cidade, e.target.value)}
                />
              </td>
              <td>
                <input
                  type="number"
                  min="0"
                  value={form.ativos[cidade] ?? ''}
                  onChange={(e) => trocar('ativos', cidade, e.target.value)}
                />
              </td>
            </tr>
          ))}
          <tr className="cfg-radio">
            <td className="left">
              Rádio <span title="Na origem a meta de rádio não é por cidade: é um número único para o total.">(total)</span>
            </td>
            <td>
              <input
                type="number"
                min="0"
                value={form.vendasRadio ?? ''}
                onChange={(e) => setForm((f) => ({ ...f, vendasRadio: e.target.value === '' ? '' : Number(e.target.value) }))}
              />
            </td>
            <td>
              <input
                type="number"
                min="0"
                value={form.ativosRadio ?? ''}
                onChange={(e) => setForm((f) => ({ ...f, ativosRadio: e.target.value === '' ? '' : Number(e.target.value) }))}
              />
            </td>
          </tr>
        </tbody>
      </table>

      <div className="janela-acoes">
        <button type="button" className="cfg-botao" disabled={!alterado || salvando} onClick={salvar}>
          {salvando ? 'Salvando…' : 'Salvar metas'}
        </button>
        <button type="button" className="cfg-botao ghost" disabled={salvando} onClick={restaurar}>
          Voltar às metas do relatório
        </button>
      </div>

      <ul className="cfg-legenda">
        <li>
          Em vigor: <b>{estado?.origem === 'tela' ? 'definidas nesta tela' : 'as do relatório de origem'}</b>
          {estado?.atualizadoPor ? ` por ${estado.atualizadoPor}` : ''}
          {estado?.atualizadoEm ? ` em ${labelDataHora(estado.atualizadoEm)}` : ''}.
        </li>
        {alt && (
          <li>
            Série alternativa de ativação, presente no modelo de origem e <b>não usada</b> pelas
            tabelas dele: {Object.entries(alt.ativos).map(([c, v]) => `${c} ${v}`).join(' · ')}.
          </li>
        )}
        <li>
          Cidade sem meta aparece na tabela do relatório com alvo em branco, e não escondida —
          esconder faria a venda daquela cidade desaparecer do total.
        </li>
      </ul>
    </div>
  );
}

// ------------------------------------------------------------------ feriados
/**
 * Feriados — o que decide dia útil e dia produtivo.
 *
 * Os nacionais e o estadual do RS são CALCULADOS, inclusive os móveis (Carnaval,
 * Sexta-feira Santa e Corpus Christi derivam da Páscoa), então nunca precisam de
 * manutenção. Esta tela existe para os MUNICIPAIS, que mudam por cidade, e para
 * remover um calculado que a empresa trate como dia normal.
 *
 * No relatório de origem esta lista vinha de uma planilha do Google.
 */
function AbaFeriados() {
  const [estado, setEstado] = useState(null);
  const [erro, setErro] = useState(null);
  const [salvando, setSalvando] = useState(false);
  const [extras, setExtras] = useState([]);
  const [removidos, setRemovidos] = useState([]);
  const [novo, setNovo] = useState({ data: '', nome: '' });

  const carregar = useCallback(async () => {
    try {
      const d = await apiJson('/feriados');
      setEstado(d);
      setExtras(d.extras || []);
      setRemovidos(d.removidos || []);
      setErro(null);
    } catch (e) { setErro(e); }
  }, []);
  useEffect(() => { carregar(); }, [carregar]);

  const salvar = async () => {
    setSalvando(true);
    setErro(null);
    try {
      const d = await apiJson('/feriados', { method: 'PUT', body: { extras, removidos } });
      setEstado(d);
      setExtras(d.extras || []);
      setRemovidos(d.removidos || []);
      setNovo({ data: '', nome: '' });
    } catch (e) { setErro(e); } finally { setSalvando(false); }
  };

  const restaurar = async () => {
    setSalvando(true);
    setErro(null);
    try {
      const d = await apiJson('/feriados/restaurar', { method: 'POST' });
      setEstado(d);
      setExtras(d.extras || []);
      setRemovidos(d.removidos || []);
    } catch (e) { setErro(e); } finally { setSalvando(false); }
  };

  if (!estado) return <div className="cfg-carregando">Carregando os feriados…</div>;

  const alterado = JSON.stringify(extras) !== JSON.stringify(estado.extras || [])
    || JSON.stringify(removidos) !== JSON.stringify(estado.removidos || []);

  const acrescentar = () => {
    if (!novo.data || !novo.nome.trim()) return;
    setExtras((e) => [...e, { data: novo.data, nome: novo.nome.trim() }]
      .sort((a, b) => a.data.localeCompare(b.data)));
    setNovo({ data: '', nome: '' });
  };

  const alternarRemocao = (data) => setRemovidos((r) => (
    r.includes(data) ? r.filter((x) => x !== data) : [...r, data]));

  return (
    <div className="cfg-bloco">
      <p className="cfg-nota">
        Feriado é dia produtivo a menos, que é meta por dia maior, que é projeção diferente. Uma
        data errada aqui move todos os números do <b>Relatório diário</b>.
      </p>
      <p className="cfg-nota">
        Os <b>nacionais e o estadual do RS são calculados</b>, os móveis inclusive — não precisam
        de cadastro em nenhum ano. Os <b>municipais não são semeados de propósito</b>: aniversário
        de cidade muda por município, e chutar uma data seria pior que não ter, porque o número
        sairia errado com cara de certo.
      </p>

      {erro && <div className="banner error">{erro.message}</div>}

      <div className="cfg-form linha">
        <label>
          <span>Data</span>
          <input type="date" value={novo.data} onChange={(e) => setNovo({ ...novo, data: e.target.value })} />
        </label>
        <label className="cresce">
          <span>Nome do feriado</span>
          <input
            type="text"
            value={novo.nome}
            placeholder="Aniversário de Canoas, por exemplo"
            onChange={(e) => setNovo({ ...novo, nome: e.target.value })}
          />
        </label>
        <button type="button" className="cfg-botao ghost" onClick={acrescentar} disabled={!novo.data || !novo.nome.trim()}>
          <Icone nome="mais" tamanho={13} /> Acrescentar
        </button>
      </div>

      <table className="pbi cfg-feriados">
        <thead>
          <tr>
            <th className="left">DATA</th>
            <th className="left">FERIADO</th>
            <th>ORIGEM</th>
            <th>VALE</th>
          </tr>
        </thead>
        <tbody>
          {(estado.doAno || []).map((f) => {
            const fora = removidos.includes(f.data);
            return (
              <tr key={f.data} className={fora ? 'desligado' : ''}>
                <td className="left">{labelData(f.data)}</td>
                <td className="left">{f.nome}</td>
                <td className="center">{f.origem === 'calculado' ? 'calculado' : 'cadastrado'}</td>
                <td className="center">
                  <button
                    type="button"
                    className="cfg-alternar"
                    onClick={() => alternarRemocao(f.data)}
                    title={fora
                      ? 'Hoje este dia conta como dia normal. Clique para voltar a tratá-lo como feriado.'
                      : 'Clique para tratar este dia como dia normal de trabalho.'}
                  >
                    {fora ? 'dia normal' : 'feriado'}
                  </button>
                </td>
              </tr>
            );
          })}
          {extras.filter((f) => !(estado.doAno || []).some((x) => x.data === f.data)).map((f) => (
            <tr key={f.data}>
              <td className="left">{labelData(f.data)}</td>
              <td className="left">{f.nome}</td>
              <td className="center">cadastrado (outro ano)</td>
              <td className="center">
                <button
                  type="button"
                  className="cfg-alternar"
                  onClick={() => setExtras((e) => e.filter((x) => x.data !== f.data))}
                  title="Apagar este feriado do cadastro."
                >
                  apagar
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="janela-acoes">
        <button type="button" className="cfg-botao" disabled={!alterado || salvando} onClick={salvar}>
          {salvando ? 'Salvando…' : 'Salvar feriados'}
        </button>
        <button type="button" className="cfg-botao ghost" disabled={salvando} onClick={restaurar}>
          Apagar o cadastro
        </button>
      </div>

      <ul className="cfg-legenda">
        <li>
          A tabela mostra o <b>ano corrente</b>. Um feriado cadastrado para outro ano aparece na
          lista de baixo e continua valendo.
        </li>
        <li>
          {extras.length} cadastrado(s) · {removidos.length} calculado(s) tratado(s) como dia normal
          {estado.atualizadoPor ? ` · última alteração por ${estado.atualizadoPor}` : ''}
          {estado.atualizadoEm ? ` em ${labelDataHora(estado.atualizadoEm)}` : ''}.
        </li>
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
      { id: 'metas', label: 'Metas por cidade', icone: 'ok' },
      { id: 'feriados', label: 'Feriados', icone: 'relogio' },
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
        {aba === 'metas' && <AbaMetas />}
        {aba === 'feriados' && <AbaFeriados />}
        {aba === 'ia' && <AbaIA />}
        {aba === 'queries' && <AbaQueries />}
      </Visual>
    </main>
  );
}
