const nf0 = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 0 });
const nf1 = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const nf2 = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const cf = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 });
const cf2 = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: 2 });

export const int = (v) => nf0.format(Number(v) || 0);
export const dec1 = (v) => nf1.format(Number(v) || 0);
export const dec2 = (v) => nf2.format(Number(v) || 0);
export const brl = (v) => cf.format(Number(v) || 0);
export const brl2 = (v) => cf2.format(Number(v) || 0);

/** Fração (0..1) em porcentagem — os mesmos formatos do Power BI: 0% e 0,00%. */
export const pct = (v) => `${nf0.format((Number(v) || 0) * 100)}%`;
export const pct2 = (v) => `${nf2.format((Number(v) || 0) * 100)}%`;

const MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
const MESES_LONGO = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho',
  'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];

/** '2026-08' -> 'ago/26' */
export const labelMes = (k) => (k ? `${MESES[Number(k.slice(5, 7)) - 1]}/${k.slice(2, 4)}` : '');
/** '2026-08' -> 'agosto de 2026' */
export const labelMesLongo = (k) => (k ? `${MESES_LONGO[Number(k.slice(5, 7)) - 1]} de ${k.slice(0, 4)}` : '');
/** '2026-08-14' -> '14/08/2026' */
export const labelData = (d) => (d ? `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}` : '');
/** '2026-08-14' -> '14/08' */
export const labelDia = (d) => (d ? `${d.slice(8, 10)}/${d.slice(5, 7)}` : '');

/** Detecta se o período é mês ('2026-08') ou dia ('2026-08-14'). */
export const labelPeriodo = (p) => (!p ? '' : p.length > 7 ? labelDia(p) : labelMes(p));
export const labelPeriodoLongo = (p) => (!p ? '' : p.length > 7 ? labelData(p) : labelMesLongo(p));

export function labelDataHora(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()} às ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

export function haQuanto(iso) {
  if (!iso) return '';
  const s = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 60) return `há ${s}s`;
  if (s < 3600) return `há ${Math.round(s / 60)}min`;
  return `há ${Math.round(s / 3600)}h`;
}

/**
 * Rótulo do rodapé das tabelas por vendedor.
 *
 * Com cross-highlight a tabela mostra TODOS os vendedores e o cartão de KPI mostra só
 * o selecionado: dois números diferentes na mesma tela, os dois certos. O rodapé diz
 * de qual lado ele está — sem isso a diferença se lê como erro de conta.
 */
export const labelTotalVendedores = (linhas = [], selecionados = []) => {
  const n = linhas.length;
  const quantos = `${n} vendedor${n === 1 ? '' : 'es'}`;
  if (!selecionados.length) return `Total (${quantos})`;
  return `Total (${quantos} · ${selecionados.length} no filtro)`;
};

export const hoje = () => new Date().toISOString().slice(0, 10);

export function inicioDoMes(iso = hoje()) {
  return `${iso.slice(0, 7)}-01`;
}

export function fimDoMes(iso = hoje()) {
  const y = Number(iso.slice(0, 4));
  const m = Number(iso.slice(5, 7));
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
}

export function addDias(iso, n) {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function addMeses(iso, n) {
  const y = Number(iso.slice(0, 4));
  const m = Number(iso.slice(5, 7)) - 1 + n;
  const d = new Date(Date.UTC(y, m, 1));
  return d.toISOString().slice(0, 10);
}
