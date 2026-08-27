/**
 * Montagem dos painéis — o que cada tela de gráficos devolve.
 *
 * Vive fora das rotas porque tem dois consumidores: o endpoint que alimenta os
 * gráficos e o de insights de IA. Se cada um montasse a sua versão, a leitura da
 * IA poderia divergir do que o usuário está vendo na tela — que é justamente o
 * tipo de erro que ninguém percebe. Aqui os dois leem da mesma função.
 */
import {
  DATE_FIELD, groupCount, matriz, mediaPonderada, porVendedor, premiacoes, rampagem,
  rows, rowsExceto, semCampo, serie, serieDiaria, serieDiariaPorTecnologia,
  seriePorTecnologia, soma,
} from './measures.js';
import { monthKey, today } from './dates.js';

/**
 * Corta a lista em `limite` mas mantém as linhas ESCOLHIDAS, mesmo fora do topo.
 *
 * É o `garantir` do `groupCount` para listas montadas à mão: sem ele, filtrar por um
 * plano de cauda o tirava da tabela de quarenta linhas, e a tela ficava recortada por
 * algo que não aparecia em lugar nenhum.
 */
function comOsEscolhidos(lista, limite, escolhidos, chaveDe) {
  if (lista.length <= limite) return lista;
  const cabeca = lista.slice(0, limite);
  if (!escolhidos || !escolhidos.length) return cabeca;
  const dentro = new Set(cabeca.map(chaveDe));
  for (const linha of lista.slice(limite)) {
    const k = chaveDe(linha);
    if (escolhidos.includes(k) && !dentro.has(k)) cabeca.push(linha);
  }
  return cabeca;
}

/**
 * Marca os rótulos-sentinela — "(sem canal)", "(sem equipe)" — como não clicáveis.
 *
 * Eles não são valor de banco: `matchDims` compara com o campo cru, então filtrar por
 * "(sem canal)" devolvia tela vazia. A barra continua desenhada e contando; só não
 * convida ao clique.
 */
const semSentinela = (linhas) => linhas.map((l) => (
  String(l.key).startsWith('(') ? { ...l, semFiltro: true } : l
));

export function painelDiretoria(flt, g) {
  const vendas = rows('vendas', flt);
  const ativos = rows('ativos', flt);
  const pagantes = rows('pagantes', flt);

  /**
   * A série MOSTRA o período, então ignora o recorte de período (o `zoom`) — mesmo
   * motivo de todo o resto: um visual que mostra um campo não pode ser calculado com o
   * filtro daquele campo, senão colapsa numa coluna só. Os KPIs acima seguem
   * recortados.
   */
  const meses = new Map();
  const put = (list, field, campo) => {
    for (const m of serie(list, field, g)) {
      const cur = meses.get(m.periodo) || { periodo: m.periodo, vendas: 0, pagantes: 0, ativacoes: 0 };
      cur[campo] = m.qtd;
      meses.set(m.periodo, cur);
    }
  };
  put(rowsExceto('vendas', flt, 'zoom', vendas), 'dtVenda', 'vendas');
  put(rowsExceto('pagantes', flt, 'zoom', pagantes), 'dtPagto', 'pagantes');
  put(rowsExceto('ativos', flt, 'zoom', ativos), 'dtAtiv', 'ativacoes');

  return {
    kpis: {
      totalAtivos: ativos.length,
      mediaAtivos: mediaPonderada(ativos, 'dtAtiv'),
      totalVendas: vendas.length,
      valorTicket: soma(vendas),
      mediaVendas: mediaPonderada(vendas, 'dtVenda'),
      totalPagantes: pagantes.length,
      valorPagantes: soma(pagantes),
    },
    granularidade: g,
    serie: [...meses.values()].sort((a, b) => a.periodo.localeCompare(b.periodo)),
  };
}

export function painelVendas(flt, g) {
  const vendas = rows('vendas', flt);
  const ativos = rows('ativos', flt);

  // combo "TOTAL DE VENDAS / MÊS (ou DIA)": colunas = vendas, linha = ativações.
  // A coluna É o período, e clicar nela recorta o período — então este visual ignora
  // o próprio recorte, como o de cidades ignora o de cidade.
  const meses = new Map();
  for (const m of serie(rowsExceto('vendas', flt, 'zoom', vendas), 'dtVenda', g)) {
    meses.set(m.periodo, { periodo: m.periodo, vendas: m.qtd, ativacoes: 0, valor: m.valor });
  }
  for (const m of serie(rowsExceto('ativos', flt, 'zoom', ativos), 'dtAtiv', g)) {
    const cur = meses.get(m.periodo) || { periodo: m.periodo, vendas: 0, ativacoes: 0, valor: 0 };
    cur.ativacoes = m.qtd;
    meses.set(m.periodo, cur);
  }

  /**
   * "TOTAL DE VENDAS / DIA (MÊS ATUAL)" — último mês do período filtrado, e o mês
   * CLICADO quando há um: clicar na coluna de março abre os dias de março ao lado, que
   * é o detalhamento que a pessoa está pedindo com aquele clique.
   */
  const mesAtual = monthKey((flt.zoom && flt.zoom.ate) || flt.ate || today());

  /**
   * Cross-highlight: cada visual CLICÁVEL ignora o seu próprio campo, senão ele
   * colapsa na categoria que a pessoa acabou de clicar — clicar em SALVADOR deixava
   * uma barra só no gráfico de cidades, sem nada para comparar, que é o oposto do
   * motivo do clique.
   *
   * Os KPIs e a série do topo continuam com o filtro CHEIO, de propósito: eles
   * respondem "quanto deu o que você escolheu", que é outra pergunta.
   */
  const paraCidade = rowsExceto('vendas', flt, 'cidade', vendas);
  const paraVendedor = rowsExceto('vendas', flt, 'vendedor', vendas);
  const paraTecnologia = rowsExceto('vendas', flt, 'tecnologia', vendas);
  const doMes = paraTecnologia.filter((f) => monthKey(f.dtVenda) === mesAtual);

  return {
    kpis: {
      totalVendas: vendas.length,
      valorTicket: soma(vendas),
      mediaVendas: mediaPonderada(vendas, 'dtVenda'),
      totalAtivos: ativos.length,
    },
    granularidade: g,
    serie: [...meses.values()].sort((a, b) => a.periodo.localeCompare(b.periodo)),
    porCidade: groupCount(paraCidade, (f) => f.cidade, { limit: 15, garantir: flt.cidade }),
    porVendedor: porVendedor(paraVendedor, 'dtVenda'),
    // Rodapé da tabela por vendedor. Com auto-exclusão ele não é mais o KPI da tela:
    // a tabela mostra todos os vendedores e o cartão mostra o selecionado. Somar as
    // linhas visíveis e chamar isso de "total" é a única leitura que fecha.
    porVendedorTotais: { total: paraVendedor.length, media: mediaPonderada(paraVendedor, 'dtVenda') },
    mesAtual,
    porDia: serieDiariaPorTecnologia(doMes, 'dtVenda', flt.tecnologia),
  };
}

export function painelAtivacoes(flt, g) {
  const ativos = rows('ativos', flt);

  // auto-exclusão dos visuais clicáveis — ver o comentário em `painelVendas`
  const paraTecnologia = rowsExceto('ativos', flt, 'tecnologia', ativos);
  const paraCanal = rowsExceto('ativos', flt, 'canal', ativos);
  const paraCidade = rowsExceto('ativos', flt, 'cidade', ativos);
  const paraVendedor = rowsExceto('ativos', flt, 'vendedor', ativos);

  // a série é por período E por tecnologia, então ignora os dois filtros que ela mostra
  const paraSerie = rowsExceto('ativos', flt, ['tecnologia', 'zoom'], ativos);
  const porTec = seriePorTecnologia(paraSerie, 'dtAtiv', g, flt.tecnologia);
  const totalTelefonia = ativos.reduce((a, f) => a + (f.tecnologia === 'TELEFONIA' ? 1 : 0), 0);

  return {
    kpis: {
      totalAtivos: ativos.length,
      mediaAtivos: mediaPonderada(ativos, 'dtAtiv'),
      valor: soma(ativos),
      // o relatório do Power BI não mostra a telefonia; separar aqui deixa o
      // total reconciliável com ele sem precisar refazer a conta na mão
      totalTelefonia,
      totalFibraRadio: ativos.length - totalTelefonia,
    },
    granularidade: g,
    // `ativacoes` é o mesmo que `total`, mantido porque a série já era consumida
    // com esse nome pelo gráfico e pelas exportações
    serie: porTec.map((m) => ({ ...m, ativacoes: m.total })),
    porCanal: semSentinela(groupCount(paraCanal, (f) => f.canal || '(sem canal)', { limit: 12, garantir: flt.canal })),
    porCidade: groupCount(paraCidade, (f) => f.cidade, { limit: 15, garantir: flt.cidade }),
    porVendedor: porVendedor(paraVendedor, 'dtAtiv'),
    porVendedorTotais: { total: paraVendedor.length, media: mediaPonderada(paraVendedor, 'dtAtiv') },
    // não é clicável (o eixo é o dia), então segue com o filtro cheio
    porDia: serieDiaria(ativos, 'dtAtiv'),
  };
}

export function painelPrimeiroPagamento(flt, g, { limit = 1500 } = {}) {
  const doModelo = rows('pagantes', flt);

  /**
   * `plano` é filtro desta página (ver `parseFilters`). A tabela de planos MOSTRA o
   * campo, então ela é montada sobre a lista SEM esse filtro — é o cross-highlight: a
   * tabela continua listando todos os planos, com o escolhido aceso, enquanto o
   * gráfico, os KPIs e o detalhamento recortam.
   */
  const nomePlano = (f) => f.plano || '(sem plano)';
  const comPlano = (lista) => (
    flt.plano ? lista.filter((f) => flt.plano.includes(nomePlano(f))) : lista
  );
  const pagantes = comPlano(doModelo);

  // "Planos mais vendidos": agrupado pelo valor do plano
  const planos = new Map();
  for (const f of doModelo) {
    const key = `${nomePlano(f)}|${(Number(f.valor) || 0).toFixed(2)}`;
    const cur = planos.get(key) || { plano: nomePlano(f), valorPadrao: Number(f.valor) || 0, qtd: 0, valorTotal: 0 };
    cur.qtd += 1;
    cur.valorTotal += Number(f.valor) || 0;
    planos.set(key, cur);
  }

  const detalhe = pagantes
    .slice()
    .sort((a, b) => (b.dtPagto || '').localeCompare(a.dtPagto || ''))
    .slice(0, limit)
    .map((f) => ({
      vendedor: f.vendedor,
      cliente: f.cliente,
      dtPagto: f.dtPagto,
      plano: f.plano,
      tecnologia: f.tecnologia,
      valor: f.valor,
      contrato: f.contrato,
    }));

  return {
    kpis: {
      totalPagantes: pagantes.length,
      valor: soma(pagantes),
      media: mediaPonderada(pagantes, 'dtPagto'),
    },
    granularidade: g,
    /**
     * A série ignora o recorte de PERÍODO (é ela que o mostra) mas mantém o de plano:
     * `rowsExceto` volta ao `rows`, que não conhece `plano`, então o filtro precisa ser
     * reaplicado por cima — sem isso, clicar num plano e depois num mês devolvia a
     * série de todos os planos.
     */
    serie: serie(comPlano(rowsExceto('pagantes', flt, 'zoom', doModelo)), 'dtPagto', g)
      .map((m) => ({ periodo: m.periodo, pagantes: m.qtd, valor: m.valor })),
    planos: comOsEscolhidos(
      [...planos.values()].sort((a, b) => b.qtd - a.qtd),
      40,
      flt.plano,
      (l) => l.plano,
    ),
    porVendedor: porVendedor(pagantes, 'dtPagto'),
    detalhe,
    detalheTotal: pagantes.length,
  };
}

export function painelHistorico(dataset, flt, granularidade) {
  const list = rows(dataset, flt);
  return { granularidade, ...matriz(list, DATE_FIELD[dataset], granularidade) };
}

/**
 * Granularidade da matriz de histórico.
 *
 * O AUTOMÁTICO é o padrão e continua sendo: acima de ~2 meses a matriz vira mensal,
 * senão ela fica com mais colunas do que cabe na tela e ninguém lê.
 *
 * Mas quem pede pode FORÇAR o dia, mesmo num período longo — foi pedido de quem usa a
 * tela, e a razão é boa: às vezes a pergunta é sobre o dia dentro de um trimestre, e
 * consolidar por mês apaga exatamente o que se quer ver. O controle fica no cabeçalho
 * do visual, e a tela diz quantas colunas o pedido gerou.
 *
 * `pedido` vem da tela: 'dia', 'mes' ou nada (automático).
 */
export function granularidadeHistorico(pedido, flt) {
  if (pedido === 'dia' || pedido === 'mes') return pedido;
  const dias = flt.de && flt.ate
    ? Math.round((new Date(flt.ate) - new Date(flt.de)) / 86400000)
    : 999;
  return dias > 62 ? 'mes' : 'dia';
}


/**
 * O motivo do cancelamento vem do Voalle como uma frase de até 230 caracteres:
 * um prefixo fixo, o motivo de verdade no meio e a justificativa do procedimento
 * no fim. Num gráfico de barras isso não cabe, e pior: o MESMO motivo aparece
 * várias vezes só porque a justificativa mudou de redação ("Sem comprovante de
 * Endereço" chega a se dividir em quatro fatias). Aqui fica só o miolo, que é o
 * que se lê e o que agrupa direito. O texto completo continua inteiro no
 * detalhamento e na exportação.
 */
export function motivoCurto(texto) {
  const bruto = String(texto || '').trim();
  if (!bruto) return '(sem motivo informado)';
  let m = bruto.split(/\s*[-.]\s*Justificativa\s*:/i)[0];
  m = m.replace(/^cancelamento de contrato\s*-\s*/i, '');
  m = m.replace(/^cancelamento\s*-\s*/i, '');
  // "Cliente cancelado por falta de pagamento" não usa o separador acima
  m = m.replace(/^cliente cancelado por\s+/i, '');
  m = m.replace(/\.$/, '').trim();
  if (!m) return bruto;
  return m.charAt(0).toUpperCase() + m.slice(1);
}

/** Cabeças que não informam nada — o motivo real está na justificativa. */
const CABECA_GENERICA = /^(contrato cancelado|cancelamento de contrato|cancelamento)$/i;

const justificativaDe = (texto) => String(texto || '')
  .split(/Justificativa\s*:/i)[1]?.trim().toLowerCase() || '';

/**
 * O mesmo motivo é registrado de duas formas no Voalle: com o nome no meio
 * ("... - Desistência - Justificativa: Cliente desistiu de instalar.") ou com uma
 * cabeça genérica ("Contrato Cancelado. Justificativa: Cliente desistiu de
 * instalar."). São 496 contratos, 1,4%, caindo num balde que não diz nada.
 *
 * Em vez de traduzir textos na mão, o mapa é APRENDIDO dos próprios dados: as
 * linhas que trazem o motivo nomeado ensinam a que motivo cada justificativa
 * pertence, e as genéricas são reclassificadas por ele. Se amanhã criarem um
 * motivo novo, ele entra sozinho; se a justificativa for desconhecida, a linha
 * fica como está em vez de ser adivinhada.
 */
function classificadorDeMotivo(lista) {
  const votos = new Map();
  for (const f of lista) {
    const curto = motivoCurto(f.statusCancelamento);
    if (CABECA_GENERICA.test(curto)) continue;
    const just = justificativaDe(f.statusCancelamento);
    if (!just) continue;
    const porMotivo = votos.get(just) || new Map();
    porMotivo.set(curto, (porMotivo.get(curto) || 0) + 1);
    votos.set(just, porMotivo);
  }
  // empate resolvido pelo mais frequente, para o resultado não depender da ordem
  const mapa = new Map();
  for (const [just, porMotivo] of votos) {
    const [melhor] = [...porMotivo].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    mapa.set(just, melhor[0]);
  }
  return (f) => {
    const curto = motivoCurto(f.statusCancelamento);
    if (!CABECA_GENERICA.test(curto)) return curto;
    return mapa.get(justificativaDe(f.statusCancelamento)) || curto;
  };
}

/**
 * Quatro motivos respondem por 95% dos cancelamentos e a cauda tem itens de uma
 * ocorrência. Deixá-los como barras próprias produz fatias invisíveis e rouba
 * altura das que importam, então a cauda vira uma linha só — que continua
 * clicável no detalhamento e some da lista quando não há nada nela.
 */
function dobrarCauda(lista, manter) {
  if (lista.length <= manter + 1) return lista;
  const cabeca = lista.slice(0, manter);
  const resto = lista.slice(manter);
  const soma = resto.reduce((a, r) => a + r.valor, 0);
  if (!soma) return cabeca;
  return [...cabeca, { key: `Outros (${resto.length} motivos)`, valor: soma, agrupado: true }];
}

/**
 * VENDAS CANCELADAS — réplica da tela única do relatório "COM - Vendas Canceladas".
 *
 * O recorte é dado pelos dois filtros de página daquele relatório: contrato
 * cancelado E sem data de ativação, ou seja, a venda que se perdeu antes de
 * virar instalação. Contrato cancelado depois de ativado não entra aqui.
 *
 * Duas fidelidades que exigiram atenção:
 *
 * 1. Aquele relatório não considera os tipos de atendimento #HR (1254/1255), ao
 *    contrário do resto do modelo. Em vez de uma segunda carga da base inteira
 *    para 0,2% dos contratos, `base.sql` marca quem tem algum atendimento da
 *    lista dele e o filtro usa essa marca — mesmo conjunto, sem custo extra.
 *
 * 2. O filtro de período do relatório é a DATA DO CONTRATO, mas o gráfico mensal
 *    agrupa por CADASTRO DO CLIENTE. As duas só coincidem em 70% dos casos, então
 *    a diferença é real; mantemos como está lá e dizemos no título do visual qual
 *    data cada um usa.
 */
/**
 * Campos que esta página recorta pelo `rows` — os cinco do modelo mais o `zoom`, que é
 * o recorte de período nascido do clique na coluna do gráfico.
 */
const DIMS_CANCELADAS = ['cidade', 'tecnologia', 'equipe', 'situacao', 'vendedor', 'zoom'];

export function painelCanceladas(flt) {
  // os dois filtros de página do relatório de origem, mais a marca de tipo padrão
  const recorte = (f) => f.statusContrato === 'Cancelado' && !f.dtAtiv && f.temTipoPadrao;
  const daPagina = rows('vendas', flt).filter(recorte);

  /**
   * O classificador é montado sobre a base SEM os filtros de motivo e tipo, de
   * propósito: ele decide o rótulo de cada motivo por votação sobre a lista inteira, e
   * treiná-lo já filtrado mudaria o nome do que sobrou — o rótulo clicado deixaria de
   * existir no clique seguinte.
   */
  const classificarMotivo = classificadorDeMotivo(daPagina);

  /**
   * Base de um visual, ignorando o campo que ele MOSTRA (cross-highlight).
   *
   * `campo` pode ser um dos cinco do modelo, e aí o recorte sai do próprio `rows`, ou
   * um dos dois desta página (`motivo`, `tipo`), aplicados aqui porque `matchDims` não
   * os conhece — o porquê está em `parseFilters`.
   *
   * Sem argumento devolve a base filtrada por tudo: é o que alimenta os KPIs, a série e
   * o detalhamento. E quando o campo não está filtrado a lista já calculada volta como
   * está, então tela sem clique custa uma varredura só, como antes.
   */
  const baseDo = (campo = null) => {
    let out = campo && flt[campo] && DIMS_CANCELADAS.includes(campo)
      ? rows('vendas', semCampo(flt, campo)).filter(recorte)
      : daPagina;
    if (flt.motivo && campo !== 'motivo') {
      out = out.filter((f) => flt.motivo.includes(classificarMotivo(f)));
    }
    if (flt.tipo && campo !== 'tipo') {
      out = out.filter((f) => flt.tipo.includes(f.tipoSolicitacao || '(sem tipo)'));
    }
    return out;
  };

  const canceladas = baseDo();

  // Duas séries, e a razão é prática: o relatório agrupa por cadastro do cliente,
  // mas o cliente pode ter se cadastrado anos antes de fechar o contrato. Num
  // único mês de vendas isso espalha o gráfico por 47 meses, quase todos com uma
  // barra de valor 1 e um pico no fim — ilegível. A série por data da venda é a
  // coerente com o filtro de período e vira o padrão; a do cadastro fica a um
  // clique, para quem precisa conferir contra o Power BI.
  const agrupar = (campo, lista = canceladas) => {
    const m = new Map();
    for (const f of lista) {
      const d = f[campo];
      const k = d ? monthKey(d) : '(sem data)';
      const cur = m.get(k) || { periodo: k, canceladas: 0, valor: 0 };
      cur.canceladas += 1;
      cur.valor += Number(f.valor) || 0;
      m.set(k, cur);
    }
    return [...m.values()].sort((a, b) => a.periodo.localeCompare(b.periodo));
  };

  // "por valor": mesma ideia dos planos, agrupando pelo valor do contrato
  const porValor = new Map();
  for (const f of canceladas) {
    const v = Number(f.valor) || 0;
    const cur = porValor.get(v) || { valor: v, qtd: 0 };
    cur.qtd += 1;
    porValor.set(v, cur);
  }

  const detalhe = canceladas
    .slice()
    .sort((a, b) => (b.dtVenda || '').localeCompare(a.dtVenda || ''))
    // amostra: a tabela mostra ~10 linhas por vez, então 2000 no DOM era peso sem
    // leitor. Quem precisa de tudo usa o CSV completo, que não passa por aqui.
    .slice(0, 400)
    .map((f) => ({
      dtVenda: f.dtVenda,
      horaVenda: f.horaVenda,
      contrato: f.contrato,
      cliente: f.cliente,
      cidade: f.cidade,
      vendedor: f.vendedor,
      situacao: f.situacao,
      statusContrato: f.statusContrato,
      statusCancelamento: f.statusCancelamento,
      valor: f.valor,
      tecnologia: f.tecnologia,
    }));

  return {
    kpis: {
      total: canceladas.length,
      valor: soma(canceladas),
      ticketMedio: canceladas.length ? soma(canceladas) / canceladas.length : 0,
    },
    // as duas séries mostram o período: ignoram o recorte que saiu do clique nelas
    serie: agrupar('dtVenda', baseDo('zoom')),
    serieCadastro: agrupar('dtCadastroCliente', baseDo('zoom')),
    porMotivo: dobrarCauda(groupCount(baseDo('motivo'), classificarMotivo, { garantir: flt.motivo }), 8),
    porCidade: groupCount(baseDo('cidade'), (f) => f.cidade, { limit: 20, garantir: flt.cidade }),
    porTecnologia: groupCount(baseDo('tecnologia'), (f) => f.tecnologia, { garantir: flt.tecnologia }),
    porEquipe: semSentinela(groupCount(baseDo('equipe'), (f) => f.equipe || '(sem equipe)', { limit: 20, garantir: flt.equipe })),
    porSituacao: semSentinela(groupCount(baseDo('situacao'), (f) => f.situacao || '(sem situação)', { garantir: flt.situacao })),
    porVendedor: groupCount(baseDo('vendedor'), (f) => f.vendedor, { limit: 30, garantir: flt.vendedor }),
    porTipo: semSentinela(groupCount(baseDo('tipo'), (f) => f.tipoSolicitacao || '(sem tipo)', { garantir: flt.tipo })),
    porValor: [...porValor.values()].sort((a, b) => b.qtd - a.qtd).slice(0, 25),
    detalhe,
    detalheTotal: canceladas.length,
  };
}

/** Um painel por id de tela — usado pelo motor de insights. */
export const PAINEIS = {
  diretoria: (flt, g) => painelDiretoria(flt, g),
  vendas: (flt, g) => painelVendas(flt, g),
  ativacoes: (flt, g) => painelAtivacoes(flt, g),
  'primeiro-pagamento': (flt, g) => painelPrimeiroPagamento(flt, g),
  rampagem: (flt, g) => rampagem(flt, g),
  premiacoes: (flt) => premiacoes(flt),
  'vendas-canceladas': (flt) => painelCanceladas(flt),
  'vendas-historico': (flt) => painelHistorico('vendas', flt, granularidadeHistorico(null, flt)),
  'ativacoes-historico': (flt) => painelHistorico('ativos', flt, granularidadeHistorico(null, flt)),
};
