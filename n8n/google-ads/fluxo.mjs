/**
 * Definição do fluxo "MKT · Google Ads → DB_Marketing (carga diária)".
 *
 * O JSON publicado no n8n é GERADO a partir daqui (ver ../publicar.mjs). Editar o
 * fluxo pela tela do n8n e não trazer a mudança para este arquivo faz o
 * repositório descrever outra coisa — a próxima publicação apaga a edição.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const codigoValidacao = fs.readFileSync(path.join(AQUI, 'validar-e-montar-sql.js'), 'utf8');

export const NOME = 'MKT · Google Ads → DB_Marketing (carga diária)';
export const CAMINHO_WEBHOOK = 'mkt-google-ads-campanhas';

const SOBRE = `## MKT · Google Ads → DB_Marketing

**O que faz.** Recebe, uma vez por dia, o desempenho das campanhas do Google Ads e grava em \`DB_Marketing.marketing_google_ads\` — a tabela da tela **Campanhas** do dashboard comercial. Substitui a exportação manual do relatório "Performance da campanha".

**Origem.** Script do Google Ads (*Ferramentas › Ações em massa › Scripts*), agendado diariamente às 06:00. Envia os **últimos 7 dias, sem hoje**: o Google revisa custo e conversão de dias recentes, e reenviar a janela corrige isso.

**Por que n8n.** O script roda nos servidores do Google, fora da rede. O webhook do n8n já é alcançável de fora (o Matrix usa o mesmo caminho), então o dado chega ao MariaDB sem abrir o proxy do dashboard nem o banco.

**Código-fonte.** Repositório \`dados_ReactJS_CommercialDashboards\`, pasta \`n8n/google-ads/\` (fluxo, script e validação). Publicar com \`node n8n/publicar.mjs --aplicar\` — editar só pela tela faz o repositório mentir.

**Responsável.** Inteligência de Dados.`;

const CONTRATO = `## Contrato

**POST** \`/webhook/${CAMINHO_WEBHOOK}\`
Cabeçalho \`X-Chave-Carga\` (credencial *MKT · Google Ads · chave do webhook*). Sem ele: 403.

Corpo: \`conta\`, \`geradoEm\`, \`de\`, \`ate\` e \`linhas\` — uma por campanha e dia, com \`campanhaId\`, \`dia\` (AAAA-MM-DD), métricas em número e frações para CTR e taxas.

**Respostas**
- **200** — gravado: total de linhas, campanhas e período.
- **400** — lote recusado, com o motivo (nada é gravado).
- **500** — falha ao gravar: vai para o fluxo de erro global (AUT_GLOBAL_ERR) e o script do Google registra a falha.

**Idempotente.** A chave da tabela é ID da campanha + Dia: reenviar o mesmo período regrava, não duplica.`;

const ARMADILHAS = `## Decisões e armadilhas

**SQL montado no Code, não upsert nativo.** A chave é composta (ID + Dia) e o upsert do nó MySQL casa por UMA coluna — cada dia sobrescreveria o anterior. Além disso, nesta instância o \`queryReplacement\` não vincula os \`?\` (medido em 06/10/2026). Os valores são validados por tipo e escapados um a um.

**Números como texto em português** ('216,95', '17,5%'): é o formato da carga manual, e a tela lê assim.

**Linhas do SQL unidas com espaço antes da quebra.** O nó apaga a quebra de linha sem pôr espaço e colava palavras.

**Blocos de 200 linhas.** Falha num bloco não desfaz os anteriores — e não precisa: reenviar o lote corrige, porque a gravação é idempotente.

**Reprocessar um período.** Rodar o script de novo no Google Ads (Executar agora) ou mudar \`CONFIG.DIAS\` temporariamente para cobrir o buraco.`;

const nota = (id, conteudo, [x, y], [largura, altura], cor) => ({
  id,
  name: id,
  type: 'n8n-nodes-base.stickyNote',
  typeVersion: 1,
  position: [x, y],
  parameters: { content: conteudo, width: largura, height: altura, ...(cor ? { color: cor } : {}) },
});

export function montarFluxo({ credMySql, credChave, fluxoDeErro }) {
  const nodes = [
    nota('Sobre', SOBRE, [-80, -620], [620, 540]),
    nota('Contrato', CONTRATO, [580, -620], [560, 540], 5),
    nota('Decisões e armadilhas', ARMADILHAS, [1180, -620], [600, 540], 3),
    {
      id: 'a1f0c3e2-1111-4c4a-9b0a-000000000001',
      name: 'Receber lote do Google Ads',
      type: 'n8n-nodes-base.webhook',
      typeVersion: 2,
      position: [0, 0],
      webhookId: 'b7e2f1a4-6c1d-4f7e-9a2b-5d3c8e9f0a11',
      parameters: {
        httpMethod: 'POST',
        path: CAMINHO_WEBHOOK,
        authentication: 'headerAuth',
        responseMode: 'responseNode',
        options: {},
      },
      credentials: { httpHeaderAuth: credChave },
      notes: 'Autenticado pelo cabeçalho X-Chave-Carga. Responde só no fim (nó "Responder"), para o script do Google saber se gravou de verdade.',
      notesInFlow: true,
    },
    {
      id: 'a1f0c3e2-1111-4c4a-9b0a-000000000002',
      name: 'Validar lote e montar SQL',
      type: 'n8n-nodes-base.code',
      typeVersion: 2,
      position: [260, 0],
      parameters: { jsCode: codigoValidacao },
      notes: 'Valida tipo de cada campo e escapa os valores. Lote inválido sai com valido=false (responde 400, nada é gravado). Fonte: n8n/google-ads/validar-e-montar-sql.js.',
      notesInFlow: true,
    },
    {
      id: 'a1f0c3e2-1111-4c4a-9b0a-000000000003',
      name: 'Lote válido?',
      type: 'n8n-nodes-base.if',
      typeVersion: 2,
      position: [520, 0],
      parameters: {
        conditions: {
          options: { caseSensitive: true, leftValue: '', typeValidation: 'strict', version: 2 },
          conditions: [{
            id: 'c0ffee00-0000-4000-8000-000000000001',
            leftValue: '={{ $json.valido }}',
            rightValue: '',
            operator: { type: 'boolean', operation: 'true', singleValue: true },
          }],
          combinator: 'and',
        },
        options: {},
      },
    },
    {
      id: 'a1f0c3e2-1111-4c4a-9b0a-000000000004',
      name: 'DB_Marketing: gravar campanhas',
      type: 'n8n-nodes-base.mySql',
      typeVersion: 2.5,
      position: [780, -100],
      parameters: { operation: 'executeQuery', query: '={{ $json.query }}', options: {} },
      credentials: { mySql: credMySql },
      notes: 'INSERT ... ON DUPLICATE KEY UPDATE pela chave ID da campanha + Dia. Um comando por bloco de 200 linhas. Falha aqui vai para o fluxo de erro global.',
      notesInFlow: true,
    },
    {
      id: 'a1f0c3e2-1111-4c4a-9b0a-000000000005',
      name: 'Responder: gravado',
      type: 'n8n-nodes-base.respondToWebhook',
      typeVersion: 1.1,
      position: [1040, -100],
      parameters: {
        respondWith: 'json',
        responseBody: "={{ JSON.stringify({ ok: true, linhas: $('Validar lote e montar SQL').first().json.total, campanhas: $('Validar lote e montar SQL').first().json.campanhas, de: $('Validar lote e montar SQL').first().json.de, ate: $('Validar lote e montar SQL').first().json.ate }) }}",
        options: {},
      },
    },
    {
      id: 'a1f0c3e2-1111-4c4a-9b0a-000000000006',
      name: 'Responder: lote recusado',
      type: 'n8n-nodes-base.respondToWebhook',
      typeVersion: 1.1,
      position: [780, 120],
      parameters: {
        respondWith: 'json',
        responseBody: '={{ JSON.stringify({ ok: false, erro: $json.erro }) }}',
        options: { responseCode: 400 },
      },
      notes: 'Nada foi gravado. O script do Google Ads termina com erro e mostra este motivo.',
      notesInFlow: true,
    },
  ];

  const connections = {
    'Receber lote do Google Ads': { main: [[{ node: 'Validar lote e montar SQL', type: 'main', index: 0 }]] },
    'Validar lote e montar SQL': { main: [[{ node: 'Lote válido?', type: 'main', index: 0 }]] },
    'Lote válido?': {
      main: [
        [{ node: 'DB_Marketing: gravar campanhas', type: 'main', index: 0 }],
        [{ node: 'Responder: lote recusado', type: 'main', index: 0 }],
      ],
    },
    'DB_Marketing: gravar campanhas': { main: [[{ node: 'Responder: gravado', type: 'main', index: 0 }]] },
  };

  return {
    name: NOME,
    nodes,
    connections,
    settings: {
      executionOrder: 'v1',
      ...(fluxoDeErro ? { errorWorkflow: fluxoDeErro } : {}),
      saveDataErrorExecution: 'all',
      saveDataSuccessExecution: 'all',
      saveManualExecutions: true,
      timezone: 'America/Sao_Paulo',
    },
  };
}
