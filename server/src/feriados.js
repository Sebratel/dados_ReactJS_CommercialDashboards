/**
 * Feriados — o que decide dia útil e dia produtivo.
 *
 * No relatório de origem esta lista vem de uma planilha do Google. Planilha foi
 * vetada como fonte de dado do dashboard, então aqui ela nasce calculada e mora no
 * volume de dados, junto de `janela.json` e `access.json`, com tela de administração.
 *
 * Por que isso não é detalhe: no RELATÓRIO DIÁRIO, feriado vira dia produtivo a
 * menos, que vira meta/dia maior, que vira projeção diferente. Uma data errada aqui
 * move todos os números daquela tela.
 *
 * O que é calculado e o que não é:
 *  - NACIONAIS e o estadual do RS saem do código, inclusive os móveis (Carnaval,
 *    Sexta-feira Santa e Corpus Christi derivam da Páscoa). Nunca precisam de
 *    manutenção, para nenhum ano.
 *  - MUNICIPAIS não são semeados de propósito. Aniversário de cidade e feriado
 *    religioso local mudam por município e por ano, e chutar uma data seria pior que
 *    não ter: o número sairia errado com cara de certo. O admin cadastra na tela.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const arquivo = () => (process.env.FERIADOS_PATH
  ? path.resolve(process.env.FERIADOS_PATH)
  : path.resolve(__dirname, '../data/feriados.json'));

const ISO = /^\d{4}-\d{2}-\d{2}$/;

const doisDigitos = (n) => String(n).padStart(2, '0');
const iso = (ano, mes, dia) => `${ano}-${doisDigitos(mes)}-${doisDigitos(dia)}`;

/** Data existe no calendário? O V8 rola dia inválido para frente, então só a ida e volta denuncia. */
export const dataReal = (v) => {
  if (!ISO.test(v)) return false;
  const d = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
};

const somarDias = (isoData, dias) => {
  const d = new Date(`${isoData}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().slice(0, 10);
};

/**
 * Domingo de Páscoa pelo algoritmo gregoriano anônimo (Meeus/Jones/Butcher).
 * Vale de 1583 a 4099 — folga suficiente para um dashboard comercial.
 */
export function pascoa(ano) {
  const a = ano % 19;
  const b = Math.floor(ano / 100);
  const c = ano % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const mes = Math.floor((h + l - 7 * m + 114) / 31);
  const dia = ((h + l - 7 * m + 114) % 31) + 1;
  return iso(ano, mes, dia);
}

/** Feriados nacionais + o estadual do RS de um ano. */
export function feriadosDoAno(ano) {
  const p = pascoa(ano);
  const lista = [
    [iso(ano, 1, 1), 'Confraternização Universal'],
    [somarDias(p, -48), 'Carnaval (segunda)'],
    [somarDias(p, -47), 'Carnaval'],
    [somarDias(p, -2), 'Sexta-feira Santa'],
    [iso(ano, 4, 21), 'Tiradentes'],
    [iso(ano, 5, 1), 'Dia do Trabalho'],
    [somarDias(p, 60), 'Corpus Christi'],
    [iso(ano, 9, 7), 'Independência'],
    [iso(ano, 9, 20), 'Revolução Farroupilha (RS)'],
    [iso(ano, 10, 12), 'Nossa Senhora Aparecida'],
    [iso(ano, 11, 2), 'Finados'],
    [iso(ano, 11, 15), 'Proclamação da República'],
    [iso(ano, 12, 25), 'Natal'],
  ];
  // Consciência Negra virou feriado nacional pela Lei 14.759/2023, em vigor a
  // partir de 2024. Antes disso não entra, senão o dia produtivo de 2023 sai errado.
  if (ano >= 2024) lista.push([iso(ano, 11, 20), 'Consciência Negra']);
  return lista.map(([data, nome]) => ({ data, nome, origem: 'calculado' }));
}

function ler() {
  try {
    const p = arquivo();
    if (!fs.existsSync(p)) return {};
    const raw = fs.readFileSync(p, 'utf8').trim();
    return raw ? JSON.parse(raw) : {};
  } catch (err) {
    console.warn(`[feriados] não foi possível ler o cadastro: ${err.message} — usando só os calculados`);
    return {};
  }
}

function gravar(dados) {
  const p = arquivo();
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, `${JSON.stringify(dados, null, 2)}\n`, 'utf8');
}

/**
 * Feriados em vigor, do ano `de` ao ano `ate`.
 *
 * Os calculados sempre existem; o cadastro da tela ACRESCENTA municipais e pode
 * REMOVER um calculado (é o caso de ponto facultativo tratado como dia normal).
 * A remoção é por data, e fica registrada — sem isso, um feriado que voltasse a ser
 * calculado reapareceria e ninguém entenderia por quê.
 */
export function feriados(de, ate) {
  const salvo = ler();
  const anoDe = Number(String(de).slice(0, 4)) || new Date().getUTCFullYear();
  const anoAte = Number(String(ate).slice(0, 4)) || anoDe;
  const mapa = new Map();
  for (let ano = anoDe; ano <= anoAte; ano += 1) {
    for (const f of feriadosDoAno(ano)) mapa.set(f.data, f);
  }
  for (const f of salvo.extras || []) {
    if (dataReal(f?.data)) mapa.set(f.data, { data: f.data, nome: f.nome || 'Feriado', origem: 'cadastrado' });
  }
  for (const data of salvo.removidos || []) mapa.delete(data);
  return [...mapa.values()]
    .filter((f) => f.data >= `${anoDe}-01-01` && f.data <= `${anoAte}-12-31`)
    .sort((a, b) => a.data.localeCompare(b.data));
}

/** Conjunto de datas, para o cálculo de dia útil não pagar o custo do objeto. */
export function conjuntoFeriados(de, ate) {
  return new Set(feriados(de, ate).map((f) => f.data));
}

export function estadoFeriados() {
  const salvo = ler();
  const ano = new Date().getUTCFullYear();
  return {
    extras: salvo.extras || [],
    removidos: salvo.removidos || [],
    atualizadoEm: salvo.atualizadoEm || null,
    atualizadoPor: salvo.atualizadoPor || null,
    // o ano corrente resolvido, que é o que a tela mostra para conferência
    doAno: feriados(`${ano}-01-01`, `${ano}-12-31`),
  };
}

/** Grava o cadastro. Recusa data inválida e nome vazio em feriado novo. */
export function definirFeriados({ extras, removidos }, porQuem) {
  const limpos = [];
  for (const f of extras || []) {
    const data = String(f?.data || '').trim();
    if (!ISO.test(data)) throw new Error(`Feriado "${f?.nome || data}": use o formato AAAA-MM-DD.`);
    if (!dataReal(data)) throw new Error(`${data} não existe no calendário.`);
    const nome = String(f?.nome || '').trim();
    if (!nome) throw new Error(`O feriado de ${data} precisa de um nome.`);
    limpos.push({ data, nome });
  }
  const removidosLimpos = [...new Set((removidos || [])
    .map((d) => String(d || '').trim())
    .filter((d) => dataReal(d)))];

  const vistos = new Set();
  for (const f of limpos) {
    if (vistos.has(f.data)) throw new Error(`${f.data} aparece duas vezes no cadastro.`);
    vistos.add(f.data);
  }

  gravar({
    extras: limpos.sort((a, b) => a.data.localeCompare(b.data)),
    removidos: removidosLimpos.sort(),
    atualizadoEm: new Date().toISOString(),
    atualizadoPor: String(porQuem || '').toLowerCase(),
  });
  return estadoFeriados();
}

export function restaurarFeriados() {
  const p = arquivo();
  if (fs.existsSync(p)) fs.rmSync(p);
  return estadoFeriados();
}

/**
 * Dias úteis e produtivos de um intervalo, na régua do relatório de origem:
 * sábado vale MEIO dia, domingo zero, feriado zero.
 *
 * `uteis` conta só o que já passou (até ontem) — é o divisor da média por dia, e
 * incluir o dia de hoje, ainda em andamento, derrubaria a média toda manhã.
 * `produtivos` conta o intervalo inteiro — é o multiplicador da projeção.
 */
export function contarDias(de, ate, hoje = new Date().toISOString().slice(0, 10)) {
  if (!dataReal(de) || !dataReal(ate) || de > ate) return { uteis: 0, produtivos: 0 };
  const naoUteis = conjuntoFeriados(de, ate);
  let uteis = 0;
  let produtivos = 0;
  const fim = new Date(`${ate}T00:00:00Z`);
  for (const d = new Date(`${de}T00:00:00Z`); d <= fim; d.setUTCDate(d.getUTCDate() + 1)) {
    const data = d.toISOString().slice(0, 10);
    const semana = d.getUTCDay(); // 0 = domingo
    const peso = naoUteis.has(data) || semana === 0 ? 0 : (semana === 6 ? 0.5 : 1);
    produtivos += peso;
    if (data < hoje) uteis += peso;
  }
  return { uteis: Math.round(uteis * 10) / 10, produtivos: Math.round(produtivos * 10) / 10 };
}
