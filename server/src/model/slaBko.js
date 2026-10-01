/**
 * Modelo do SLA do BKO — o quinto modelo em memória.
 *
 * TRÊS FONTES, DOIS SISTEMAS
 *   tarefas  Data Hub `umuvme-sls-bko`    uma linha por envio no uMov.me (A1 → análise)
 *   ciclos   Data Hub `umovme-ciclos-bko` uma linha por ciclo de envio/devolução/reenvio
 *   vendas   Voalle `sql/sla_bko.sql`     uma linha por contrato, com os marcos do Elleven
 *
 * OS MARCOS (escopo técnico do SLA BKO)
 *   Venda externa: A1 envio no uMov · A2 cadastro no Elleven · A3 1º contato · A4 agendamento
 *   Venda interna: B1 cadastro no Elleven · B2 1º contato · B3 agendamento
 *   A2/B1 = criação do contrato; A3/B2 = PRIMEIRO relato do atendimento, qualquer texto
 *   (regra da área, 25/09/2026); A4/B3 = relato de agendamento.
 *
 * METAS, em horas úteis (redefinidas pela área em 25/09/2026): A2−A1 (cadastro − input) = 1 h;
 * A4−A2 = B3−B1 (agendamento − cadastro) = 12 h. Os demais SLAs não têm meta. As duas de 12 h são o
 * mesmo cálculo (agendamento − cadastro), por isso aparecem juntas.
 *
 * CRUZAMENTO uMov ↔ Elleven — a regra do Power BI: CPF só com dígitos dos dois lados,
 * e o ciclo escolhido é o de `primeiro_input` mais recente que não passa do cadastro.
 * Duas travas a mais que lá: só vale para o canal externo (um cliente interno que um
 * dia passou pelo externo encontraria o ciclo antigo) e CPF vazio nunca casa (no
 * Power Query nulo casa com nulo).
 *
 * CANCELADA ANTES DE AGENDAR sai da média e do % no prazo (decidido em 25/09). Ela
 * aparece como situação à parte, assim como a encerrada sem relato de agendamento.
 */
import {
  agoraLocal, deMinutos, esquecerFeriados, horasCorridas, horasUteis, normalizarData, paraMinutos,
} from '../sla/horasUteis.js';

export const METAS = { cadastro: 1, agendamento: 12 };
export const CANAL_EXTERNO = 'vendedor externo';
const JANELA_FILA_DIAS = 7;

/**
 * Ajuste de fuso dos horários de ENVIO do uMov (data_hora, primeiro_input,
 * ultimo_input), em horas. Padrão 0. Existe porque os primeiros números reais
 * mostraram a maioria das análises ANTES do envio e envios concentrados à noite —
 * sinal de que esses campos podem estar em UTC enquanto a análise está no horário
 * de Brasília. O quadro de qualidade mede o efeito de −3 h antes de alguém ligar
 * isso: UMOV_AJUSTE_HORAS=-3.
 */
// Histórico: em 25/09/2026 o teste de fuso confirmou UTC (com −3 h as análises "antes
// do envio" foram de 13.093 para 0) e −3 virou o padrão. Em 28/09/2026 ~16h40 o uMov
// passou a chegar no horário de Brasília; em 29/09 o admin do Data Hub acertou o fuso da
// conexão e recarregou tudo, histórico incluído. Desde então o Data Hub entrega
// data_hora/primeiro_envio/ultimo_envio JÁ em Brasília e o padrão voltou a 0.
const ajusteUmovMin = () => {
  const v = process.env.UMOV_AJUSTE_HORAS;
  return (v === undefined || String(v).trim() === '' ? 0 : Number(v) || 0) * 60;
};
function deslocar(texto, minutos) {
  if (!texto || !minutos) return texto;
  const m = paraMinutos(texto);
  return m === null ? texto : deMinutos(m + minutos);
}
// As filas vão inteiras para a tela (a de 7 dias do uMov tem ~500 linhas). Com
// corte de 300 depois de ordenar por espera, a tabela recebia só as mais antigas e,
// reordenada por data, parecia não ter nada depois delas.
const LIMITE_LINHAS = 3000;

const vazio = () => ({
  fontes: {}, brutos: { vendas: [], tarefas: [], ciclos: [] },
  tarefas: [], ciclos: [], vendas: [], versao: 0, buildMs: 0, construidoEm: null,
});
let estado = vazio();

export const getEstadoSla = () => estado;
export const slaPronto = () => ['vendas', 'tarefas', 'ciclos'].some((f) => estado.fontes[f]?.updatedAt);

export function setFonteSla(nome, rows, meta = {}) {
  estado.brutos[nome] = rows;
  estado.fontes[nome] = { updatedAt: new Date().toISOString(), ms: meta.ms, linhas: rows.length, error: null };
}
export function setFonteErroSla(nome, err) {
  estado.fontes[nome] = { ...(estado.fontes[nome] || {}), error: err.message || String(err), erroEm: new Date().toISOString() };
}

// ---------------------------------------------------------------- utilitários

const ehTeste = (s) => /teste/i.test(String(s || ''));
const txt = (v) => (v === null || v === undefined ? '' : String(v).trim());
/** Data em qualquer dos dois formatos que chegam → 'YYYY-MM-DD HH:MM:SS' (ou null). */
const dt = (v) => normalizarData(txt(v));
/** Horário de envio do uMov, com o ajuste de fuso (ver `ajusteUmovMin`). */
const dtUmov = (v) => deslocar(dt(v), ajusteUmovMin());

/** CPF/CNPJ só com dígitos, com os zeros à esquerda que um campo numérico perderia. */
export function normalizarCpf(v) {
  const d = txt(v).replace(/\D/g, '');
  if (!d) return null;
  if (d.length <= 11) return d.padStart(11, '0');
  if (d.length <= 14) return d.padStart(14, '0');
  return d;
}

export const ehExterno = (canal) => txt(canal).toLowerCase() === CANAL_EXTERNO;

/** Ciclo mais recente com primeiro_input ≤ cadastro. `lista` vem ordenada por primeiro_input. */
export function escolherCiclo(lista, criadoEm) {
  if (!lista || !criadoEm) return null;
  let achado = null;
  for (const c of lista) {
    if (!c.primeiroInput || c.primeiroInput > criadoEm) break;
    achado = c;
  }
  return achado;
}

/** Situação da venda para o SLA de agendamento. */
export function situacaoVenda(v) {
  if (v.agendamentoEm) return 'Agendado';
  const status = txt(v.statusProtocolo).toLowerCase();
  if (v.canceladoEm || status === 'cancelado') return 'Cancelado antes de agendar';
  if (status === 'encerrado') return 'Encerrado sem relato de agendamento';
  return 'Em aberto';
}

const redondo = (v, casas = 2) => (v === null || v === undefined ? null : Math.round(v * 10 ** casas) / 10 ** casas);

function mediana(ordenados) {
  if (!ordenados.length) return null;
  const m = Math.floor(ordenados.length / 2);
  return ordenados.length % 2 ? ordenados[m] : (ordenados[m - 1] + ordenados[m]) / 2;
}
function percentil(ordenados, p) {
  if (!ordenados.length) return null;
  return ordenados[Math.min(ordenados.length - 1, Math.ceil(p * ordenados.length) - 1)];
}

/** n, média, mediana, p90 e — com meta — % no prazo. */
export function estatistica(valores, meta = null) {
  const v = valores.filter((x) => x !== null && x !== undefined && Number.isFinite(x)).sort((a, b) => a - b);
  const soma = v.reduce((s, x) => s + x, 0);
  return {
    n: v.length,
    media: v.length ? redondo(soma / v.length) : null,
    mediana: redondo(mediana(v)),
    p90: redondo(percentil(v, 0.9)),
    noPrazo: meta === null ? null : v.filter((x) => x <= meta).length,
    pctNoPrazo: meta === null || !v.length ? null : redondo(v.filter((x) => x <= meta).length / v.length, 4),
  };
}

function agrupar(itens, chave) {
  const m = new Map();
  for (const i of itens) {
    const k = chave(i);
    if (!m.has(k)) m.set(k, []);
    m.get(k).push(i);
  }
  return m;
}

const periodoDe = (iso, g) => (iso ? (g === 'dia' ? iso.slice(0, 10) : iso.slice(0, 7)) : null);

// ---------------------------------------------------------------- construção

function construirTarefas(brutos) {
  const out = [];
  for (const r of brutos) {
    if (ehTeste(r.vendedor)) continue;
    // `ultimo_envio` (history, já em horário de Brasília) é o horário que o BKO vê na tela
    // "Pedidos para Aprovação"; `data_hora` (task, UTC) fica de reserva para quem ainda não
    // tem histórico. Com reenvio, a análise se refere ao último envio.
    const envio = dt(r.ultimo_envio) || dtUmov(r.data_hora);
    if (!envio) continue;
    // aprovado_em vem como '21/09/2026 20:50' — `dt` traz para o formato do resto
    const analise = dt(r.aprovado_em);
    const motivo = txt(r.motivo_reprovacao) || null;
    const horas = analise ? horasUteis(envio, analise) : null;
    out.push({
      idTarefa: Number.isFinite(Number(r.id_tarefa)) ? Math.round(Number(r.id_tarefa)) : null,
      envio,
      primeiroEnvio: dt(r.primeiro_envio) || envio,
      qtdEnvios: Number(r.qtd_envios) || null,
      // tarefa com CPF = pedido que chegou ao BKO (sem CPF é visita / lead não convertido)
      temCpf: Boolean(normalizarCpf(r.cpf_cnpj)),
      cpf: normalizarCpf(r.cpf_cnpj),
      analise,
      vendedor: txt(r.vendedor) || '(sem vendedor)',
      analista: txt(r.analista) || (r.aprovado_por_user_id ? `id ${r.aprovado_por_user_id}` : null),
      cliente: txt(r.nome_cliente) || null,
      situacao: !analise ? 'Pendente' : (motivo ? 'Reprovado' : 'Aprovado'),
      motivo,
      horas,
      analiseAntesDoEnvio: Boolean(analise) && horas === null,
    });
  }
  return out;
}

function construirCiclos(brutos) {
  const out = [];
  for (const r of brutos) {
    // mesma limpeza do Power BI: dado de teste e ciclo sem nome de cliente
    if (ehTeste(r.vendedor_primeiro_envio) || !txt(r.nome_cliente)) continue;
    const primeiroInput = dtUmov(r.primeiro_input);
    const ultimaAnalise = dt(r.ultima_analise);
    out.push({
      id: r.id_ciclo,
      // tarefa do último envio do ciclo: diz se o BKO aprovou ou reprovou por último
      tarefaUltimo: Number.isFinite(Number(r.tarefa_ultimo_envio)) ? Math.round(Number(r.tarefa_ultimo_envio)) : null,
      cpf: normalizarCpf(r.cpf_cnpj_norm),
      primeiroInput,
      ultimoInput: dtUmov(r.ultimo_input),
      ultimaAnalise,
      concluido: r.ciclo_concluido === true || r.ciclo_concluido === 'true',
      retrabalho: r.houve_retrabalho === true || r.houve_retrabalho === 'true',
      rodadas: Number(r.rodadas) || 0,
      reenvios: Number(r.reenvios) || 0,
      devolucoes: Number(r.devolucoes) || 0,
      motivo: txt(r.motivo_ultima_devolucao) || null,
      vendedor: txt(r.vendedor_primeiro_envio) || '(sem vendedor)',
      analista: txt(r.analista_ultimo_envio) || null,
      horasCiclo: ultimaAnalise ? horasUteis(primeiroInput, ultimaAnalise) : null,
    });
  }
  return out;
}

/** Nome para comparar Voalle × uMov: sem acento, caixa ou espaço duplo. */
export const chaveNome = (n) => txt(n).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ');

/**
 * Nome de PESSOA para comparar Voalle × uMov: além de acento e caixa, ignora as partículas
 * (de, da, do, das, dos, e). Caso 1827240: no Voalle "ADRIANE DE SOUZA ALVES", no uMov
 * "Adriane Souza Alves" — sem isso a OBS dizia "vendedor sem nenhum pedido no uMov".
 */
const PARTICULAS = new Set(['de', 'da', 'do', 'das', 'dos', 'e']);
export const chavePessoa = (n) => chaveNome(n).split(' ').filter((p) => p && !PARTICULAS.has(p)).join(' ');

/** Dias corridos entre dois instantes, 1 casa. */
const diasEntre = (a, b) => redondo(horasCorridas(a, b) / 24, 1);
// menos de 1 dia sai em horas ("0,1 dias" não diz nada a quem lê)
const nDias = (a, b) => {
  const horas = horasCorridas(a, b);
  if (horas < 24) { const h = Math.round(horas); return h < 1 ? 'menos de 1 h' : `${h} h`; }
  const n = redondo(horas / 24, 1);
  return `${String(n).replace('.', ',')} ${n === 1 ? 'dia' : 'dias'}`;
};
const fmtDia = (t) => (t ? `${t.slice(8, 10)}/${t.slice(5, 7)}/${t.slice(0, 4)} ${t.slice(11, 16)}` : '');
/**
 * REGRA (decidida em 28/09/2026, caso 1814656): ciclo do uMov cuja última movimentação
 * (análise, ou envio se não houve análise) ficou mais de 30 dias antes do cadastro é de
 * OUTRA venda do mesmo cliente — uma instalação nova exige envio novo. A venda fica sem
 * A1 em vez de herdar o envio antigo (que chegava a 3.000 h no SLA de cadastro).
 * Contar da última movimentação, e não do 1º envio, preserva o ciclo com retrabalho
 * longo que foi aprovado pouco antes do cadastro.
 */
const DIAS_CICLO_VALIDO = 30;
const ultimaAtividade = (c) => c.ultimaAnalise || c.ultimoInput || c.primeiroInput;
export const cicloAntigo = (c, criadoEm) => Boolean(c) && diasEntre(ultimaAtividade(c), criadoEm) > DIAS_CICLO_VALIDO;
const DIAS_INTERNA_SUSPEITA = 7;
const HORAS_REUSO_CICLO = 24;

/** Equipe do Elleven que é a fila do BKO — destaque do card "em aberto" (29/09/2026). */
export const EQUIPE_BKO = 'Validação de dados - BKO';
const naEquipeBko = (v) => chaveNome(v.equipe) === chaveNome(EQUIPE_BKO);

/**
 * REGRA (decidida em 29/09/2026, caso 1834335): pedido cujo ÚLTIMO envio no uMov foi
 * REPROVADO pelo BKO e não foi reenviado não é a origem da venda — ela foi refeita por
 * outro caminho (ex.: Venda Consultiva manual). A venda fica sem A1.
 */
const ultimaTarefaReprovada = (c, tarefasPorId) => Boolean(c && c.tarefaUltimo)
  && tarefasPorId.get(c.tarefaUltimo)?.situacao === 'Reprovado';

/**
 * Explica, linha a linha, o cruzamento com o uMov (só texto; a regra está em construirVendas).
 *  externa sem A1 → por que não achou (sem CPF / CPF fora do uMov / uMov só depois /
 *                   só envio antigo, de outra venda)
 *  interna com envio no uMov pouco antes do cadastro → possível canal errado
 */
function obsCruzamento(v, lista, candidato, inicioUmov, tarefasPorId) {
  if (v.externo) {
    const reprovado = ultimaTarefaReprovada(candidato, tarefasPorId);
    const semA1 = !candidato || cicloAntigo(candidato, v.criadoEm) || reprovado || Boolean(v.cicloUsadoPor);
    // o vendedor nem usava o uMov quando a venda foi cadastrada: falta de A1 esperada
    if (semA1 && inicioUmov.size) {
      const inicio = inicioUmov.get(chavePessoa(v.vendedor));
      if (!inicio) return 'Vendedor sem nenhum pedido no uMov';
      if (inicio > v.criadoEm) return `Vendedor ainda não usava o uMov (1º pedido dele: ${fmtDia(inicio)})`;
    }
    if (!v.cpf) return 'Sem CPF no Voalle';
    if (!lista) return 'CPF não encontrado no uMov';
    const depois = lista.find((c) => c.primeiroInput && c.primeiroInput > v.criadoEm);
    const txtDepois = depois ? `; envio novo só depois do cadastro (${fmtDia(depois.primeiroInput)})` : '';
    if (!candidato) return `Envio no uMov só depois do cadastro${depois ? ` (${fmtDia(depois.primeiroInput)})` : ''}`;
    if (cicloAntigo(candidato, v.criadoEm)) {
      return `Envio no uMov antigo (${fmtDia(candidato.primeiroInput)}), de outra venda: desconsiderado${txtDepois}`;
    }
    if (v.cicloUsadoPor) {
      return `Envio no uMov (${fmtDia(candidato.primeiroInput)}) já gerou a venda ${v.cicloUsadoPor.protocolo} `
        + `(cadastro ${fmtDia(v.cicloUsadoPor.criadoEm)}): processo novo, desconsiderado${txtDepois}`;
    }
    if (reprovado) {
      const t = tarefasPorId.get(candidato.tarefaUltimo);
      return `Pedido no uMov reprovado em ${fmtDia(t.analise)} (${t.motivo}), sem reenvio: desconsiderado${txtDepois}`;
    }
    return null;
  }
  if (candidato) {
    const ref = candidato.ultimoInput || candidato.primeiroInput;
    if (diasEntre(ref, v.criadoEm) <= DIAS_INTERNA_SUSPEITA) {
      return `Interna com envio no uMov ${nDias(ref, v.criadoEm)} antes (vendedor uMov: ${candidato.vendedor})`;
    }
  }
  return null;
}

/**
 * O envio que vale como A1: o último pedido do CPF entre o 1º envio do ciclo e o cadastro
 * (grão de tarefa, já com a análise dele). Sem tarefa casada, cai no último envio do ciclo
 * — ou no primeiro, se o último for depois do cadastro (reenvio depois de cadastrar).
 */
function ultimoEnvioAteCadastro(ciclo, criadoEm, tarefasDoCpf) {
  let achada = null;
  for (const t of tarefasDoCpf || []) {
    if (t.envio < ciclo.primeiroInput || t.envio > criadoEm) continue;
    if (!achada || t.envio > achada.envio) achada = t;
  }
  if (achada) return { envio: achada.envio, analise: achada.analise || ciclo.ultimaAnalise || null };
  const ult = ciclo.ultimoInput && ciclo.ultimoInput <= criadoEm ? ciclo.ultimoInput : ciclo.primeiroInput;
  return { envio: ult, analise: ciclo.ultimaAnalise || null };
}

function construirVendas(brutos, ciclosPorCpf, inicioUmov = new Map(), tarefasPorId = new Map(), envioPorCpf = new Map()) {
  const out = [];
  // ciclo do uMov → 1ª venda que o usou. Ordem de cadastro, para a venda mais antiga ficar com ele.
  const cicloUsado = new Map();
  const ordenados = [...brutos].sort((a, b) => String(a.criado_em || '').localeCompare(String(b.criado_em || '')));
  for (const r of ordenados) {
    const externo = ehExterno(r.canal);
    const cpf = normalizarCpf(r.cpf_digitos);
    const criadoEm = dt(r.criado_em);
    if (!criadoEm) continue;
    const lista = cpf ? ciclosPorCpf.get(cpf) : null;
    // o ciclo candidato é procurado para TODA venda: na externa vira o A1; na interna só
    // serve de diagnóstico (interna com envio recente no uMov pode ser canal errado)
    const candidato = lista ? escolherCiclo(lista, criadoEm) : null;
    const reprovado = externo && ultimaTarefaReprovada(candidato, tarefasPorId);
    // REGRA (29/09/2026, caso 1834900): um pedido do uMov gera UMA venda. Se o ciclo já
    // virou A1 de uma venda anterior do mesmo cliente (ex.: instalação 1804367 em 04/09), a
    // venda nova (Venda Consultiva de 29/09) é outro processo e fica sem A1. Tolerância de
    // 24 h para mais de um contrato cadastrado junto a partir do mesmo pedido.
    const usoAnterior = candidato ? cicloUsado.get(candidato.id) : null;
    const jaUsado = Boolean(usoAnterior) && horasCorridas(usoAnterior.criadoEm, criadoEm) > HORAS_REUSO_CICLO;
    const valido = candidato && !cicloAntigo(candidato, criadoEm) && !reprovado && !jaUsado;
    if (valido && !usoAnterior) cicloUsado.set(candidato.id, { criadoEm, protocolo: r.protocolo });
    const ciclo = externo && valido ? candidato : null;
    const envioFinal = ciclo ? ultimoEnvioAteCadastro(ciclo, criadoEm, envioPorCpf.get(cpf)) : null;
    const v = {
      protocolo: r.protocolo,
      contrato: r.contrato,
      cliente: txt(r.cliente) || null,
      vendedor: txt(r.vendedor) || '(sem vendedor)',
      canal: txt(r.canal) || '(sem canal)',
      externo,
      tipo: txt(r.tipo_solicitacao) || null,
      statusProtocolo: txt(r.status_protocolo) || null,
      // equipe em que o protocolo está AGORA (ex.: "Validação de dados - BKO")
      equipe: txt(r.equipe) || null,
      temCpf: Boolean(cpf),
      cpf,
      // A1 = ÚLTIMO envio do ciclo até o cadastro (regra de 29/09/2026, caso 1833811):
      // o tempo em que o pedido reprovado ficou com o vendedor para corrigir não é do BKO.
      // Cada reprovação continua medida na triagem (grão de tarefa) e no Retrabalho.
      a1: envioFinal?.envio || null,
      analiseUmov: envioFinal?.analise || null,
      primeiroEnvioUmov: ciclo?.primeiroInput || null,
      enviosNoCiclo: ciclo ? (ciclo.rodadas || null) : null,
      criadoEm,
      contatoEm: dt(r.contato_em),
      atendenteContato: txt(r.atendente_contato) || null,
      agendamentoEm: dt(r.agendamento_em),
      atendenteAgendamento: txt(r.atendente_agendamento) || null,
      canceladoEm: dt(r.cancelado_em),
      cpfNoUmov: Boolean(cpf && ciclosPorCpf.has(cpf)),
      cicloId: ciclo?.id || null,
      cicloAntigoDescartado: externo && cicloAntigo(candidato, criadoEm),
      cicloReprovadoDescartado: reprovado && !cicloAntigo(candidato, criadoEm),
      cicloJaUsadoDescartado: externo && jaUsado && !cicloAntigo(candidato, criadoEm) && !reprovado,
      cicloUsadoPor: jaUsado ? usoAnterior : null,
      // intervalo entre a análise do ciclo e o cadastro: é o que vai dizer qual
      // janela máxima aceitar no cruzamento (decisão pendente, com os números)
      diasCicloAteCadastro: ciclo
        ? redondo(horasCorridas(ciclo.ultimaAnalise || ciclo.ultimoInput || ciclo.primeiroInput, criadoEm) / 24, 1)
        : null,
    };
    v.obsCruzamento = obsCruzamento(v, lista, candidato, inicioUmov, tarefasPorId);
    v.situacao = situacaoVenda(v);
    v.slaAgendamento = v.agendamentoEm ? horasUteis(criadoEm, v.agendamentoEm) : null;
    // 1º contato: externa conta desde o envio no uMov (A3−A1, meta 2 h);
    // interna desde o cadastro (B2−B1, sem meta no escopo)
    v.sla1Contato = v.contatoEm ? horasUteis(externo ? v.a1 : criadoEm, v.contatoEm) : null;
    v.slaContatoAgendamento = v.contatoEm && v.agendamentoEm ? horasUteis(v.contatoEm, v.agendamentoEm) : null;
    v.slaTotalExterna = externo && v.a1 && v.agendamentoEm ? horasUteis(v.a1, v.agendamentoEm) : null;
    v.slaTriagem = v.a1 && v.analiseUmov ? horasUteis(v.a1, v.analiseUmov) : null;
    // A2 − A1: do envio no uMov ao cadastro no Elleven (meta 1 h) — só externa
    v.slaCadastro = externo && v.a1 ? horasUteis(v.a1, criadoEm) : null;
    // data fora de ordem: horasUteis devolve null para intervalo negativo
    v.foraDeOrdem = (v.agendamentoEm && v.slaAgendamento === null)
      || (v.contatoEm && (externo ? v.a1 : true) && v.sla1Contato === null);
    out.push(v);
  }
  // 2ª passada: vendedor do Voalle cujo nome não bate com o do uMov, mas que tem venda
  // casada pelo CPF, usa o uMov sim — a OBS não pode dizer "sem nenhum pedido" para ele
  const extra = new Map();
  for (const v of out) {
    if (!v.a1) continue;
    const k = chavePessoa(v.vendedor);
    if (!inicioUmov.has(k) && (!extra.has(k) || v.a1 < extra.get(k))) extra.set(k, v.a1);
  }
  if (extra.size) {
    const inicio2 = new Map([...inicioUmov, ...extra]);
    for (const v of out) {
      if (v.obsCruzamento !== 'Vendedor sem nenhum pedido no uMov' || !extra.has(chavePessoa(v.vendedor))) continue;
      const lista = v.cpf ? ciclosPorCpf.get(v.cpf) : null;
      const candidato = lista ? escolherCiclo(lista, v.criadoEm) : null;
      v.obsCruzamento = obsCruzamento(v, lista, candidato, inicio2, tarefasPorId);
    }
  }
  return out;
}

export function construirSla() {
  const inicio = Date.now();
  esquecerFeriados();
  const tarefas = construirTarefas(estado.brutos.tarefas || []);
  const ciclos = construirCiclos(estado.brutos.ciclos || []);
  const porCpf = new Map();
  for (const c of ciclos) {
    if (!c.cpf || !c.primeiroInput) continue;
    if (!porCpf.has(c.cpf)) porCpf.set(c.cpf, []);
    porCpf.get(c.cpf).push(c);
  }
  for (const lista of porCpf.values()) lista.sort((a, b) => a.primeiroInput.localeCompare(b.primeiroInput));
  // 1º pedido (tarefa com CPF) de cada vendedor no uMov: separa "vendedor que ainda não
  // usava o app" (ex.: recebeu o celular em setembro) de falha real do cruzamento
  const inicioUmov = new Map();
  for (const t of tarefas) {
    if (!t.temCpf) continue;
    const k = chavePessoa(t.vendedor);
    if (k && (!inicioUmov.has(k) || t.envio < inicioUmov.get(k))) inicioUmov.set(k, t.envio);
  }
  const tarefasPorId = new Map(tarefas.filter((t) => t.idTarefa).map((t) => [t.idTarefa, t]));
  const envioPorCpf = new Map();
  for (const t of tarefas) {
    if (!t.cpf) continue;
    if (!envioPorCpf.has(t.cpf)) envioPorCpf.set(t.cpf, []);
    envioPorCpf.get(t.cpf).push(t);
  }
  const vendas = construirVendas(estado.brutos.vendas || [], porCpf, inicioUmov, tarefasPorId, envioPorCpf);
  const diagFuso = diagnosticarFuso(tarefas, vendas, porCpf);

  estado = {
    ...estado, tarefas, ciclos, vendas, diagFuso,
    versao: estado.versao + 1, buildMs: Date.now() - inicio, construidoEm: new Date().toISOString(),
  };
  return estado;
}

/**
 * Teste do fuso na base inteira: quantas análises caem antes do envio e quantas
 * vendas externas acham ciclo, do jeito que está e com o envio 3 h mais cedo.
 * Se −3 h zerar as análises "antes do envio" e subir o cruzamento, o envio do uMov
 * está em UTC. Não muda número nenhum da tela — só informa.
 */
function diagnosticarFuso(tarefas, vendas, porCpf) {
  const analisadas = tarefas.filter((t) => t.analise);
  const difs = analisadas.map((t) => paraMinutos(t.analise) - paraMinutos(t.envio)).sort((a, b) => a - b);
  const externas = vendas.filter((v) => v.externo && v.temCpf);
  let comMenos3h = 0;
  for (const v of externas) {
    const alvo = deslocar(v.criadoEm, 180); // primeiro_input − 3 h ≤ cadastro  ⇔  primeiro_input ≤ cadastro + 3 h
    if (escolherCiclo(porCpf.get(v.cpf), alvo)) comMenos3h += 1;
  }
  return {
    ajusteAtualHoras: ajusteUmovMin() / 60,
    analisadas: analisadas.length,
    antesDoEnvio: difs.filter((d) => d < 0).length,
    antesDoEnvioComMenos3h: difs.filter((d) => d + 180 < 0).length,
    medianaAnaliseMenosEnvioH: difs.length ? redondo(mediana(difs) / 60) : null,
    externasComCpf: externas.length,
    cruzamento: externas.filter((v) => v.cicloId).length,
    cruzamentoComMenos3h: comMenos3h,
  };
}

// ---------------------------------------------------------------- filtros

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const lista = (v) => String(v || '').split(',').map((s) => s.trim()).filter(Boolean);

/**
 * Grupos do filtro Canal. "Sem canal" = vendedor sem setor no CRM do Voalle (consultor,
 * supervisor, ex-vendedor): no SLA conta como interna, mas pode ser visto à parte.
 */
export const GRUPOS_CANAL = ['Externo', 'Interno', 'Sem canal'];
export const grupoCanal = (v) => (v.externo ? 'Externo' : (v.canal === '(sem canal)' ? 'Sem canal' : 'Interno'));
const casaCanal = (v, flt) => !flt.canal || grupoCanal(v) === flt.canal;
/**
 * REGRA (29/09/2026): "Sem canal" fica FORA dos cálculos de SLA em "Todos" (cards, resumo,
 * gráficos, rankings). Continua visível no filtro "Sem canal", no Detalhamento e na fila
 * do Elleven — a instalação ainda precisa ser agendada, mesmo sem entrar na conta.
 */
const entraNoCalculo = (v, flt) => (flt.canal ? grupoCanal(v) === flt.canal : grupoCanal(v) !== 'Sem canal');

export function parseFiltrosSla(q = {}) {
  const canais = lista(q.canal).filter((c) => GRUPOS_CANAL.includes(c));
  return {
    de: ISO.test(q.de || '') ? q.de : null,
    ate: ISO.test(q.ate || '') ? q.ate : null,
    canal: canais.length === 1 ? canais[0] : null,
    g: q.g === 'dia' ? 'dia' : 'mes',
  };
}

const naJanela = (iso, flt) => {
  if (!iso) return false;
  const d = iso.slice(0, 10);
  return (!flt.de || d >= flt.de) && (!flt.ate || d <= flt.ate);
};

// ---------------------------------------------------------------- painel

function serie(itens, dataDe, valorDe, g, meta = null) {
  const grupos = agrupar(itens.filter((i) => dataDe(i)), (i) => periodoDe(dataDe(i), g));
  return [...grupos.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([periodo, lista]) => {
      const e = estatistica(lista.map(valorDe), meta);
      return { periodo, n: lista.length, medicoes: e.n, mediana: e.mediana, media: e.media, pctNoPrazo: e.pctNoPrazo };
    });
}

function ranking(itens, chave, valorDe, meta = null, extra = () => ({})) {
  return [...agrupar(itens, chave).entries()]
    .filter(([k]) => k)
    .map(([k, lista]) => {
      const e = estatistica(lista.map(valorDe), meta);
      return { nome: k, n: lista.length, medicoes: e.n, media: e.media, mediana: e.mediana, pctNoPrazo: e.pctNoPrazo, ...extra(lista) };
    })
    .sort((a, b) => b.n - a.n);
}

/**
 * Motivo digitado à mão: "DUPLICADO", "duplicado", "Duplicidade" e "DUPLICADA" são o
 * mesmo motivo, e "teste" não é motivo. Agrupa sem caixa e sem acento, junta as
 * variações de duplicidade e mostra a grafia mais frequente de cada grupo.
 */
const semAcento = (t) => t.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
export function chaveMotivo(t) {
  const k = semAcento(String(t || '')).toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (!k || /^(teste|test|tst)( \d+)?$/.test(k)) return null;
  if (/^duplic/.test(k)) return 'duplicado';
  return k.slice(0, 90);
}
function contarTextos(textos, limite = 12) {
  const m = new Map();
  for (const t of textos) {
    const k = chaveMotivo(t);
    if (!k) continue;
    const g = m.get(k) || { valor: 0, grafias: new Map() };
    g.valor += 1;
    const grafia = k === 'duplicado' ? 'Duplicado' : String(t).replace(/\s+/g, ' ').trim().slice(0, 90);
    g.grafias.set(grafia, (g.grafias.get(grafia) || 0) + 1);
    m.set(k, g);
  }
  return [...m.values()]
    .map((g) => ({ key: [...g.grafias.entries()].sort((a, b) => b[1] - a[1])[0][0], valor: g.valor }))
    .sort((a, b) => b.valor - a.valor)
    .slice(0, limite);
}

/** Abertos sem agendamento neste momento, de qualquer mês de cadastro. */
function backlogAgora(todas, flt, agora) {
  const abertas = todas.filter((v) => v.situacao === 'Em aberto' && entraNoCalculo(v, flt))
    .map((v) => ({ ...v, esperaHoras: horasUteis(v.criadoEm, agora) }));
  const bko = abertas.filter(naEquipeBko);
  return {
    backlog: abertas.length,
    backlogBko: bko.length,
    backlogBkoEstouradas: bko.filter((v) => v.esperaHoras > METAS.agendamento).length,
    backlogBkoMaisDe7Dias: bko.filter((v) => v.criadoEm < diasAtras(agora, 7)).length,
  };
}

export function painelSlaBko(flt, agora = agoraLocal()) {
  const s = estado;
  // uMov (triagem, ciclos, fila) só existe para a venda externa
  const querExterno = !flt.canal || flt.canal === 'Externo';
  const vendas = s.vendas.filter((v) => naJanela(v.criadoEm, flt) && entraNoCalculo(v, flt));
  const tarefas = querExterno ? s.tarefas.filter((t) => naJanela(t.envio, flt)) : [];
  const ciclos = querExterno ? s.ciclos.filter((c) => naJanela(c.primeiroInput, flt)) : [];

  // ---- agendamento (A4−A2 / B3−B1, meta 12 h) ----
  const agendadas = vendas.filter((v) => v.situacao === 'Agendado');
  const abertas = vendas.filter((v) => v.situacao === 'Em aberto')
    .map((v) => ({ ...v, esperaHoras: horasUteis(v.criadoEm, agora) }));
  const situacoes = [...agrupar(vendas, (v) => v.situacao).entries()]
    .map(([key, l]) => ({ key, valor: l.length })).sort((a, b) => b.valor - a.valor);

  const agendamento = {
    ...estatistica(agendadas.map((v) => v.slaAgendamento), METAS.agendamento),
    vendas: vendas.length,
    abertas: abertas.length,
    abertasEstouradas: abertas.filter((v) => v.esperaHoras > METAS.agendamento).length,
    // destaque do card: o que está AGORA na fila do BKO (equipe "Validação de dados - BKO")
    abertasBko: abertas.filter(naEquipeBko).length,
    abertasBkoEstouradas: abertas.filter((v) => naEquipeBko(v) && v.esperaHoras > METAS.agendamento).length,
    // BACKLOG de agora, SEM o filtro de período (29/09→01/10/2026: na virada do mês o card
    // "Este mês" zerava e escondia o que ficou aberto de setembro). Respeita só o canal.
    ...backlogAgora(s.vendas, flt, agora),
    equipeBko: EQUIPE_BKO,
    situacoes,
    porCanal: ranking(agendadas, grupoCanal, (v) => v.slaAgendamento, METAS.agendamento),
    serie: serie(agendadas, (v) => v.criadoEm, (v) => v.slaAgendamento, flt.g, METAS.agendamento),
    porAtendente: ranking(agendadas, (v) => v.atendenteAgendamento, (v) => v.slaAgendamento, METAS.agendamento).slice(0, 40),
  };

  // ---- 1º contato ----
  const externas = vendas.filter((v) => v.externo);
  const internas = vendas.filter((v) => !v.externo);
  const primeiroContato = {
    externo: estatistica(externas.map((v) => v.sla1Contato)),
    interno: estatistica(internas.map((v) => v.sla1Contato)),
    comContato: vendas.filter((v) => v.contatoEm).length,
    vendasSemRelato: vendas.filter((v) => !v.contatoEm).length,
    contatoAteAgendamento: estatistica(vendas.map((v) => v.slaContatoAgendamento)),
    porAtendente: ranking(vendas.filter((v) => v.contatoEm), (v) => v.atendenteContato,
      (v) => v.sla1Contato).slice(0, 40),
  };

  // ---- total externa (A4−A1) ----
  const totalExterna = estatistica(externas.map((v) => v.slaTotalExterna));
  // B3 − B1 é o mesmo intervalo do agendamento na venda interna; aparece à parte
  // porque a área quer o total de cada canal lado a lado
  const totalInterna = estatistica(internas.filter((v) => v.situacao === 'Agendado').map((v) => v.slaAgendamento));
  const cadastro = {
    ...estatistica(externas.map((v) => v.slaCadastro), METAS.cadastro),
    serie: serie(externas.filter((v) => v.slaCadastro !== null), (v) => v.criadoEm, (v) => v.slaCadastro, flt.g, METAS.cadastro),
  };

  // ---- triagem no uMov (envio → análise do BKO) ----
  const analisadas = tarefas.filter((t) => t.analise);
  const triagem = {
    ...estatistica(analisadas.map((t) => t.horas)),
    enviadas: tarefas.length,
    analisadas: analisadas.length,
    aprovadas: tarefas.filter((t) => t.situacao === 'Aprovado').length,
    reprovadas: tarefas.filter((t) => t.situacao === 'Reprovado').length,
    pendentes: tarefas.filter((t) => t.situacao === 'Pendente').length,
    serie: serie(analisadas, (t) => t.envio, (t) => t.horas, flt.g),
    porAnalista: ranking(analisadas, (t) => t.analista, (t) => t.horas, null, (l) => ({
      aprovadas: l.filter((t) => t.situacao === 'Aprovado').length,
      reprovadas: l.filter((t) => t.situacao === 'Reprovado').length,
    })).slice(0, 40),
    porVendedor: ranking(tarefas, (t) => t.vendedor, (t) => t.horas, null, (l) => ({
      reprovadas: l.filter((t) => t.situacao === 'Reprovado').length,
      pctReprovacao: redondo(l.filter((t) => t.situacao === 'Reprovado').length
        / Math.max(1, l.filter((t) => t.analise).length), 4),
    })).slice(0, 60),
    motivosReprovacao: contarTextos(tarefas.map((t) => t.motivo)),
  };

  // ---- ciclos e retrabalho ----
  const comRetrabalho = ciclos.filter((c) => c.retrabalho);
  const cicloStats = {
    ciclos: ciclos.length,
    concluidos: ciclos.filter((c) => c.concluido).length,
    comRetrabalho: comRetrabalho.length,
    pctRetrabalho: ciclos.length ? redondo(comRetrabalho.length / ciclos.length, 4) : null,
    mediaRodadas: ciclos.length ? redondo(ciclos.reduce((s2, c) => s2 + c.rodadas, 0) / ciclos.length) : null,
    horasCiclo: estatistica(ciclos.filter((c) => c.concluido).map((c) => c.horasCiclo)),
    motivos: contarTextos(ciclos.map((c) => c.motivo)),
    porVendedor: ranking(ciclos, (c) => c.vendedor, (c) => c.horasCiclo, null, (l) => ({
      comRetrabalho: l.filter((c) => c.retrabalho).length,
      pctRetrabalho: redondo(l.filter((c) => c.retrabalho).length / l.length, 4),
      devolucoes: l.reduce((s2, c) => s2 + c.devolucoes, 0),
    })).slice(0, 60),
  };

  // ---- fila pendente agora (não respeita o período: é retrato do agora) ----
  const limiteFila = diasAtras(agora, JANELA_FILA_DIAS);
  const pendUmov = querExterno ? s.tarefas.filter((t) => t.situacao === 'Pendente' && t.temCpf) : [];
  const filaUmov = pendUmov.filter((t) => t.envio >= limiteFila)
    .map((t) => ({ idTarefa: t.idTarefa, envio: t.envio, qtdEnvios: t.qtdEnvios, vendedor: t.vendedor, cliente: t.cliente, esperaHoras: horasUteis(t.envio, agora) }))
    .sort((a, b) => (b.envio || '').localeCompare(a.envio || '')); // mais recente primeiro
  const abertasTodas = s.vendas.filter((v) => v.situacao === 'Em aberto' && casaCanal(v, flt));
  const filaElleven = abertasTodas.filter((v) => v.criadoEm >= limiteFila)
    .map((v) => ({
      protocolo: v.protocolo, contrato: v.contrato, cliente: v.cliente, canal: grupoCanal(v),
      vendedor: v.vendedor, criadoEm: v.criadoEm, contatoEm: v.contatoEm, esperaHoras: horasUteis(v.criadoEm, agora),
      equipe: v.equipe, statusProtocolo: v.statusProtocolo,
    }))
    .map((v) => ({ ...v, estourado: v.esperaHoras > METAS.agendamento }))
    .sort((a, b) => (b.criadoEm || '').localeCompare(a.criadoEm || '')); // mais recente primeiro
  const fila = {
    janelaDias: JANELA_FILA_DIAS,
    umov: filaUmov.slice(0, LIMITE_LINHAS),
    umovTotal: filaUmov.length,
    umovMaisAntigas: pendUmov.length - filaUmov.length,
    // o envio mais recente que chegou do Data Hub: diz se a fila está "parada"
    // porque ninguém enviou ou porque o dado não chegou
    umovUltimoEnvio: s.tarefas.reduce((m, t) => (t.envio > m ? t.envio : m), '') || null,
    elleven: filaElleven.slice(0, LIMITE_LINHAS),
    ellevenTotal: filaElleven.length,
    ellevenEstouradas: filaElleven.filter((v) => v.estourado).length,
    ellevenMaisAntigas: abertasTodas.length - filaElleven.length,
  };

  // ---- qualidade do dado ----
  const externasComCpf = externas.filter((v) => v.temCpf);
  const casadas = externas.filter((v) => v.cicloId);
  const gaps = casadas.map((v) => v.diasCicloAteCadastro).filter((x) => x !== null);
  const qualidade = {
    externas: externas.length,
    externasComCpf: externasComCpf.length,
    externasComCiclo: casadas.length,
    pctCruzamento: externas.length ? redondo(casadas.length / externas.length, 4) : null,
    diasCicloAteCadastro: estatistica(gaps),
    cruzamentosAcimaDe7Dias: gaps.filter((x) => x > 7).length,
    ciclosAntigosDescartados: externas.filter((v) => v.cicloAntigoDescartado).length,
    ciclosReprovadosDescartados: externas.filter((v) => v.cicloReprovadoDescartado).length,
    ciclosJaUsadosDescartados: externas.filter((v) => v.cicloJaUsadoDescartado).length,
    diasCicloValido: DIAS_CICLO_VALIDO,
    datasForaDeOrdem: vendas.filter((v) => v.foraDeOrdem).length,
    // o CPF da venda existe no uMov em QUALQUER data? separa "não há ciclo" de
    // "há ciclo, mas depois do cadastro"
    externasComCpfNoUmov: externas.filter((v) => v.cpfNoUmov).length,
    contatoEAgendamentoMesmoHorario: vendas.filter((v) => v.contatoEm && v.contatoEm === v.agendamentoEm).length,
    comContatoEAgendamento: vendas.filter((v) => v.contatoEm && v.agendamentoEm).length,
    analisesAntesDoEnvio: tarefas.filter((t) => t.analiseAntesDoEnvio).length,
    analisesNoPeriodo: analisadas.length,
    fuso: s.diagFuso || null,
    fontes: s.fontes,
    construidoEm: s.construidoEm,
  };

  return {
    metas: METAS, filtros: flt, agora,
    agendamento, cadastro, primeiroContato, totalExterna, totalInterna, triagem, ciclos: cicloStats, fila, qualidade,
  };
}

/**
 * DETALHAMENTO — uma linha por protocolo, com as datas e os SLAs individuais.
 * É onde se enxerga o gap: por que aquela venda estourou, qual marco faltou.
 *
 * Filtros próprios além do período e do canal: busca (protocolo, contrato ou
 * cliente), situação e "só fora da meta". A tela recebe no máximo `limite`
 * linhas; o CSV leva todas.
 */
export function parseFiltrosDetalhe(q = {}) {
  return {
    ...parseFiltrosSla(q),
    busca: String(q.busca || '').trim().toLowerCase().slice(0, 80),
    situacao: String(q.situacao || '').trim() || null,
    fora: q.fora === '1' || q.fora === 'true',
    limite: Math.min(Math.max(Number(q.limite) || 500, 1), 2000),
  };
}

export function detalheSlaBko(flt, agora = agoraLocal()) {
  const linhas = [];
  for (const v of estado.vendas) {
    if (!naJanela(v.criadoEm, flt)) continue;
    if (!casaCanal(v, flt)) continue;
    if (flt.situacao && v.situacao !== flt.situacao) continue;
    if (flt.busca) {
      const alvo = `${v.protocolo ?? ''} ${v.contrato ?? ''} ${v.cliente ?? ''}`.toLowerCase();
      if (!alvo.includes(flt.busca)) continue;
    }
    const aberto = v.situacao === 'Em aberto';
    const espera = aberto ? horasUteis(v.criadoEm, agora) : null;
    const agend = aberto ? espera : v.slaAgendamento;
    const foraCad = v.slaCadastro !== null && v.slaCadastro > METAS.cadastro;
    const foraAg = agend !== null && agend > METAS.agendamento;
    if (flt.fora && !foraCad && !foraAg) continue;
    linhas.push({
      protocolo: v.protocolo,
      contrato: v.contrato,
      cliente: v.cliente,
      canal: grupoCanal(v),
      canalOrigem: v.canal,
      tipo: v.tipo,
      vendedor: v.vendedor,
      envioUmov: v.a1,
      primeiroEnvioUmov: v.primeiroEnvioUmov,
      enviosNoCiclo: v.enviosNoCiclo,
      analiseUmov: v.analiseUmov,
      cadastro: v.criadoEm,
      primeiroContato: v.contatoEm,
      atendenteContato: v.atendenteContato,
      agendamento: v.agendamentoEm,
      atendenteAgendamento: v.atendenteAgendamento,
      cancelado: v.canceladoEm,
      statusProtocolo: v.statusProtocolo,
      equipe: v.equipe,
      situacao: v.situacao,
      slaTriagem: v.slaTriagem,
      slaCadastro: v.slaCadastro,
      sla1Contato: v.sla1Contato,
      slaContatoAgendamento: v.slaContatoAgendamento,
      slaAgendamento: agend,
      agendamentoEmAberto: aberto,
      slaTotalExterna: v.slaTotalExterna,
      foraCadastro: foraCad,
      foraAgendamento: foraAg,
      obsCruzamento: v.obsCruzamento,
    });
  }
  linhas.sort((a, b) => b.cadastro.localeCompare(a.cadastro));
  return {
    total: linhas.length,
    foraDaMeta: linhas.filter((l) => l.foraCadastro || l.foraAgendamento).length,
    situacoes: [...new Set(estado.vendas.map((v) => v.situacao))].sort(),
    todas: linhas,
    linhas: linhas.slice(0, flt.limite),
  };
}

/** CSV no padrão da casa: ';', BOM, decimal com vírgula, data dd/mm/aaaa hh:mm. */
export function detalheParaCsv(linhas) {
  const data = (t) => (t ? `${t.slice(8, 10)}/${t.slice(5, 7)}/${t.slice(0, 4)} ${t.slice(11, 16)}` : '');
  // hh:mm:ss, com as horas passando de 24 quando precisa (62:14:24 = 62 h úteis)
  const horas = (h) => {
    if (h === null || h === undefined || !Number.isFinite(h)) return '';
    const seg = Math.round(h * 3600);
    const p2 = (n) => String(n).padStart(2, '0');
    return `${p2(Math.floor(seg / 3600))}:${p2(Math.floor((seg % 3600) / 60))}:${p2(seg % 60)}`;
  };
  const cel = (v) => {
    const t = v === null || v === undefined ? '' : String(v);
    return /[;"\n\r]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
  };
  const colunas = [
    ['PROTOCOLO', (l) => l.protocolo], ['CONTRATO', (l) => l.contrato], ['CLIENTE', (l) => l.cliente],
    ['CANAL', (l) => l.canal], ['CANAL NO VOALLE', (l) => l.canalOrigem], ['TIPO', (l) => l.tipo],
    ['VENDEDOR', (l) => l.vendedor], ['ENVIO UMOV (A1 - ULTIMO ENVIO)', (l) => data(l.envioUmov)],
    ['1º ENVIO UMOV', (l) => data(l.primeiroEnvioUmov)], ['ENVIOS NO CICLO', (l) => l.enviosNoCiclo ?? ''],
    ['ANALISE UMOV', (l) => data(l.analiseUmov)], ['CADASTRO ELLEVEN (A2/B1)', (l) => data(l.cadastro)],
    ['1º CONTATO (A3/B2)', (l) => data(l.primeiroContato)], ['ATENDENTE 1º CONTATO', (l) => l.atendenteContato],
    ['AGENDAMENTO (A4/B3)', (l) => data(l.agendamento)], ['ATENDENTE AGENDAMENTO', (l) => l.atendenteAgendamento],
    ['CANCELADO EM', (l) => data(l.cancelado)], ['STATUS PROTOCOLO', (l) => l.statusProtocolo],
    ['EQUIPE ATUAL', (l) => l.equipe],
    ['SITUACAO', (l) => l.situacao],
    ['SLA TRIAGEM UMOV (HH:MM:SS UTEIS)', (l) => horas(l.slaTriagem)],
    ['SLA CADASTRO - INPUT A2-A1 (HH:MM:SS UTEIS)', (l) => horas(l.slaCadastro)],
    ['SLA 1º CONTATO (HH:MM:SS UTEIS)', (l) => horas(l.sla1Contato)],
    ['SLA CONTATO ATE AGENDAMENTO (HH:MM:SS UTEIS)', (l) => horas(l.slaContatoAgendamento)],
    ['SLA AGENDAMENTO (HH:MM:SS UTEIS)', (l) => horas(l.slaAgendamento)],
    ['AGENDAMENTO EM ABERTO', (l) => (l.agendamentoEmAberto ? 'sim' : 'não')],
    ['SLA TOTAL EXTERNA (HH:MM:SS UTEIS)', (l) => horas(l.slaTotalExterna)],
    ['FORA DA META CADASTRO (1H)', (l) => (l.foraCadastro ? 'sim' : 'não')],
    ['FORA DA META AGENDAMENTO (12H)', (l) => (l.foraAgendamento ? 'sim' : 'não')],
    ['OBS. CRUZAMENTO UMOV', (l) => l.obsCruzamento],
  ];
  const corpo = linhas.map((l) => colunas.map(([, f]) => cel(f(l))).join(';'));
  return `\uFEFF${[colunas.map(([t]) => t).join(';'), ...corpo].join('\r\n')}\r\n`;
}

function diasAtras(agoraTxt, dias) {
  const d = new Date(`${agoraTxt.slice(0, 10)}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - dias);
  return `${d.toISOString().slice(0, 10)} 00:00:00`;
}

/** Resetar entre testes. */
export function _reiniciarSla() { estado = vazio(); }
