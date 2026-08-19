import { useEffect, useMemo, useRef, useState } from 'react';
import { int } from '../format';
import { Icone } from './Icone';
import { BotaoInsights } from './InsightsIA';

/**
 * `ia` recebe o id do visual no catálogo do servidor (ex.: "vendas:serie") e
 * rende o botão de leitura por IA junto das demais ações do cabeçalho.
 */
export function Visual({
  title, sub, children, flush = false, style, actions, ia, className = 'v-grafico',
}) {
  return (
    <section className={`visual ${className}`} style={style}>
      {title && (
        <header>
          <span className="titulo">
            <span>{title}</span>
            {actions}
            {ia && <BotaoInsights visual={ia} titulo={title} />}
          </span>
          {sub && <span className="sub">{sub}</span>}
        </header>
      )}
      <div className={`body${flush ? ' flush' : ''}`}>{children}</div>
    </section>
  );
}

/** Controle segmentado usado nos cabeçalhos dos visuais (mês/dia, escala…). */
export function Segmentado({ valor, opcoes, onChange, titulo }) {
  return (
    <span className="seg" title={titulo}>
      {opcoes.map((o) => (
        <button
          key={o.id}
          type="button"
          className={valor === o.id ? 'on' : ''}
          onClick={() => onChange(o.id)}
        >
          {o.label}
        </button>
      ))}
    </span>
  );
}

/**
 * `desc` é opcional: uma linha dizendo o que o número mede. Vale para indicador
 * cujo nome não basta — "valor perdido" pode ser lido como prejuízo acumulado
 * quando é a soma de uma parcela mensal. Telas que não passam `desc` seguem iguais.
 */
export function Kpi({ value, label, small = false, desc = null, title = null }) {
  return (
    <div className="kpi" title={title || undefined}>
      <div className={`value${small ? ' sm' : ''}`}>{value}</div>
      <div className="label">{label}</div>
      {desc && <div className="desc">{desc}</div>}
    </div>
  );
}

export function KpiStack({ itens }) {
  return (
    <div className="kpi-stack">
      {itens.map((i) => (
        <Kpi key={i.label} value={i.value} label={i.label} small={i.small} />
      ))}
    </div>
  );
}

export function Loading({ texto = 'Carregando…' }) {
  return (
    <div className="loading">
      <div className="spinner" />
      <span>{texto}</span>
    </div>
  );
}

export function Vazio({ texto = 'Sem dados para os filtros selecionados' }) {
  return <div className="empty">{texto}</div>;
}

export function Erro({ erro }) {
  const msg = String(erro?.message || erro);
  return (
    <div className={`banner${erro?.status === 503 ? '' : ' error'}`}>
      <Icone nome={erro?.status === 503 ? 'relogio' : 'alerta'} tamanho={14} />
      {msg}
    </div>
  );
}

export function Legenda({ itens }) {
  return (
    <div className="legend">
      {itens.map((i) => (
        <span key={i.label}>
          <i style={{ background: i.cor, borderRadius: i.linha ? 8 : 2, height: i.linha ? 3 : 11 }} />
          {i.label}
        </span>
      ))}
    </div>
  );
}

/**
 * Botão de exportar no cabeçalho do visual: baixa exatamente o que está na
 * tabela (mesmas colunas, mesmos filtros) em CSV.
 */
export function BotaoExportar({ onExportar, titulo = 'Exportar em CSV', rotulo = 'CSV' }) {
  return (
    <button type="button" className="btn-exportar" onClick={onExportar} title={titulo}>
      <Icone nome="baixar" tamanho={13} />
      {rotulo}
    </button>
  );
}
