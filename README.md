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
| `SPLITTER_(GERAL)` ¹ | `src/sql/splitters.sql` | Voalle |
| `SPLITTER_(OCUPADA_/_DISPONIVEIS)` + `SPLITTER_(OCUPACAO)` ¹ | `src/sql/splitter_ocupacao.sql` | Voalle |
| `leads` ² | `src/sql/leads.sql` | Voalle |
| `negotiations` ² | `src/sql/negotiations.sql` | Voalle |

¹ do relatório **COM - Condomínios**, um `.pbip` separado. Ver a seção *Condomínios*.
² do relatório **COM - Leads & Negociações**. Ver a seção *Leads e Negociações*.

O servidor carrega essas consultas, faz os mesmos *merges* que o Power Query fazia
(`src/model/store.js`) e mantém a tabela de fatos em memória (~120 mil contratos, ~60 MB).
As páginas consultam a API, que agrega em milissegundos.

**Três modelos, não um.** Cada relatório replicado tem o seu estado em memória, porque o
grão é diferente em cada um:

| Modelo | Arquivo | Grão | Tamanho hoje |
|---|---|---|---|
| comercial | `src/model/store.js` | um contrato vendido | ~120 mil contratos |
| condomínios | `src/model/condominios.js` | uma porta de splitter | ~55 mil portas, 3.885 splitters |
| CRM | `src/model/leads.js` | um lead + uma negociação | ~68 mil leads, ~31 mil negociações |

Na mesma tabela de fatos, toda medida comercial passaria a precisar excluir linhas que não
são venda — e a primeira que esquecesse contaria porta de splitter como contrato.
Consequência prática: cada tela abre mesmo que a carga das outras esteja rodando ou tenha
falhado. O modelo de CRM tem a única dependência entre eles: lê a equipe do vendedor da
fonte `teams` que o modelo comercial já carrega (ver a seção *Leads e Negociações*).

### Frequência de atualização

| Grupo | O que lê | Custo | Padrão | Variável |
|---|---|---|---|---|
| `hot` | janela dos últimos 60 dias de vendas, ativações e primeiro pagamento | ~5 s | **2 min** | `REFRESH_HOT_MS` |
| `full` | recarga completa desde `DATA_SINCE` | ~25 s | **30 min** | `REFRESH_FULL_MS` |
| `dims` | equipes, RH, usuários | < 1 s | **15 min** | `REFRESH_DIMS_MS` |
| `cond` | splitters de condomínio e ocupação das portas | ~15 s | **10 min** | `REFRESH_COND_MS` |
| `crm` | leads e negociações | ~25 s | **10 min** | `REFRESH_CRM_MS` |

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
| **dev** | viewer com o atributo de power user já marcado |
| **admin** | todas as telas + **Usuários e papéis**, **Acesso por tela** e **Provedor de IA** |

O papel efetivo é o **maior** entre a semente do `.env` (`ADMIN_EMAILS` / `DEV_EMAILS`) e o
que estiver em `access.json`. Assim sempre existe um admin para abrir a tela, e a tela não
consegue rebaixar quem está no `.env`.

### Power user: um atributo, não um degrau

Administrar pessoas e ler o SQL do sistema são atribuições diferentes, então o **catálogo de
queries não é concedido pelo papel de admin**. Mas ele também não é *negado* por ele: power
user é uma marcação à parte, fora da hierarquia — `exigirAuth({ powerUser: true })`.

| Quem | Papel | Vê as queries |
|---|---|---|
| está em `DEV_EMAILS` | qualquer um | sim |
| tem papel `dev` | dev | sim |
| marcado na tela de usuários | qualquer um | sim |
| admin sem nenhuma das marcações | admin | **não** |

A primeira versão modelava `dev` como degrau (`viewer < dev < admin`) e exigia igualdade
exata do papel. O efeito colateral: quem estava nas duas listas resolvia para `admin` e
perdia o acesso ao SQL, sem conta possível que fosse as duas coisas. Separar o atributo da
escada resolve isso mantendo a regra original de pé.

Em **Configurações → Usuários e papéis** a coluna *Power user* liga e desliga a marcação sem
tocar no papel. Quem vem de `DEV_EMAILS` aparece cadeado — a tela não rebaixa a semente.

### Acesso por tela: matriz pessoas x telas

Em **Configurações → Acesso por tela** cada linha é uma pessoa e cada coluna é uma tela.
Marcar a caixa libera; a gravação é imediata.

A primeira versão era orientada à tela — para liberar alguém em seis telas era preciso abrir
seis cartões e digitar o mesmo e-mail em cada um. Quem administra pensa no sentido oposto
("entrou fulano, ele vê isto e isto"), e é esse o sentido da matriz.

**O modelo de dados não mudou.** A permissão continua guardada por tela
(`telas[id] = { modo, emails }`), que é como `podeVerTela` decide a cada requisição; a matriz
é uma transposição na leitura. Não há estado novo para sair de sincronia com o antigo.

Cada coluna tem um modo, no próprio cabeçalho:

* **todos** — qualquer conta do domínio. A coluna aparece preenchida e sem caixa, porque
  marcar alguém ali não mudaria nada;
* **restrita** — só quem está marcado, mais os administradores.

Linha de administrador também aparece preenchida e sem caixa: ele entra em tudo por
definição, e uma caixa ali seria decorativa.

> **Lista vazia agora é um estado válido.** Uma tela restrita sem ninguém marcado fica só
> para os administradores. Antes isso era recusado, e o efeito colateral era pior que o
> problema: ao tirar a última pessoa, a tela voltava a ser pública — uma remoção de acesso
> ampliava o acesso.

O backend valida a permissão **em cada endpoint**; esconder o item do menu não é o que
protege o dado.

### Escopo de dados: qual fatia a pessoa enxerga

O ACL de tela responde *quais telas* alguém abre. O escopo responde *qual fatia dos dados* —
e as duas são perguntas independentes de propósito. Na matriz, a coluna **Equipes** define o
escopo: nenhuma marcada significa "vê tudo".

> **O escopo vale no dashboard INTEIRO, não na tela onde foi configurado.** Marcar equipes
> para alguém recorta todas as visões por equipe de **todas** as telas — Diretoria, Vendas,
> Vendas Histórico, Ativações, Ativações Histórico, Rampagem, Premiações, Vendas Canceladas e
> Análise Preditiva — mais as exportações e a leitura de IA. Não existe escopo "só de uma
> tela": ele é atributo da pessoa. A interface repete isso em três lugares (introdução da aba,
> seletor de equipes e legenda) porque é a confusão mais provável de quem configura.

**Nada é gravado até você clicar em Salvar.** As alterações ficam em rascunho: a célula
alterada aparece destacada, uma barra mostra quantas estão pendentes e oferece **Descartar**.
A primeira versão gravava a cada clique — numa tela de uso frequente isso significa dezenas de
requisições, nenhuma confirmação visível e nenhum jeito de desistir no meio de uma
reorganização.

> **A ordem da gravação importa.** O modo da tela vai primeiro, depois as pessoas, depois os
> escopos. `definirTelasDoEmail` ignora tela em modo "todos", então marcar alguém numa tela que
> só agora virou restrita seria descartado em silêncio se a ordem fosse a inversa.

A escolha das equipes abre em **diálogo centralizado**, não em popover ancorado no botão: a
célula fica dentro de uma tabela com rolagem, onde `position: absolute` é cortado pela borda
do contêiner — e a lista ainda rolava por dentro. Eram três recortes empilhados para escolher
uma equipe. No diálogo, as 36 equipes aparecem numa grade de três colunas, todas de uma vez,
com busca e um único `Aplicar` em vez de uma gravação por clique.

**Para quem serve.** Quem acessa é o **líder**, não o vendedor — a relação é 1 líder para N
equipes, não 1 para 1. O líder não precisa existir na `Comercial_Teams` como pessoa: o recorte
é amarrado ao e-mail dele, independente de ele aparecer na base como vendedor.

> **Por que a marcação é manual.** O Senior tem as colunas `supervisor_name`,
> `coordinator_name` e `manager_name`, que permitiriam derivar as equipes de cada líder
> automaticamente — mas elas estão **vazias** (0 preenchidos em 644 ativos). O campo `team` de
> lá também não serve: tem 3 valores (`ADM`, `SVA`, `SCM`), nenhum deles correspondendo às 36
> equipes da `Comercial_Teams`. Enquanto o RH não alimentar a hierarquia, marcar à mão é o
> único caminho honesto — inferir liderança pelo cargo erraria em silêncio. São ~19 líderes,
> não 100 vendedores.

O escopo é propriedade do cargo, não da tela: quem cuida das equipes X, Y e Z cuida delas em
Vendas, Ativações e Premiações igualmente. Por isso ele vale em **todas** as telas — pendurá-lo
em cada uma viraria tela × equipe × pessoa, que é o desenho que não se sustenta.

**Onde é aplicado.** Dentro de `exigirAuth`, reescrevendo `req.query.equipe`. É o único caminho
por onde toda rota de dados passa, então KPIs, gráficos, tabelas, exportações e leitura de IA
respeitam o recorte de uma só vez — e endpoint novo herda sem ninguém lembrar de aplicar.

O pedido é **cruzado** com o permitido, nunca substituído: quem tem escopo em `[A, B]` e pede a
equipe `C` recebe **vazio**, não recebe A e B.

> **Por que existe um sentinela.** `asArray('')` devolve `null`, e `null` no filtro significa
> "sem filtro". Escrever escopo vazio como string vazia abriria a base inteira em vez de
> fechá-la, então o caso "nada permitido" usa `EQUIPE_INEXISTENTE`, um valor que nenhum
> registro tem. Falhar fechado precisa ser explícito.

Três decisões que mudam número na tela:

* **`/filters`** é o único endpoint de dados fora daquele caminho, e teve o recorte aplicado à
  mão: sem isso a pessoa veria no seletor equipes que não consegue abrir, e escolher uma
  devolveria tela vazia sem explicação;
* **registro sem equipe fica de fora** do escopo, por consequência de cruzar com uma lista que
  nunca contém `''` — nas vendas canceladas são 12 mil contratos, então o efeito é visível;
* **administrador é isento**, senão não conseguiria auditar o que liberou. Definir escopo para
  um admin é **recusado** em vez de guardado sem efeito, que voltaria a valer sozinho no dia
  de uma despromoção.

Quem tem escopo vê um aviso na barra de filtros com as equipes que alcança. Recorte invisível
faz a pessoa concluir que o número está errado.

### Janela de dados

O recorte histórico da carga fica em **Configurações → Janela de dados** (só admin). Ele
decide até onde o dashboard enxerga: é o que limita a comparação entre meses, as coortes e
as projeções.

`DATA_SINCE` e `PHONE_SINCE` no `.env` continuam valendo como **semente** — enquanto ninguém
definir nada na tela, e como destino do botão "voltar ao valor do .env". O que a tela grava
tem precedência e vive em `janela.json`, no volume de dados. `config.since` é um getter, e
todos os pontos que montam SQL já o liam de forma preguiçosa, então a carga seguinte usa o
recorte novo sem reiniciar o processo.

Mudar o recorte dispara uma recarga completa em segundo plano: a tela responde na hora e
acompanha o progresso, e os dados anteriores continuam servindo até a nova carga terminar.

> **Consultas em voo.** Uma carga completa leva dezenas de segundos. Se o recorte mudar nesse
> meio-tempo, o resultado que chega é de outro recorte e é **descartado** — a consulta é
> refeita com o valor novo. Quem pede uma fonte que já está em execução espera a que está
> rodando em vez de receber um retorno imediato. Sem isso, trocar o recorte durante uma carga
> respondia "concluído" na hora e o cache acabava com os dados do recorte anterior.

A telefonia tem data própria porque entrou na operação depois do resto; ela não pode ser
anterior à data inicial da base. A carga incremental (60 dias) também respeita o recorte:
se ele for mais estreito que a janela incremental, ela é encurtada.

### Expiração da sessão

O token do Google dura cerca de uma hora. A sessão se renova **sozinha cinco minutos antes
de expirar**, então quem está com a tela aberta não percebe a troca.

Quando a renovação silenciosa não é possível — sessão do Google encerrada, cookies de
terceiros bloqueados, máquina suspensa por muito tempo — a sessão é **encerrada de verdade**:
o token é descartado, o cache de dados do front é limpo e a tela volta ao login explicando o
motivo.

> Antes, o 401 era engolido: a renovação falhava, as requisições passavam a ser recusadas e a
> tela continuava montada com o usuário anterior — todos os números em branco e nenhum
> caminho de volta a não ser abrir o perfil, sair e entrar na mão. O `usuario` do contexto
> nunca era limpo, então o app não sabia que a sessão tinha acabado.

O cache é descartado junto para que ninguém reencontre os números de outra conta ao entrar
depois na mesma máquina.

Todas as chamadas passam por `apiFetch`, que renova em 401 e encerra a sessão se o token novo
também for recusado. Isso inclui as exportações e o botão ⟳ — este último fazia `fetch` sem o
header de autorização e, com autenticação ligada, tomava 401 em silêncio: a atualização nunca
acontecia, só o cache do front era invalidado.

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

Em **Stacks → Add stack → Repository**, informe:

* **Repository URL:** `https://github.com/Sebratel/dados_ReactJS_CommercialDashboards`
* **Reference:** `refs/heads/main`
* **Compose path:** `docker-compose.yml` (fica na raiz do repositório)

E cadastre as variáveis de ambiente:

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
| **Condomínios** | 6 cartões, ocupação por splitter, detalhe porta a porta, resumos por condomínio e por cidade, matriz mês × cidade, colunas por cidade | `SPLITTER_CONDOMINIO`, `CLASSIFICACAO`, `TEMPO_DE_VIDA`, `TOTAL_USUARIOS`, `PORCENT_OCUPACAO_CIDADE` |
| **Leads e Negociações** · sub-página *Leads* | 8 cartões, status por lead, colunas por mês × status, detalhe completo, origem e forma de contato por mês, motivos, 5 tabelas de perfil, matriz vendedor × status | `Leads`, `Leads_Disponíveis`, `Leads_Qualificado`, `Leads_Em_Andamento`, `Leads_Ganho`, `Leads_Perda`, `Leads_Descartados`, `Leads_Outros`, `Dono do Lead Final`, `Tempo Vida Lead Formatado` |

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

### Ativações: a telefonia que o relatório antigo não conta

O Power BI define a data de ativação assim (Power Query, tabela `general`):

```
DATA ATIVAÇÃO = if [TECNOLOGIA] = "TELEFONIA" then [DATA ATIVAÇÃO TELEFONIA]
                                              else [DATA ATIVAÇÃO FIBRA]
```

Ou seja: a fórmula manda contar a ativação de telefonia. **A tela dele, porém, não as
mostra** — em junho/2026 o relatório exibe 2.595 e o dashboard, 2.674.

Replicando o pipeline do relatório em SQL independente, a definição dele produz **81
ativações de telefonia em junho e 71 em julho**, exatamente o que o dashboard apura. A
implementação aqui é fiel à fórmula; o número exibido no Power BI é que diverge da própria
definição. Foram descartadas, com evidência: defasagem de carga (os registros foram criados
no mês corrente, não em backfill), incompatibilidade de tipo no merge (`contract_number` é
`varchar` e `protocol` é `bigint` dos dois lados), filtro de tecnologia salvo no visual e
relação inativa no modelo. A causa do comportamento em tempo de execução do Power BI não é
determinável a partir dos arquivos do `.pbip`.

Decisão: **manter a contagem completa e separar as faixas no gráfico.** As colunas de
Ativações vêm empilhadas por tecnologia e os KPIs trazem `FIBRA E RÁDIO` e `TELEFONIA` em
separado, então o total continua correto e a parte comparável ao relatório antigo é lida
direto, sem refazer conta.

Resta uma diferença de **-2 (junho) e -6 (julho)** na fibra. Ela vem de outro ponto: a
consulta de alocação do Power BI **não agrega** — devolve uma linha por equipamento — e o
`Table.Distinct` posterior fica com a *primeira* linha de cada contrato, que depende da ordem
em que o banco devolveu. Aqui usamos `MIN(data_ativacao)`, que é determinístico. Perseguir
esses 2-6 contratos significaria replicar uma ordenação arbitrária.

> Uma nota sobre a consulta de telefonia: o `WHERE` do relatório é `t.title <> 'Financeiro'`,
> e como `t` vem de `LEFT JOIN`, a comparação é NULL quando o atendimento não tem time —
> essas linhas ficam de fora. Escrever `t.title IS NULL OR ...` parece o conserto de um
> descuido de lógica ternária, mas muda a medida. A réplica aqui é literal.

### Vendas canceladas: uma segunda origem, sem segunda carga

A tela vem do relatório **COM - Vendas Canceladas**, que é um `.pbip` separado com uma única
página. O recorte é dado pelos dois filtros de página dele: contrato **cancelado** e **sem
data de ativação** — a venda perdida antes de virar instalação.

A consulta daquele relatório é 95% igual à `general` do principal, com três diferenças:

| | |
|---|---|
| **Tipos de atendimento** | ele não considera os `#HR` (1254/1255) |
| **Coluna a mais** | `TIPO SOLICITAÇÃO` (`it.title`) |
| **Tabela anexada** | `Table.Combine` com `DB_Applicattion.General_Commercial` (MariaDB, 55 mil linhas de 2022-2024) |

A tabela anexada **não tem a coluna `STATUS CONTRATO`**, então o filtro `= 'Cancelado'` a
descarta inteira: ela não influencia esta tela e não foi replicada.

A diferença de tipos vale 74 contratos em 36 mil (0,2%). Em vez de uma segunda carga da base
inteira por causa disso, `base.sql` marca em `tem_tipo_padrao` quem tem algum atendimento da
lista daquele relatório, e a tela filtra por essa marca — mesmo conjunto, sem custo de ETL.
`TIPO SOLICITAÇÃO` entrou como mais uma coluna da mesma consulta.

> **Duas datas.** No relatório de origem o filtro de período usa a **data do contrato**, mas o
> gráfico mensal agrupa por **cadastro do cliente** — e as duas só coincidem em 70% dos casos.
> Como o cliente pode ter se cadastrado anos antes de fechar, o agrupamento original espalha
> um único mês de vendas por 47 barras, quase todas valendo 1. A tela abre pela data da venda
> (coerente com o filtro) e o agrupamento do Power BI fica no alternador do cabeçalho.
>
> **Consequência prática, já observada em uso:** comparar o nosso gráfico (por venda) com o
> do relatório (por cadastro) mostra números bem diferentes — 1.060 contra 798 em janeiro/2026,
> por exemplo. Não é divergência de regra: trocando o alternador para "cadastro", os meses
> batem com folga de 0 a 3 registros, que é o dado entrado desde a última atualização do
> relatório. O mês corrente diverge mais porque continua recebendo cancelamentos.

**A ordem dos blocos é a do relatório de origem**, lida das coordenadas dos visuais no
`.pbip`: detalhamento de largura inteira (y=196), as seis contagens lado a lado (y=770),
tipo de solicitação e motivo (y=1195) e o gráfico mensal por último (y=1629). A primeira
versão aqui invertia isso — gráfico em cima, detalhe no fim — e quem usa o relatório
procurava a tabela onde ela não estava.

As larguras da faixa de seis também vêm de lá: vendedor mais largo que as outras cinco,
porque nome de vendedor é o rótulo mais longo da faixa.

**O que os indicadores medem.** O nome de um KPI raramente basta, então cada um traz uma
linha de descrição e o detalhe completo no `title`:

| Indicador | O que é |
|---|---|
| Vendas canceladas | contratos cancelados sem nunca ter sido ativados, no período filtrado pela data da venda |
| Valor perdido | **soma do valor mensal** dos planos que não entraram — é a receita recorrente que deixou de começar, uma parcela, não a perda acumulada ao longo do tempo |
| Ticket médio | valor perdido dividido pela quantidade de contratos |

A distinção do valor perdido importa: sem ela, R$ 683 mil é lido como prejuízo total quando
é a soma de mensalidades. A perda real dependeria de quanto cada cliente teria ficado.

**As cores da tabela principal são a formatação condicional do relatório**, lida de
`objects.values` no `visual.json` — não escolhidas aqui:

| Coluna | Regra |
|---|---|
| `STATUS CONTRATO` | fundo `#1F601A` quando *Normal*, `#9F0E0E` quando *Cancelado*, fonte branca |
| `VALOR` | escala linear de `#e8d166` (menor) a `#D9B300` (maior) |

Como esta tela só mostra cancelados, o status sai sempre vermelho — e é isso que
sinaliza de relance que a linha é uma perda. A coluna `STATUS CONTRATO` existia no
payload desde o início e faltava na tabela; agora as 10 colunas batem uma a uma com as
do relatório, na mesma ordem.

A página de origem tem 2000px e foi feita para rolar; aqui a tela fica em ~1750px e
também rola. Comprimir quatro faixas numa tela deixaria todas ilegíveis. O detalhamento
mostra as 400 linhas mais recentes — a tabela exibe ~10 por vez, então 2000 no DOM era
peso sem leitor — e o CSV completo fica ao lado.

**O motivo do cancelamento** chega do Voalle como uma frase de até 230 caracteres — prefixo
fixo, motivo no meio, justificativa do procedimento no fim. No gráfico fica só o miolo; o
texto íntegro continua no detalhamento e na exportação.

Isso resolve três problemas de uma vez:

* o rótulo passa a caber (de 231 para no máximo 28 caracteres);
* o **mesmo motivo deixa de aparecer repetido** — "Sem comprovante de Endereço" se dividia em
  quatro fatias só porque a redação da justificativa mudava;
* a cauda (motivos de uma ocorrência) vira uma barra **Outros**, pintada em cinza neutro para
  não ser lida como uma categoria de verdade.

> **Reclassificação aprendida dos dados.** O mesmo cancelamento é registrado de duas formas:
> com o motivo nomeado no meio, ou com uma cabeça genérica ("Contrato Cancelado") e o motivo
> real só na justificativa — 496 contratos, 1,4%, num balde que não informa nada. O mapa de
> justificativa → motivo não é escrito à mão: ele é **aprendido das linhas que trazem o motivo
> nomeado**, e aplicado às genéricas. Motivo novo entra sozinho; justificativa desconhecida
> fica como está em vez de ser adivinhada.

### Premiações: só quem está ativo

O corte do Senior (`termination_date IS NULL`) é o mesmo do relatório e vale para todas as
telas. Ele não basta para a premiação: **quem é recontratado ganha um registro novo em
aberto** e volta a aparecer, mesmo já fora da operação comercial.

Por isso a tela de Premiações — e só ela — exige também `ATIVO` na `Comercial_Teams`. É uma
divergência proposital: o relatório antigo não usa essa coluna. A justificativa é que
premiação é dinheiro a pagar, e quem foi desligado não pode concorrer.

Quem tem demissão antiga **e** readmissão em aberto continua aparecendo — está empregado
hoje.


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

### Condomínios: um segundo relatório, um segundo modelo

A tela vem do relatório **COM - Condomínios**, um `.pbip` separado cuja página principal
tem 3.950px de altura e dez visuais de dados. Nada ali cruza com o modelo comercial: o
grão é a **porta de splitter**, não o contrato vendido.

**O que define um condomínio.** A coluna DAX `SPLITTER_CONDOMINIO` procura `COND.`, `RES.`
ou `ED.` no título do splitter secundário e corta dali até o primeiro `" -"`; o filtro de
página exige que ela não seja nula. `nomeDoCondominio()` reproduz a regra letra por letra,
inclusive a prioridade do `SWITCH` (`COND.` antes de `RES.`, `RES.` antes de `ED.`) e o
truque de concatenar `" -"` no fim do texto para o `SEARCH` nunca falhar. Hoje isso dá
**870 condomínios em 3.885 splitters, 55 mil portas e ~14,7 mil clientes**.

O teste do título ficou no `WHERE` do SQL, e não só na coluna calculada: sem isso a
consulta traria as portas de todos os 19 mil splitters da rede para a memória do servidor,
quando a tela só mostra as de condomínio.

**Quatro consultas viraram uma.** `SPLITTER_(OCUPADA_/_DISPONIVEIS)`, `SPLITTER_(OCUPACAO)`,
`SPLITTER_(LOTADOS)` e `SPLITTER_(ZERADOS)` têm o mesmo corpo no Power BI; diferem por
colunas derivadas e por um `HAVING`. Aqui é uma consulta só (`splitter_ocupacao.sql`), com
percentual e faixa calculados em JS — mesmos cortes de 70% e 90%, e o mesmo
`ROUND(...,2)` antes de comparar, senão 89,996% cairia em faixas diferentes nos dois lados.

**Os filtros dos splitters e das portas passaram a valer dos dois lados.** O Power Query
filtra `active`/`deleted` na consulta de ocupação, mas não na de portas. O efeito com dado
real é que a contagem de portas da tabela de detalhe fica **maior que a capacidade
informada ao lado** — o detalhe contradiz o indicador. Filtrando nos dois, os números
fecham.

**O usuário do cliente vem direto da conexão da porta.** O Power Query dá a volta por
`CONTRATOS_BLOQUEADOS` casando por número de contrato; quando um contrato tem mais de uma
conexão, essa volta duplica a linha e pode trazer o usuário de outra porta. A conexão da
linha já está no `JOIN` — direto não tem como errar.

**A cidade é a do equipamento, não a do cliente.** Esta é a divergência que mais muda a
leitura, e ela só aparece com dado real: porta livre não tem conexão, logo não tem cidade.
Filtrando pela cidade do cliente (`CIDADE.1`, como o relatório faz), escolher uma cidade
descarta **todas as portas livres** — e "portas" passa a ser sinônimo de "clientes" num
painel cujo assunto é exatamente quanto ainda cabe. Do mesmo defeito vinha a necessidade de
avisar que um splitter com clientes em duas cidades tinha a capacidade contada duas vezes.

Aqui cada splitter tem **uma** cidade e entra ou sai inteiro do filtro.
`authentication_splitters.city` está preenchido em menos de um terço dos casos (5.583 de
19.040), então o resto vem da cidade mais frequente entre os clientes daquele splitter —
que é o prédio onde ele está. Empate resolve em ordem alfabética, para o resultado não
depender da ordem em que o banco devolveu as linhas.

**As cinco cidades saíram do código.** O relatório fixa Canoas, Novo Hamburgo, São
Leopoldo, Sapucaia do Sul e Esteio como filtro nas tabelas de detalhe. A tela mostra todas
e oferece esse recorte num botão na barra de filtros. Filtro escondido em constante é a
receita de "o dashboard está com número errado": quem abre não tem como saber que cinco
cidades foram escolhidas dentro de um arquivo `.js`.

**O que não veio.** Os dois mapas (`LOCALIZAÇÃO SPLITTERS` e `LOCALIZAÇÃO CLIENTE`): o
dashboard não tem biblioteca de mapa, e não vale acoplá-lo a um servidor de tiles externo
por dois visuais. As coordenadas do splitter e do cliente vão nos dois CSVs da tela. Fora
disso, o seletor `USUÁRIO` virou caixa de busca — a lista tem um item por conexão da rede,
e rolar milhares de logins é mais lento que digitar três letras — e o segundo filtro de
data (`DT. CRIAÇÃO SPLITTER PRIM.`) saiu, porque a idade do primário é da rede e não do
prédio.

**Leitura por IA em quatro visuais.** Ocupação por splitter, por condomínio, por cidade e a
matriz de aprovações têm o botão. O detalhamento porta a porta **não** — ele tem nome de
cliente e endereço, e `recorte` é o filtro de privacidade desta tela. Para isso funcionar, o
catálogo de `ia/visuais.js` passou a saber de qual modelo cada visual vem; ver a seção
*Insights por gráfico*.

**Amostra na tela, conjunto no CSV.** São 3.885 splitters, 870 condomínios e 55 mil portas.
A tela mostra 300, 300 e 400 — sem o corte, chegava a 54 mil células no DOM e cada clique de
ordenação repintava todas. Cada visual diz no subtítulo quantas linhas está mostrando do
total, e os dois CSVs do cabeçalho trazem o conjunto inteiro.


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
| `GET /api/canceladas` | vendas canceladas sem ativação |
| `GET /api/condominios/filtros` | listas dos slicers da tela de condomínios |
| `GET /api/condominios` | cartões, ocupação por splitter, detalhe, cidade, matriz |
| `GET /api/leads/filtros` | listas dos slicers da tela de leads |
| `GET /api/leads` | cartões, status, séries por mês, perfil, matriz vendedor |
| `GET /api/premiacoes` | faixas de premiação |
| `POST /api/refresh?group=hot\|full\|dims\|cond\|crm` | força releitura |
| `GET /api/auth/config` | client_id do Google e domínio (público) |
| `GET /api/me` | e-mail, papel, atributo de power user e telas liberadas |
| `GET/PUT/DELETE /api/access/users` | papéis (admin) |
| `GET/PUT /api/access/screens` | acesso por tela (admin) |
| `PUT /api/access/users/:email/poweruser` | liga/desliga o atributo de power user (admin) |
| `GET /api/queries` · `POST /api/queries/:id/test` | catálogo de queries (exclusivo de power users) |
| `GET /api/preditivo` | indicadores preditivos (sem IA) |
| `POST /api/preditivo/insights` | leitura da IA sobre os indicadores |
| `GET/PUT/DELETE /api/ia` · `POST /api/ia/modelos` · `POST /api/ia/testar` | provedor de IA (admin) |
| `GET/PUT /api/janela` · `POST /api/janela/restaurar` | recorte histórico da carga (admin) |
| `GET /api/insights/visuais` · `POST /api/insights/visual/:id` | leitura de IA de um gráfico |

Todos aceitam os filtros: `de`, `ate`, `vendedor`, `equipe`, `tecnologia`, `situacao`,
`cidade`, `canal`, `cliente` (listas separadas por vírgula) e `g=mes|dia` (granularidade
da série dos gráficos de coluna).

As rotas de condomínio têm o seu próprio conjunto, porque as dimensões não se cruzam:
`criadoDe`, `criadoAte` (criação do splitter), `condominio`, `splitter`, `concentrador`,
`ponto`, `site`, `cidadeCond`, `faixa` e `buscaCond`. O nome `cidadeCond` não é enfeite —
`cidade` já existe no lado comercial com uma lista de valores diferente, e como os filtros
vivem na URL, o mesmo nome faria a tela herdar da outra um valor que não existe na lista
dela: tela vazia, sem explicação nenhuma.

As rotas de leads têm o seu próprio conjunto: `lde`, `late` (cadastro do lead), `lvend`,
`lequipe`, `lstatus`, `lcidade`, `lorigem`, `lforma` e `lbusca`.

As rotas de condomínio e de leads são as que **não** esperam a carga comercial: têm modelo
próprio e devolvem o seu próprio 503 enquanto os dados delas não chegam. Quem só tem acesso a
uma dessas telas não fica preso a uma carga que não lhe serve.

---

## 8. Análise preditiva

Tela `/preditivo`. **Todo número é calculado estatisticamente sobre a base — nada vem de
LLM.** A IA entra depois, só para interpretar e priorizar o que o motor apurou; é o que
garante que nenhum valor exibido possa ser alucinado.

| Indicador | Como é calculado |
|---|---|
| **Projeção do mês** | ritmo por dia útil ponderado (domingo 0, sábado 0,5, feriado 0) × dias restantes; a margem sai do desvio do ritmo diário |
| **Conversão por coorte** | das vendas de cada mês, quantas ativaram e quantas pagaram — só coortes maduras entram na comparação |
| **Defasagem do funil** | mediana e p90 de dias entre venda→ativação e ativação→1º pagamento |
| **Carteira em risco** | contratos parados além do p90 de cada etapa, com valor e concentração por vendedor/cidade |
| **Queda de ritmo** | ritmo dos últimos 14 dias contra os 41 anteriores, ignorando quem tinha menos de 5 vendas na base |
| **Projeção dos novatos** | ritmo do novato × dias úteis restantes dos 90, comparado à mediana histórica dos veteranos |
| **Sazonalidade** | média por dia da semana nos últimos 180 dias |
| **Cancelamento e concentração** | taxa por coorte e participação dos top 5/10/20 vendedores |

Os filtros de vendedor, equipe e tecnologia se aplicam; o de período não, porque cada
análise tem a sua própria janela.

### Provedor de IA

Cadastrado em **Configurações → Provedor de IA** (só admin). Três dialetos, uma interface:

* **Anthropic** (Claude)
* **OpenAI e compatíveis** — cobre Groq, OpenRouter, Azure OpenAI, Together e servidores
  locais: muda só a URL base
* **Google Gemini**

A tela lista os modelos que **aquela chave** alcança e tem teste de conexão, que separa
"chave errada" de "modelo inexistente" antes de alguém descobrir no meio de uma análise.

**A chave é gravada cifrada** (AES-256-GCM) em `data/ia.json` e nunca volta numa resposta da
API — só os quatro últimos caracteres. Defina `SECRET_KEY` no ambiente para controlar a
chave de cifra; sem ela, uma é gerada no volume de dados. Também é possível configurar por
`.env` (`AI_PROVIDER`, `ANTHROPIC_API_KEY`, `AI_MODEL`), que serve de semente.

O que vai para o modelo são **apenas os agregados** — nenhum nome de cliente sai da rede.

### Insights por gráfico

Os visuais das telas de Diretoria, Vendas, Ativações, Primeiro Pagamento, Rampagem,
Premiações, Vendas Canceladas, Condomínios e Leads têm um botão **Insights** no cabeçalho:
**32 visuais** ao todo. Ele abre uma gaveta lateral com a leitura daquele gráfico — o que
salta aos olhos, o que passa despercebido e o que os números não respondem.

**Cada visual declara de qual modelo ele vem** (`modelo: 'comercial' | 'condominios' |
'leads'` em `ia/visuais.js`), e o modelo declara três coisas: como ler os filtros da query,
como montar o painel e como descrever o recorte em português para o prompt. Isso não é
cerimônia: quando existia um modelo só, a rota parseava os filtros comerciais para todo
mundo, e um visual de condomínio registrado sem adaptação receberia um `parseFilters` que
não conhece `cidadeCond` nem `faixa` — a IA leria a **base inteira** achando que estava
lendo o recorte da tela, e escreveria isso com toda a autoridade de uma análise. Por isso a
rota passa a query CRUA: quem sabe interpretá-la é o catálogo.

O vocabulário do prompt também muda por tela, porque o recorte é outro: em Vendas o período
é a data do indicador, em Condomínios é a criação do splitter e em Leads é o cadastro do
lead. O painel mostra a mesma descrição no cabeçalho — dizer "todo o histórico" num visual
filtrado por data seria contar uma coisa e o número mostrar outra.

> **O navegador não envia dados para serem interpretados.** Manda só o ID do visual e os
> filtros da tela; quem remonta os números é o servidor, pela **mesma função** que alimenta
> o gráfico (`model/paineis.js`). Duas consequências: a leitura não tem como divergir do que
> está desenhado, e não adianta adulterar a requisição para a IA "concluir" o que se quiser.

O recorte enviado é também o filtro de privacidade: passa apenas o que o gráfico já mostra,
agregado, no máximo 11 KB. Nome de cliente e número de contrato não saem — por isso o
detalhamento do primeiro pagamento não tem botão.

Os insights herdam o ACL da tela dona do visual, e o botão some para quem não é admin
enquanto não houver provedor cadastrado.

## 9. Exportações

Duas formas de tirar o dado da tela:

* **Botão `CSV` no cabeçalho de cada tabela** — baixa exatamente o que está no visual,
  com as mesmas colunas, os filtros aplicados e a ordenação escolhida. É processado no
  navegador, sem ida ao servidor.
* **Aba `Exportações`** — onze conjuntos completos gerados pelo servidor, sem o corte que
  as telas aplicam. O relatório de primeiros pagamentos, por exemplo, mostra 1.500 linhas
  na tela e exporta as 18.723 do período.

  Cada conjunto mostra **quantas linhas e colunas** o arquivo terá com os filtros atuais, e
  o botão **ver amostra** abre as 8 primeiras linhas já formatadas como vão sair — ninguém
  precisa baixar para descobrir o que vem dentro. Conjunto sem registros aparece com o
  botão desabilitado.

| Conjunto | Tela que controla o acesso |
|---|---|
| Vendas (contratos criados) | vendas |
| Ativações | ativacoes |
| Primeiro pagamento | primeiro-pagamento |
| Vendas canceladas | vendas-canceladas |
| Premiações (>60 e ≤60 dias) | premiacoes |
| Rampagem (novatos) | rampagem |
| Resumo por vendedor | vendas |
| Condomínios — portas dos splitters | condominios |
| Condomínios — ocupação por splitter | condominios |
| Leads (CRM) | leads |

Os conjuntos de condomínio e de leads leem os filtros **daquela** tela, não os comerciais:
cada conjunto declara o seu escopo e `filtrosDoConjunto()` escolhe o parser. Sem essa marca,
um conjunto novo receberia `de`/`ate` de vendas e exportaria o recorte errado calado.

O ACL por tela vale para o download: quem não vê Premiações recebe 403 ao tentar exportá-la,
e o conjunto nem aparece na lista.

**Formato:** CSV com separador `;`, BOM UTF-8, decimal com vírgula e datas `dd/mm/aaaa` —
abre no Excel em português com duplo clique, sem assistente de importação. O nome do arquivo
carrega o período (`vendas_2026-01-01_a_2026-08-15.csv`).

> O download passa por `fetch` com o Bearer e entrega um blob. Link direto (`href`) não
> leva o header de autenticação e devolveria 401.

## 10. Convenções de interface

* **Sem emojis.** Todos os ícones são SVG traçado em `web/src/components/Icone.jsx`,
  herdando a cor do texto via `currentColor`. Isso vale inclusive para os títulos que o
  Power BI trazia com emoji (`Resumo Diretoria`, `Resumo dos 3 principais indicadores`).
* **Um estilo de card só** — borda 1 px, raio 8 px, cabeçalho vinho de 32 px.
* **Altura derivada da janela** (`--util`), nunca fixa em pixels.
