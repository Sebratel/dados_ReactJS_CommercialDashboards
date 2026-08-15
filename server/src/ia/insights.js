/**
 * Camada de interpretação: manda o resumo estatístico ao provedor de IA e
 * recebe leitura + prioridades. A IA NÃO calcula nada — ela lê números que já
 * vieram apurados. É o que garante que nenhum valor exibido seja inventado.
 */
import { provedorAtivo } from './registro.js';
import { resumoParaIA } from '../model/preditivo.js';

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

export function iaConfigurada() {
  return !!provedorAtivo();
}

export async function gerarInsights(analise) {
  const ativo = provedorAtivo();
  if (!ativo) {
    const erro = new Error('Nenhum provedor de IA configurado. Um administrador pode cadastrar a chave em Configurações.');
    erro.status = 503;
    throw erro;
  }

  const resumo = resumoParaIA(analise);
  const texto = await ativo.provedor.conversar(
    SISTEMA,
    `Indicadores da operação comercial:\n\n${JSON.stringify(resumo, null, 1)}`,
  );

  // o modelo às vezes embrulha em cerca de código, mesmo pedindo para não
  const limpo = String(texto || '').trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '');

  try {
    const json = JSON.parse(limpo);
    return {
      ...json,
      provedor: ativo.cfg.tipo,
      modelo: ativo.cfg.modelo,
      geradoEm: new Date().toISOString(),
    };
  } catch {
    // se não veio JSON, entrega o texto para o usuário não ficar sem nada
    return {
      resumo: limpo.slice(0, 1200),
      insights: [],
      perguntas: [],
      formatoInesperado: true,
      provedor: ativo.cfg.tipo,
      modelo: ativo.cfg.modelo,
      geradoEm: new Date().toISOString(),
    };
  }
}
