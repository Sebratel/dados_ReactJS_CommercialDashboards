// Tabela "holidays" do modelo do Power BI (feriados nacionais).
// O modelo original ia até 2025; 2026/2027 foram acrescentados para que as
// medidas de média por dia útil continuem corretas.
const RAW = [
  ['2020-01-01', 'Confraternização Universal'], ['2020-02-25', 'Carnaval'],
  ['2020-04-10', 'Sexta-feira Santa'], ['2020-04-21', 'Tiradentes'],
  ['2020-05-01', 'Dia do Trabalho'], ['2020-06-11', 'Corpus Christi'],
  ['2020-09-07', 'Independência do Brasil'], ['2020-10-12', 'Nossa Senhora Aparecida'],
  ['2020-11-02', 'Finados'], ['2020-11-15', 'Proclamação da República'], ['2020-12-25', 'Natal'],

  ['2021-01-01', 'Confraternização Universal'], ['2021-02-16', 'Carnaval'],
  ['2021-04-02', 'Sexta-feira Santa'], ['2021-04-21', 'Tiradentes'],
  ['2021-05-01', 'Dia do Trabalho'], ['2021-06-03', 'Corpus Christi'],
  ['2021-09-07', 'Independência do Brasil'], ['2021-10-12', 'Nossa Senhora Aparecida'],
  ['2021-11-02', 'Finados'], ['2021-11-15', 'Proclamação da República'], ['2021-12-25', 'Natal'],

  ['2022-01-01', 'Confraternização Universal'], ['2022-03-01', 'Carnaval'],
  ['2022-04-15', 'Sexta-feira Santa'], ['2022-04-21', 'Tiradentes'],
  ['2022-05-01', 'Dia do Trabalho'], ['2022-06-16', 'Corpus Christi'],
  ['2022-09-07', 'Independência do Brasil'], ['2022-10-12', 'Nossa Senhora Aparecida'],
  ['2022-11-02', 'Finados'], ['2022-11-15', 'Proclamação da República'], ['2022-12-25', 'Natal'],

  ['2023-01-01', 'Confraternização Universal'], ['2023-02-21', 'Carnaval'],
  ['2023-04-07', 'Sexta-feira Santa'], ['2023-04-21', 'Tiradentes'],
  ['2023-05-01', 'Dia do Trabalho'], ['2023-06-08', 'Corpus Christi'],
  ['2023-09-07', 'Independência do Brasil'], ['2023-10-12', 'Nossa Senhora Aparecida'],
  ['2023-11-02', 'Finados'], ['2023-11-15', 'Proclamação da República'], ['2023-12-25', 'Natal'],

  ['2024-01-01', 'Confraternização Universal'], ['2024-02-13', 'Carnaval'],
  ['2024-03-29', 'Sexta-feira Santa'], ['2024-04-21', 'Tiradentes'],
  ['2024-05-01', 'Dia do Trabalho'], ['2024-05-30', 'Corpus Christi'],
  ['2024-09-07', 'Independência do Brasil'], ['2024-10-12', 'Nossa Senhora Aparecida'],
  ['2024-11-02', 'Finados'], ['2024-11-15', 'Proclamação da República'], ['2024-12-25', 'Natal'],

  ['2025-01-01', 'Confraternização Universal'], ['2025-03-04', 'Carnaval'],
  ['2025-04-18', 'Sexta-feira Santa'], ['2025-04-21', 'Tiradentes'],
  ['2025-05-01', 'Dia do Trabalho'], ['2025-06-19', 'Corpus Christi'],
  ['2025-09-07', 'Independência do Brasil'], ['2025-10-12', 'Nossa Senhora Aparecida'],
  ['2025-11-02', 'Finados'], ['2025-11-15', 'Proclamação da República'], ['2025-12-25', 'Natal'],

  ['2026-01-01', 'Confraternização Universal'], ['2026-02-17', 'Carnaval'],
  ['2026-04-03', 'Sexta-feira Santa'], ['2026-04-21', 'Tiradentes'],
  ['2026-05-01', 'Dia do Trabalho'], ['2026-06-04', 'Corpus Christi'],
  ['2026-09-07', 'Independência do Brasil'], ['2026-10-12', 'Nossa Senhora Aparecida'],
  ['2026-11-02', 'Finados'], ['2026-11-15', 'Proclamação da República'], ['2026-12-25', 'Natal'],

  ['2027-01-01', 'Confraternização Universal'], ['2027-02-09', 'Carnaval'],
  ['2027-03-26', 'Sexta-feira Santa'], ['2027-04-21', 'Tiradentes'],
  ['2027-05-01', 'Dia do Trabalho'], ['2027-05-27', 'Corpus Christi'],
  ['2027-09-07', 'Independência do Brasil'], ['2027-10-12', 'Nossa Senhora Aparecida'],
  ['2027-11-02', 'Finados'], ['2027-11-15', 'Proclamação da República'], ['2027-12-25', 'Natal'],
];

export const HOLIDAYS = new Set(RAW.map(([d]) => d));
export const HOLIDAY_LIST = RAW.map(([data, feriado]) => ({ data, feriado }));

/**
 * Peso do dia usado nas medidas MEDIA VENDAS / MEDIA ATIVOS do Power BI:
 *   domingo ou feriado = 0 | sábado = 0.5 | segunda a sexta = 1
 * (WEEKDAY(...,2): 1=segunda ... 6=sábado, 7=domingo)
 */
export function dayWeight(isoDate) {
  if (!isoDate) return 0;
  if (HOLIDAYS.has(isoDate)) return 0;
  const dow = new Date(`${isoDate}T00:00:00Z`).getUTCDay(); // 0=domingo
  if (dow === 0) return 0;
  if (dow === 6) return 0.5;
  return 1;
}
