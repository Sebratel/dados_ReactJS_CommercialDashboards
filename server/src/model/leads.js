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

/**
 * A fonte de negociações carregou alguma vez?
 *
 * Olha o registro da FONTE, e não a contagem de linhas, porque as duas coisas são
 * diferentes: zero negociação pode ser a verdade de um filtro, e "a consulta
 * falhou" não pode virar zero na tela. Quando a fonte falhou na carga inicial — e
 * isso acontecia — a tela mostrava seis cartões zerados, que qualquer pessoa lê
 * como "não houve negociação nenhuma".
 */
export const negociacoesPronto = () => Boolean(estado.fontes.negociacoes?.updatedAt);
export const erroNegociacoes = () => estado.fontes.negociacoes?.error || null;

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
  const equipeDe = (nome) => equipePorVendedor.get(norm(nome).toUpperCase())?.equipe || '';
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
      // equipe do RESPONSÁVEL. No modelo de origem a relação com dVendedores que
      // está ativa é a do dono do LEAD, então lá a página de negociações filtra
      // equipe pelo dono do lead, não pelo responsável — o que faz o rótulo
      // "EQUIPE" ao lado de "VENDEDOR" significar duas pessoas diferentes na
      // mesma barra. Aqui os dois se referem à mesma pessoa.
      equipe: equipeDe(r.responsavel),
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

/**
 * Filtros da sub-página de NEGOCIAÇÕES.
 *
 * Base própria, e isso é o ponto central desta tela: o período é a data de
 * criação da NEGOCIAÇÃO (é a ela que o slicer DATA do relatório está ligado,
 * via `LocalDateTable` de `data_criacao_negociacao`), não a do cadastro do lead.
 * Medido no banco, 6.694 negociações — 21% do total — são de leads cadastrados
 * antes do recorte; filtrar pelo lead perderia uma em cada cinco.
 *
 * VENDEDOR aqui é o `responsavel` da negociação, enquanto na sub-página de Leads
 * é o dono do lead. São campos diferentes no modelo de origem (na verdade duas
 * relações com dVendedores, uma ativa e uma que as medidas ativam com
 * USERELATIONSHIP), e cada página usa o seu. A barra de filtros mostra o rótulo
 * certo para cada uma em vez de fingir que é o mesmo campo.
 */
export function parseFiltrosNegociacoes(q = {}) {
  return {
    de: q.nde || null,                    // criação da negociação
    ate: q.nate || null,
    responsavel: lista(q.nvend),
    equipe: lista(q.nequipe),
    status: lista(q.nstatus),
    fase: lista(q.nfase),
    tipoContrato: lista(q.ntipo),
    origem: lista(q.norigem),
    forma: lista(q.nforma),
    regiao: lista(q.nregiao),
    busca: q.nbusca ? String(q.nbusca).trim().toUpperCase() : null,
  };
}

function combinaNegociacao(n, flt) {
  const dia = n.dtCriacao ? n.dtCriacao.slice(0, 10) : null;
  if (flt.de && (!dia || dia < flt.de)) return false;
  if (flt.ate && (!dia || dia > flt.ate)) return false;
  if (flt.responsavel && !flt.responsavel.includes(n.responsavel)) return false;
  if (flt.equipe && !flt.equipe.includes(n.equipe)) return false;
  if (flt.status && !flt.status.some((x) => mesmo(x, n.status))) return false;
  if (flt.fase && !flt.fase.includes(n.faseFunil)) return false;
  if (flt.tipoContrato && !flt.tipoContrato.includes(n.tipoContrato)) return false;
  if (flt.origem && !flt.origem.includes(n.origem)) return false;
  if (flt.forma && !flt.forma.includes(n.forma)) return false;
  if (flt.regiao && !flt.regiao.includes(n.regiao)) return false;
  if (flt.busca) {
    const alvo = `${n.nome} ${n.titulo} ${n.contrato} ${n.protocolo}`.toUpperCase();
    if (!alvo.includes(flt.busca)) return false;
  }
  return true;
}

export function linhasNegociacoes(flt) {
  return estado.negociacoes.filter((n) => combinaNegociacao(n, flt));
}

/** Opções dos seletores da sub-página de negociações. */
export function filtrosNegociacoes() {
  let min = null;
  let max = null;
  for (const n of estado.negociacoes) {
    const dia = n.dtCriacao ? n.dtCriacao.slice(0, 10) : null;
    if (!dia) continue;
    if (!min || dia < min) min = dia;
    if (!max || dia > max) max = dia;
  }
  const de = (fn) => unico(estado.negociacoes.map(fn));
  return {
    responsaveis: de((n) => n.responsavel),
    equipes: de((n) => n.equipe),
    status: STATUS_NEGOCIACAO.filter((x) => estado.negociacoes.some((n) => mesmo(n.status, x))),
    fases: de((n) => n.faseFunil),
    tiposContrato: de((n) => n.tipoContrato),
    origens: de((n) => n.origem),
    formas: de((n) => n.forma),
    regioes: de((n) => n.regiao),
    times: de((n) => n.time),
    periodo: { min, max, hoje: today() },
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

// ------------------------------------------------- PAINEL DE NEGOCIAÇÕES

const AMOSTRA_NEGOCIACOES = 300;

/**
 * Uma linha da consulta de negociações NÃO é uma negociação.
 *
 * O `GROUP BY` da consulta de origem inclui `sp.title` e `ccsssp.unit_amount`,
 * então uma negociação com dois planos vira duas linhas. Medido no banco: 31.108
 * linhas para 30.714 negociações distintas — 394 a mais, 1,3%.
 *
 * É exatamente por isso que o relatório tem DUAS medidas que parecem redundantes:
 * `Medidas_old[Negociacoes]` é `DISTINCTCOUNT(negociacao_id)` e
 * `Medidas[Total Negociacoes]` é `COUNT(titulo_negociacao)`, ou seja, linhas. Os
 * cartões usam a distinta; as tabelas de dimensão, a de linhas.
 *
 * Aqui a contagem é sempre a DISTINTA, para a tabela não contradizer o cartão
 * logo acima dela. A exceção honesta é o valor: cada linha é um plano com o seu
 * `unit_amount`, então receita se soma por LINHA — somar por negociação perderia
 * o segundo plano.
 */
const contarDistintas = (negs) => new Set(negs.map((n) => n.negociacaoId)).size;

function agruparNegociacoes(negs, chaveFn, { limite = null, rotuloVazio = '(sem informação)' } = {}) {
  const mapa = new Map();
  for (const n of negs) {
    const k = norm(chaveFn(n)) || rotuloVazio;
    let cur = mapa.get(k);
    if (!cur) {
      cur = { key: k, ids: new Set(), idsGanhas: new Set(), valor: 0 };
      mapa.set(k, cur);
    }
    cur.ids.add(n.negociacaoId);
    cur.valor += n.valor;
    if (mesmo(n.status, 'Ganho')) cur.idsGanhas.add(n.negociacaoId);
  }
  const total = contarDistintas(negs) || 1;
  let out = [...mapa.values()].map((g) => ({
    key: g.key, qtd: g.ids.size, ganhas: g.idsGanhas.size, valor: g.valor, pct: g.ids.size / total,
  }));
  out.sort((a, b) => b.qtd - a.qtd || a.key.localeCompare(b.key, 'pt-BR'));
  if (limite && out.length > limite) {
    const cabeca = out.slice(0, limite);
    const cauda = out.slice(limite);
    const soma = cauda.reduce((a, c) => a + c.qtd, 0);
    cabeca.push({
      key: `Outros (${cauda.length} itens)`,
      qtd: soma,
      ganhas: cauda.reduce((a, c) => a + c.ganhas, 0),
      valor: cauda.reduce((a, c) => a + c.valor, 0),
      pct: soma / total,
      agrupado: true,
    });
    out = cabeca;
  }
  return out;
}

export function painelNegociacoes(flt) {
  const negs = linhasNegociacoes(flt);

  // Cada status conta negociações DISTINTAS, como as medidas de origem
  // (Negociacoes_Ganhas e companhia são todas DISTINCTCOUNT). Contando linhas, a
  // soma dos três estados passava do total e a tela se contradizia sozinha.
  const idsPorStatus = {};
  for (const s of STATUS_NEGOCIACAO) idsPorStatus[s] = new Set();
  let receita = 0;
  const leadsGanhos = new Set();
  const leadsComNegociacao = new Set();
  for (const n of negs) {
    const achado = STATUS_NEGOCIACAO.find((s) => mesmo(s, n.status));
    if (achado) idsPorStatus[achado].add(n.negociacaoId);
    if (n.leadId != null) leadsComNegociacao.add(n.leadId);
    if (mesmo(n.status, 'Ganho')) {
      // receita soma por LINHA: cada linha é um plano com o seu valor
      receita += n.valor;
      if (n.leadId != null) leadsGanhos.add(n.leadId);
    }
  }
  const contagem = {};
  for (const s of STATUS_NEGOCIACAO) contagem[s] = idsPorStatus[s].size;

  // y=355 esquerda: negociações por lead (o relatório agrupa por nome + lead_id)
  const porLeadMapa = new Map();
  for (const n of negs) {
    const chave = n.leadId != null ? `l${n.leadId}` : `t${n.titulo}`;
    let linha = porLeadMapa.get(chave);
    if (!linha) {
      linha = { __key: chave, leadId: n.leadId, nome: n.nome, total: 0, ids: new Set() };
      for (const s of STATUS_NEGOCIACAO) linha[s] = new Set();
      porLeadMapa.set(chave, linha);
    }
    const achado = STATUS_NEGOCIACAO.find((s) => mesmo(s, n.status));
    if (achado) linha[achado].add(n.negociacaoId);
    linha.ids.add(n.negociacaoId);
  }
  for (const linha of porLeadMapa.values()) {
    for (const s of STATUS_NEGOCIACAO) linha[s] = linha[s].size;
    linha.total = linha.ids.size;
    delete linha.ids;
  }
  const porLead = [...porLeadMapa.values()]
    .sort((a, b) => b.total - a.total || a.nome.localeCompare(b.nome, 'pt-BR'));

  // y=355 meio: status x motivo. O relatório conta LEADS aqui (CountNonNull do
  // lead_id), não negociações, e a base do percentual é o mesmo CountNonNull no
  // escopo inteiro — quem tem negociação, não o total de leads do CRM.
  const motivoMapa = new Map();
  for (const n of negs) {
    if (n.leadId == null) continue;
    const chave = `${n.status}||${n.motivo || '(sem motivo)'}`;
    let linha = motivoMapa.get(chave);
    if (!linha) {
      linha = { __key: chave, status: n.status, motivo: n.motivo || '(sem motivo)', leads: new Set() };
      motivoMapa.set(chave, linha);
    }
    linha.leads.add(n.leadId);
  }
  const baseMotivo = leadsComNegociacao.size || 1;
  const porMotivo = [...motivoMapa.values()]
    .map((l) => ({
      __key: l.__key, status: l.status, motivo: l.motivo,
      leads: l.leads.size, pct: l.leads.size / baseMotivo,
    }))
    .sort((a, b) => b.leads - a.leads || a.motivo.localeCompare(b.motivo, 'pt-BR'));

  // y=355 direita: status por mês de CRIAÇÃO da negociação
  const meses = new Map();
  for (const n of negs) {
    const mes = monthKey(n.dtCriacao ? n.dtCriacao.slice(0, 10) : null);
    if (!mes) continue;
    let linha = meses.get(mes);
    if (!linha) {
      linha = { periodo: mes, total: 0, ids: new Set() };
      for (const s of STATUS_NEGOCIACAO) linha[s] = new Set();
      meses.set(mes, linha);
    }
    const achado = STATUS_NEGOCIACAO.find((s) => mesmo(s, n.status));
    if (achado) linha[achado].add(n.negociacaoId);
    linha.ids.add(n.negociacaoId);
  }
  for (const linha of meses.values()) {
    for (const s of STATUS_NEGOCIACAO) linha[s] = linha[s].size;
    linha.total = linha.ids.size;
    delete linha.ids;
  }

  const recentes = negs.slice().sort((a, b) => b.negociacaoId - a.negociacaoId);

  return {
    kpis: {
      total: contarDistintas(negs),
      // linhas da consulta: uma negociação com dois planos aparece duas vezes.
      // Exposto para a tela poder explicar a diferença em vez de esconder.
      linhas: negs.length,
      Ganho: contagem.Ganho,
      Perda: contagem.Perda,
      'Em Andamento': contagem['Em Andamento'],
      // 'Receita Total' e 'Ticket Medio' de Medidas: só as ganhas entram, e o
      // ticket divide por LEADS ganhos, não por negociações ganhas
      receita,
      ticketMedio: leadsGanhos.size ? receita / leadsGanhos.size : 0,
      leadsGanhos: leadsGanhos.size,
      leadsComNegociacao: leadsComNegociacao.size,
    },
    porLead: porLead.slice(0, AMOSTRA_NEGOCIACOES),
    porLeadTotal: porLead.length,
    porMotivo,
    serieStatus: {
      series: STATUS_NEGOCIACAO.filter((s) => negs.some((n) => mesmo(n.status, s))),
      dados: [...meses.values()].sort((a, b) => a.periodo.localeCompare(b.periodo)),
    },
    // A chave leva o índice porque negociacao_id NÃO é único aqui: a negociação
    // com dois planos vem em duas linhas, e o React reclamou de chave duplicada
    // exatamente nessas — o mesmo fato que os dois contadores do relatório
    // escondiam.
    completo: recentes.slice(0, AMOSTRA_NEGOCIACOES).map((n, i) => ({
      __key: `n${n.negociacaoId}-${i}`,
      nome: n.nome,
      status: n.status,
      titulo: n.titulo,
      responsavel: n.responsavel,
      equipe: n.equipe,
      time: n.time,
      protocolo: n.protocolo,
      campanha: n.campanha,
      origem: n.origem,
      forma: n.forma,
      faseFunil: n.faseFunil,
      motivo: n.motivo,
      dtInicio: n.dtInicio,
      dtFim: n.dtFim,
      duracao: duracaoTexto(n.duracaoMin, 'N/A'),
      contrato: n.contrato,
      servico: n.servico,
      valor: n.valor,
    })),
    total: negs.length,
    // y=1669: as cinco tabelas
    porResponsavel: agruparNegociacoes(negs, (n) => n.responsavel, { limite: 30, rotuloVazio: '(sem responsável)' }),
    porFase: agruparNegociacoes(negs, (n) => n.faseFunil, { rotuloVazio: '(sem fase)' }),
    porOrigem: agruparNegociacoes(negs, (n) => n.origem, { limite: 15 }),
    porForma: agruparNegociacoes(negs, (n) => n.forma, { limite: 15 }),
    porRegiao: agruparNegociacoes(negs, (n) => n.regiao, { limite: 15, rotuloVazio: '(sem região)' }),
    // y=2322: as quatro tabelas
    porTime: agruparNegociacoes(negs, (n) => n.time, { limite: 15, rotuloVazio: '(sem time)' }),
    porTipoContrato: agruparNegociacoes(negs, (n) => n.tipoContrato, { limite: 20, rotuloVazio: '(sem contrato)' }),
    porServico: agruparNegociacoes(negs, (n) => n.servico, { limite: 20, rotuloVazio: '(sem plano)' }),
    porValorStatus: STATUS_NEGOCIACAO
      .map((s) => {
        const doStatus = negs.filter((n) => mesmo(n.status, s));
        const qtd = contarDistintas(doStatus);
        return {
          key: s,
          qtd,
          // valor por LINHA: cada plano da negociação entra com o seu
          valor: doStatus.reduce((a, n) => a + n.valor, 0),
          pct: qtd / (contarDistintas(negs) || 1),
        };
      })
      .filter((x) => x.qtd > 0)
      .sort((a, b) => b.qtd - a.qtd),
  };
}

// ------------------------------------------------- PAINEL DE DESEMPENHO

/**
 * As duas páginas de Desempenho do relatório — DO VENDEDOR e POR CIDADE — são a
 * MESMA tela com outra dimensão de linha. Mesmos sete slicers, mesmos seis
 * cartões, mesma matriz de produtividade, mesmos dois funis, mesmas oito tabelas
 * de perda. Então aqui é uma função só, com `por` escolhendo o agrupamento.
 *
 * O que muda de verdade é COMO cada lado é agrupado:
 *
 *   por = 'vendedor'  leads pelo DONO DO LEAD, negociações pelo RESPONSÁVEL.
 *                     É o que o relatório faz: `dVendedores` é a dimensão
 *                     compartilhada, ligada ao dono por relação ativa e ao
 *                     responsável por uma relação que as medidas ativam com
 *                     USERELATIONSHIP. Uma negociação conta para quem a conduziu,
 *                     mesmo que o lead tenha sido cadastrado por outra pessoa.
 *
 *   por = 'cidade'    leads pela CIDADE deles, negociações pela cidade do LEAD a
 *                     que pertencem. Negociação de lead fora do recorte não tem
 *                     cidade e fica de fora — diferente da tela de Negociações,
 *                     onde ela conta. As duas coisas estão certas: lá a pergunta
 *                     é "quantas negociações houve", aqui é "quanto rendeu cada
 *                     cidade", e cidade quem tem é o lead.
 *
 * Consequência que vale dizer em voz alta: numa linha de vendedor, a taxa de
 * conversão de CADASTRO e a de NEGOCIAÇÃO têm bases diferentes de propósito — a
 * primeira é sobre os leads que ele cadastrou, a segunda sobre as negociações que
 * ele conduziu, e os dois conjuntos não são o mesmo.
 */

const BACKLOG = ['Em Andamento', 'Qualificado', 'Disponível'];

/** Filtros da tela de Desempenho: dois períodos, um para cada lado do funil. */
export function parseFiltrosDesempenho(q = {}) {
  return {
    leadDe: q.dlde || null,
    leadAte: q.dlate || null,
    negDe: q.dnde || null,
    negAte: q.dnate || null,
    vendedor: lista(q.dvend),
    equipe: lista(q.dequipe),
    status: lista(q.dstatus),
    tipoContrato: lista(q.dtipo),
    cidade: lista(q.dcidade),
    bairro: lista(q.dbairro),
    busca: q.dbusca ? String(q.dbusca).trim().toUpperCase() : null,
  };
}

function leadsDoDesempenho(flt) {
  return estado.leads.filter((l) => {
    if (flt.leadDe && (!l.diaCadastro || l.diaCadastro < flt.leadDe)) return false;
    if (flt.leadAte && (!l.diaCadastro || l.diaCadastro > flt.leadAte)) return false;
    if (flt.vendedor && !flt.vendedor.includes(l.dono)) return false;
    if (flt.equipe && !flt.equipe.includes(l.equipe)) return false;
    if (flt.status && !flt.status.some((x) => mesmo(x, l.status))) return false;
    if (flt.cidade && !flt.cidade.includes(l.cidade)) return false;
    if (flt.bairro && !flt.bairro.includes(l.bairro)) return false;
    if (flt.busca && !`${l.nome} ${l.cpfCnpj} ${l.email}`.toUpperCase().includes(flt.busca)) return false;
    return true;
  });
}

function negociacoesDoDesempenho(flt, leadsVisiveis, por) {
  // Para o agrupamento por cidade, a negociação só entra se o LEAD dela sobreviveu
  // ao filtro — é do lead que vem a cidade. Por vendedor, ela entra pelo
  // responsável, como o USERELATIONSHIP do relatório.
  const idsLead = por === 'cidade' ? new Set(leadsVisiveis.map((l) => l.leadId)) : null;
  const cidadePorLead = new Map(leadsVisiveis.map((l) => [l.leadId, { cidade: l.cidade, bairro: l.bairro }]));
  return estado.negociacoes.filter((n) => {
    const dia = n.dtCriacao ? n.dtCriacao.slice(0, 10) : null;
    if (flt.negDe && (!dia || dia < flt.negDe)) return false;
    if (flt.negAte && (!dia || dia > flt.negAte)) return false;
    if (flt.tipoContrato && !flt.tipoContrato.includes(n.tipoContrato)) return false;
    if (por === 'cidade') {
      if (n.leadId == null || !idsLead.has(n.leadId)) return false;
    } else {
      if (flt.vendedor && !flt.vendedor.includes(n.responsavel)) return false;
      if (flt.equipe && !flt.equipe.includes(n.equipe)) return false;
    }
    if (flt.busca && !`${n.nome} ${n.contrato} ${n.titulo}`.toUpperCase().includes(flt.busca)) return false;
    return true;
  }).map((n) => (por === 'cidade' ? { ...n, ...cidadePorLead.get(n.leadId) } : n));
}

/** Média em minutos, formatada como as medidas de tempo do relatório. */
const mediaMinutos = (valores) => {
  const uteis = valores.filter((v) => v !== null && v !== undefined && !Number.isNaN(v));
  if (!uteis.length) return null;
  return uteis.reduce((a, v) => a + v, 0) / uteis.length;
};

/** Uma linha da matriz de produtividade: os dois lados do funil na mesma chave. */
function linhaDesempenho(chave, leadsDaChave, negsDaChave) {
  const cadastrados = leadsDaChave.length;
  const ganhosLead = leadsDaChave.filter((l) => mesmo(l.status, 'Ganho')).length;
  const descartados = leadsDaChave.filter((l) => mesmo(l.status, 'Descartado')).length;
  const backlog = leadsDaChave.filter((l) => BACKLOG.some((b) => mesmo(b, l.status))).length;
  const conduzidas = contarDistintas(negsDaChave);
  const ganhasNeg = contarDistintas(negsDaChave.filter((n) => mesmo(n.status, 'Ganho')));
  const receita = negsDaChave
    .filter((n) => mesmo(n.status, 'Ganho'))
    .reduce((a, n) => a + n.valor, 0);
  const leadsGanhos = new Set(
    negsDaChave.filter((n) => mesmo(n.status, 'Ganho')).map((n) => n.leadId).filter((x) => x != null),
  );
  const duracao = mediaMinutos(negsDaChave.map((n) => n.duracaoMin));
  const vida = mediaMinutos(leadsDaChave.map((l) => l.tempoDeVidaMin));
  return {
    key: chave,
    __key: chave,
    cadastrados,
    ganhosLead,
    descartados,
    backlog,
    // 'Taxa Conversao Cadastro'
    taxaCadastro: cadastrados ? ganhosLead / cadastrados : 0,
    conduzidas,
    ganhasNeg,
    // 'Taxa Conversao Negociacao'
    taxaNegociacao: conduzidas ? ganhasNeg / conduzidas : 0,
    // 'Taxa Vendas sobre Cadastro' — cruza os dois lados de propósito
    taxaVendas: cadastrados ? ganhasNeg / cadastrados : 0,
    receita,
    ticketMedio: leadsGanhos.size ? receita / leadsGanhos.size : 0,
    duracaoMin: duracao,
    duracao: duracaoTexto(duracao),
    vidaMin: vida,
    vidaLead: duracaoTexto(vida),
  };
}

/** Contagem por dimensão, sobre um subconjunto já filtrado. */
function contarPor(itens, chaveFn, contaFn, { limite = 15, rotuloVazio = '(sem informação)' } = {}) {
  const mapa = new Map();
  for (const x of itens) {
    const k = norm(chaveFn(x)) || rotuloVazio;
    mapa.set(k, (mapa.get(k) || []).concat([x]));
  }
  const total = contaFn(itens) || 1;
  let out = [...mapa].map(([key, grupo]) => {
    const qtd = contaFn(grupo);
    return { key, __key: key, qtd, pct: qtd / total };
  });
  out.sort((a, b) => b.qtd - a.qtd || a.key.localeCompare(b.key, 'pt-BR'));
  if (limite && out.length > limite) {
    const cauda = out.slice(limite);
    const soma = cauda.reduce((a, c) => a + c.qtd, 0);
    out = out.slice(0, limite).concat([{
      key: `Outros (${cauda.length} itens)`, __key: '__outros', qtd: soma, pct: soma / total, agrupado: true,
    }]);
  }
  return out;
}

const contarLeads = (ls) => new Set(ls.map((l) => l.leadId)).size;
/**
 * Negociação conta DISTINTA aqui também.
 *
 * O relatório usa `Total Negociacoes` nos funis e nas tabelas de perda, que é
 * `COUNT(titulo_negociacao)` — linhas, e negociação com dois planos vira duas.
 * Na primeira versão desta tela eu segui a medida, e o funil dizia 31.150
 * enquanto a matriz logo acima dizia 30.756: a mesma incoerência que eu tinha
 * apontado no relatório, reproduzida por mim. Uma tela precisa fechar consigo
 * mesma antes de fechar com a origem.
 */
const contarLinhasNeg = (ns) => contarDistintas(ns);

export function painelDesempenho(flt, por = 'vendedor') {
  const leads = leadsDoDesempenho(flt);
  const negs = negociacoesDoDesempenho(flt, leads, por);

  const chaveLead = por === 'cidade'
    ? (l) => l.cidade || '(sem cidade)'
    : (l) => l.dono || '(sem dono)';
  const chaveNeg = por === 'cidade'
    ? (n) => n.cidade || '(sem cidade)'
    : (n) => n.responsavel || '(sem responsável)';

  // ---- matriz de produtividade: os dois lados na mesma chave -------------
  const porChaveLead = new Map();
  for (const l of leads) {
    const k = chaveLead(l);
    if (!porChaveLead.has(k)) porChaveLead.set(k, []);
    porChaveLead.get(k).push(l);
  }
  const porChaveNeg = new Map();
  for (const n of negs) {
    const k = chaveNeg(n);
    if (!porChaveNeg.has(k)) porChaveNeg.set(k, []);
    porChaveNeg.get(k).push(n);
  }
  const chaves = [...new Set([...porChaveLead.keys(), ...porChaveNeg.keys()])];
  const produtividade = chaves
    .map((k) => linhaDesempenho(k, porChaveLead.get(k) || [], porChaveNeg.get(k) || []))
    .sort((a, b) => b.cadastrados - a.cadastrados || b.conduzidas - a.conduzidas
      || a.key.localeCompare(b.key, 'pt-BR'));

  // ---- os seis cartões: o total, não a soma das linhas -------------------
  const geral = linhaDesempenho('__total', leads, negs);

  // ---- funis: as três etapas do relatório --------------------------------
  const totalLeads = contarLeads(leads);
  const totalNeg = contarLinhasNeg(negs);
  const funilGanhos = [
    { key: 'Leads', __key: 'f1', qtd: totalLeads },
    { key: 'Negociações', __key: 'f2', qtd: totalNeg },
    { key: 'Leads ganhos', __key: 'f3', qtd: geral.ganhosLead },
  ];
  const funilDescartes = [
    { key: 'Leads', __key: 'd1', qtd: totalLeads },
    { key: 'Negociações', __key: 'd2', qtd: totalNeg },
    { key: 'Leads descartados', __key: 'd3', qtd: geral.descartados },
  ];

  // ---- as duas matrizes de taxa de conversão ----------------------------
  const matrizTaxa = (colunaFn, colunasDe, taxaDe) => {
    const colunas = [...new Set(colunasDe.map((x) => norm(colunaFn(x)) || '(sem informação)'))]
      .sort((a, b) => a.localeCompare(b, 'pt-BR'))
      .slice(0, 10);
    const linhas = chaves.map((k) => {
      const linha = { key: k, __key: k };
      for (const c of colunas) linha[c] = taxaDe(k, c);
      return linha;
    }).filter((l) => colunas.some((c) => l[c] !== null));
    return { colunas, linhas };
  };

  // taxa de conversão de CADASTRO por forma de contato do lead
  const taxaPorForma = matrizTaxa(
    (l) => l.forma,
    leads,
    (k, c) => {
      const grupo = (porChaveLead.get(k) || []).filter((l) => (norm(l.forma) || '(sem informação)') === c);
      if (!grupo.length) return null;
      return grupo.filter((l) => mesmo(l.status, 'Ganho')).length / grupo.length;
    },
  );

  // taxa de conversão de NEGOCIAÇÃO por origem da negociação
  const taxaPorOrigem = matrizTaxa(
    (n) => n.origem,
    negs,
    (k, c) => {
      const grupo = (porChaveNeg.get(k) || []).filter((n) => (norm(n.origem) || '(sem informação)') === c);
      if (!grupo.length) return null;
      return contarDistintas(grupo.filter((n) => mesmo(n.status, 'Ganho'))) / contarDistintas(grupo);
    },
  );

  // ---- as oito tabelas de perda -----------------------------------------
  // Lead: classificacao IN (Perda, Descartado). Negociação: status = Perda.
  // São os filtros de visual do relatório, lidos do .pbip.
  const leadsPerdidos = leads.filter((l) => mesmo(l.status, 'Perda') || mesmo(l.status, 'Descartado'));
  const negsPerdidas = negs.filter((n) => mesmo(n.status, 'Perda'));
  const perdaLead = (fn, rotulo) => contarPor(leadsPerdidos, fn, contarLeads, { rotuloVazio: rotulo });
  const perdaNeg = (fn, rotulo) => contarPor(negsPerdidas, fn, contarLinhasNeg, { rotuloVazio: rotulo });

  return {
    por,
    kpis: {
      ticketMedio: geral.ticketMedio,
      receita: geral.receita,
      taxaCadastro: geral.taxaCadastro,
      taxaNegociacao: geral.taxaNegociacao,
      duracao: geral.duracao,
      vidaLead: geral.vidaLead,
      totalLeads,
      totalNegociacoes: totalNeg,
      cadastrados: geral.cadastrados,
      ganhosLead: geral.ganhosLead,
      descartados: geral.descartados,
      backlog: geral.backlog,
      conduzidas: geral.conduzidas,
      ganhasNeg: geral.ganhasNeg,
    },
    produtividade: produtividade.slice(0, 200),
    produtividadeTotal: produtividade.length,
    funilGanhos,
    funilDescartes,
    taxaPorForma,
    taxaPorOrigem,
    perdaLeadMotivo: perdaLead((l) => l.motivo, '(sem motivo)'),
    perdaLeadOrigem: perdaLead((l) => l.origem, '(sem origem)'),
    perdaLeadForma: perdaLead((l) => l.forma, '(sem forma)'),
    perdaLeadTime: perdaLead((l) => l.time, '(sem time)'),
    perdaNegMotivo: perdaNeg((n) => n.motivo, '(sem motivo)'),
    perdaNegOrigem: perdaNeg((n) => n.origem, '(sem origem)'),
    perdaNegForma: perdaNeg((n) => n.forma, '(sem forma)'),
    perdaNegTime: perdaNeg((n) => n.time, '(sem time)'),
    leadsPerdidos: contarLeads(leadsPerdidos),
    negsPerdidas: contarLinhasNeg(negsPerdidas),
    // Recorte invisível gera chamado: a tela diz quantos vendedores o
    // Comercial_Teams não conhece, em vez de deixá-los caírem em "(sem equipe)"
    // sem explicação.
    semEquipe: conferirEquipes().semEquipe,
    vendedores: conferirEquipes().vendedores,
  };
}

/** Opções dos seletores da tela de Desempenho (os dois lados do funil). */
export function filtrosDesempenho() {
  const uniqLead = (fn) => unico(estado.leads.map(fn));
  return {
    vendedores: estado.dims.vendedores,
    equipes: estado.dims.equipes,
    status: estado.dims.status,
    cidades: uniqLead((l) => l.cidade),
    bairros: uniqLead((l) => l.bairro),
    tiposContrato: unico(estado.negociacoes.map((n) => n.tipoContrato)),
    periodoLead: (() => {
      let min = null; let max = null;
      for (const l of estado.leads) {
        if (!l.diaCadastro) continue;
        if (!min || l.diaCadastro < min) min = l.diaCadastro;
        if (!max || l.diaCadastro > max) max = l.diaCadastro;
      }
      return { min, max, hoje: today() };
    })(),
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
