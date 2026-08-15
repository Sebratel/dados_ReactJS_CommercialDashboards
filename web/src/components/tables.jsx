import { useMemo, useState } from 'react';
import { CORES, Sparkline, corDoTexto, escalaGradiente } from './charts';
import { int, labelDia } from '../format';
import { Icone } from './Icone';

/**
 * Tabela no estilo do Power BI (tableEx): cabeçalho branco com linha dourada,
 * barras de dados opcionais, sparklines e linha de total fixa no rodapé.
 */
export function Tabela({ colunas, dados, totais = null, ordemInicial, alturaMax }) {
  const [ordem, setOrdem] = useState(ordemInicial || { key: colunas[1]?.key, dir: 'desc' });

  const maximos = useMemo(() => {
    const m = {};
    for (const c of colunas) {
      if (c.databar) m[c.key] = Math.max(...dados.map((d) => Math.abs(Number(d[c.key]) || 0)), 1);
    }
    return m;
  }, [colunas, dados]);

  const linhas = useMemo(() => {
    if (!ordem?.key) return dados;
    const col = colunas.find((c) => c.key === ordem.key);
    if (col?.tipo === 'spark') return dados;
    const arr = [...dados];
    arr.sort((a, b) => {
      const va = a[ordem.key];
      const vb = b[ordem.key];
      if (typeof va === 'number' || typeof vb === 'number') {
        return ordem.dir === 'asc' ? (va || 0) - (vb || 0) : (vb || 0) - (va || 0);
      }
      const cmp = String(va ?? '').localeCompare(String(vb ?? ''), 'pt-BR');
      return ordem.dir === 'asc' ? cmp : -cmp;
    });
    return arr;
  }, [dados, ordem, colunas]);

  const clique = (key) => {
    setOrdem((o) => (o.key === key ? { key, dir: o.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'desc' }));
  };

  return (
    <div className="tbl-wrap" style={alturaMax ? { maxHeight: alturaMax } : undefined}>
      <table className="pbi">
        <thead>
          <tr>
            {colunas.map((c) => (
              <th
                key={c.key}
                className={c.align === 'left' ? 'left' : ''}
                style={c.largura ? { width: c.largura } : undefined}
                onClick={() => clique(c.key)}
                title="Ordenar"
              >
                {c.titulo}
                {ordem.key === c.key && <Icone nome={ordem.dir === 'asc' ? 'cima' : 'baixo'} tamanho={11} className="ord" />}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {linhas.map((d, i) => (
            <tr key={d.__key || d.vendedor || d.cliente || i}>
              {colunas.map((c) => {
                if (c.tipo === 'spark') {
                  return (
                    <td key={c.key} className="center">
                      <Sparkline pontos={d[c.key] || []} cor={c.cor || CORES.gold} />
                    </td>
                  );
                }
                const bruto = d[c.key];
                const texto = c.fmt ? c.fmt(bruto, d) : bruto ?? '—';
                if (c.databar) {
                  const pct = Math.abs(Number(bruto) || 0) / maximos[c.key];
                  return (
                    <td key={c.key} className="right">
                      <span className="databar">
                        <i style={{ width: `${Math.max(pct * 100, 2)}%`, background: c.databar.cor || CORES.gold }} />
                        <span>{texto}</span>
                      </span>
                    </td>
                  );
                }
                // cor de fundo condicional (formatação por faixa do Power BI)
                let estilo = c.estilo ? c.estilo(bruto, d) : undefined;
                if (c.corFundo) {
                  const fundo = c.corFundo(d);
                  if (fundo) estilo = { ...estilo, background: fundo, color: corDoTexto(fundo) };
                }
                return (
                  <td
                    key={c.key}
                    className={`${c.align === 'left' ? 'left' : c.align === 'center' ? 'center' : 'right'}${c.bold ? ' bold' : ''}`}
                    title={typeof texto === 'string' ? texto : undefined}
                    style={estilo}
                  >
                    {texto}
                  </td>
                );
              })}
            </tr>
          ))}
          {!linhas.length && (
            <tr><td colSpan={colunas.length} style={{ textAlign: 'center', padding: 22, color: '#605E5C' }}>Sem dados</td></tr>
          )}
        </tbody>
        {totais && (
          <tfoot>
            <tr>
              {colunas.map((c, i) => (
                <td key={c.key} className={i === 0 ? 'left' : c.align === 'left' ? 'left' : 'right'}>
                  {i === 0 ? (totais.__label || 'Total') : (totais[c.key] !== undefined ? (c.fmt ? c.fmt(totais[c.key], totais) : totais[c.key]) : '')}
                </td>
              ))}
            </tr>
          </tfoot>
        )}
      </table>
    </div>
  );
}

/** Matriz vendedor x dia com mapa de calor (branco -> dourado), como no PBI. */
export function Matriz({ colunas, linhas, totalPorDia, total, rotuloColuna = labelDia }) {
  const max = useMemo(() => {
    let m = 1;
    for (const l of linhas) for (const c of colunas) m = Math.max(m, l.dias[c] || 0);
    return m;
  }, [linhas, colunas]);

  return (
    <div className="tbl-wrap">
      <table className="matrix">
        <thead>
          <tr>
            <th className="rowhead">VENDEDOR</th>
            {colunas.map((c) => <th key={c}>{rotuloColuna(c)}</th>)}
            <th className="total">TOTAL</th>
          </tr>
        </thead>
        <tbody>
          {linhas.map((l) => (
            <tr key={l.vendedor}>
              <td className="rowhead" title={l.vendedor}>{l.vendedor}</td>
              {colunas.map((c) => {
                const v = l.dias[c] || 0;
                return (
                  <td key={c} style={v ? { background: escalaGradiente(v, 0, max, '#FFFFFF', CORES.gold) } : undefined}>
                    {v || ''}
                  </td>
                );
              })}
              <td className="total">{int(l.total)}</td>
            </tr>
          ))}
          {!linhas.length && (
            <tr><td className="rowhead">—</td><td colSpan={colunas.length + 1} style={{ padding: 20, color: '#605E5C' }}>Sem dados</td></tr>
          )}
        </tbody>
        <tfoot>
          <tr>
            <td className="rowhead" style={{ background: '#FCF5DC' }}>TOTAL</td>
            {colunas.map((c) => <td key={c}>{int(totalPorDia[c] || 0)}</td>)}
            <td>{int(total)}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}
