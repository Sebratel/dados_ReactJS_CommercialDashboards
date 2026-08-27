// Utilitários de data em texto ISO (YYYY-MM-DD), sem fuso horário.

export const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho',
  'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];

export const MESES_ABREV = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun',
  'jul', 'ago', 'set', 'out', 'nov', 'dez'];

export function toIso(value) {
  if (!value) return null;
  if (typeof value === 'string') return value.slice(0, 10);
  if (value instanceof Date) {
    const y = value.getFullYear();
    const m = String(value.getMonth() + 1).padStart(2, '0');
    const d = String(value.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  return null;
}

export function addDays(iso, days) {
  if (!iso) return null;
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Primeiro dia do mês seguinte ao da data (EOMONTH(d,0)+1 no DAX). */
export function startOfNextMonth(iso) {
  if (!iso) return null;
  const y = Number(iso.slice(0, 4));
  const m = Number(iso.slice(5, 7));
  return m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, '0')}-01`;
}

/** Último dia do mês da data (EOMONTH(d,0)). */
export function endOfMonth(iso) {
  return addDays(startOfNextMonth(iso), -1);
}

/**
 * Chave de período -> intervalo de datas. '2026-08' vira o mês inteiro; '2026-08-14'
 * vira o dia. É o que traduz o clique numa coluna do gráfico em recorte de período: a
 * coluna sabe o seu rótulo, e o rótulo é a chave.
 */
export function intervaloDePeriodo(periodo) {
  if (!periodo) return null;
  const p = String(periodo).trim();
  if (/^\d{4}-\d{2}$/.test(p)) return { de: `${p}-01`, ate: endOfMonth(`${p}-01`) };
  if (/^\d{4}-\d{2}-\d{2}$/.test(p)) return { de: p, ate: p };
  return null;
}

export function startOfMonth(iso) {
  return iso ? `${iso.slice(0, 7)}-01` : null;
}

export function monthKey(iso) {
  return iso ? iso.slice(0, 7) : null;
}

export function monthLabel(key) {
  const [y, m] = key.split('-');
  return `${MESES_ABREV[Number(m) - 1]}/${y.slice(2)}`;
}

export function monthLabelLong(key) {
  const [y, m] = key.split('-');
  return `${MESES[Number(m) - 1]} de ${y}`;
}

export function diffDays(from, to) {
  if (!from || !to) return null;
  return Math.round((new Date(`${to}T00:00:00Z`) - new Date(`${from}T00:00:00Z`)) / 86400000);
}

export function today() {
  const now = new Date();
  return toIso(now);
}

/** "1 ano e 2 meses e 3 dias" — equivalente à medida TempoContrato2. */
export function tempoContrato(admissao, ref) {
  if (!admissao || !ref) return '';
  let totalMeses = (Number(ref.slice(0, 4)) - Number(admissao.slice(0, 4))) * 12
    + (Number(ref.slice(5, 7)) - Number(admissao.slice(5, 7)));
  if (Number(ref.slice(8, 10)) < Number(admissao.slice(8, 10))) totalMeses -= 1;
  if (totalMeses < 0) return '';
  const anos = Math.floor(totalMeses / 12);
  const meses = totalMeses % 12;
  const base = addMonths(admissao, totalMeses);
  const dias = diffDays(base, ref);
  const partes = [];
  if (anos > 0) partes.push(anos === 1 ? '1 ano' : `${anos} anos`);
  if (meses > 0) partes.push(meses === 1 ? '1 mês' : `${meses} meses`);
  if (dias > 0) partes.push(dias === 1 ? '1 dia' : `${dias} dias`);
  return partes.join(' e ');
}

export function addMonths(iso, months) {
  const y = Number(iso.slice(0, 4));
  const m = Number(iso.slice(5, 7));
  const d = Number(iso.slice(8, 10));
  const total = y * 12 + (m - 1) + months;
  const ny = Math.floor(total / 12);
  const nm = (total % 12) + 1;
  const lastDay = new Date(Date.UTC(ny, nm, 0)).getUTCDate();
  const nd = Math.min(d, lastDay);
  return `${ny}-${String(nm).padStart(2, '0')}-${String(nd).padStart(2, '0')}`;
}
