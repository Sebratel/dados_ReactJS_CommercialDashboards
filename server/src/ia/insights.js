/**
 * Camada de interpretação: manda o resumo estatístico ao provedor de IA e
 * recebe leitura + prioridades. A IA NÃO calcula nada — ela lê números que já
 * vieram apurados. É o que garante que nenhum valor exibido seja inventado.
 */
import { provedorAtivo } from './registro.js';
import { resumoParaIA } from '../model/preditivo.js';
import { recortarVisual } from './visuais.js';

const SISTEMA = `Você é analista de dados de uma operação comercial de telecom (fibra, rádio e telefonia).

Recebe um JSON com indicadores JÁ CALCULADOS sobre a base de contratos. Sua função é
interpretar e priorizar — nunca recalcular, nunca inventar números.

Regras:
- Use exclusivamente os números do JSON. Se algo não estiver lá, não afirme.
- Escreva em português do Brasil, direto, sem jargão e sem entusiasmo artificial.
- Uma observação vale mais quando aponta a causa provável e o que fazer a respeito.
- Nomes de vendedores podem ser citados quando o dado os traz.
- Não use emojis.

Responda SOMENTE com um JSON válido, sem cercas de código, neste formato:
{
  "resumo": "2 a 3 frases sobre a situação do mês",
  "insights": [
    {
      "titulo": "frase curta e específica",
      "detalhe": "2 a 4 frases explicando o que os números mostram e a causa provável",
      "acao": "o que fazer, concreto",
      "gravidade": "critico" | "atencao" | "positivo",
      "indicadores": ["número exato citado", "outro número"]
    }
  ],
  "perguntas": ["pergunta que os dados atuais não respondem e valeria investigar"]
}

Entregue de 4 a 6 insights, ordenados do mais urgente para o menos.`;

/** Prompt do botão que fica no cabeçalho de cada gráfico. */
const SISTEMA_VISUAL = `Você é analista de dados de uma operação comercial de telecom (fibra, rádio e telefonia).

Recebe UM visual de um dashboard: o título, o que ele representa e os dados JÁ AGREGADOS
que estão desenhados nele. Sua função é ler esse visual como um analista experiente leria —
apontar o que salta aos olhos, o que passa despercebido e o que merece uma pergunta.

Regras:
- Use exclusivamente os números recebidos. Não estime, não complete, não recalcule.
- Comente o que ESTE visual mostra. Se a conclusão depender de um dado que não está aqui,
  transforme isso em pergunta em vez de afirmar.
- Prefira a comparação concreta ("caiu de 412 para 287 entre março e abril") ao adjetivo.
- Quando os dados vierem cortados no topo N, não trate o último colocado como o pior de todos.
- Escreva em português do Brasil, direto, sem jargão e sem entusiasmo artificial.
- Não use emojis.

Responda SOMENTE com um JSON válido, sem cercas de código, neste formato:
{
  "resumo": "1 a 2 frases sobre o que este visual está dizendo",
  "insights": [
    {
      "titulo": "frase curta e específica",
      "detalhe": "2 a 3 frases com o número que sustenta a observação e a causa provável",
      "acao": "o que fazer a respeito, ou string vazia se não houver ação óbvia",
      "gravidade": "critico" | "atencao" | "positivo",
      "indicadores": ["número exato citado"]
    }
  ],
  "perguntas": ["pergunta que este visual levanta mas não responde"]
}

Entregue de 2 a 4 insights, do mais relevante para o menos, e no máximo 2 perguntas.`;

export function iaConfigurada() {
  return !!provedorAtivo();
}

function exigirProvedor() {
  const ativo = provedorAtivo();
  if (!ativo) {
    const erro = new Error('Nenhum provedor de IA configurado. Um administrador pode cadastrar a chave em Configurações.');
    erro.status = 503;
    throw erro;
  }
  return ativo;
}

/** Converte a resposta do modelo em objeto, tolerando cerca de código e texto solto. */
function interpretar(texto, ativo) {
  const limpo = String(texto || '').trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '');
  const assinatura = {
    provedor: ativo.cfg.tipo,
    modelo: ativo.cfg.modelo,
    geradoEm: new Date().toISOString(),
  };
  try {
    return { ...JSON.parse(limpo), ...assinatura };
  } catch {
    // se não veio JSON, entrega o texto para o usuário não ficar sem nada
    return {
      resumo: limpo.slice(0, 1200),
      insights: [],
      perguntas: [],
      formatoInesperado: true,
      ...assinatura,
    };
  }
}

export async function gerarInsights(analise) {
  const ativo = exigirProvedor();
  const resumo = resumoParaIA(analise);
  const texto = await ativo.provedor.conversar(
    SISTEMA,
    `Indicadores da operação comercial:\n\n${JSON.stringify(resumo, null, 1)}`,
  );
  return interpretar(texto, ativo);
}

/**
 * Leitura de um único visual. Recebe o ID e os filtros — nunca os dados: quem
 * remonta os números é o servidor, pela mesma função que desenha o gráfico.
 */
export async function gerarInsightsVisual(id, flt, g) {
  const ativo = exigirProvedor();
  const { titulo, oQueE, dados, tela } = recortarVisual(id, flt, g);

  const periodo = flt.de || flt.ate
    ? `Período filtrado: ${flt.de || 'início'} a ${flt.ate || 'hoje'}.`
    : 'Sem filtro de período: o visual mostra todo o histórico carregado.';
  const recortes = [
    flt.vendedor?.length && `vendedores: ${flt.vendedor.join(', ')}`,
    flt.equipe?.length && `equipes: ${flt.equipe.join(', ')}`,
    flt.tecnologia?.length && `tecnologias: ${flt.tecnologia.join(', ')}`,
  ].filter(Boolean);

  const texto = await ativo.provedor.conversar(
    SISTEMA_VISUAL,
    [
      `Visual: ${titulo}`,
      `O que ele mostra: ${oQueE}`,
      periodo,
      recortes.length ? `Filtros ativos — ${recortes.join(' | ')}.` : 'Sem filtros de vendedor, equipe ou tecnologia.',
      '',
      'Dados desenhados no visual:',
      JSON.stringify(dados, null, 1),
    ].join('\n'),
  );

  return { ...interpretar(texto, ativo), visual: id, tela, titulo };
}
