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

/**
 * Baixa um arquivo já montado. É o degrau de baixo: quem exporta uma tabela usa
 * `baixarCSV`, que cuida do nome.
 *
 * A GUARDA não é paranoia, é um bug que aconteceu. A ordem `(nome, conteudo)` é
 * invisível na chamada, e a tela de Relatórios Comercial inteira foi escrita com os
 * dois trocados: o arquivo saía sem extensão, batizado com a linha de cabeçalho do
 * CSV ("CONTRATO;TIPO;VALOR DO PLANO;..."), e o conteúdo era o nome que deveria
 * estar na capa. O Windows nem sabia com o que abrir.
 *
 * Nada disso dá erro por si: `Blob` aceita qualquer string e `a.download` aceita
 * qualquer nome. Só quem olha a pasta de downloads descobre — foi assim que o
 * problema apareceu, semanas depois. O conteúdo sempre começa com o BOM e quase
 * sempre tem quebra de linha; nome de arquivo nunca tem nenhum dos dois, então o
 * teste é exato e o erro estoura no clique, e não na pasta de downloads.
 */
export function baixar(nomeArquivo, conteudo, tipo = 'text/csv;charset=utf-8') {
  if (typeof nomeArquivo === 'string' && (nomeArquivo.startsWith(BOM) || /[\r\n]/.test(nomeArquivo))) {
    throw new Error(
      'baixar(nome, conteudo): os argumentos vieram trocados — o nome do arquivo '
      + 'recebeu o conteúdo do CSV. Use baixarCSV(base, conteudo, periodo).',
    );
  }
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

/**
 * Sufixo do arquivo com o período filtrado, para não sobrescrever downloads.
 *
 * `campos` existe porque cada tela tem o SEU par de datas: condomínios recorta pela
 * criação do splitter (`criadoDe`), leads pelo cadastro do lead (`leadDe`), e assim
 * por diante. Com o par fixo em `de`/`ate`, o arquivo de condomínios saía carimbado
 * com o período comercial — uma data que não recortou nada do que está dentro dele.
 */
export function sufixoPeriodo(filtros, campos = ['de', 'ate']) {
  const p = campos.map((c) => filtros?.[c]).filter(Boolean).join('_a_');
  return p || 'completo';
}

/**
 * Nome de arquivo previsível: sem acento, sem espaço, sem maiúscula.
 *
 * A base vem escrita à mão em cada tela e já chegou com acento e com espaço. Windows
 * e Excel aceitam, mas o arquivo vira outro nome ao ser anexado num e-mail ou subir
 * num compartilhamento, e deixa de casar com os outros da mesma pasta.
 */
function nomeLimpo(base) {
  return String(base ?? '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\.csv$/, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'exportacao';
}

/**
 * A ÚNICA porta de saída de CSV das telas — e é ela que dá a forma do nome:
 *
 *     <base>_<periodo>.csv        ex.: vendas-por-vendedor_2026-01-01_a_2026-09-16.csv
 *
 * É a mesma forma que o servidor usa nos conjuntos completos (ver a rota
 * `/exportar/:id`), então os dois caminhos de download produzem arquivos que se
 * arquivam juntos em vez de dois padrões convivendo na mesma pasta.
 *
 * `base` vai SEM extensão e SEM período: quem chama diz o que é o arquivo, não como
 * ele se chama. Era daí que vinha a bagunça — cada tela montava o nome inteiro à mão,
 * e metade esquecia o período.
 */
export function baixarCSV(base, conteudo, periodo = 'completo') {
  baixar(`${nomeLimpo(base)}_${periodo}.csv`, conteudo);
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
