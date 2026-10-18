# Fluxos de n8n do dashboard comercial

Fluxos que alimentam as tabelas lidas pelo dashboard e que rodam no n8n de
produção (`n8n-prod.sebratel.net.br`). O que está publicado no n8n é **gerado a
partir desta pasta** — editar só pela tela do n8n faz o repositório descrever
outro fluxo, e a próxima publicação apaga a edição.

## MKT · Google Ads → DB_Marketing (carga diária)

| | |
|---|---|
| **ID no n8n** | `1qgD0L9VpbUJOSYr` |
| **Gatilho** | Webhook `POST /webhook/mkt-google-ads-campanhas`, cabeçalho `X-Chave-Carga` |
| **Origem** | Script do Google Ads, diário às 06:00, últimos 7 dias sem hoje |
| **Destino** | `DB_Marketing.marketing_google_ads` (chave: ID da campanha + Dia) |
| **Quem lê** | Tela **Campanhas** do dashboard (Google Ads e Visão geral) |
| **Erros** | Fluxo global `AUT_GLOBAL_ERR`; o script do Google também registra a falha |

```
Google Ads (script diário) ──POST──> n8n: validar ──> MariaDB (upsert) ──> resposta 200
                                          └── lote inválido ──> resposta 400, nada gravado
```

**Por que assim.** O script roda nos servidores do Google, fora da rede. O
webhook do n8n já é alcançável de fora (o Matrix usa o mesmo caminho), então o
dado chega ao banco sem abrir o proxy do dashboard nem o MariaDB, e sem planilha
no meio.

### Arquivos

| Arquivo | O que é |
|---|---|
| `google-ads/fluxo.mjs` | Definição do fluxo, com as notas do canvas |
| `google-ads/validar-e-montar-sql.js` | Código do nó "Validar lote e montar SQL" (testado em `server/test/n8n-google-ads.test.mjs`) |
| `google-ads/script-google-ads.js` | Script a colar no Google Ads (a chave NÃO fica aqui) |
| `google-ads/fluxo.json` | O JSON gerado e publicado — não editar à mão |
| `credenciais.json` | IDs das credenciais no n8n (só os IDs, nenhum segredo) |
| `publicar.mjs` | Cria as credenciais (uma vez) e cria/atualiza o fluxo |

### Publicar uma alteração

```bash
node n8n/publicar.mjs --env=<.env com N8N_BASE_URL e N8N_API_KEY>            # ensaio
node n8n/publicar.mjs --env=<.env com N8N_BASE_URL e N8N_API_KEY> --aplicar  # publica
```

O publicador **nunca ativa** o fluxo. Ativar e desativar é pela tela do n8n.

### Credenciais

- **`dbMaria_DB_Marketing`** — MySQL no banco `DB_Marketing`, mesmo usuário do dashboard.
- **`MKT · Google Ads · chave do webhook`** — cabeçalho `X-Chave-Carga`. O valor
  está em `dashboard/.env` como `GOOGLE_ADS_CHAVE_WEBHOOK` (fora do git) e vai
  no `CONFIG.CHAVE` do script do Google Ads. Para trocar: edite a credencial no
  n8n e o script no Google Ads, nos dois lados ao mesmo tempo.

### Decisões que não são óbvias

- **SQL montado no nó Code, não o "upsert" nativo.** A chave é composta (ID + Dia)
  e o upsert do nó MySQL casa por uma coluna só; além disso, nesta instância o
  `queryReplacement` não vincula os `?`. Os valores são validados por tipo e
  escapados.
- **Números gravados como texto em português** (`'216,95'`, `'17,5%'`): é o
  formato que a carga manual sempre usou e que a tela lê.
- **Janela de 7 dias reenviada todo dia.** O Google revisa custo e conversão de
  dias recentes; a gravação é idempotente, então reenviar corrige.

### Reprocessar um período

No Google Ads, abra o script, aumente `CONFIG.DIAS` (ex.: 40), clique em
**Executar**, e volte para 7. A gravação regrava os dias, não duplica. A janela
aceita pelo fluxo é de até 400 dias para trás.
