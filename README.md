# COM · Gestão Comercial — dashboard React

Réplica em React do relatório Power BI **COM - Gestão Comercial**, com os mesmos gráficos,
medidas, layout e paleta de cores — porém lendo os bancos em tempo quase real, sem depender
do refresh manual do Power BI Service.

O arquivo `.pbip` de origem não é versionado aqui; ele continua com o time de BI e serviu
como especificação da réplica (as consultas e medidas equivalentes estão documentadas abaixo).

```
dashboard/
├── server/          API Node/Express + cache em memória (o "modelo semântico")
│   └── src/sql/     réplica em SQL das consultas do Power Query
├── web/             front React (Vite + Recharts)
├── Dockerfile       imagem única (build do front + API)
└── docker-compose.yml
```

---

## 1. Como os dados chegam

| Fonte no Power BI | Aqui | Banco |
|---|---|---|
| `general` (dsn=dbVoalle) | `src/sql/base.sql` | Voalle · PostgreSQL |
| `ALOCAÇÃO/ATIVAÇÃO` | `src/sql/aloc.sql` | Voalle |
| `phone activation` | `src/sql/phone.sql` | Voalle |
| `PAGAMENTO` | `src/sql/pagto.sql` | Voalle |
| `new_sellers` (users) | `src/sql/sellers.sql` | Voalle |
| `teams` (Comercial_Teams) | `src/sql/maria.js` | MariaDB |
| `senior_admitted` | `src/sql/maria.js` | MariaDB |

O servidor carrega essas consultas, faz os mesmos *merges* que o Power Query fazia
(`src/model/store.js`) e mantém a tabela de fatos em memória (~120 mil contratos, ~60 MB).
As páginas consultam a API, que agrega em milissegundos.

### Frequência de atualização

| Grupo | O que lê | Custo | Padrão | Variável |
|---|---|---|---|---|
| `hot` | janela dos últimos 60 dias de vendas, ativações e primeiro pagamento | ~5 s | **2 min** | `REFRESH_HOT_MS` |
| `full` | recarga completa desde `DATA_SINCE` | ~25 s | **30 min** | `REFRESH_FULL_MS` |
| `dims` | equipes, RH, usuários | < 1 s | **15 min** | `REFRESH_DIMS_MS` |

A carga incremental é o que mantém **novas vendas, ativações e primeiro pagante** quase em
tempo real sem pesar no Voalle: em vez de reler 120 mil contratos (≈20 s de consulta), lê só
os ~5 mil da janela (≈0,8 s) e faz merge no cache. A recarga completa a cada 30 min corrige
qualquer alteração retroativa. A janela é ajustável em `INCREMENTAL_DAYS`.

O front revalida a cada 60 s e mostra no topo quando os dados foram lidos pela última vez.
O botão ⟳ força uma atualização imediata do grupo `hot` (`POST /api/refresh?group=hot`).

---

## 2. Login e controle de acesso

O acesso é por **conta Google corporativa** (mesmo fluxo do `churn_mvp`): o front usa o
Google Identity Services, manda o `access_token` no header `Authorization` e o servidor
confere o token no `userinfo` do Google, exige o domínio permitido e resolve o papel.

### Papéis

| Papel | O que vê |
|---|---|
| **viewer** | telas liberadas para todos + telas onde o e-mail está na lista |
| **dev** | as telas do viewer + o **catálogo de queries** (SQL, estatísticas e teste com LIMIT) |
| **admin** | todas as telas + **Usuários e papéis** e **Acesso por tela** |

> **DEV e admin são atribuições diferentes, não níveis.** O catálogo de queries é exclusivo
> do papel `dev` — o administrador gerencia pessoas e permissões, mas não enxerga o SQL do
> sistema. No servidor isso é `exigirAuth({ papeis: ['dev'] })`, comparação exata em vez de
> hierárquica. Consequência prática: um e-mail que esteja em `ADMIN_EMAILS` **e** em
> `DEV_EMAILS` resolve para `admin` e, portanto, **não** vê as queries — use contas
> diferentes para cada atribuição.

O papel efetivo é o **maior** entre a semente do `.env` (`ADMIN_EMAILS` / `DEV_EMAILS`) e o
que estiver em `access.json`. Assim sempre existe um admin para abrir a tela, e a tela não
consegue rebaixar quem está no `.env`.

### Acesso por tela

Em **Configurações → Acesso por tela** cada uma das 9 telas aparece em uma linha da tabela
com o modo de acesso e as pessoas liberadas:

* **Todos** — qualquer conta do domínio;
* **Restrito** — só os e-mails da lista, editados como chips (Enter adiciona, × remove).

O salvamento é imediato a cada alteração; ao remover o último e-mail a tela volta
sozinha para **Todos**, que é o estado equivalente.

Administradores enxergam todas as telas independentemente do modo. O backend valida a
permissão **em cada endpoint** (não é só a navegação que some), e a configuração fica em
`access.json`, no volume do container.

### Antes do primeiro login

No **Google Cloud Console → Credenciais → ID do cliente OAuth**, inclua em *Origens
JavaScript autorizadas* a URL de onde o dashboard é servido — por exemplo
`http://localhost:8080` (local) e o endereço publicado no Portainer. Sem isso o Google
recusa o popup de login.

Para desenvolver sem Google, use `AUTH_ENABLED=false` — o servidor libera tudo como admin.
**Nunca** use isso em produção.

## 3. Rodando local

```bash
cd dashboard/server && npm install && npm start
```

```bash
cd dashboard/web && npm install && npm run dev
```

O Vite sobe em `http://localhost:5173` e faz proxy de `/api` para `http://localhost:8080`.
Credenciais: copie `.env.example` para `.env` (senhas com `#` precisam de aspas simples).

---

## 4. Deploy no Portainer

### Opção A — Stack apontando para o repositório

Em **Stacks → Add stack → Repository**, informe o repositório, o caminho
`dashboard/docker-compose.yml` e cadastre as variáveis de ambiente:

```
DB_VOALLE_HOST=ip-do-voalle
DB_VOALLE_DATABASE=nome-do-banco
DB_VOALLE_USER=usuario-voalle
DB_VOALLE_PASSWORD=********
DB_VOALLE_PORT=5432
DB_MARIA_HOST=ip-do-mariadb
DB_MARIA_DATABASE=DB_Applicattion
DB_MARIA_USER=usuario-mariadb
DB_MARIA_PASSWORD=********
DB_MARIA_PORT=3306
HOST_PORT=8081
```

> ⚠️ **Aspas nas senhas.** No arquivo `dashboard/.env` (lido pelo Node local e pela
> interpolação do compose) a senha com `#` **precisa** de aspas simples — o dotenv trata
> `#` como início de comentário. Já nas variáveis do stack do Portainer e em
> `docker run -e` a senha vai **sem aspas**, senão elas viram parte da senha.

### Opção B — imagem construída na máquina

```bash
cd dashboard
docker build -t comercial-dashboard:1.0.0 .
docker save comercial-dashboard:1.0.0 | gzip > comercial-dashboard.tar.gz
```

Suba o `.tar.gz` em **Images → Import** e crie o container mapeando a porta do host para a
`8080` do container, com as mesmas variáveis acima.

> **Porta.** A `8080` do servidor já está em uso, então o compose publica em **8081**
> (`8081:8080`) — dentro do container a aplicação continua na 8080. Para mudar, use a
> variável `HOST_PORT` no stack, sem mexer no compose.

O container expõe:

* `GET /` — dashboard (no servidor: `http://<host>:8081`)
* `GET /api/health` — usado pelo healthcheck (`start_period` de 90 s: a carga inicial leva ~40 s)

> O container precisa de rota para `ip-do-voalle:5432` (Voalle) e `ip-do-mariadb:3306` (MariaDB).

---

## 5. Páginas e medidas

| Página | Visuais | Medidas |
|---|---|---|
| **Capa** | objetivo, indicadores, status das fontes | — |
| **Diretoria** | 3 blocos de cartões + área "Resumo dos 3 principais indicadores" com linha de tendência | `TOTAL ATIVOS`, `MEDIA ATIVOS`, `TOTAL VENDAS`, `VALOR DO TICKET`, `MEDIA VENDAS`, `TOTAL PRIMEIRO PAGANTE`, `VALOR` |
| **Primeiro Pagamento** | combo mês (qtd + valor), planos mais vendidos, relatório detalhado | `Qtd primeiro pagante`, `SUM(VALOR)` |
| **Ativações** | combo mês, cartões, CANAL VOALLE, TOTAL/CIDADE, ATIVOS/VENDEDOR | `Total ativos`, `MEDIA ATIVOS` |
| **Ativações - Histórico** | matriz vendedor × dia (mapa de calor) | `CountNonNull(ATIVOS[CLIENTES])` |
| **Vendas** | combo vendas × ativações, cartões, TOTAL/CIDADE, VENDAS/VENDEDOR, empilhado por tecnologia | `Total vendas`, `MEDIA VENDAS` |
| **Vendas - Histórico** | matriz vendedor × dia | `CountNonNull(CADASTRO[CLIENTES])` |
| **Rampagem** | combo VENDA 90 × ATIVO 90, cartões, cidade, tabelas de novatos | `VENDAS_RAMPAGEM`, `ATIVOS_RAMPAGEM`, `Dias_Trabalhados` |
| **Premiações** | duas tabelas (>60 dias e ≤60 dias) | `ValorFaixa`, `FaixaPorPagamento`, `ValorPorTempoDeCasa`, `ValorFinal`, `ValorFaixaAtivo`, `FaixaPorAtivo` |

### Cores das faixas de premiação

As duas tabelas de Premiações reproduzem o `linearGradient3` do relatório
(`#D8A579` → `#BACDDF` → `#7FCE79`) nas colunas de quantidade, faixa e valores.
A base do gradiente é `ValorFaixa` na tabela dos >60 dias e a contagem de ativações
na dos ≤60 dias.

Como as faixas de **Interno** (0 → R$ 3.393, exigindo 100–260+ pagamentos) e
**Externo** (0 → R$ 2.745, com 10–60+) têm escalas incompatíveis, o padrão é
calcular o gradiente **dentro de cada situação** — assim um externo no topo da
escala dele fica tão verde quanto um interno no topo da dele. O botão no cabeçalho
alterna para **geral**, que é a escala única do Power BI.

### Granularidade dos gráficos de coluna

Os combos de Vendas, Ativações, Primeiro Pagamento, Diretoria e Rampagem têm um
alternador **mês / dia** no cabeçalho. A escolha vai para a URL (`?g=dia`), então o
link compartilhado abre do mesmo jeito. Acima de 24 colunas o gráfico entra em modo
denso: barras mais finas, rótulos escondidos (a leitura passa para o tooltip) e
marcações de eixo espaçadas.

### Medidas que exigiram atenção

* **`MEDIA VENDAS` / `MEDIA ATIVOS`** — média ponderada por dia útil: domingo e feriado
  valem 0, sábado 0,5 e os demais 1. Só entram no cálculo os dias que aparecem nos dados
  (mesmo comportamento de `VALUES()` no DAX). Feriados em `src/model/holidays.js`
  (a tabela do Power BI parava em 2025; 2026 e 2027 foram acrescentados).
* **Cada projeção usa a sua data** — vendas por `DATA CRIAÇÃO CONTRATO`, ativações por
  `DATA ATIVAÇÃO`, primeiro pagamento por `PAGAMENTO CLIENTE` — exatamente como os três
  relacionamentos com a tabela `calendar`.
* **Premiações** — as faixas de TELEFONIA só valem quando uma única tecnologia está
  selecionada no filtro, replicando o `SELECTEDVALUE(tecnology[TECNOLOGIA])`.
* **`DATA ATIVAÇÃO`** — telefonia usa `MAX(reports.final_date)`; fibra/rádio usam a saída
  do equipamento, ignorando os casos em que ele retornou no mesmo dia.

---

## 6. Diferenças propositais em relação ao Power BI

1. **Layout responsivo que cabe em uma tela**, em vez da tela fixa de 1920×1125.

   A altura de cada visual é derivada da área útil da janela:

   ```css
   --chrome: topbar (52) + navegação (36) + filtros (50) + respiros (34)
   --util:   calc(100vh - var(--chrome))
   .v-grafico { height: clamp(258px, calc((var(--util) - 10px) * 0.455), 430px); }
   .v-tabela  { height: clamp(280px, calc((var(--util) - 10px) * 0.545), 500px); }
   ```

   Resultado medido: em 1440×900, 1366×768 e 1920×1080 as páginas de Vendas, Ativações,
   Primeiro Pagamento, Diretoria e Históricos fecham com **1 px de sobra** — sem rolagem
   e sem gráfico cortado. Só Premiações rola ~40 px (duas tabelas + aviso).

   | Largura | Comportamento |
   |---|---|
   | ≥ 1100 px | as três colunas do relatório, com as proporções originais |
   | 860–1100 px | o trio vira dupla; o terceiro visual ocupa a linha inteira |
   | < 860 px | uma coluna, cartões lado a lado |
   | altura < 780 px | filtros e cartões encolhem (telas 720p / projetor) |

   Os gráficos de barra horizontal calculam a espessura da barra pela altura disponível,
   então **nunca ficam cortados no meio** — só rolam se as barras cairiam abaixo de 13 px.

2. **Barra de filtros em uma linha.** Os seis cartões de slicer do Power BI (125 px de
   altura) viraram botões compactos de 30 px que abrem o seletor em popover, fixos abaixo
   da navegação. O cromo caiu de **232 px para 139 px** — 93 px a mais de gráfico por tela.

3. **Um único estilo de card.** No relatório original algumas tabelas tinham borda vinho de
   2 px e os gráficos não tinham borda nenhuma. Aqui todo visual usa a mesma moldura
   (borda 1 px `#E3E0DC`, raio 8 px, sombra sutil) e o mesmo cabeçalho vinho de 32 px.
4. **Eixos duplos** — no Power BI o combo de vendas usava dois eixos. Como as duas séries
   são contagens de clientes, aqui elas dividem a mesma escala (leitura correta e visual
   idêntico, já que o eixo é oculto). Só a página de primeiro pagamento mantém escalas
   separadas (quantidade × R$), com rótulos diretos em ambas as séries.
5. **Filtro de cliente** é uma busca por texto, não uma lista com 120 mil nomes.
   O *cross-filter* do Power BI está nos gráficos de barras: clicar em uma cidade
   (ou canal) filtra a página inteira; clicar de novo remove.
6. **Períodos longos** na página Histórico agrupam a matriz por mês (acima de ~2 meses),
   evitando uma tabela com centenas de colunas.
7. A paleta é a do relatório (`#880F17`, `#D9B300`, `#E66C37`). O dourado tem contraste
   baixo sobre branco — por isso todas as barras trazem rótulo de valor legível, além da
   tabela equivalente ao lado.

---

## 7. Endpoints

| Endpoint | Retorna |
|---|---|
| `GET /api/meta` | versão do cache, horário de cada fonte, nº de contratos |
| `GET /api/filters` | listas dos slicers + período disponível |
| `GET /api/diretoria` | cartões + série mensal dos 3 indicadores |
| `GET /api/vendas` | cartões, série mensal, cidade, vendedor, dia × tecnologia |
| `GET /api/ativacoes` | cartões, série mensal, canal, cidade, vendedor |
| `GET /api/primeiro-pagamento` | cartões, série, planos, detalhe |
| `GET /api/historico/:vendas\|ativos` | matriz vendedor × dia |
| `GET /api/rampagem` | novatos < 90 dias |
| `GET /api/premiacoes` | faixas de premiação |
| `POST /api/refresh?group=hot\|full\|dims` | força releitura |
| `GET /api/auth/config` | client_id do Google e domínio (público) |
| `GET /api/me` | e-mail, papel e telas liberadas |
| `GET/PUT/DELETE /api/access/users` | papéis (admin) |
| `GET/PUT /api/access/screens` | acesso por tela (admin) |
| `GET /api/queries` · `POST /api/queries/:id/test` | catálogo de queries (exclusivo do papel `dev`) |

Todos aceitam os filtros: `de`, `ate`, `vendedor`, `equipe`, `tecnologia`, `situacao`,
`cidade`, `canal`, `cliente` (listas separadas por vírgula) e `g=mes|dia` (granularidade
da série dos gráficos de coluna).

---

## 8. Exportações

Duas formas de tirar o dado da tela:

* **Botão `CSV` no cabeçalho de cada tabela** — baixa exatamente o que está no visual,
  com as mesmas colunas, os filtros aplicados e a ordenação escolhida. É processado no
  navegador, sem ida ao servidor.
* **Aba `Exportações`** — sete conjuntos completos gerados pelo servidor, sem o corte que
  as telas aplicam. O relatório de primeiros pagamentos, por exemplo, mostra 1.500 linhas
  na tela e exporta as 18.723 do período.

| Conjunto | Tela que controla o acesso |
|---|---|
| Vendas (contratos criados) | vendas |
| Ativações | ativacoes |
| Primeiro pagamento | primeiro-pagamento |
| Premiações (>60 e ≤60 dias) | premiacoes |
| Rampagem (novatos) | rampagem |
| Resumo por vendedor | vendas |

O ACL por tela vale para o download: quem não vê Premiações recebe 403 ao tentar exportá-la,
e o conjunto nem aparece na lista.

**Formato:** CSV com separador `;`, BOM UTF-8, decimal com vírgula e datas `dd/mm/aaaa` —
abre no Excel em português com duplo clique, sem assistente de importação. O nome do arquivo
carrega o período (`vendas_2026-01-01_a_2026-08-15.csv`).

> O download passa por `fetch` com o Bearer e entrega um blob. Link direto (`href`) não
> leva o header de autenticação e devolveria 401.

## 9. Convenções de interface

* **Sem emojis.** Todos os ícones são SVG traçado em `web/src/components/Icone.jsx`,
  herdando a cor do texto via `currentColor`. Isso vale inclusive para os títulos que o
  Power BI trazia com emoji (`Resumo Diretoria`, `Resumo dos 3 principais indicadores`).
* **Um estilo de card só** — borda 1 px, raio 8 px, cabeçalho vinho de 32 px.
* **Altura derivada da janela** (`--util`), nunca fixa em pixels.
