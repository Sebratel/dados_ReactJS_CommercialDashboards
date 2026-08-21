/**
 * Réplica em memória do modelo do Power BI "COM - Leads & Negociações".
 *
 * Terceiro modelo do servidor, ao lado do comercial (`store.js`) e do de
 * condomínios (`condominios.js`), pelo mesmo motivo dos outros dois: o grão é
 * diferente. Aqui são duas tabelas de fatos — LEADS (uma linha por pessoa no CRM)
 * e NEGOCIAÇÕES (uma linha por etapa de venda) — ligadas por `lead_id`.
 *
 * Fontes (as duas do Voalle/PostgreSQL, nenhuma conexão nova):
 *   leads       -> sql/leads.sql
 *   negociacoes -> sql/negotiations.sql
 *
 * A dimensão de EQUIPE vem do MariaDB `Comercial_Teams`, que o modelo comercial
 * já carrega a cada 15 minutos. No `.pbip` ela vem de uma planilha do Google com
 * as mesmas quatro colunas (VENDEDORES / SITUAÇÃO / EQUIPES / ATIVO). Reusar o
 * que já está em memória evita uma dependência nova e — mais importante — mantém
 * UMA definição de "equipe do vendedor" no dashboard: se cada tela usasse a sua,
 * o mesmo vendedor apareceria em equipes diferentes em telas vizinhas.
 * `conferirEquipes()` mede a divergência entre as duas origens.
 *
 * O que no Power BI eram colunas e medidas DAX vira código aqui:
 *   'Dono do Lead Final'        -> donoDoLead()
 *   'Tempo Vida Lead Formatado' -> tempoDeVidaMin + duracaoTexto()
 *   'Duracao Total Formatada'   -> duracaoMin + duracaoTexto()
 *   dVendedores                 -> estado.vendedores
 */
import { diffDays, monthKey, toIso, today } from './dates.js';
import { getState } from './store.js';

/**
 * Os sete estados de `classificacao_lead`, na ordem em que o relatório mostra os
 * cartões — que é a ordem do funil, não a alfabética.
 */
export const STATUS_LEAD = [
  'Disponível', 'Qualificado', 'Em Andamento', 'Ganho', 'Perda', 'Descartado', 'Outros',
];

export const STATUS_NEGOCIACAO = ['Ganho', 'Perda', 'Em Andamento'];

const estado = {
  raw: { leads: [], negociacoes: [] },
  fontes: {},
  leads: [],
  negociacoes: [],
  negociacoesPorLead: new Map(),
  vendedores: [],       // dVendedores: [{ vendedor, equipe, situacao, ativo }]
  equipePorVendedor: new Map(),
  dims: {
    vendedores: [], equipes: [], status: [], cidades: [], origens: [],
    formas: [], motivos: [], times: [],
  },
  versao: 0,
  geradoEm: null,
  buildMs: null,
};

export const getEstadoLeads = () => estado;
export const leadsPronto = () => estado.leads.length > 0;

export function setFonteLeads(nome, rows, meta = {}) {
  estado.raw[nome] = rows;
  estado.fontes[nome] = {
    updatedAt: new Date().toISOString(),
    rows: rows.length,
    ms: meta.ms ?? null,
    error: null,
  };
}

export function setFonteErroLeads(nome, err) {
  estado.fontes[nome] = {
    ...(estado.fontes[nome] || {}),
    error: String(err && err.message ? err.message : err),
    failedAt: new Date().toISOString(),
  };
}

const norm = (s) => (s == null ? '' : String(s).trim());
const num = (v) => (v === null || v === undefined || v === '' ? 0 : Number(v) || 0);
/** Comparação de rótulo à moda do DAX: sem diferenciar caixa nem acento sobrando. */
const mesmo = (a, b) => norm(a).toLowerCase() === norm(b).toLowerCase();

/** Timestamp completo (não só a data) — o tempo de vida do lead conta minutos. */
const paraData = (v) => {
  if (!v) return null;
  const d = v instanceof Date ? v : new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
};

/**
 * Réplica da coluna DAX 'Dono do Lead Final': o proprietário da venda quando
 * existe, senão quem cadastrou. É por este campo que o relatório atribui o lead a
 * um vendedor — e é a relação ATIVA com dVendedores. As negociações têm o seu
 * próprio responsável, ligado por uma relação inativa que as medidas ativam com
 * USERELATIONSHIP; por isso os dois nunca se misturam aqui.
 */
export function donoDoLead(proprietarioVenda, criadoPor) {
  const p = norm(proprietarioVenda);
  return p || norm(criadoPor);
}

/**
 * Réplica do SWITCH que formata duração nas três colunas/medidas de tempo do
 * relatório ('Tempo Vida Lead Formatado', 'Duracao Total Formatada',
 * 'Média Duração por Vendedor'). Mesmos limites e mesmos textos.
 */
export function duracaoTexto(minutos, vazio = '---') {
  if (minutos === null || minutos === undefined || Number.isNaN(minutos)) return vazio;
  if (minutos < 0) return 'Erro de Data';
  const total = Math.round(minutos);
  const dias = Math.floor(total / 1440);
  const resto = total % 1440;
  const horas = Math.floor(resto / 60);
  const min = resto % 60;
  if (dias === 0 && horas === 0) return `${min} min`;
  if (dias === 0) return `${horas}h ${min}min`;
  return `${dias === 1 ? '1 dia, ' : `${dias} dias, `}${horas}h ${min}min`;
}

const unico = (arr) => [...new Set(arr.filter(Boolean))].sort((a, b) => a.localeCompare(b, 'pt-BR'));

/** Reconstrói os dois conjuntos de fatos a partir das fontes carregadas. */
export function construirLeads() {
  const iniciou = Date.now();

  // ---- equipe do vendedor, do MariaDB que o modelo comercial já carrega ----
  // Lê a fonte CRUA (`raw.teams`), e não o `teamsByName` derivado, de propósito:
  // o derivado só existe depois de `build()`, que roda com 250ms de atraso, então
  // depender dele deixava a primeira montagem dos leads sem equipe nenhuma
  // dependendo de quem terminasse primeiro. `raw.teams` é preenchido de forma
  // síncrona pela carga, então esta função não tem mais ordem para respeitar.
  const equipePorVendedor = new Map();
  for (const t of getState().raw?.teams || []) {
    const nome = norm(t.vendedores);
    if (!nome) continue;
    equipePorVendedor.set(nome.toUpperCase(), {
      equipe: norm(t.equipes),
      situacao: norm(t.situacao),
      ativo: norm(t.ativo).toUpperCase() === 'TRUE',
    });
  }

  // ---- negociações --------------------------------------------------------
  const negociacoes = [];
  const negociacoesPorLead = new Map();
  for (const r of estado.raw.negociacoes) {
    const inicio = paraData(r.data_inicio_negociacao);
    const fim = paraData(r.data_fim_negociacao);
    const criacao = paraData(r.data_criacao_negociacao);
    const n = {
      negociacaoId: Number(r.negociacao_id),
      leadId: r.lead_id == null ? null : Number(r.lead_id),
      nome: norm(r.nome),
      campanha: norm(r.campanha),
      origem: norm(r.origem),
      responsavel: norm(r.responsavel),
      motivo: norm(r.motivo),
      status: norm(r.status_negociacao),
      faseFunil: norm(r.fase_funil),
      probabilidade: num(r.probabilidade_venda),
      regiao: norm(r.regiao),
      contrato: norm(r.contrato),
      tipoContrato: norm(r.tipo_contrato),
      titulo: norm(r.titulo_negociacao),
      time: norm(r.time_descricao),
      forma: norm(r.forma),
      servico: norm(r.servico),
      valor: num(r.valor_servico),
      protocolo: norm(r.protocolo),
      deletado: r.deletado === true,
      dtCriacao: criacao ? criacao.toISOString() : null,
      dtProvavelFechamento: toIso(r.data_provavel_fechamento),
      dtInicio: inicio ? inicio.toISOString() : null,
      dtFim: fim ? fim.toISOString() : null,
      // duração em minutos, como o DATEDIFF(..., MINUTE) do DAX
      duracaoMin: inicio && fim ? Math.round((fim - inicio) / 60000) : null,
    };
    negociacoes.push(n);
    if (n.leadId != null) {
      if (!negociacoesPorLead.has(n.leadId)) negociacoesPorLead.set(n.leadId, []);
      negociacoesPorLead.get(n.leadId).push(n);
    }
  }

  // ---- leads --------------------------------------------------------------
  const leads = [];
  for (const r of estado.raw.leads) {
    const leadId = Number(r.lead_id);
    const cadastro = paraData(r.data_cadastro_lead);
    const descarte = paraData(r.data_descarte);
    const dono = donoDoLead(r.proprietario_venda, r.criado_por);
    const doTime = equipePorVendedor.get(dono.toUpperCase());

    const negs = negociacoesPorLead.get(leadId) || [];
    // 'Tempo Vida Lead Formatado': fim da última negociação; sem negociação
    // encerrada, a data de descarte. Lead vivo e nunca descartado fica em branco,
    // igual ao "---" do relatório.
    let fimNegociacao = null;
    for (const n of negs) {
      if (n.dtFim && (!fimNegociacao || n.dtFim > fimNegociacao)) fimNegociacao = n.dtFim;
    }
    const dataFinal = fimNegociacao ? new Date(fimNegociacao) : descarte;

    leads.push({
      leadId,
      nome: norm(r.nome),
      tipoDocumento: norm(r.tipo_documento),
      cpfCnpj: norm(r.cpf_cnpj),
      genero: norm(r.genero),
      email: norm(r.email),
      dtNascimento: toIso(r.data_nascimento),
      dtCadastro: cadastro ? cadastro.toISOString() : null,
      diaCadastro: cadastro ? toIso(cadastro) : null,   // eixo do filtro de período
      dtModificacao: r.data_modificacao ? paraData(r.data_modificacao)?.toISOString() || null : null,
      dtDescarte: descarte ? descarte.toISOString() : null,
      criadoPor: norm(r.criado_por),
      modificadoPor: norm(r.modificado_por),
      telefone: norm(r.telefone),
      celular: norm(r.celular),
      proprietarioVenda: norm(r.proprietario_venda),
      dono,
      equipe: doTime?.equipe || '',
      situacaoEquipe: doTime?.situacao || '',
      origem: norm(r.origem_lead),
      forma: norm(r.origem_lead_form),
      dtProvavelVenda: toIso(r.data_provavel_venda),
      motivo: norm(r.motivo_oportunidade),
      protocolo: norm(r.protocolo),
      time: norm(r.time_proprietario),
      lat: norm(r.lat),
      lng: norm(r.lng),
      cep: norm(r.postal_code),
      rua: norm(r.street),
      numero: norm(r.number),
      bairro: norm(r.neighborhood),
      cidade: norm(r.city),
      situacao: norm(r.situacao),
      deletado: norm(r.deletado),
      status: norm(r.classificacao_lead),
      negociacoes: negs.length,
      tempoDeVidaMin: cadastro && dataFinal ? Math.round((dataFinal - cadastro) / 60000) : null,
    });
  }

  // ---- dVendedores: união dos dois lados, como a tabela calculada do DAX ---
  const nomes = unico([
    ...leads.map((l) => l.dono),
    ...negociacoes.map((n) => n.responsavel),
  ]);
  const vendedores = nomes.map((v) => {
    const t = equipePorVendedor.get(v.toUpperCase());
    return { vendedor: v, equipe: t?.equipe || '', situacao: t?.situacao || '', ativo: t?.ativo ?? null };
  });

  estado.leads = leads;
  estado.negociacoes = negociacoes;
  estado.negociacoesPorLead = negociacoesPorLead;
  estado.vendedores = vendedores;
  estado.equipePorVendedor = equipePorVendedor;
  estado.dims = {
    vendedores: nomes,
    equipes: unico(vendedores.map((v) => v.equipe)),
    status: STATUS_LEAD.filter((s) => leads.some((l) => mesmo(l.status, s))),
    cidades: unico(leads.map((l) => l.cidade)),
    origens: unico(leads.map((l) => l.origem)),
    formas: unico(leads.map((l) => l.forma)),
    motivos: unico(leads.map((l) => l.motivo)),
    times: unico(leads.map((l) => l.time)),
  };
  estado.versao += 1;
  estado.geradoEm = new Date().toISOString();
  estado.buildMs = Date.now() - iniciou;
  return estado;
}

/**
 * Quanto a planilha do Google (origem do `.pbip`) e o MariaDB divergem.
 *
 * Não dá para comparar com a planilha daqui — o que esta função mede é o outro
 * lado do problema: quantos vendedores que aparecem nos leads e nas negociações
 * o MariaDB não conhece. É o número que diz se reusar `Comercial_Teams` custou
 * alguma coisa, e ele aparece na tela de Configurações em vez de ficar só aqui.
 */
export function conferirEquipes() {
  const semEquipe = estado.vendedores.filter((v) => !v.equipe).map((v) => v.vendedor);
  return {
    vendedores: estado.vendedores.length,
    comEquipe: estado.vendedores.length - semEquipe.length,
    semEquipe: semEquipe.length,
    exemplos: semEquipe.slice(0, 20),
  };
}

// --------------------------------------------------------------- FILTROS

const lista = (v) => {
  if (v === undefined || v === null || v === '') return null;
  const arr = (Array.isArray(v) ? v : String(v).split(',')).map((s) => String(s).trim()).filter(Boolean);
  return arr.length ? arr : null;
};

/**
 * Filtros da tela. Prefixo `l` na query pelo mesmo motivo do `cidadeCond` de
 * condomínios: `cidade`, `equipe` e `vendedor` já existem no lado comercial com
 * listas de valores diferentes (lá o vendedor é quem fechou o contrato, aqui é o
 * dono do lead), e como os filtros vivem na URL, o mesmo nome faria uma tela
 * herdar da outra um valor que não existe na sua lista.
 *
 * O período é a DATA DE CADASTRO DO LEAD: é a única data ligada ao Calendario no
 * modelo de origem (`Calendario[Date] -> leads[data_cadastro_lead]`), então é ela
 * que o slicer de lá filtra.
 */
export function parseFiltrosLeads(q = {}) {
  return {
    de: q.lde || null,
    ate: q.late || null,
    vendedor: lista(q.lvend),
    equipe: lista(q.lequipe),
    status: lista(q.lstatus),
    cidade: lista(q.lcidade),
    origem: lista(q.lorigem),
    forma: lista(q.lforma),
    busca: q.lbusca ? String(q.lbusca).trim().toUpperCase() : null,
  };
}

function combina(l, flt) {
  if (flt.de && (!l.diaCadastro || l.diaCadastro < flt.de)) return false;
  if (flt.ate && (!l.diaCadastro || l.diaCadastro > flt.ate)) return false;
  if (flt.vendedor && !flt.vendedor.includes(l.dono)) return false;
  if (flt.equipe && !flt.equipe.includes(l.equipe)) return false;
  if (flt.status && !flt.status.some((s) => mesmo(s, l.status))) return false;
  if (flt.cidade && !flt.cidade.includes(l.cidade)) return false;
  if (flt.origem && !flt.origem.includes(l.origem)) return false;
  if (flt.forma && !flt.forma.includes(l.forma)) return false;
  if (flt.busca) {
    const alvo = `${l.nome} ${l.cpfCnpj} ${l.email} ${l.celular} ${l.telefone} ${l.protocolo}`.toUpperCase();
    if (!alvo.includes(flt.busca)) return false;
  }
  return true;
}

export function linhasLeads(flt) {
  return estado.leads.filter((l) => combina(l, flt));
}

/**
 * Negociações dos leads que sobraram no filtro.
 *
 * ATENÇÃO ao usar isto na página de NEGOCIAÇÕES: são duas perguntas diferentes.
 * Aqui a base são os LEADS, então uma negociação de lead cadastrado antes do
 * recorte fica de fora — e são muitas: medido no banco, 6.694 negociações de
 * 5.660 leads antigos, 21% do total. Para a página de Negociações a base tem de
 * ser a data da NEGOCIAÇÃO, senão um em cada cinco desaparece do cartão.
 */
export function negociacoesDosLeads(leads) {
  const ids = new Set(leads.map((l) => l.leadId));
  return estado.negociacoes.filter((n) => n.leadId != null && ids.has(n.leadId));
}

export function filtrosLeads() {
  let min = null;
  let max = null;
  for (const l of estado.leads) {
    if (!l.diaCadastro) continue;
    if (!min || l.diaCadastro < min) min = l.diaCadastro;
    if (!max || l.diaCadastro > max) max = l.diaCadastro;
  }
  return { ...estado.dims, periodo: { min, max, hoje: today() } };
}

// ---------------------------------------------------------------- MEDIDAS

/** DISTINCTCOUNT(leads[lead_id]) — "Leads" / "Total Leads". */
const totalLeads = (leads) => new Set(leads.map((l) => l.leadId)).size;

/**
 * Contagem por estado. O relatório usa DISTINCTCOUNT com igualdade de texto, e a
 * comparação do DAX ignora caixa — o que salva a medida `Leads_Em_Andamento`, que
 * filtra "Em andamento" enquanto a consulta produz "Em Andamento". Em JavaScript
 * essa diferença mataria o cartão em silêncio, então aqui a comparação é
 * normalizada de propósito.
 */
function porStatus(leads) {
  const mapa = new Map(STATUS_LEAD.map((s) => [s, new Set()]));
  for (const l of leads) {
    for (const s of STATUS_LEAD) {
      if (mesmo(l.status, s)) { mapa.get(s).add(l.leadId); break; }
    }
  }
  const out = {};
  for (const [s, set] of mapa) out[s] = set.size;
  return out;
}

/**
 * Agrupamento com participação no total — a terceira coluna das seis tabelinhas
 * do relatório, que lá é `Divide(CountNonNull(lead_id), ScopedEval(..., []))`.
 */
function agruparComPct(leads, chaveFn, { limite = null, rotuloVazio = '(sem informação)' } = {}) {
  const mapa = new Map();
  for (const l of leads) {
    const k = norm(chaveFn(l)) || rotuloVazio;
    if (!mapa.has(k)) mapa.set(k, new Set());
    mapa.get(k).add(l.leadId);
  }
  const total = totalLeads(leads) || 1;
  let out = [...mapa].map(([key, set]) => ({ key, leads: set.size, pct: set.size / total }));
  out.sort((a, b) => b.leads - a.leads || a.key.localeCompare(b.key, 'pt-BR'));
  if (limite && out.length > limite) {
    const topo = out.slice(0, limite);
    const cauda = out.slice(limite);
    const somaCauda = cauda.reduce((a, c) => a + c.leads, 0);
    topo.push({
      key: `Outros (${cauda.length} itens)`,
      leads: somaCauda,
      pct: somaCauda / total,
      agrupado: true,
    });
    out = topo;
  }
  return out;
}

/**
 * Série mensal empilhada por uma dimensão. O relatório usa colunas AGRUPADAS com
 * a dimensão em Series; com sete estados de lead (ou uma dúzia de origens) isso
 * vira sete barras finas por mês, ilegíveis. Aqui empilha: mesma informação, mais
 * o total do mês, que agrupado não aparece.
 *
 * `limiteSeries` dobra a cauda numa série "Outros" — sem isso, uma origem nova
 * acrescenta uma cor ao gráfico toda semana.
 */
function serieMensalPor(leads, chaveFn, { limiteSeries = 6, ordemFixa = null } = {}) {
  const totalPorChave = new Map();
  for (const l of leads) {
    const k = norm(chaveFn(l)) || '(sem informação)';
    totalPorChave.set(k, (totalPorChave.get(k) || 0) + 1);
  }
  let series;
  if (ordemFixa) {
    series = ordemFixa.filter((s) => totalPorChave.has(s));
  } else {
    series = [...totalPorChave].sort((a, b) => b[1] - a[1]).slice(0, limiteSeries).map(([k]) => k);
  }
  const conjunto = new Set(series);
  const temCauda = totalPorChave.size > conjunto.size;
  const meses = new Map();
  for (const l of leads) {
    const mes = monthKey(l.diaCadastro);
    if (!mes) continue;
    const bruto = norm(chaveFn(l)) || '(sem informação)';
    const k = conjunto.has(bruto) ? bruto : 'Outros';
    let linha = meses.get(mes);
    if (!linha) {
      linha = { periodo: mes, total: 0 };
      for (const s of series) linha[s] = 0;
      if (temCauda) linha.Outros = 0;
      meses.set(mes, linha);
    }
    linha[k] = (linha[k] || 0) + 1;
    linha.total += 1;
  }
  return {
    series: temCauda ? [...series, 'Outros'] : series,
    dados: [...meses.values()].sort((a, b) => a.periodo.localeCompare(b.periodo)),
  };
}

// ----------------------------------------------------------------- PAINEL

/** Amostras que vão para a tela; o CSV do cabeçalho traz o conjunto inteiro. */
const AMOSTRA_STATUS = 300;
const AMOSTRA_COMPLETO = 300;

export function painelLeads(flt) {
  const leads = linhasLeads(flt);
  const negs = negociacoesDosLeads(leads);
  const contagem = porStatus(leads);

  // Ordem do relatório: `leads[lead_id]` DESC nas duas tabelas grandes. O id é
  // serial, então na prática é o cadastro mais recente primeiro — mas quando dois
  // leads entram no mesmo segundo, é o id que decide, e é ele que a origem usa.
  const recentes = leads.slice().sort((a, b) => b.leadId - a.leadId);

  const semDono = leads.filter((l) => !l.dono).length;
  const comMotivo = leads.filter((l) => l.motivo);

  return {
    kpis: {
      total: totalLeads(leads),
      ...contagem,
      // 'Leads Trabalhados' do relatório: DISTINCTCOUNT(negotiations[lead_id])
      // dentro do contexto dos leads. É bem definido aqui — quantos DESTES leads
      // já têm negociação.
      trabalhados: new Set(negs.map((n) => n.leadId)).size,
    },
    // y=487 esquerda: a lista curta de status por lead
    statusPorLead: recentes.slice(0, AMOSTRA_STATUS).map((l) => ({
      __key: `s${l.leadId}`,
      leadId: l.leadId,
      nome: l.nome,
      dtCadastro: l.dtCadastro,
      status: l.status,
    })),
    // y=487 direita: colunas por mês x status
    serieStatus: serieMensalPor(leads, (l) => l.status, { ordemFixa: STATUS_LEAD }),
    // y=1124: o detalhamento completo
    completo: recentes.slice(0, AMOSTRA_COMPLETO).map((l) => ({
      __key: `c${l.leadId}`,
      leadId: l.leadId,
      nome: l.nome,
      dtCadastro: l.dtCadastro,
      status: l.status,
      tempoDeVida: duracaoTexto(l.tempoDeVidaMin),
      genero: l.genero,
      tipoDocumento: l.tipoDocumento,
      cpfCnpj: l.cpfCnpj,
      dtNascimento: l.dtNascimento,
      telefone: l.telefone,
      celular: l.celular,
      email: l.email,
      cep: l.cep,
      cidade: l.cidade,
      bairro: l.bairro,
      rua: l.rua,
      numero: l.numero,
      criadoPor: l.criadoPor,
      proprietarioVenda: l.proprietarioVenda,
      time: l.time,
      origem: l.origem,
      forma: l.forma,
      motivo: l.motivo,
      modificadoPor: l.modificadoPor,
      dtModificacao: l.dtModificacao,
      deletado: l.deletado,
    })),
    total: leads.length,
    // y=1764: origem, forma de contato e motivos
    serieOrigem: serieMensalPor(leads, (l) => l.origem),
    serieForma: serieMensalPor(leads, (l) => l.forma),
    // O relatório conta a COLUNA do motivo (CountNonNull) e divide pelo mesmo
    // CountNonNull no escopo inteiro — ou seja, a base é quem TEM motivo, e lead
    // sem motivo não aparece nem no numerador nem no denominador. As cinco
    // tabelinhas abaixo são diferentes: lá o contado é `lead_id`, e a base é o
    // total de leads. Usar a mesma base nas seis deixava este percentual menor
    // que o de lá em toda linha.
    porMotivo: agruparComPct(comMotivo, (l) => l.motivo, { limite: 12 }),
    leadsComMotivo: comMotivo.length,
    // y=2401: as cinco tabelinhas
    porCidade: agruparComPct(leads, (l) => l.cidade, { limite: 20, rotuloVazio: '(sem cidade)' }),
    porBairro: agruparComPct(leads, (l) => l.bairro, { limite: 20, rotuloVazio: '(sem bairro)' }),
    porRua: agruparComPct(leads, (l) => l.rua, { limite: 20, rotuloVazio: '(sem rua)' }),
    porGenero: agruparComPct(leads, (l) => l.genero, { rotuloVazio: '(não informado)' }),
    porTipoPessoa: agruparComPct(leads, (l) => l.tipoDocumento, { rotuloVazio: '(não informado)' }),
    // y=2971: matriz vendedor x status
    matrizVendedor: matrizVendedorStatus(leads),
    semDono,
  };
}

/** Matriz "Status de Lead por Vendedor": linhas = dono do lead, colunas = status. */
function matrizVendedorStatus(leads) {
  const colunas = STATUS_LEAD.filter((s) => leads.some((l) => mesmo(l.status, s)));
  const mapa = new Map();
  const totalPorColuna = {};
  let total = 0;
  for (const l of leads) {
    const dono = l.dono || '(sem dono)';
    let linha = mapa.get(dono);
    if (!linha) {
      linha = { vendedor: dono, equipe: l.equipe, total: 0 };
      for (const c of colunas) linha[c] = 0;
      mapa.set(dono, linha);
    }
    const col = colunas.find((c) => mesmo(c, l.status));
    if (col) {
      linha[col] += 1;
      totalPorColuna[col] = (totalPorColuna[col] || 0) + 1;
    }
    linha.total += 1;
    total += 1;
  }
  return {
    colunas,
    linhas: [...mapa.values()].sort((a, b) => b.total - a.total || a.vendedor.localeCompare(b.vendedor, 'pt-BR')),
    totalPorColuna,
    total,
  };
}
