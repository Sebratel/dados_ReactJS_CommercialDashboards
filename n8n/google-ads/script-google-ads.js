/**
 * GOOGLE ADS → n8n → DB_Marketing.marketing_google_ads
 *
 * Script do Google Ads (Ferramentas › Ações em massa › Scripts) que envia, uma
 * vez por dia, o desempenho das campanhas dos últimos dias para o fluxo do n8n
 * "MKT · Google Ads → DB_Marketing (carga diária)", que grava no MariaDB.
 *
 * Substitui a exportação manual do relatório "Performance da campanha" para a
 * tabela `DB_Marketing.marketing_google_ads`, lida pela tela de Campanhas do
 * dashboard comercial.
 *
 * COMO INSTALAR
 *   1. Google Ads › Ferramentas › Ações em massa › Scripts › "+" Novo script.
 *   2. Cole este arquivo inteiro e troque CHAVE pelo valor combinado (não versionar).
 *   3. Autorizar → Visualizar (roda sem gravar nada no Google; ENVIA para o n8n).
 *   4. Frequência: Diariamente, 06:00.
 *
 * POR QUE OS ÚLTIMOS 7 DIAS, E NÃO SÓ ONTEM
 *   O Google revisa custo e conversões de dias recentes (conversão atribuída
 *   depois do clique, cliques inválidos estornados). Reenviar a janela inteira
 *   todo dia corrige esses dias; o fluxo grava por campanha + dia, sem duplicar.
 *
 * POR QUE HOJE NÃO ENTRA
 *   O dia corrente está incompleto. Entraria com números parciais e só seria
 *   corrigido amanhã — e quem abrisse a tela no meio do dia veria um custo menor.
 *
 * Se o envio falhar, o script termina com erro: o Google Ads registra a falha
 * no histórico de execuções e avisa por e-mail quem o instalou.
 */
var CONFIG = {
  URL: 'https://n8n-prod.sebratel.net.br/webhook/mkt-google-ads-campanhas',
  CABECALHO: 'X-Chave-Carga',
  CHAVE: 'COLE_A_CHAVE_AQUI',
  DIAS: 7,
};

function main() {
  var conta = AdsApp.currentAccount();
  var fuso = conta.getTimeZone();
  var umDia = 24 * 60 * 60 * 1000;
  var agora = new Date();
  var ate = Utilities.formatDate(new Date(agora.getTime() - umDia), fuso, 'yyyy-MM-dd');
  var de = Utilities.formatDate(new Date(agora.getTime() - CONFIG.DIAS * umDia), fuso, 'yyyy-MM-dd');

  var consulta = [
    'SELECT campaign.id, campaign.name, campaign.status, campaign.advertising_channel_type,',
    '  customer.currency_code, segments.date,',
    '  metrics.clicks, metrics.impressions, metrics.ctr, metrics.average_cpc, metrics.cost_micros,',
    '  metrics.absolute_top_impression_percentage, metrics.top_impression_percentage,',
    '  metrics.conversions, metrics.view_through_conversions, metrics.cost_per_conversion,',
    '  metrics.conversions_from_interactions_rate',
    'FROM campaign',
    "WHERE segments.date BETWEEN '" + de + "' AND '" + ate + "'",
    '  AND metrics.impressions > 0',
  ].join('\n');

  var micros = function (v) { return v ? Number(v) / 1e6 : 0; };
  var fracao = function (v) { return v === undefined || v === null ? null : Number(v); };

  var linhas = [];
  var resultado = AdsApp.search(consulta);
  while (resultado.hasNext()) {
    var r = resultado.next();
    linhas.push({
      campanha: r.campaign.name,
      campanhaId: String(r.campaign.id),
      estado: r.campaign.status,
      tipo: r.campaign.advertisingChannelType,
      dia: r.segments.date,
      moeda: r.customer.currencyCode,
      cliques: Number(r.metrics.clicks || 0),
      impressoes: Number(r.metrics.impressions || 0),
      ctr: Number(r.metrics.ctr || 0),
      cpcMedio: micros(r.metrics.averageCpc),
      custo: micros(r.metrics.costMicros),
      impressaoTopoAbsoluto: fracao(r.metrics.absoluteTopImpressionPercentage),
      impressaoTopo: fracao(r.metrics.topImpressionPercentage),
      conversoes: Number(r.metrics.conversions || 0),
      conversoesVisualizacao: Number(r.metrics.viewThroughConversions || 0),
      custoPorConversao: micros(r.metrics.costPerConversion),
      taxaConversao: Number(r.metrics.conversionsFromInteractionsRate || 0),
    });
  }

  if (!linhas.length) {
    Logger.log('Nenhuma campanha com impressão entre ' + de + ' e ' + ate + '. Nada a enviar.');
    return;
  }

  var corpo = {
    conta: conta.getCustomerId(),
    geradoEm: new Date().toISOString(),
    de: de,
    ate: ate,
    linhas: linhas,
  };
  var cabecalhos = {};
  cabecalhos[CONFIG.CABECALHO] = CONFIG.CHAVE;

  var resposta = UrlFetchApp.fetch(CONFIG.URL, {
    method: 'post',
    contentType: 'application/json',
    headers: cabecalhos,
    payload: JSON.stringify(corpo),
    muteHttpExceptions: true,
  });
  var codigo = resposta.getResponseCode();
  var texto = resposta.getContentText();
  if (codigo !== 200) {
    throw new Error('O n8n recusou o envio (HTTP ' + codigo + '): ' + texto.slice(0, 500));
  }
  Logger.log('Enviado: ' + linhas.length + ' linhas de ' + de + ' a ' + ate + '. Resposta: ' + texto);
}
