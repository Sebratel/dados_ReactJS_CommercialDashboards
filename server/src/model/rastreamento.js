/**
 * RASTREAMENTO DE POSTS DO MATRIX — leitura do CSV exportado da tela.
 *
 * É a base de leads da tela de Campanhas desde out/2026. Antes, o lead de
 * anúncio era o atendimento com TAG de marketing, e a tag cobria só 36% dos
 * leads de setembro (819 de 2.250): ela depende de uma frase exata na primeira
 * mensagem, e só existe para quem chegou a um atendente. O rastreamento vem do
 * CLIQUE no anúncio do Meta (Click-to-WhatsApp) e registra todo mundo, inclusive
 * quem mandou só "Oi" ou falou só com o robô.
 *
 * O relatório não sai por API (nenhum dos 130 endpoints do Matrix o expõe), então
 * ele é exportado da tela e importado aqui. Este módulo é puro: recebe os bytes,
 * devolve linhas normalizadas. O banco fica em `src/rastreamento.js`.
 *
 * Formato observado (set/2026): `;` como separador, aspas em volta do texto,
 * mensagens com quebra de linha DENTRO das aspas, data `dd/mm/aaaa hh:mm:ss`,
 * emoji escrito como `##1f60d##`, e alguns bytes que não são UTF-8 válido no meio
 * de um arquivo que é UTF-8 — então o arquivo não pode ser lido como Latin-1
 * inteiro só por causa deles.
 */

/** Sem acento, minúsculo, só letras e números: como o cabeçalho é comparado. */
const chave = (v) => String(v ?? '')
  .normalize('NFD').replace(/[̀-ͯ]/g, '')
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, ' ')
  .trim();

/**
 * As colunas do relatório, pelo nome do cabeçalho.
 *
 * O cabeçalho é casado por nome, e não por posição: se o Matrix mudar a ordem ou
 * acrescentar uma coluna, a importação continua certa.
 */
const COLUNAS = {
  cod: ['cod'],
  titulo: ['titulo do post'],
  tipo: ['tipo'],
  conta: ['conta'],
  canal: ['canal'],
  contato: ['nome do contato'],
  telefone: ['numero de telefone'],
  classificacao: ['classificacao principal do atendimento'],
  dataAcesso: ['data acesso'],
  protocolo: ['protocolo'],
  mensagem: ['mensagem'],
};
const OBRIGATORIAS = ['cod', 'dataAcesso', 'protocolo'];

/**
 * Bytes para texto.
 *
 * UTF-8 primeiro, porque é o que o Matrix exporta. Se o resultado vier com muitos
 * caracteres de substituição (U+FFFD), o arquivo não era UTF-8 — alguém abriu e
 * salvou no Excel, que grava em Windows-1252 — e a leitura é refeita assim.
 * O limite é proporcional: o arquivo de setembro, que É UTF-8, tem um punhado de
 * bytes ruins em 423 KB, e não pode cair no outro caminho por causa deles.
 */
export function decodificar(bytes) {
  const buf = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const utf8 = new TextDecoder('utf-8').decode(buf);
  const ruins = (utf8.match(/�/g) || []).length;
  const texto = ruins > Math.max(20, utf8.length * 0.002)
    ? new TextDecoder('windows-1252').decode(buf)
    : utf8;
  return texto.replace(/^﻿/, '');
}

/**
 * Texto CSV para matriz de células.
 *
 * Parser próprio porque o arquivo tem o que derruba um `split`: quebra de linha e
 * separador dentro de campo com aspas, e aspas escapadas como `""`.
 */
export function celulas(texto, sep) {
  const linhas = [];
  let linha = [];
  let campo = '';
  let aspas = false;
  for (let i = 0; i < texto.length; i += 1) {
    const c = texto[i];
    if (aspas) {
      if (c === '"') {
        if (texto[i + 1] === '"') { campo += '"'; i += 1; } else aspas = false;
      } else campo += c;
    } else if (c === '"') aspas = true;
    else if (c === sep) { linha.push(campo); campo = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && texto[i + 1] === '\n') i += 1;
      linha.push(campo); campo = '';
      if (linha.some((x) => x !== '')) linhas.push(linha);
      linha = [];
    } else campo += c;
  }
  linha.push(campo);
  if (linha.some((x) => x !== '')) linhas.push(linha);
  return linhas;
}

/** `##1f60d##` e `##26a0-fe0f##` de volta para o emoji que o cliente mandou. */
export function emojis(v) {
  return String(v ?? '').replace(/##([0-9a-f]{2,6}(?:-[0-9a-f]{2,6})*)##/gi, (m, cods) => {
    try {
      return String.fromCodePoint(...cods.split('-').map((h) => parseInt(h, 16)));
    } catch {
      return m;
    }
  });
}

/** `30/09/2026 23:39:56` -> `2026-09-30 23:39:56`; inválida -> null. */
export function dataHora(v) {
  const m = String(v ?? '').trim().match(/^(\d{2})\/(\d{2})\/(\d{4})(?:\s+(\d{2}):(\d{2})(?::(\d{2}))?)?$/);
  if (!m) return null;
  const [, d, mes, a, h = '00', min = '00', s = '00'] = m;
  // 31/02 passa no formato e o MariaDB recusa no INSERT, derrubando o lote
  // inteiro: a data tem de existir no calendário
  const t = new Date(Date.UTC(Number(a), Number(mes) - 1, Number(d)));
  if (t.getUTCFullYear() !== Number(a) || t.getUTCMonth() !== Number(mes) - 1 || t.getUTCDate() !== Number(d)) return null;
  if (Number(h) > 23 || Number(min) > 59 || Number(s) > 59) return null;
  return `${a}-${mes}-${d} ${h}:${min}:${s}`;
}

/**
 * Quantas linhas de um INSERT ... ON DUPLICATE KEY UPDATE eram novas, e quantas
 * já existiam.
 *
 * Só essa divisão é confiável. "Atualizada" contra "idêntica" não dá para saber:
 * o mysql2 liga FOUND_ROWS (toda linha encontrada conta 1, mudando ou não) e a
 * importação regrava `lote_id` e `importado_em` em todas. A primeira versão tentou
 * separar e mostrou metade das linhas como alteradas numa reimportação idêntica.
 * O texto `info` do MariaDB ("Records: 500  Duplicates: 120") dá as que já
 * existiam.
 */
export function contagemDoUpsert(res, total) {
  const dup = Number(String(res?.info || '').match(/Duplicates:\s*(\d+)/i)?.[1] ?? NaN);
  if (!Number.isFinite(dup)) return { novas: total, existentes: 0 };
  const existentes = Math.min(total, Math.max(0, dup));
  return { novas: total - existentes, existentes };
}

/**
 * O protocolo é guardado como TEXTO e só com dígitos.
 *
 * Ele tem 16 dígitos e às vezes começa com zero (`0924000005436812`). No
 * `db_matrix` a coluna é bigint, então lá o zero some — o cruzamento compara sem
 * os zeros à esquerda (`chaveProtocolo`). Guardar como número aqui perderia o
 * zero também, e o protocolo mostrado na tela deixaria de bater com o do Matrix.
 */
export const protocoloDe = (v) => String(v ?? '').replace(/\D/g, '');
export const chaveProtocolo = (v) => protocoloDe(v).replace(/^0+/, '');

const limpar = (v, max) => {
  const s = emojis(v).trim();
  if (!s) return null;
  return max && s.length > max ? s.slice(0, max) : s;
};

/**
 * Lê o arquivo inteiro.
 *
 * Devolve as linhas boas e, separadas, as que foram recusadas com o motivo — a
 * tela mostra quantas e por quê, em vez de importar pela metade em silêncio.
 * Um arquivo sem as colunas obrigatórias é recusado inteiro: provavelmente é
 * outro relatório do Matrix exportado por engano.
 */
export function lerRastreamento(bytes) {
  const texto = decodificar(bytes);
  const fim = texto.search(/\r?\n/);
  const primeira = fim < 0 ? texto : texto.slice(0, fim);
  const sep = (primeira.match(/;/g) || []).length >= (primeira.match(/,/g) || []).length ? ';' : ',';
  const matriz = celulas(texto, sep);
  if (!matriz.length) throw new Error('O arquivo está vazio.');

  const cabecalho = matriz[0].map(chave);
  const idx = {};
  for (const [campo, nomes] of Object.entries(COLUNAS)) {
    const i = cabecalho.findIndex((h) => nomes.includes(h));
    if (i >= 0) idx[campo] = i;
  }
  const faltam = OBRIGATORIAS.filter((c) => idx[c] === undefined);
  if (faltam.length) {
    throw new Error(
      'Este arquivo não parece o "Relatório analítico de rastreamento de posts" do Matrix: '
      + `faltam as colunas ${faltam.map((c) => COLUNAS[c][0]).join(', ')}.`,
    );
  }

  const linhas = [];
  const recusadas = [];
  const vistos = new Set();
  for (let n = 1; n < matriz.length; n += 1) {
    const r = matriz[n];
    const get = (c) => (idx[c] === undefined ? '' : r[idx[c]] ?? '');
    const cod = String(get('cod')).replace(/\D/g, '');
    const quando = dataHora(get('dataAcesso'));
    const protocolo = protocoloDe(get('protocolo'));
    const motivo = !cod ? 'sem código'
      : !quando ? `data inválida (${String(get('dataAcesso')).slice(0, 25)})`
        : !protocolo ? 'sem protocolo'
          : vistos.has(cod) ? 'código repetido no arquivo' : null;
    if (motivo) {
      recusadas.push({ linha: n + 1, motivo });
      continue;
    }
    vistos.add(cod);
    linhas.push({
      cod,
      titulo: limpar(get('titulo'), 255),
      tipo: limpar(get('tipo'), 20),
      conta: limpar(get('conta'), 120),
      canal: limpar(get('canal'), 40),
      contato: limpar(get('contato'), 255),
      telefone: limpar(get('telefone'), 20),
      classificacao: limpar(get('classificacao'), 255),
      dataAcesso: quando,
      protocolo,
      mensagem: limpar(get('mensagem'), 4000),
    });
  }

  const datas = linhas.map((l) => l.dataAcesso).sort();
  return {
    linhas,
    recusadas,
    de: datas[0]?.slice(0, 10) || null,
    ate: datas[datas.length - 1]?.slice(0, 10) || null,
  };
}
