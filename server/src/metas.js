/**
 * Metas comerciais por cidade — o alvo contra o qual o RELATÓRIO DIÁRIO compara.
 *
 * No relatório de origem elas são constantes escritas dentro de medidas DAX. Meta
 * muda todo ano (e às vezes no meio do ano), então aqui elas vivem no volume de
 * dados com tela de administração, no mesmo padrão de `janela.json`.
 *
 * DUAS SÉRIES CONFLITANTES NA ORIGEM
 * O modelo tem dois conjuntos de meta de ATIVAÇÃO, e eles não batem:
 *
 *   cidade            [# ATIVOS_META]   [## ATIVOS_META_BASE]
 *   Canoas                      1100                     898
 *   São Leopoldo                 600                     598
 *   Novo Hamburgo                650                     498
 *   Sapucaia do Sul              400                     349
 *   Esteio                       250                     149
 *   Cachoeirinha          (não existe)                    498
 *
 * As tabelas da tela usam o segundo (`##`), que é também o único que soma
 * corretamente quando há mais de uma cidade selecionada — o primeiro usa
 * SELECTEDVALUE e devolve 0 com duas cidades marcadas. A semente aqui é o `##`, e a
 * tela de administração mostra o conjunto alternativo para quem precisar comparar.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const arquivo = () => (process.env.METAS_PATH
  ? path.resolve(process.env.METAS_PATH)
  : path.resolve(__dirname, '../data/metas.json'));

/** Semente: o conjunto `##`, que é o que as tabelas do relatório realmente usam. */
export const SEMENTE = {
  vendas: {
    Canoas: 1540,
    'Sapucaia do Sul': 560,
    Esteio: 350,
    'São Leopoldo': 840,
    'Novo Hamburgo': 910,
    Cachoeirinha: 100,
  },
  ativos: {
    Canoas: 898,
    'Sapucaia do Sul': 349,
    Esteio: 149,
    'São Leopoldo': 598,
    'Novo Hamburgo': 498,
    Cachoeirinha: 498,
  },
  // Rádio não é por cidade na origem: é um número só, para o total.
  vendasRadio: 200,
  ativosRadio: 100,
};

/** O conjunto que a tela mostra como alternativa, para conferência. */
export const CONJUNTO_ALTERNATIVO = {
  rotulo: '# ATIVOS_META (a série mais alta, não usada pelas tabelas)',
  ativos: {
    Canoas: 1100,
    'Sapucaia do Sul': 400,
    Esteio: 250,
    'São Leopoldo': 600,
    'Novo Hamburgo': 650,
  },
};

function ler() {
  try {
    const p = arquivo();
    if (!fs.existsSync(p)) return null;
    const raw = fs.readFileSync(p, 'utf8').trim();
    return raw ? JSON.parse(raw) : null;
  } catch (err) {
    console.warn(`[metas] não foi possível ler o cadastro: ${err.message} — usando a semente`);
    return null;
  }
}

const numero = (v) => {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : null;
};

/** Metas em vigor. */
export function metas() {
  const salvo = ler();
  if (!salvo) return { ...SEMENTE, origem: 'semente', atualizadoEm: null, atualizadoPor: null };
  const limpar = (obj, padrao) => {
    const saida = {};
    for (const [cidade, valor] of Object.entries(obj || {})) {
      const n = numero(valor);
      if (n !== null) saida[cidade] = n;
    }
    return Object.keys(saida).length ? saida : padrao;
  };
  return {
    vendas: limpar(salvo.vendas, SEMENTE.vendas),
    ativos: limpar(salvo.ativos, SEMENTE.ativos),
    vendasRadio: numero(salvo.vendasRadio) ?? SEMENTE.vendasRadio,
    ativosRadio: numero(salvo.ativosRadio) ?? SEMENTE.ativosRadio,
    origem: 'tela',
    atualizadoEm: salvo.atualizadoEm || null,
    atualizadoPor: salvo.atualizadoPor || null,
  };
}

export function estadoMetas() {
  return { ...metas(), semente: SEMENTE, alternativo: CONJUNTO_ALTERNATIVO };
}

/**
 * Grava. Cidade sem meta não é erro — é meta zero, e a tela mostra a cidade com
 * alvo em branco em vez de esconder a linha. Esconder faria a venda daquela cidade
 * desaparecer do total.
 */
export function definirMetas({ vendas, ativos, vendasRadio, ativosRadio }, porQuem) {
  const validar = (obj, rotulo) => {
    const saida = {};
    for (const [cidade, valor] of Object.entries(obj || {})) {
      const nome = String(cidade).trim();
      if (!nome) throw new Error(`${rotulo}: há uma linha sem cidade.`);
      const n = numero(valor);
      if (n === null) throw new Error(`${rotulo} de ${nome}: use um número igual ou maior que zero.`);
      if (n > 1000000) throw new Error(`${rotulo} de ${nome}: ${n} é grande demais para ser meta.`);
      saida[nome] = n;
    }
    return saida;
  };
  const radio = (v, rotulo) => {
    const n = numero(v);
    if (n === null) throw new Error(`${rotulo}: use um número igual ou maior que zero.`);
    return n;
  };

  const novo = {
    vendas: validar(vendas, 'Meta de vendas'),
    ativos: validar(ativos, 'Meta de ativações'),
    vendasRadio: radio(vendasRadio, 'Meta de vendas de rádio'),
    ativosRadio: radio(ativosRadio, 'Meta de ativações de rádio'),
    atualizadoEm: new Date().toISOString(),
    atualizadoPor: String(porQuem || '').toLowerCase(),
  };
  const p = arquivo();
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, `${JSON.stringify(novo, null, 2)}\n`, 'utf8');
  return estadoMetas();
}

export function restaurarMetas() {
  const p = arquivo();
  if (fs.existsSync(p)) fs.rmSync(p);
  return estadoMetas();
}
