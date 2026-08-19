import { useEffect, useMemo, useRef, useState } from 'react';
import { useFiltros } from '../api';
import { PRESETS, useFilters } from '../filters';
import { useSession } from '../auth/session.jsx';
import { labelData } from '../format';
import { Icone } from './Icone';

const TITULOS = {
  vendedor: 'Vendedor',
  tecnologia: 'Tecnologia',
  equipe: 'Equipe',
  situacao: 'Canal',
  cidade: 'Cidade',
  canal: 'Canal Voalle',
};

/** Fecha o popover ao clicar fora ou apertar Esc. */
function usarFechamento(aberto, fechar) {
  const ref = useRef(null);
  useEffect(() => {
    if (!aberto) return undefined;
    const fora = (e) => { if (ref.current && !ref.current.contains(e.target)) fechar(); };
    const esc = (e) => { if (e.key === 'Escape') fechar(); };
    document.addEventListener('mousedown', fora);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('mousedown', fora);
      document.removeEventListener('keydown', esc);
    };
  }, [aberto, fechar]);
  return ref;
}

function FiltroLista({ campo, opcoes = [], valor = [], onChange, alinhar }) {
  const [aberto, setAberto] = useState(false);
  const [busca, setBusca] = useState('');
  const ref = usarFechamento(aberto, () => setAberto(false));

  const filtradas = useMemo(() => {
    const b = busca.trim().toLowerCase();
    return (b ? opcoes.filter((o) => String(o).toLowerCase().includes(b)) : opcoes).slice(0, 400);
  }, [opcoes, busca]);

  const alterna = (op) => onChange(valor.includes(op) ? valor.filter((v) => v !== op) : [...valor, op]);
  const resumo = valor.length === 1 ? valor[0] : valor.length ? `${valor.length} selecionados` : 'todos';

  return (
    <div className={`filtro${valor.length ? ' ativo' : ''}`} ref={ref}>
      <button type="button" onClick={() => setAberto((a) => !a)} title={valor.join(', ') || 'todos'}>
        <span className="nome">{TITULOS[campo]}</span>
        <span className="valor">{resumo}</span>
        {valor.length > 1 && <span className="contador">{valor.length}</span>}
        <Icone nome="baixo" tamanho={12} className="seta" />
      </button>

      {aberto && (
        <div className={`pop${alinhar === 'direita' ? ' direita' : ''}`}>
          <input
            className="busca-interna"
            autoFocus
            placeholder="Buscar…"
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
          />
          <div className="lista">
            {filtradas.map((op) => (
              <label key={op}>
                <input type="checkbox" checked={valor.includes(op)} onChange={() => alterna(op)} />
                <span>{op}</span>
              </label>
            ))}
            {!filtradas.length && <div style={{ padding: 8, fontSize: 12, color: '#605E5C' }}>Nada encontrado</div>}
          </div>
          <div className="acoes">
            <button type="button" onClick={() => onChange([])}>Limpar</button>
            <span>{opcoes.length} opções</span>
          </div>
        </div>
      )}
    </div>
  );
}

function FiltroPeriodo({ de, ate, presetAtivo, onChange, rotulo }) {
  const [aberto, setAberto] = useState(false);
  const ref = usarFechamento(aberto, () => setAberto(false));
  const preset = PRESETS.find((p) => p.id === presetAtivo);
  const resumo = preset
    ? preset.label
    : de && ate ? `${labelData(de)} – ${labelData(ate)}` : 'todo o período';

  return (
    <div className="filtro ativo" ref={ref}>
      <button type="button" onClick={() => setAberto((a) => !a)} title={rotulo}>
        <span className="nome">{rotulo}</span>
        <span className="valor">{resumo}</span>
        <Icone nome="baixo" tamanho={12} className="seta" />
      </button>

      {aberto && (
        <div className="pop pop-periodo">
          <div className="datas">
            <input type="date" value={de || ''} onChange={(e) => onChange({ de: e.target.value })} />
            <span>até</span>
            <input type="date" value={ate || ''} onChange={(e) => onChange({ ate: e.target.value })} />
          </div>
          <div className="presets">
            {PRESETS.map((p) => (
              <button
                key={p.id}
                type="button"
                className={presetAtivo === p.id ? 'on' : ''}
                onClick={() => { onChange(p.calc()); setAberto(false); }}
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Barra de filtros: uma linha só, fixa abaixo da navegação. Substitui os
 * seis cartões de slicer que ocupavam 125px de altura.
 */
export function SlicerBar({
  campos = ['cliente', 'periodo', 'vendedor', 'tecnologia', 'equipe', 'situacao'],
  rotuloPeriodo = 'Período',
}) {
  const { filtros, setFiltro, presetAtivo, ativos, limpar } = useFilters();
  const { data: dims } = useFiltros();
  const { escopo } = useSession();
  const [cliente, setCliente] = useState(filtros.cliente || '');

  useEffect(() => setCliente(filtros.cliente || ''), [filtros.cliente]);
  useEffect(() => {
    const t = setTimeout(() => {
      if (cliente !== (filtros.cliente || '')) setFiltro({ cliente });
    }, 400);
    return () => clearTimeout(t);
  }, [cliente]); // eslint-disable-line react-hooks/exhaustive-deps

  const opcoes = {
    vendedor: dims?.vendedores || [],
    equipe: dims?.equipes || [],
    tecnologia: dims?.tecnologias || [],
    situacao: dims?.situacoes || [],
    cidade: dims?.cidades || [],
    canal: dims?.canais || [],
  };

  const listas = campos.filter((c) => c !== 'cliente' && c !== 'periodo');

  return (
    <div className="filtros">
      <span className="rotulo">Filtros</span>

      {/* recorte invisível faz a pessoa concluir que o número está errado */}
      {!!escopo?.length && (
        <span
          className="escopo-aviso"
          title={`Você enxerga apenas: ${escopo.join(', ')}. Os totais desta tela já vêm recortados.`}
        >
          <Icone nome="cadeado" tamanho={11} />
          {escopo.length === 1 ? escopo[0] : `${escopo.length} equipes`}
        </span>
      )}

      {campos.includes('periodo') && (
        <FiltroPeriodo
          de={filtros.de}
          ate={filtros.ate}
          presetAtivo={presetAtivo}
          onChange={setFiltro}
          rotulo={rotuloPeriodo}
        />
      )}

      {listas.map((campo, i) => (
        <FiltroLista
          key={campo}
          campo={campo}
          opcoes={opcoes[campo]}
          valor={filtros[campo]}
          onChange={(v) => setFiltro({ [campo]: v })}
          alinhar={i >= listas.length - 2 ? 'direita' : undefined}
        />
      ))}

      {campos.includes('cliente') && (
        <label className="busca">
          <Icone nome="busca" tamanho={13} />
          <input
            type="text"
            value={cliente}
            placeholder="Buscar cliente…"
            onChange={(e) => setCliente(e.target.value)}
          />
        </label>
      )}

      {ativos > 0 && (
        <button type="button" className="limpar" onClick={limpar}>
          <Icone nome="fechar" tamanho={12} /> limpar {ativos} filtro{ativos > 1 ? 's' : ''}
        </button>
      )}
    </div>
  );
}
