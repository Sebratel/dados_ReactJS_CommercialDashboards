import { useState } from 'react';
import { useDados } from '../api';
import { useFilters } from '../filters';
import { SlicerBar } from '../components/SlicerBar';
import { Erro, Loading, Visual } from '../components/ui';
import { Icone } from '../components/Icone';
import { labelData } from '../format';
import { baixarDoServidor } from '../exportar';

export default function Exportacoes() {
  const { filtros } = useFilters();
  const { data, error, isLoading } = useDados('/exportacoes', filtros, { refetchInterval: false });
  const [ocupado, setOcupado] = useState(null);
  const [aviso, setAviso] = useState({});
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
          sem o corte que as tabelas aplicam para não travar o navegador.
        </p>

        {isLoading && !data ? <Loading texto="Carregando conjuntos…" /> : (
          <div className="export-lista">
            {(data?.conjuntos || []).map((c) => (
              <article className="export-item" key={c.id}>
                <div className="export-icone"><Icone nome="planilha" tamanho={17} /></div>
                <div className="export-texto">
                  <b>{c.titulo}</b>
                  <span>{c.descricao}</span>
                </div>
                {aviso[c.id] && (
                  <span className="export-ok"><Icone nome="ok" tamanho={12} /> {aviso[c.id]}</span>
                )}
                <button
                  type="button"
                  className="cfg-botao"
                  disabled={ocupado === c.id}
                  onClick={() => baixar(c)}
                >
                  <Icone nome="baixar" tamanho={13} />
                  {ocupado === c.id ? 'gerando…' : 'Baixar CSV'}
                </button>
              </article>
            ))}
            {data && !data.conjuntos.length && (
              <p className="cfg-nota">Você não tem acesso a nenhum conjunto de dados.</p>
            )}
          </div>
        )}
      </Visual>
    </main>
  );
}
