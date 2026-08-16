/**
 * Exportação do que está na tela, em CSV que abre direto no Excel em português:
 * separador ";", BOM UTF-8 (senão os acentos quebram), decimal com vírgula.
 */
const BOM = '﻿';

function celula(valor) {
  const s = valor === null || valor === undefined ? '' : String(valor);
  return /[";\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Converte o valor bruto no texto que vai para a planilha. */
function textoDaCelula(coluna, linha) {
  const bruto = linha[coluna.key];
  if (coluna.tipo === 'spark') {
    return (bruto || []).map((p) => `${p.k}=${p.v}`).join(' ');
  }
  if (typeof bruto === 'number') {
    // número vai cru (com vírgula decimal) para a planilha poder somar
    return Number.isInteger(bruto) ? String(bruto) : bruto.toFixed(2).replace('.', ',');
  }
  if (coluna.fmt) {
    const formatado = coluna.fmt(bruto, linha);
    return typeof formatado === 'string' ? formatado : bruto ?? '';
  }
  return bruto ?? '';
}

export function tabelaParaCSV(colunas, linhas) {
  const cols = colunas.filter((c) => c.titulo);
  const cabecalho = cols.map((c) => celula(c.titulo)).join(';');
  const corpo = linhas.map((l) => cols.map((c) => celula(textoDaCelula(c, l))).join(';'));
  return BOM + [cabecalho, ...corpo].join('\r\n') + '\r\n';
}

/** Matriz (vendedor x dia) das telas de histórico. */
export function matrizParaCSV({ colunas, linhas, totalPorDia, total }, rotulo) {
  const cab = ['VENDEDOR', ...colunas.map(rotulo), 'TOTAL'].map(celula).join(';');
  const corpo = linhas.map((l) => [
    celula(l.vendedor),
    ...colunas.map((c) => l.dias[c] || 0),
    l.total,
  ].join(';'));
  const rodape = ['TOTAL', ...colunas.map((c) => totalPorDia[c] || 0), total].join(';');
  return BOM + [cab, ...corpo, rodape].join('\r\n') + '\r\n';
}

export function baixar(nomeArquivo, conteudo, tipo = 'text/csv;charset=utf-8') {
  const blob = conteudo instanceof Blob ? conteudo : new Blob([conteudo], { type: tipo });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = nomeArquivo;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Sufixo do arquivo com o período filtrado, para não sobrescrever downloads. */
export function sufixoPeriodo(filtros) {
  const p = [filtros?.de, filtros?.ate].filter(Boolean).join('_a_');
  return p || 'completo';
}

/**
 * Baixa um CSV gerado pelo servidor (conjunto completo). Precisa passar pelo
 * fetch para levar o Bearer — navegação direta por href não manda o header.
 */
export async function baixarDoServidor(id, filtros, { aoTerminar, aoFalhar } = {}) {
  const { apiFetch, buildQuery } = await import('./api.js');
  const qs = buildQuery(filtros);
  try {
    // apiFetch em vez de fetch direto: renova o token em 401 e, se não der,
    // encerra a sessão — senão a exportação falhava sozinha logo após expirar
    const res = await apiFetch(`/api/exportar/${id}?${qs}`);
    if (!res.ok) {
      const corpo = await res.json().catch(() => ({}));
      throw new Error(corpo.error || `Erro ${res.status} ao gerar o arquivo.`);
    }
    const nome = (res.headers.get('Content-Disposition') || '').match(/filename="(.+)"/)?.[1] || `${id}.csv`;
    const linhas = res.headers.get('X-Linhas');
    baixar(nome, await res.blob());
    aoTerminar?.(linhas ? `${Number(linhas).toLocaleString('pt-BR')} linhas baixadas` : 'arquivo baixado');
  } catch (e) {
    if (aoFalhar) aoFalhar(e);
    else throw e;
  }
}
