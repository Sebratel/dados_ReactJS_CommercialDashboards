/**
 * Cache das respostas dos painéis.
 *
 * Existe por causa do cross-filter. Antes dele a tela era carregada e ficava; agora
 * é exploração — a pessoa clica numa cidade, volta, clica noutra, e cada volta
 * refazia a varredura inteira da tabela de fatos. Junte a isso o auto-refresh: cada
 * aba aberta repete a MESMA consulta a cada 60 s, então vinte abas na tela de Vendas
 * com o período padrão são vinte varreduras idênticas por minuto.
 *
 * Duas decisões que fazem este cache ser seguro em vez de esperto:
 *
 * 1. **A versão do modelo entra na chave.** Uma carga nova troca todas as chaves de
 *    uma vez, então não existe invalidação para alguém esquecer de chamar. E como a
 *    carga incremental roda a cada dois minutos, nada aqui pode ficar mais velho do
 *    que o próprio dado.
 * 2. **A chave é a query INTEIRA, já reescrita pelo middleware de escopo.** É lá que
 *    `equipe` é cruzada com as equipes que a pessoa pode ver (`aplicarEscopo`), então
 *    dois usuários com escopos diferentes produzem chaves diferentes. Cachear antes
 *    disso — por rota e filtro "pedido" — serviria o dado de uma equipe para quem não
 *    pode enxergá-la. Por isso a função recebe `req.query` e não o filtro já
 *    interpretado: o que vale é o que o middleware deixou ali.
 *
 * O valor guardado é COMPARTILHADO entre requisições: quem consome não pode mutá-lo.
 * Os handlers só espalham o objeto em outro (`withMeta`), o que é seguro.
 */

/** Entradas simultâneas. 240 cobre ~20 abas explorando três telas sem se atropelar. */
const MAX = 240;

/**
 * Validade. Dois minutos é o intervalo da carga incremental — o mesmo tempo que o
 * dado leva para poder mudar. Passar disso seria mostrar número velho; ficar muito
 * abaixo jogaria fora o acerto justamente do auto-refresh, que é de 60 s.
 */
const TTL_MS = 120000;

const mapa = new Map(); // Map itera na ordem de inserção: dá LRU sem estrutura extra
let acertos = 0;
let faltas = 0;

const chave = (nome, versao, query) => {
  const partes = Object.keys(query).sort().map((k) => `${k}=${query[k]}`);
  return `${nome}|v${versao}|${partes.join('&')}`;
};

/**
 * Devolve o painel do cache ou calcula e guarda.
 *
 * `nome` identifica a rota (duas rotas com a mesma query são respostas diferentes),
 * `versao` é a do modelo que alimentou o painel — a do comercial para as telas
 * comerciais, a de cada modelo próprio para as demais.
 */
export function comCache({ nome, versao, query }, calcular) {
  const k = chave(nome, versao, query);
  const agora = Date.now();
  const achado = mapa.get(k);
  if (achado && agora - achado.em < TTL_MS) {
    acertos += 1;
    // reinsere para virar o mais recente
    mapa.delete(k);
    mapa.set(k, achado);
    return achado.valor;
  }

  faltas += 1;
  const valor = calcular();
  mapa.delete(k);
  mapa.set(k, { valor, em: agora });
  while (mapa.size > MAX) {
    const maisAntiga = mapa.keys().next().value;
    mapa.delete(maisAntiga);
  }
  return valor;
}

/**
 * Diagnóstico para o `/meta`. Cache sem medida é fé: sem a taxa de acerto ninguém
 * descobre que a chave está errada e que ele nunca acerta.
 */
export function estatisticasCache() {
  const total = acertos + faltas;
  return {
    entradas: mapa.size,
    acertos,
    faltas,
    taxa: total ? Number((acertos / total).toFixed(3)) : null,
  };
}

/** Usado pelo refresh manual: joga tudo fora sem esperar a versão virar. */
export function limparCache() {
  mapa.clear();
}
