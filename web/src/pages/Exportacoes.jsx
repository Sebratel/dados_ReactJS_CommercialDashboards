import { useState } from 'react';
import { apiGet, useDados } from '../api';
import { useFilters } from '../filters';
import { SlicerBar } from '../components/SlicerBar';
import { Erro, Loading, Visual } from '../components/ui';
import { Icone } from '../components/Icone';
import { int, labelData } from '../format';
import { baixarDoServidor } from '../exportar';

/** Amostra: as primeiras linhas do arquivo, exatamente como vão sair. */
function Amostra({ id, filtros }) {
  const { data, error, isLoading } = useDados(`/exportar/${id}/amostra`, filtros, { refetchInterval: false });

  if (isLoading && !data) return <div className="amostra-vazia">Carregando amostra…</div>;
  if (error) return <div className="amostra-vazia">Não foi possível carregar a amostra.</div>;
  if (!data?.linhas?.length) return <div className="amostra-vazia">Nenhum registro para os filtros atuais.</div>;

  return (
    <div className="amostra">
      <div className="tbl-wrap">
        <table className="pbi amostra-tabela">
          <thead>
            <tr>{data.colunas.map((c) => <th key={c} className="left">{c}</th>)}</tr>
          </thead>
          <tbody>
            {data.linhas.map((linha, i) => (
              <tr key={i}>
                {linha.map((valor, j) => (
                  <td key={j} className="left" title={valor}>{valor === '' ? '—' : valor}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="amostra-rodape">
        Mostrando as <b>{data.exibindo}</b> primeiras de <b>{int(data.total)}</b> linhas ·
        {' '}{data.colunas.length} colunas. O arquivo vem com todas.
      </p>
    </div>
  );
}

export default function Exportacoes() {
  const { filtros } = useFilters();
  const { data, error, isLoading } = useDados('/exportacoes', filtros, { refetchInterval: false });
  const [ocupado, setOcupado] = useState(null);
  const [aviso, setAviso] = useState({});
  const [aberto, setAberto] = useState(null);
  const [erro, setErro] = useState(null);

  const periodo = filtros.de && filtros.ate
    ? `${labelData(filtros.de)} a ${labelData(filtros.ate)}`
    : 'todo o período disponível';

  const baixar = (c) => {
    setOcupado(c.id);
    setErro(null);
    baixarDoServidor(c.id, filtros, {
      aoTerminar: (msg) => {
        setAviso((a) => ({ ...a, [c.id]: msg }));
        setOcupado(null);
        setTimeout(() => setAviso((a) => ({ ...a, [c.id]: null })), 4000);
      },
      aoFalhar: (e) => { setErro(e); setOcupado(null); },
    });
  };

  return (
    <main className="page">
      <SlicerBar />
      {error && <Erro erro={error} />}
      {erro && <Erro erro={erro} />}

      <Visual
        title="Exportações"
        sub={`Os arquivos saem com os filtros aplicados acima · ${periodo}`}
        className="v-auto"
      >
        <p className="cfg-nota" style={{ marginBottom: 12 }}>
          Arquivos <b>CSV</b> com separador ponto e vírgula, prontos para abrir no Excel
          (basta dar duplo clique). Diferente das telas, aqui vem o conjunto <b>completo</b> —
          sem o corte que as tabelas aplicam para não travar o navegador. Use
          {' '}<b>ver amostra</b> para conferir as colunas antes de baixar.
        </p>

        {isLoading && !data ? <Loading texto="Carregando conjuntos…" /> : (
          <div className="export-lista">
            {(data?.conjuntos || []).map((c) => {
              const vazio = c.linhas === 0;
              return (
                <article className={`export-item${aberto === c.id ? ' aberto' : ''}`} key={c.id}>
                  <div className="export-topo">
                    <div className="export-icone"><Icone nome="planilha" tamanho={17} /></div>

                    <div className="export-texto">
                      <b>{c.titulo}</b>
                      <span>{c.descricao}</span>
                      <div className="export-medidas">
                        <span className={vazio ? 'zero' : ''}>
                          {c.linhas === null ? '—' : `${int(c.linhas)} ${c.linhas === 1 ? 'linha' : 'linhas'}`}
                        </span>
                        <span>{c.colunas} colunas</span>
                        <button
                          type="button"
                          className="export-ver"
                          onClick={() => setAberto(aberto === c.id ? null : c.id)}
                        >
                          <Icone nome={aberto === c.id ? 'cima' : 'baixo'} tamanho={11} />
                          {aberto === c.id ? 'ocultar amostra' : 'ver amostra'}
                        </button>
                      </div>
                    </div>

                    {aviso[c.id] && (
                      <span className="export-ok"><Icone nome="ok" tamanho={12} /> {aviso[c.id]}</span>
                    )}

                    <button
                      type="button"
                      className="cfg-botao"
                      disabled={ocupado === c.id || vazio}
                      title={vazio ? 'Nenhum registro para os filtros atuais' : 'Baixar o arquivo completo'}
                      onClick={() => baixar(c)}
                    >
                      <Icone nome="baixar" tamanho={13} />
                      {ocupado === c.id ? 'gerando…' : 'Baixar CSV'}
                    </button>
                  </div>

                  {aberto === c.id && <Amostra id={c.id} filtros={filtros} />}
                </article>
              );
            })}
            {data && !data.conjuntos.length && (
              <p className="cfg-nota">Você não tem acesso a nenhum conjunto de dados.</p>
            )}
          </div>
        )}
      </Visual>
    </main>
  );
}
