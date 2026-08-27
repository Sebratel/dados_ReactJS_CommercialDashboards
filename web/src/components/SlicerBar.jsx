import { useEffect, useMemo, useRef, useState } from 'react';
import { useFiltros, useMeta } from '../api';
import { LISTAS, PRESETS, ROTULOS, useFilters } from '../filters';
import { useSession } from '../auth/session.jsx';
import { labelData, labelPeriodoLongo } from '../format';
import { Icone } from './Icone';

const TITULOS = ROTULOS;

/**
 * Campos do modelo comercial que os chips da barra representam. `zoom` entra em todas
 * as telas porque o servidor o aplica no modelo inteiro: um recorte de período deixado
 * para trás mexe no número de qualquer tela comercial, e precisa aparecer em todas.
 */
const CAMPOS_COMERCIAL = [...LISTAS, 'cliente', 'zoom'];

/** O chip do período mostra 'agosto de 2026', não '2026-08'. */
const FORMATOS = { zoom: labelPeriodoLongo };

/** Fecha o popover ao clicar fora ou apertar Esc. */
export function usarFechamento(aberto, fechar) {
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

/**
 * Um seletor de lista com busca interna. `titulo` existe para as telas que não
 * estão no mapa `TITULOS` acima — a de condomínios tem sete campos que só ela usa,
 * e cadastrá-los num mapa global só para dar nome a eles espalharia o rótulo
 * longe de quem o mostra.
 */
export function FiltroLista({ campo, titulo, opcoes = [], valor = [], onChange, alinhar }) {
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
        <span className="nome">{titulo || TITULOS[campo]}</span>
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

/**
 * Seletor em PAINEL, ancorado ao lado do visual — não em popover.
 *
 * Existe porque a página CLIENTES BASE do relatório de origem tem um slicer de
 * 311×849 na lateral esquerda, ocupando a altura inteira das três matrizes, com
 * cidade e bairro juntos. Ali o filtro não é acessório da barra: é o eixo pelo qual
 * se lê a tela, e quem usa fica trocando de bairro e olhando a matriz ao lado. Num
 * popover isso custa dois cliques por troca e esconde o gráfico justamente na hora
 * de comparar.
 *
 * Cada grupo tem busca própria a partir de ~12 opções — abaixo disso a busca ocupa
 * mais espaço do que economiza.
 */
export function FiltroLateral({ titulo, grupos, onChange }) {
  const [buscas, setBuscas] = useState({});

  const total = grupos.reduce((a, g) => a + g.valor.length, 0);

  return (
    <aside className="painel-filtro">
      <header>
        <span>{titulo}</span>
        {total > 0 && (
          <button
            type="button"
            className="painel-limpar"
            onClick={() => onChange(Object.fromEntries(grupos.map((g) => [g.campo, []])))}
            title="Limpar as seleções deste painel"
          >
            <Icone nome="fechar" tamanho={11} /> {total}
          </button>
        )}
      </header>

      {grupos.map((g) => {
        const busca = (buscas[g.campo] || '').trim().toLowerCase();
        const casam = (busca
          ? g.opcoes.filter((o) => String(o).toLowerCase().includes(busca))
          : g.opcoes);
        // Teto de itens no DOM, como no seletor de popover. São 277 bairros hoje;
        // sem teto, uma dimensão que cresça enche a página de caixas de marcação
        // que ninguém vai rolar. O rodapé diz quantas ficaram de fora, para a lista
        // curta não ser confundida com lista completa.
        const visiveis = casam.slice(0, 300);
        const escondidas = casam.length - visiveis.length;
        const alterna = (op) => onChange({
          [g.campo]: g.valor.includes(op) ? g.valor.filter((v) => v !== op) : [...g.valor, op],
        });
        return (
          <section key={g.campo}>
            <h4>
              {g.titulo}
              {/* `nota` diz de onde a lista veio quando ela e derivada de outro
                  grupo — sem isso, uma lista que encurtou parece lista incompleta. */}
              <span title={g.nota || undefined}>
                {g.nota ? `${g.opcoes.length} ${g.nota}` : null}
                {!g.nota && (g.valor.length ? `${g.valor.length} de ${g.opcoes.length}` : g.opcoes.length)}
              </span>
            </h4>
            {g.opcoes.length > 12 && (
              <input
                type="text"
                placeholder={`Buscar ${g.titulo.toLowerCase()}…`}
                value={buscas[g.campo] || ''}
                onChange={(e) => setBuscas((b) => ({ ...b, [g.campo]: e.target.value }))}
              />
            )}
            <div className="painel-lista">
              {visiveis.map((op) => (
                <label key={op} title={op}>
                  <input
                    type="checkbox"
                    checked={g.valor.includes(op)}
                    onChange={() => alterna(op)}
                  />
                  <span>{op}</span>
                </label>
              ))}
              {!visiveis.length && <p className="painel-nada">Nada encontrado</p>}
              {escondidas > 0 && (
                <p className="painel-nada">
                  +{escondidas} não listadas — use a busca acima
                </p>
              )}
            </div>
          </section>
        );
      })}
    </aside>
  );
}

/**
 * Seletor de período. `min` é o começo da janela de dados (Configurações → Janela
 * de dados): o que existe carregado em memória, não o que existe no banco.
 *
 * Ele faz duas coisas. Nos campos de data, limita o calendário — pedir 2023 numa
 * tela cujo recorte começa em 2026 devolvia zero e parecia dado faltando. Nos
 * atalhos, encurta o começo em vez de deixar passar: "12 meses" com recorte de
 * janeiro vira janeiro–hoje. O atalho deixa de ficar aceso de propósito, e o
 * resumo passa a mostrar as datas reais — o filtro conta a verdade do que somou.
 */
export function FiltroPeriodo({ de, ate, presetAtivo, onChange, rotulo, presets = PRESETS, min }) {
  const [aberto, setAberto] = useState(false);
  const ref = usarFechamento(aberto, () => setAberto(false));
  const preset = presets.find((p) => p.id === presetAtivo);
  const aplicar = (r) => onChange(min && r.de && r.de < min ? { ...r, de: min } : r);
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
            <input
              type="date"
              value={de || ''}
              min={min || undefined}
              onChange={(e) => onChange({ de: e.target.value })}
            />
            <span>até</span>
            <input
              type="date"
              value={ate || ''}
              min={min || undefined}
              onChange={(e) => onChange({ ate: e.target.value })}
            />
          </div>
          <div className="presets">
            {presets.map((p) => (
              <button
                key={p.id}
                type="button"
                className={presetAtivo === p.id ? 'on' : ''}
                onClick={() => { aplicar(p.calc()); setAberto(false); }}
              >
                {p.label}
              </button>
            ))}
          </div>
          {min && <div className="pop-limite">Dados carregados a partir de {labelData(min)}</div>}
        </div>
      )}
    </div>
  );
}

/**
 * Chips do que está filtrando agora — um por VALOR, não por campo.
 *
 * Existe por causa do cross-filter. Clicar numa barra de cidade preenche um campo
 * que NÃO tem botão na barra (`cidade` não está entre os seis seletores da tela de
 * vendas): o contador dizia "limpar 1 filtro" e não havia nada na tela dizendo qual.
 * Filtro que soma mas não se mostra é o caminho mais curto para alguém apresentar
 * um número recortado achando que é o total.
 *
 * Cada chip remove o SEU valor, e não o campo inteiro — clicar em três cidades e
 * ter que desmarcar as três de uma vez é o mesmo problema com outro nome.
 *
 * `teto` limita o que vai ao DOM: com quinze cidades marcadas a linha viraria três,
 * e a conta de altura da tela (`--util`) só reserva uma. O que sobra vai no `+N`,
 * com a lista completa no `title`.
 */
export function ChipsAtivos({ campos, rotulos = ROTULOS, formatos = FORMATOS, teto = 12 }) {
  const { filtros, alternar, alternarUnico } = useFilters();

  const itens = useMemo(() => {
    const out = [];
    for (const campo of campos) {
      const valor = filtros[campo];
      const rotulo = rotulos[campo] || campo;
      if (Array.isArray(valor)) {
        for (const v of valor) out.push({ campo, valor: v, rotulo, tipo: 'lista', texto: v });
      } else if (valor) {
        const fmt = formatos[campo];
        out.push({ campo, valor, rotulo, tipo: 'unico', texto: fmt ? fmt(valor) : valor });
      }
    }
    return out;
  }, [campos, filtros, rotulos, formatos]);

  if (!itens.length) return null;

  const visiveis = itens.slice(0, teto);
  const escondidos = itens.slice(teto);
  // remover chip também empilha no histórico: é clique, e o voltar tem que desfazer
  const remover = (i) => (i.tipo === 'lista'
    ? alternar(i.campo, i.valor)
    : alternarUnico(i.campo, i.valor));

  return (
    <div className="chips">
      <span className="chips-rotulo">Filtrando por</span>
      {visiveis.map((i) => (
        <button
          key={`${i.campo}:${i.valor}`}
          type="button"
          className="chip"
          onClick={() => remover(i)}
          title={`Remover o filtro ${i.rotulo}: ${i.texto}`}
        >
          <span className="chip-campo">{i.rotulo}</span>
          <span className="chip-valor">{i.texto}</span>
          <Icone nome="fechar" tamanho={10} />
        </button>
      ))}
      {escondidos.length > 0 && (
        <span
          className="chip chip-resto"
          title={escondidos.map((i) => `${i.rotulo}: ${i.texto}`).join('\n')}
        >
          +{escondidos.length}
        </span>
      )}
    </div>
  );
}

/**
 * Barra de filtros: uma linha só, fixa abaixo da navegação. Substitui os
 * seis cartões de slicer que ocupavam 125px de altura.
 */
/**
 * `chipsExtra` são as dimensões de PÁGINA daquela tela (motivo, tipo, plano). Entram
 * nos chips e na contagem do botão de limpar, mas não ganham botão de seletor: elas só
 * existem como clique num visual.
 */
export function SlicerBar({
  campos = ['cliente', 'periodo', 'vendedor', 'tecnologia', 'equipe', 'situacao'],
  rotuloPeriodo = 'Período',
  chipsExtra = [],
}) {
  const { filtros, setFiltro, presetAtivo, contar, limpar } = useFilters();
  const { data: dims } = useFiltros();
  const { data: meta } = useMeta();
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
  /**
   * Os campos que esta barra representa. Conta daqui, e não do `ativos` do contexto,
   * para o número do botão bater com os chips ao lado: com o `ativos` global, um
   * motivo clicado virava chip mas não entrava na conta, e o botão prometia limpar
   * menos do que limpava.
   */
  const daBarra = [...CAMPOS_COMERCIAL, ...chipsExtra];
  const ativos = contar(daBarra);

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
          min={meta?.since}
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

      {/* Todos os campos do modelo comercial, não só os que têm botão aqui: o
          cross-filter preenche `cidade` e `canal`, que não estão entre os seis
          seletores desta barra. */}
      <ChipsAtivos campos={daBarra} />
    </div>
  );
}
