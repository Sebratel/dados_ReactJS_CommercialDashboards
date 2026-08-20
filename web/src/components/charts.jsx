import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  Area, Bar, CartesianGrid, Cell, ComposedChart, LabelList, Line,
  Tooltip, XAxis, YAxis,
} from 'recharts';
import { brl, int, dec1 } from '../format';

/**
 * Mede o container e entrega largura/altura em pixels para o gráfico.
 * (Substitui o ResponsiveContainer do Recharts, que depende exclusivamente do
 * ResizeObserver e fica em branco em alguns cenários de render.)
 */
export function AutoSizer({ children, minHeight = 180, altura = null }) {
  const ref = useRef(null);
  const [size, setSize] = useState({ w: 0, h: 0 });

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const medir = () => {
      const r = el.getBoundingClientRect();
      const h = altura || r.height;
      setSize((s) => (Math.abs(s.w - r.width) > 1 || Math.abs(s.h - h) > 1 ? { w: r.width, h } : s));
    };
    medir();
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(medir) : null;
    ro?.observe(el);
    window.addEventListener('resize', medir);
    const t1 = setTimeout(medir, 50);
    const t2 = setTimeout(medir, 400);
    return () => {
      ro?.disconnect();
      window.removeEventListener('resize', medir);
      clearTimeout(t1);
      clearTimeout(t2);
    };
  }, [altura]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const h = altura || r.height;
    if (r.width > 0 && (size.w === 0 || size.h === 0)) setSize({ w: r.width, h });
  });

  return (
    <div
      ref={ref}
      style={{
        flex: altura ? '0 0 auto' : 1,
        width: '100%',
        height: altura || '100%',
        minHeight: altura || minHeight,
      }}
    >
      {size.w > 0 && size.h > 0 ? children(size) : null}
    </div>
  );
}

export const CORES = {
  primary: '#880F17',
  primaryDark: '#6b2328',
  gold: '#D9B300',
  goldLight: '#f0e199',
  gold200: '#EED790',
  gold600: '#D49F00',
  goldSoft: '#E0C233',
  orange: '#E66C37',
  orangeSoft: '#EB895F',
  ink: '#252423',
  muted: '#605E5C',
  green: '#0E9224',
  grid: '#E1DFDD',
};

const hex2rgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const rgb2hex = (r) => `#${r.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')}`;

/** Gradiente de valor das colunas/barras do Power BI (mín -> máx). */
export function escalaGradiente(valor, min, max, de = CORES.goldLight, ate = CORES.gold) {
  if (max === min) return ate;
  const t = Math.max(0, Math.min(1, (valor - min) / (max - min)));
  const a = hex2rgb(de);
  const b = hex2rgb(ate);
  return rgb2hex(a.map((v, i) => v + (b[i] - v) * t));
}

/**
 * Gradiente de 3 pontos (linearGradient3 do Power BI) — usado na coloração das
 * faixas de premiação: mínimo -> meio -> máximo.
 */
export function escalaGradiente3(valor, min, max, cores = ['#D8A579', '#BACDDF', '#7FCE79']) {
  const [cMin, cMid, cMax] = cores;
  if (max === min) return cMid;
  const t = Math.max(0, Math.min(1, (valor - min) / (max - min)));
  return t <= 0.5
    ? escalaGradiente(t, 0, 0.5, cMin, cMid)
    : escalaGradiente(t, 0.5, 1, cMid, cMax);
}

/** Preto ou branco conforme a luminância do fundo (legibilidade dos rótulos). */
export function corDoTexto(fundo) {
  const [r, g, b] = hex2rgb(fundo);
  const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return lum > 0.6 ? '#252423' : '#FFFFFF';
}

/** Rótulo de dados no estilo Power BI: texto branco sobre "chip" escuro. */
function ChipLabel(props) {
  const {
    x, y, width = 0, height = 0, value, fmt = int, fill = CORES.ink, color = '#fff',
    posicao = 'centro', fontSize = 11.5, minAltura = 22,
  } = props;
  if (value === null || value === undefined || value === 0) return null;
  const texto = fmt(value);
  const w = Math.max(texto.length * fontSize * 0.58 + 10, 22);
  const h = fontSize + 7;
  let cx = x + width / 2;
  let cy = y + height / 2;
  if (posicao === 'acima' || (posicao === 'centro' && height < minAltura)) {
    cy = y - h / 2 - 3;
  }
  if (posicao === 'direita') {
    cx = x + width + w / 2 + 5;
    cy = y + height / 2;
  }
  if (posicao === 'ponto') {
    cy = y - h / 2 - 5;
  }
  return (
    <g pointerEvents="none">
      <rect x={cx - w / 2} y={cy - h / 2} width={w} height={h} rx={3} fill={fill} opacity={0.92} />
      <text x={cx} y={cy} textAnchor="middle" dominantBaseline="central" fill={color} fontSize={fontSize} fontWeight={600}>
        {texto}
      </text>
    </g>
  );
}

export function PbiTooltip({ active, payload, label, fmts = {} }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="tooltip-pbi">
      <div className="t">{label}</div>
      {payload.filter((p) => p.value !== null && p.value !== undefined).map((p) => (
        <div className="r" key={p.dataKey}>
          <span><i style={{ background: p.color || p.stroke || p.fill }} />{p.name}</span>
          <b>{(fmts[p.dataKey] || int)(p.value)}</b>
        </div>
      ))}
    </div>
  );
}

const eixoTick = { fontSize: 11, fontWeight: 700, fill: CORES.ink };

/**
 * Combo "colunas + linha" (lineClusteredColumnComboChart do Power BI).
 * As duas séries compartilham a mesma escala quando são da mesma unidade;
 * quando `escalaSecundaria` é usada os eixos ficam ocultos e a leitura é feita
 * pelos rótulos diretos, como no relatório original.
 */
export function ComboChart({
  data, xKey = 'label', barKey, barName, lineKey, lineName,
  barFmt = int, lineFmt = int, escalaSecundaria = false,
  corLinha = CORES.orange, rotuloBarra = 'centro',
}) {
  const valores = data.map((d) => Number(d[barKey]) || 0);
  const min = Math.min(...valores, 0);
  const max = Math.max(...valores, 1);
  // com muitos pontos (visão diária) os rótulos viram ruído: escondemos e
  // deixamos a leitura pelo tooltip
  const denso = data.length > 24;
  const muitoDenso = data.length > 70;
  return (
    <AutoSizer>
      {({ w, h }) => (
      <ComposedChart width={w} height={h} data={data} margin={{ top: denso ? 12 : 26, right: 14, bottom: 4, left: 6 }}>
        <CartesianGrid vertical={false} stroke={CORES.grid} strokeDasharray="4 4" />
        <XAxis
          dataKey={xKey}
          tick={{ ...eixoTick, fontSize: denso ? 9.5 : 11 }}
          axisLine={false}
          tickLine={false}
          interval={muitoDenso ? Math.ceil(data.length / 22) : denso ? 1 : 0}
          minTickGap={0}
          angle={denso ? -35 : 0}
          textAnchor={denso ? 'end' : 'middle'}
          height={denso ? 42 : 22}
        />
        <YAxis yAxisId="l" hide domain={[0, (d) => d * 1.18]} />
        {lineKey && <YAxis yAxisId={escalaSecundaria ? 'r' : 'l'} orientation="right" hide domain={[0, (d) => d * 1.25]} />}
        <Tooltip
          cursor={{ fill: 'rgba(136,15,23,0.06)' }}
          content={<PbiTooltip fmts={{ [barKey]: barFmt, [lineKey]: lineFmt }} />}
        />
        <Bar yAxisId="l" dataKey={barKey} name={barName} maxBarSize={denso ? 22 : 54} radius={[4, 4, 0, 0]} isAnimationActive={false}>
          {data.map((d, i) => (
            <Cell key={i} fill={escalaGradiente(Number(d[barKey]) || 0, min, max)} />
          ))}
          {!denso && (
            <LabelList dataKey={barKey} content={(p) => <ChipLabel {...p} fmt={barFmt} posicao={rotuloBarra} />} />
          )}
        </Bar>
        {lineKey && (
          <Line
            yAxisId={escalaSecundaria ? 'r' : 'l'}
            type="linear"
            dataKey={lineKey}
            name={lineName}
            stroke={corLinha}
            strokeWidth={denso ? 2 : 2.5}
            isAnimationActive={false}
            dot={denso ? false : { r: 4, fill: corLinha, stroke: '#fff', strokeWidth: 1.5 }}
            activeDot={{ r: 6 }}
          >
            {!denso && (
              <LabelList
                dataKey={lineKey}
                content={(p) => <ChipLabel {...p} fmt={lineFmt} posicao="ponto" fill={corLinha} />}
              />
            )}
          </Line>
        )}
      </ComposedChart>
      )}
    </AutoSizer>
  );
}

/**
 * Barras horizontais (clusteredBarChart) com gradiente por valor.
 * `onSelect` reproduz o cross-filter do Power BI: clicar na barra filtra a página.
 */
export function BarrasHorizontais({
  data, keyLabel = 'key', keyValue = 'valor', nome = 'Total', fmt = int,
  larguraCategoria = 128, onSelect = null, selecionados = [],
}) {
  const valores = data.map((d) => Number(d[keyValue]) || 0);
  const min = Math.min(...valores, 0);
  const max = Math.max(...valores, 1);
  const temSelecao = selecionados.length > 0;
  // ocupa a altura disponível do card; só cresce (e rola) se as barras ficarem
  // abaixo do tamanho mínimo legível
  const alturaMinima = Math.max(data.length * 13 + 20, 120);
  return (
    <AutoSizer minHeight={140}>
      {({ w, h }) => {
      const alt = Math.max(h, alturaMinima);
      const barra = Math.max(7, Math.min(18, ((alt - 20) / Math.max(data.length, 1)) * 0.62));
      // o eixo tem largura fixa: rótulo que não cabe sai cortado em vez de
      // invadir a área das barras. O tooltip recebe o valor original, inteiro.
      const maxChars = Math.max(8, Math.floor((larguraCategoria - 8) / 5.6));
      const cortar = (v) => {
        const t = String(v ?? '');
        return t.length > maxChars ? `${t.slice(0, maxChars - 1)}…` : t;
      };
      return (
      <ComposedChart width={w} height={alt} data={data} layout="vertical" margin={{ top: 4, right: 54, bottom: 4, left: 4 }}>
        <CartesianGrid horizontal={false} stroke={CORES.grid} strokeDasharray="4 4" />
        <XAxis type="number" hide domain={[0, (d) => d * 1.12]} />
        <YAxis
          type="category"
          dataKey={keyLabel}
          width={larguraCategoria}
          tick={{ ...eixoTick, fontSize: 10.5 }}
          tickFormatter={cortar}
          axisLine={false}
          tickLine={false}
          interval={0}
        />
        <Tooltip cursor={{ fill: 'rgba(136,15,23,0.06)' }} content={<PbiTooltip fmts={{ [keyValue]: fmt }} />} />
        <Bar
          dataKey={keyValue}
          name={nome}
          barSize={barra}
          radius={[0, 4, 4, 0]}
          isAnimationActive={false}
          onClick={onSelect ? (d) => onSelect(d[keyLabel]) : undefined}
          cursor={onSelect ? 'pointer' : undefined}
        >
          {data.map((d, i) => (
            <Cell
              key={i}
              // uma barra marcada como `agrupado` é a soma de uma cauda, não uma
              // categoria: sai da escala de cor para não ser lida como par das outras
              fill={d.agrupado ? '#C8C6C4' : escalaGradiente(Number(d[keyValue]) || 0, min, max)}
              fillOpacity={temSelecao && !selecionados.includes(d[keyLabel]) ? 0.32 : 1}
            />
          ))}
          <LabelList dataKey={keyValue} content={(p) => <ChipLabel {...p} fmt={fmt} posicao="direita" fontSize={11} />} />
        </Bar>
      </ComposedChart>
      );
      }}
    </AutoSizer>
  );
}

/** Colunas empilhadas por tecnologia + rótulo de total (gráfico "por dia"). */
export function ColunasPorTecnologia({ data, fmt = int }) {
  const series = [
    { key: 'FIBRA', cor: CORES.goldSoft },
    { key: 'RÁDIO', cor: CORES.ink },
    { key: 'TELEFONIA', cor: CORES.orangeSoft },
  ];
  return (
    <AutoSizer>
      {({ w, h }) => (
      <ComposedChart width={w} height={h} data={data} margin={{ top: 24, right: 10, bottom: 2, left: 4 }}>
        <CartesianGrid vertical={false} stroke={CORES.grid} strokeDasharray="4 4" />
        <XAxis dataKey="label" tick={{ ...eixoTick, fontSize: 10 }} axisLine={false} tickLine={false} interval={0} />
        <YAxis hide domain={[0, (d) => d * 1.2]} />
        <Tooltip cursor={{ fill: 'rgba(136,15,23,0.06)' }} content={<PbiTooltip />} />
        {series.map((s, i) => (
          <Bar
            key={s.key}
            dataKey={s.key}
            name={s.key}
            stackId="t"
            fill={s.cor}
            maxBarSize={38}
            isAnimationActive={false}
            radius={i === series.length - 1 ? [4, 4, 0, 0] : 0}
            stroke="#fff"
            strokeWidth={1}
          >
            {i === series.length - 1 && (
              <LabelList dataKey="total" content={(p) => <ChipLabel {...p} fmt={fmt} posicao="acima" fontSize={10.5} />} />
            )}
          </Bar>
        ))}
      </ComposedChart>
      )}
    </AutoSizer>
  );
}

/**
 * Cores de ESTADO do funil de CRM. É polaridade, não identidade: cada rótulo tem
 * um significado fixo (ganhou / perdeu / está aberto), então a cor é reservada e
 * nunca reaproveitada como "série 4". Ganho verde e Perda vermelha são as duas
 * que a pessoa lê sem legenda; o resto fica na escala da marca.
 */
export const COR_STATUS = {
  Ganho: CORES.green,
  Perda: '#b3261e',
  'Em Andamento': CORES.gold,
  Qualificado: CORES.goldSoft,
  Disponível: CORES.orange,
  Descartado: CORES.muted,
  Outros: '#C8C6C4',
};

/**
 * Paleta para dimensões sem significado fixo (origem do lead, forma de contato).
 * Ordem FIXA e curta de propósito: a identidade é atribuída pela posição na lista
 * de séries, que o servidor devolve estável, e não pelo ranking do filtro atual —
 * se as cores trocassem quando um filtro muda o ranking, o usuário que memorizou
 * "amarelo é PAP" leria o gráfico errado. Acima de 6 séries o servidor dobra a
 * cauda em "Outros", que sai sempre no cinza neutro.
 */
export const PALETA_CATEGORIAS = [
  CORES.gold, CORES.orange, CORES.primary, CORES.goldSoft, CORES.ink, CORES.orangeSoft,
];

/** "Outros" é a soma de uma cauda, não uma categoria: sai da paleta, vai no cinza. */
export const corDaCategoria = (nome, i) => (
  nome === 'Outros' || String(nome).startsWith('Outros (')
    ? '#C8C6C4'
    : PALETA_CATEGORIAS[i % PALETA_CATEGORIAS.length]
);

/**
 * Colunas empilhadas por mês com N séries e rótulo de total no topo.
 *
 * O relatório de Leads usa colunas AGRUPADAS com a dimensão em "Series". Com sete
 * estados de lead (ou uma dúzia de origens) isso vira sete barras finas por mês,
 * ilegíveis, e esconde o total — que é o número que a pessoa procura primeiro.
 * Empilhado mostra os dois: a composição e a altura total.
 */
export function ColunasEmpilhadas({
  data, series, cores, fmt = int, mostrarTotal = true, xKey = 'label',
}) {
  const denso = data.length > 16;
  return (
    <AutoSizer>
      {({ w, h }) => (
        <ComposedChart width={w} height={h} data={data} margin={{ top: mostrarTotal ? 24 : 10, right: 12, bottom: 2, left: 4 }}>
          <CartesianGrid vertical={false} stroke={CORES.grid} strokeDasharray="4 4" />
          <XAxis
            dataKey={xKey}
            tick={{ ...eixoTick, fontSize: denso ? 9.5 : 11 }}
            axisLine={false}
            tickLine={false}
            interval={denso ? Math.ceil(data.length / 18) : 0}
            angle={denso ? -35 : 0}
            textAnchor={denso ? 'end' : 'middle'}
            height={denso ? 40 : 22}
          />
          <YAxis hide domain={[0, (d) => d * 1.18]} />
          <Tooltip cursor={{ fill: 'rgba(136,15,23,0.06)' }} content={<PbiTooltip />} />
          {series.map((s, i) => (
            <Bar
              key={s}
              dataKey={s}
              name={s}
              stackId="e"
              fill={cores ? cores(s, i) : corDaCategoria(s, i)}
              maxBarSize={44}
              isAnimationActive={false}
              radius={i === series.length - 1 ? [4, 4, 0, 0] : 0}
              // 2px de folga entre segmentos, como manda o padrão da marca
              stroke="#fff"
              strokeWidth={1}
            >
              {mostrarTotal && i === series.length - 1 && !denso && (
                <LabelList dataKey="total" content={(p) => <ChipLabel {...p} fmt={fmt} posicao="acima" fontSize={10.5} />} />
              )}
            </Bar>
          ))}
        </ComposedChart>
      )}
    </AutoSizer>
  );
}

/** Área com as 3 séries do resumo da diretoria + linha de tendência. */
export function AreaResumo({ data, series, tendencia = true, denso = false }) {
  const dados = data.map((d) => ({ ...d, __total: series.reduce((a, s) => a + (Number(d[s.key]) || 0), 0) }));
  let comTendencia = dados;
  if (tendencia && dados.length > 1) {
    const n = dados.length;
    const sx = (n - 1) * n / 2;
    const sy = dados.reduce((a, d) => a + d.__total, 0);
    const sxy = dados.reduce((a, d, i) => a + i * d.__total, 0);
    const sxx = dados.reduce((a, _, i) => a + i * i, 0);
    const b = (n * sxy - sx * sy) / (n * sxx - sx * sx || 1);
    const a0 = (sy - b * sx) / n;
    comTendencia = dados.map((d, i) => ({ ...d, __trend: Math.max(0, a0 + b * i) }));
  }
  return (
    <AutoSizer>
      {({ w, h }) => (
      <ComposedChart width={w} height={h} data={comTendencia} margin={{ top: 28, right: 18, bottom: 4, left: 6 }}>
        <defs>
          {series.map((s) => (
            <linearGradient key={s.key} id={`g-${s.key}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={s.cor} stopOpacity={0.55} />
              <stop offset="100%" stopColor={s.cor} stopOpacity={0.08} />
            </linearGradient>
          ))}
        </defs>
        <CartesianGrid vertical={false} stroke={CORES.grid} strokeDasharray="4 4" />
        <XAxis
          dataKey="label"
          tick={{ ...eixoTick, fontSize: denso ? 9.5 : 12 }}
          axisLine={false}
          tickLine={false}
          interval={denso ? Math.ceil(data.length / 22) : 0}
          angle={denso ? -35 : 0}
          textAnchor={denso ? 'end' : 'middle'}
          height={denso ? 42 : 22}
        />
        <YAxis hide domain={[0, (d) => d * 1.15]} />
        <Tooltip cursor={{ stroke: CORES.primary, strokeWidth: 1, strokeDasharray: '4 4' }} content={<PbiTooltip />} />
        {series.map((s) => (
          <Area
            key={s.key}
            type="monotone"
            dataKey={s.key}
            name={s.nome}
            stroke={s.cor}
            strokeWidth={2.5}
            fill={`url(#g-${s.key})`}
            isAnimationActive={false}
            dot={denso ? false : { r: 3.5, fill: s.cor, stroke: '#fff', strokeWidth: 1.5 }}
            activeDot={{ r: 6 }}
          >
            {!denso && (
              <LabelList dataKey={s.key} content={(p) => <ChipLabel {...p} posicao="ponto" fill={s.cor} fontSize={11} />} />
            )}
          </Area>
        ))}
        {tendencia && (
          <Line
            type="linear"
            dataKey="__trend"
            name="Tendência"
            stroke={CORES.goldSoft}
            strokeWidth={2}
            strokeDasharray="6 5"
            dot={false}
            isAnimationActive={false}
            legendType="none"
          />
        )}
      </ComposedChart>
      )}
    </AutoSizer>
  );
}

/** Sparkline usada nas tabelas por vendedor. */
export function Sparkline({ pontos = [], cor = CORES.gold, largura = 110, altura = 26 }) {
  if (!pontos.length) return <span style={{ color: '#A19F9D' }}>—</span>;
  const vals = pontos.map((p) => p.v);
  const max = Math.max(...vals, 1);
  const min = Math.min(...vals, 0);
  const dx = pontos.length > 1 ? largura / (pontos.length - 1) : 0;
  const y = (v) => altura - 3 - ((v - min) / (max - min || 1)) * (altura - 8);
  const d = pontos.map((p, i) => `${i ? 'L' : 'M'}${(i * dx).toFixed(1)},${y(p.v).toFixed(1)}`).join(' ');
  const area = `${d} L${largura},${altura} L0,${altura} Z`;
  return (
    <svg width={largura} height={altura} style={{ display: 'block' }}>
      <path d={area} fill={cor} opacity={0.18} />
      <path d={d} fill="none" stroke={cor} strokeWidth={1.8} strokeLinejoin="round" />
      <circle cx={(pontos.length - 1) * dx} cy={y(vals[vals.length - 1])} r={2.6} fill={CORES.primary} />
    </svg>
  );
}

export const fmtBRL = brl;
export const fmtDec1 = dec1;
