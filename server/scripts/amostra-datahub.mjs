/**
 * Amostra dos dois conjuntos do SLA BKO no Data Hub, para conhecer colunas e tipos.
 *
 * Uso (dentro da pasta server):   node scripts/amostra-datahub.mjs
 *
 * Grava em data/amostra-datahub.json (a pasta data/ não vai para o git).
 * Nome, CPF/CNPJ, telefone e documento saem MASCARADOS: a amostra serve para ver o
 * formato, não o conteúdo. O token nunca é impresso.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from '../src/config.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SAIDA = path.resolve(__dirname, '../data/amostra-datahub.json');
const CONJUNTOS = ['umovme-ciclos-bko', 'umuvme-sls-bko'];
const LINHAS = 25;

const SENSIVEL = /nome_cliente|cliente_nome|cpf|cnpj|telefone|celular|documento|email/i;

function mascarar(chave, valor) {
  if (valor === null || valor === undefined || valor === '') return valor;
  if (SENSIVEL.test(chave)) {
    const s = String(valor);
    return `*** (${s.length} caracteres)`;
  }
  return valor;
}

function limpar(obj) {
  if (Array.isArray(obj)) return obj.map(limpar);
  if (obj && typeof obj === 'object') {
    return Object.fromEntries(Object.entries(obj).map(([k, v]) => (
      v && typeof v === 'object' ? [k, limpar(v)] : [k, mascarar(k, v)]
    )));
  }
  return obj;
}

/** Acha a lista de linhas na resposta, seja qual for o nome da chave. */
function linhasDe(corpo) {
  if (Array.isArray(corpo)) return corpo;
  for (const v of Object.values(corpo || {})) if (Array.isArray(v)) return v;
  return [];
}

function tipos(linhas) {
  const out = {};
  for (const l of linhas) {
    for (const [k, v] of Object.entries(l)) {
      const t = v === null ? 'null' : Array.isArray(v) ? 'array' : typeof v;
      out[k] = out[k] || new Set();
      out[k].add(t);
    }
  }
  return Object.fromEntries(Object.entries(out).map(([k, s]) => [k, [...s].join(' | ')]));
}

async function main() {
  if (!config.datahub.token) {
    console.error('DATAHUB_TOKEN está vazio no .env da pasta server.');
    process.exit(1);
  }
  const resultado = { geradoEm: new Date().toISOString(), conjuntos: {} };

  for (const slug of CONJUNTOS) {
    const url = `${config.datahub.url}/${slug}/rows?limit=${LINHAS}&offset=0&token=${encodeURIComponent(config.datahub.token)}`;
    process.stdout.write(`${slug}: `);
    try {
      const inicio = Date.now();
      const res = await fetch(url, { headers: { Accept: 'application/json' } });
      const texto = await res.text();
      if (!res.ok) {
        console.log(`erro HTTP ${res.status}`);
        resultado.conjuntos[slug] = { erro: `HTTP ${res.status}`, corpo: texto.slice(0, 500) };
        continue;
      }
      const corpo = JSON.parse(texto);
      const linhas = linhasDe(corpo);
      const envelope = Array.isArray(corpo) ? '(lista direta)' : Object.fromEntries(
        Object.entries(corpo).map(([k, v]) => [k, Array.isArray(v) ? `[lista com ${v.length}]` : v]),
      );
      resultado.conjuntos[slug] = {
        ms: Date.now() - inicio,
        envelope,
        colunas: linhas[0] ? Object.keys(linhas[0]) : [],
        tipos: tipos(linhas),
        amostra: limpar(linhas),
      };
      console.log(`ok — ${linhas.length} linhas de amostra em ${Date.now() - inicio} ms`);
    } catch (err) {
      console.log(`falhou: ${err.message}${err.cause ? ` (${err.cause.code || err.cause.message})` : ''}`);
      resultado.conjuntos[slug] = { erro: err.message, causa: err.cause?.code || err.cause?.message || null };
    }
  }

  fs.mkdirSync(path.dirname(SAIDA), { recursive: true });
  fs.writeFileSync(SAIDA, `${JSON.stringify(resultado, null, 2)}\n`, 'utf8');
  console.log(`\nAmostra gravada em ${SAIDA}`);
}

main();
