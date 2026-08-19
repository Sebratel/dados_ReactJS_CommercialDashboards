/**
 * Exportação em CSV dos conjuntos completos (sem o corte que as telas aplicam).
 *
 * Formato pensado para abrir direto no Excel em português: separador ";",
 * BOM UTF-8 (senão os acentos quebram), decimal com vírgula e datas dd/mm/aaaa.
 */
import { getState } from './store.js';
import { parseFilters, premiacoes, rampagem, rows } from './measures.js';
import { diffDays, today } from './dates.js';
import { linhasCondominios, parseFiltrosCondominios, splittersCondominios } from './condominios.js';

const BOM = '﻿';

const dataBR = (iso) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : '');
const numBR = (v, casas = 2) => (v === null || v === undefined || v === '' ? '' : Number(v).toFixed(casas).replace('.', ','));
const inteiro = (v) => (v === null || v === undefined || v === '' ? '' : String(Math.round(Number(v))));

function celula(valor) {
  const s = valor === null || valor === undefined ? '' : String(valor);
  return /[";\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function paraCSV(colunas, linhas) {
  const cabecalho = colunas.map((c) => celula(c.titulo)).join(';');
  const corpo = linhas.map((l) => colunas.map((c) => celula(c.valor(l))).join(';'));
  return BOM + [cabecalho, ...corpo].join('\r\n') + '\r\n';
}

/** Campos comuns do contrato, reaproveitados pelos três conjuntos principais. */
const contrato = (extras = []) => [
  { titulo: 'CONTRATO', valor: (f) => f.contrato },
  { titulo: 'CLIENTE', valor: (f) => f.cliente },
  { titulo: 'VENDEDOR', valor: (f) => f.vendedor },
  { titulo: 'EQUIPE', valor: (f) => f.equipe },
  { titulo: 'SITUAÇÃO', valor: (f) => f.situacao },
  { titulo: 'CANAL', valor: (f) => f.canal },
  { titulo: 'TECNOLOGIA', valor: (f) => f.tecnologia },
  { titulo: 'CIDADE', valor: (f) => f.cidade },
  { titulo: 'REGIÃO DO VENDEDOR', valor: (f) => f.regiao },
  { titulo: 'VALOR', valor: (f) => numBR(f.valor) },
  ...extras,
  { titulo: 'DATA DA VENDA', valor: (f) => dataBR(f.dtVenda) },
  { titulo: 'DATA DA ATIVAÇÃO', valor: (f) => dataBR(f.dtAtiv) },
  { titulo: 'DATA DO 1º PAGAMENTO', valor: (f) => dataBR(f.dtPagto) },
  { titulo: 'STATUS DO CONTRATO', valor: (f) => f.statusContrato },
  { titulo: 'MOTIVO DE CANCELAMENTO', valor: (f) => f.statusCancelamento },
];

export const CONJUNTOS = {
  vendas: {
    titulo: 'Vendas (contratos criados)',
    descricao: 'Um registro por contrato criado no período, com a data de ativação e a do primeiro pagamento quando já existem.',
    tela: 'vendas',
    arquivo: 'vendas',
    colunas: () => contrato([{ titulo: 'HORA DA VENDA', valor: (f) => f.horaVenda || '' }]),
    linhas: (flt) => rows('vendas', flt).sort((a, b) => (b.dtVenda || '').localeCompare(a.dtVenda || '')),
  },
  ativacoes: {
    titulo: 'Ativações',
    descricao: 'Contratos com instalação concluída no período (fibra e rádio pela saída do equipamento, telefonia pelo relatório técnico).',
    tela: 'ativacoes',
    arquivo: 'ativacoes',
    colunas: () => contrato(),
    linhas: (flt) => rows('ativos', flt).sort((a, b) => (b.dtAtiv || '').localeCompare(a.dtAtiv || '')),
  },
  'primeiro-pagamento': {
    titulo: 'Primeiro pagamento',
    descricao: 'Clientes que pagaram a primeira fatura no período, com o plano contratado.',
    tela: 'primeiro-pagamento',
    arquivo: 'primeiro-pagamento',
    colunas: () => contrato([
      { titulo: 'PLANO', valor: (f) => f.plano },
      { titulo: 'VENCIMENTO', valor: (f) => dataBR(f.dtVencimento) },
    ]),
    linhas: (flt) => rows('pagantes', flt).sort((a, b) => (b.dtPagto || '').localeCompare(a.dtPagto || '')),
  },
  'vendas-canceladas': {
    titulo: 'Vendas canceladas',
    descricao: 'Contratos cancelados que nunca chegaram a ser ativados, com o motivo do cancelamento e o tipo de atendimento.',
    tela: 'vendas-canceladas',
    arquivo: 'vendas-canceladas',
    colunas: () => contrato([
      { titulo: 'TIPO SOLICITAÇÃO', valor: (f) => f.tipoSolicitacao || '' },
      { titulo: 'HORA DA VENDA', valor: (f) => f.horaVenda || '' },
    ]),
    linhas: (flt) => rows('vendas', flt)
      .filter((f) => f.statusContrato === 'Cancelado' && !f.dtAtiv && f.temTipoPadrao)
      .sort((a, b) => (b.dtVenda || '').localeCompare(a.dtVenda || '')),
  },
  'premiacoes-pagantes': {
    titulo: 'Premiações — mais de 60 dias',
    descricao: 'Faixa e valor de premiação por vendedor, calculados sobre os primeiros pagamentos do período.',
    tela: 'premiacoes',
    arquivo: 'premiacoes-mais-60-dias',
    colunas: () => [
      { titulo: 'VENDEDOR', valor: (r) => r.vendedor },
      { titulo: 'EQUIPE', valor: (r) => r.equipe },
      { titulo: 'SITUAÇÃO', valor: (r) => r.situacao },
      { titulo: 'PRIMEIROS PAGAMENTOS', valor: (r) => inteiro(r.qtd) },
      { titulo: 'FAIXA', valor: (r) => r.faixa },
      { titulo: 'VALOR DA FAIXA', valor: (r) => numBR(r.valorFaixa) },
      { titulo: 'TEMPO DE CASA', valor: (r) => numBR(r.valorTempoDeCasa) },
      { titulo: 'VALOR FINAL', valor: (r) => numBR(r.valorFinal) },
      { titulo: 'TEMPO DE CONTRATO', valor: (r) => r.tempoContrato },
      { titulo: 'ADMISSÃO (RH)', valor: (r) => dataBR(r.admissaoSenior) },
    ],
    linhas: (flt) => premiacoes(flt).pagantes,
  },
  'premiacoes-ativos': {
    titulo: 'Premiações — até 60 dias',
    descricao: 'Vendedores que ainda não viraram pagantes, premiados pelas ativações.',
    tela: 'premiacoes',
    arquivo: 'premiacoes-ate-60-dias',
    colunas: () => [
      { titulo: 'VENDEDOR', valor: (r) => r.vendedor },
      { titulo: 'EQUIPE', valor: (r) => r.equipe },
      { titulo: 'SITUAÇÃO', valor: (r) => r.situacao },
      { titulo: 'ATIVAÇÕES', valor: (r) => inteiro(r.qtd) },
      { titulo: 'FAIXA', valor: (r) => r.faixa },
      { titulo: 'VALOR DA FAIXA', valor: (r) => numBR(r.valorFaixa) },
      { titulo: 'VIRA PAGANTE EM', valor: (r) => dataBR(r.mesVirada) },
      { titulo: 'TEMPO DE CONTRATO', valor: (r) => r.tempoContrato },
      { titulo: 'ADMISSÃO (RH)', valor: (r) => dataBR(r.admissaoSenior) },
    ],
    linhas: (flt) => premiacoes(flt).ativos,
  },
  rampagem: {
    titulo: 'Rampagem (novatos)',
    descricao: 'Desempenho dos vendedores dentro dos 90 primeiros dias de casa.',
    tela: 'rampagem',
    arquivo: 'rampagem',
    colunas: () => [
      { titulo: 'VENDEDOR', valor: (r) => r.vendedor },
      { titulo: 'EQUIPE', valor: (r) => r.equipe },
      { titulo: 'SITUAÇÃO', valor: (r) => r.situacao },
      { titulo: 'ADMISSÃO', valor: (r) => dataBR(r.admissaoReal) },
      { titulo: 'FIM DA RAMPAGEM', valor: (r) => dataBR(r.dataApos90) },
      { titulo: 'VENDAS EM 90 DIAS', valor: (r) => inteiro(r.vendas) },
      { titulo: 'MÉDIA DE VENDAS', valor: (r) => numBR(r.mediaVendas) },
      { titulo: 'ATIVAÇÕES EM 90 DIAS', valor: (r) => inteiro(r.ativos) },
      { titulo: 'MÉDIA DE ATIVAÇÕES', valor: (r) => numBR(r.mediaAtivos) },
      { titulo: 'DIAS CONTRATADO', valor: (r) => inteiro(r.diasContratado) },
      { titulo: 'DIAS TRABALHADOS', valor: (r) => numBR(r.diasTrabalhados, 1) },
    ],
    linhas: (flt) => rampagem(flt).tabela,
  },
  vendedores: {
    titulo: 'Resumo por vendedor',
    descricao: 'Vendas, ativações e primeiros pagamentos consolidados por vendedor no período.',
    tela: 'vendas',
    arquivo: 'resumo-por-vendedor',
    colunas: () => [
      { titulo: 'VENDEDOR', valor: (r) => r.vendedor },
      { titulo: 'EQUIPE', valor: (r) => r.equipe },
      { titulo: 'SITUAÇÃO', valor: (r) => r.situacao },
      { titulo: 'VENDAS', valor: (r) => inteiro(r.vendas) },
      { titulo: 'ATIVAÇÕES', valor: (r) => inteiro(r.ativacoes) },
      { titulo: '1º PAGAMENTOS', valor: (r) => inteiro(r.pagantes) },
      { titulo: 'VALOR VENDIDO', valor: (r) => numBR(r.valor) },
      { titulo: 'DIAS DE CASA', valor: (r) => inteiro(r.diasDeCasa) },
    ],
    linhas: (flt) => {
      const estado = getState();
      const mapa = new Map();
      const garante = (nome) => {
        if (!mapa.has(nome)) {
          const t = estado.teamsByName.get(nome);
          const s = estado.sellersByName.get(nome);
          mapa.set(nome, {
            vendedor: nome,
            equipe: t?.equipe || '',
            situacao: t?.situacao || '',
            vendas: 0,
            ativacoes: 0,
            pagantes: 0,
            valor: 0,
            diasDeCasa: s?.admissaoReal ? diffDays(s.admissaoReal, flt.ate || today()) : null,
          });
        }
        return mapa.get(nome);
      };
      for (const f of rows('vendas', flt)) {
        const r = garante(f.vendedor);
        r.vendas += 1;
        r.valor += Number(f.valor) || 0;
      }
      for (const f of rows('ativos', flt)) garante(f.vendedor).ativacoes += 1;
      for (const f of rows('pagantes', flt)) garante(f.vendedor).pagantes += 1;
      return [...mapa.values()].sort((a, b) => b.vendas - a.vendas);
    },
  },

  // ---------------------------------------------------------- condomínios
  // `escopo: 'condominios'` avisa às rotas que estes dois conjuntos leem os
  // filtros da tela de condomínios, não os comerciais. Sem essa marca eles
  // receberiam `de`/`ate` de vendas e exportariam o recorte errado calados.
  condominios: {
    titulo: 'Condomínios — portas dos splitters',
    descricao: 'Uma linha por porta de splitter de condomínio, com o cliente da porta quando existe e as coordenadas do splitter e do cliente.',
    tela: 'condominios',
    arquivo: 'condominios-portas',
    escopo: 'condominios',
    colunas: () => [
      { titulo: 'CONDOMÍNIO', valor: (f) => f.condominio },
      { titulo: 'SPLITTER', valor: (f) => f.splitter },
      { titulo: 'CÓDIGO DO SPLITTER', valor: (f) => f.splitterCodigo },
      { titulo: 'PORTA', valor: (f) => inteiro(f.porta) },
      { titulo: 'PORTA COM CLIENTE', valor: (f) => (f.temCliente ? 'Sim' : 'Não') },
      { titulo: 'USUÁRIO', valor: (f) => f.usuario },
      { titulo: 'CLIENTE', valor: (f) => f.cliente },
      { titulo: 'CONTRATO', valor: (f) => f.contrato },
      { titulo: 'DATA DE APROVAÇÃO', valor: (f) => dataBR(f.dataAprovacao) },
      { titulo: 'STATUS DO CONTRATO', valor: (f) => f.statusContrato },
      { titulo: 'CIDADE DO SPLITTER', valor: (f) => f.cidade },
      { titulo: 'CIDADE DO CLIENTE', valor: (f) => f.cidadeCliente },
      { titulo: 'RUA', valor: (f) => f.rua },
      { titulo: 'NÚMERO', valor: (f) => f.numero },
      { titulo: 'BAIRRO', valor: (f) => f.bairro },
      { titulo: 'PONTO DE ACESSO', valor: (f) => f.pontoAcesso },
      { titulo: 'CONCENTRADOR', valor: (f) => f.concentrador },
      { titulo: 'SITE', valor: (f) => f.site },
      { titulo: 'SPLITTER PRIMÁRIO', valor: (f) => f.primario },
      { titulo: 'SPLITTER CRIADO EM', valor: (f) => dataBR(f.criado) },
      { titulo: 'DIAS DE VIDA', valor: (f) => inteiro(f.diasDeVida) },
      { titulo: 'CAPACIDADE', valor: (f) => inteiro(f.capacidade) },
      { titulo: 'PORTAS OCUPADAS', valor: (f) => inteiro(f.ocupadas) },
      { titulo: 'PORTAS DISPONÍVEIS', valor: (f) => inteiro(f.disponiveis) },
      { titulo: 'OCUPAÇÃO (%)', valor: (f) => numBR(f.percentual * 100, 2) },
      { titulo: 'FAIXA', valor: (f) => f.classificacao },
      { titulo: 'PLACA', valor: (f) => inteiro(f.placa) },
      { titulo: 'PON', valor: (f) => inteiro(f.pon) },
      // as coordenadas saem aqui porque a tela não tem mapa: quem precisa da
      // localização joga o CSV no mapa que já usa
      { titulo: 'LATITUDE DO SPLITTER', valor: (f) => f.splitterLat },
      { titulo: 'LONGITUDE DO SPLITTER', valor: (f) => f.splitterLng },
      { titulo: 'LATITUDE DO CLIENTE', valor: (f) => f.clienteLat },
      { titulo: 'LONGITUDE DO CLIENTE', valor: (f) => f.clienteLng },
    ],
    linhas: (flt) => linhasCondominios(flt)
      .slice()
      .sort((a, b) => a.condominio.localeCompare(b.condominio, 'pt-BR')
        || a.splitter.localeCompare(b.splitter, 'pt-BR')
        || a.porta - b.porta),
  },
  'condominios-ocupacao': {
    titulo: 'Condomínios — ocupação por splitter',
    descricao: 'Uma linha por splitter de condomínio: capacidade, portas ocupadas, percentual, faixa e localização.',
    tela: 'condominios',
    arquivo: 'condominios-ocupacao',
    escopo: 'condominios',
    colunas: () => [
      { titulo: 'CONDOMÍNIO', valor: (s) => s.condominio },
      { titulo: 'SPLITTER', valor: (s) => s.splitter },
      { titulo: 'PONTO DE ACESSO', valor: (s) => s.pontoAcesso },
      { titulo: 'CONCENTRADOR', valor: (s) => s.concentrador },
      { titulo: 'SITE', valor: (s) => s.site },
      { titulo: 'CIDADE', valor: (s) => s.cidade },
      { titulo: 'CAPACIDADE', valor: (s) => inteiro(s.capacidade) },
      { titulo: 'PORTAS CADASTRADAS', valor: (s) => inteiro(s.portas) },
      { titulo: 'PORTAS OCUPADAS', valor: (s) => inteiro(s.ocupadas) },
      { titulo: 'PORTAS DISPONÍVEIS', valor: (s) => inteiro(s.disponiveis) },
      { titulo: 'CLIENTES', valor: (s) => inteiro(s.clientes) },
      { titulo: 'OCUPAÇÃO (%)', valor: (s) => numBR(s.percentual * 100, 2) },
      { titulo: 'FAIXA', valor: (s) => s.classificacao },
      { titulo: 'CRIADO EM', valor: (s) => dataBR(s.criado) },
      { titulo: 'DIAS DE VIDA', valor: (s) => inteiro(s.diasDeVida) },
      { titulo: 'LATITUDE', valor: (s) => s.lat },
      { titulo: 'LONGITUDE', valor: (s) => s.lng },
    ],
    linhas: (flt) => splittersCondominios(flt),
  },
};

/**
 * Cada conjunto lê os filtros da SUA tela. A tela de exportações manda a query
 * inteira e quem decide o que é filtro é o conjunto — se ela decidisse, um dia
 * alguém acrescentaria um conjunto novo e ele receberia `de`/`ate` de vendas
 * sem ninguém notar, exportando o recorte errado em silêncio.
 */
export function filtrosDoConjunto(conjunto, query = {}) {
  return conjunto?.escopo === 'condominios'
    ? parseFiltrosCondominios(query)
    : parseFilters(query);
}

export function listarConjuntos(usuarioPodeVer, query) {
  return Object.entries(CONJUNTOS)
    .filter(([, c]) => usuarioPodeVer(c.tela))
    .map(([id, c]) => {
      const flt = filtrosDoConjunto(c, query);
      const colunas = c.colunas();
      // a contagem já sai aqui: o usuário precisa saber o tamanho antes de baixar
      let linhas = null;
      try {
        linhas = c.linhas(flt).length;
      } catch { /* se falhar, a tela mostra a amostra sob demanda */ }
      return {
        id,
        titulo: c.titulo,
        descricao: c.descricao,
        tela: c.tela,
        linhas,
        colunas: colunas.length,
        campos: colunas.map((col) => col.titulo),
      };
    });
}

/** Primeiras linhas do conjunto, já formatadas como sairão no arquivo. */
export function gerarAmostra(id, flt, limite = 8) {
  const conjunto = CONJUNTOS[id];
  if (!conjunto) throw new Error(`Conjunto desconhecido: ${id}`);
  const lim = Math.min(Math.max(Number(limite) || 8, 1), 50);
  const colunas = conjunto.colunas();
  const todas = conjunto.linhas(flt);
  return {
    colunas: colunas.map((c) => c.titulo),
    linhas: todas.slice(0, lim).map((l) => colunas.map((c) => c.valor(l))),
    total: todas.length,
    exibindo: Math.min(lim, todas.length),
  };
}

export function gerarCSV(id, flt) {
  const conjunto = CONJUNTOS[id];
  if (!conjunto) throw new Error(`Conjunto desconhecido: ${id}`);
  const colunas = conjunto.colunas();
  const linhas = conjunto.linhas(flt);
  return {
    csv: paraCSV(colunas, linhas),
    linhas: linhas.length,
    arquivo: conjunto.arquivo,
  };
}
