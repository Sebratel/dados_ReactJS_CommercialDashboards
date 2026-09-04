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

**A carga inicial é uma rajada, e ela precisa de fila.** São dez consultas para um pool de
cinco conexões, e as pesadas seguram a conexão por 60 a 85 s (`base` 76 s, `leads` 84 s,
`pagto` 65 s, `portas` 61 s). Com o `connectionTimeoutMillis` de 20 s que estava aqui, quem
entrava na fila desistia antes da vez: a cada reinício uma fonte diferente falhava, à sorte
de quem chegava por último — e a tela dela nascia zerada. Agora a espera é de 180 s
(`DB_VOALLE_CONNECT_TIMEOUT_MS`), porque esperar é o comportamento certo para uma rajada que
tem fim. O pool continua em cinco: quem manda no limite é o banco de produção, não a nossa
pressa.

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

### O vendedor encontra o RH pelo e-mail, não pelo nome

O modelo original relacionava `new_sellers` (usuários do Voalle) com o RH do Senior
**pelo nome**, e nome quebra. `JÉSSICA ARAÚJO TEIXEIRA` no Voalle contra
`JESSICA ARAUJO TEIXEIRA` no Senior é a mesma pessoa e não casava — ela ficava sem
admissão, e como o modelo mantém só quem existe no RH, **desaparecia de Rampagem e de
Premiações sem deixar rastro**. O relatório de origem foi corrigido do mesmo jeito.

As duas consultas passaram a trazer `email`, e a junção tem três tentativas:

| Via | Quantos | Por que existe |
|---|---|---|
| e-mail | 477 | chave de verdade |
| nome exato | 158 | 303 usuários do Voalle e 151 registros do Senior **não têm e-mail** — trocar só para e-mail perderia essas pessoas |
| nome sem acento | 10 | resolve o caso da Jéssica para quem também não tem e-mail |

O total de vendedores com admissão foi de **602 para 645**.

O e-mail fica no servidor: é chave de junção, não coluna de tela, e não entra em
nenhuma resposta de API.

#### E-mail igual não é sempre a mesma pessoa

Com o e-mail como chave única, **sete pares** casaram com nome de outra pessoa — conta
genérica e conta reaproveitada nas duas bases:

```
SEM AUXILIAR                   -> GUSTAVO LEITE DOS SANTOS
ISA - AGENTE VIRTUAL SEBRATEL  -> PATRICIA PASTORIZA LOUZADA     (robô)
LUKAS FRANCISCO MELO CAVALIM   -> IGOR SOARES SCHUMACHER DA SILVA
ANDRE LUIS DOS SANTOS          -> ANDRE FERNANDO DOS SANTOS
VANESSA GARCIA DA SILVA        -> VANESSA CUNHA DA SILVA
CARLOS DAVI RODRIGUES DA SILVA -> CARLOS EDUARDO DA SILVA
JOAO BATISTA GOMES DE OLIVEIRA -> JOAO VITOR GOMES DA SILVA
```

`SEM AUXILIAR` chegou a aparecer na tela de Rampagem herdando a admissão do Gustavo —
um vendedor que não existe, com data de outra pessoa. Então o e-mail só casa quando os
nomes se reconhecem, em três níveis:

1. **iguais** ignorando acento — o caso da Jéssica;
2. **um é prefixo do outro** (12 caracteres ou mais) — a coluna `name` do Senior corta
   em 40 caracteres, e daí vinham três dos pares: `VIANNELLY NAZARETH DE CARMEN RAMIREZ
   SEIJAS` contra `... RAMIREZ SEI`;
3. **três quartos dos pedaços** batendo, com tolerância de uma letra por pedaço.

O limite de 3/4 foi **medido, não escolhido**: com 1/2 passavam quatro impostores que
compartilham primeiro nome e último sobrenome (`ANDRE LUIS DOS SANTOS` contra `ANDRE
FERNANDO DOS SANTOS`, 2 de 3). Com 3/4 eles caem e continuam passando
`DARWIN JOSE BAIRROS RODRIGUES` / `BARRIOS RODRIGUEZ` (3 de 4) e
`LUCIANO TELLES VIEIRA` / `VIERA` (3 de 3).

Os dois grupos ficam contados em `GET /api/meta` (`juncaoVendedores`), com nome e sem
e-mail: os sete recusados são erro de cadastro numa das bases, e alguém precisa olhar.

### Histórico: dia ou mês, e quem decide

As matrizes de **Vendas - Histórico** e **Ativações - Histórico** escolhiam sozinhas:
acima de ~2 meses viravam mensais, senão ficavam por dia. Isso é o que faz a tela
caber, e continua sendo o padrão — agora chamado de **Automático** no cabeçalho do
visual, ao lado de **Dia** e **Mês**.

Forçar o dia num período longo foi pedido de quem usa, e a razão é boa: às vezes a
pergunta é sobre o dia dentro de um trimestre, e consolidar por mês apaga exatamente o
que se quer ver. A escolha vai para a URL (`hg=dia`), então o link é compartilhável.

#### O corte é em vendedor, não em dia

A matriz desenha coluna × vendedor, e forçando dia no recorte inteiro dá 519 dias por
451 vendedores. Medido no navegador:

| | células | rolagem de salto | rolagem de roda |
|---|---|---|---|
| 519 dias × 451 vendedores | 234.000 | — | travava |
| 400 dias × 451 vendedores | 181.704 | 113 ms | — |
| **519 dias × 77 vendedores** | **40.117** | **62 ms** | **22 ms** |

A primeira tentativa cortou COLUNAS, e estava errada: o pedido era justamente ver os
dias. Cortar vendedor resolve sem tirar o que se pediu — a matriz já vem ordenada por
total, vendedor tem filtro próprio na barra, e o CSV sai completo.

O teto é de **células**, não de linhas, e a diferença aparece na prática: com teto de
linha fixo, a visão mensal (20 colunas, 1.200 células) cortava vendedor sem motivo e
avisava que 391 tinham ficado de fora de uma matriz que caberia inteira. Com teto de
40.000 células, a visão mensal mostra os 451 e não avisa nada.

> **O rodapé soma TODOS os vendedores**, não os visíveis — é o total do período. A tela
> diz isso no aviso, porque rodapé que não fecha com as linhas à vista é o tipo de
> coisa que gera desconfiança no número.

**Tentei e não paguei:** `content-visibility: auto` nas linhas, que é a receita padrão
para tabela longa. Piorou — a rolagem horizontal foi de 113 ms para 205–728 ms, porque
a cada rolagem o navegador reavalia quais linhas estão visíveis e repinta do zero; com
coluna fixa e centenas de colunas, isso custa mais que manter tudo pintado. Revertido.

### Memória: onde ela estava indo

O container começou a cair. A causa não era volume de dado, era **cópia**: cada modelo
guardava a linha CRUA do banco e o objeto derivado dela, e o modelo de relatórios ainda
clonava os 120 mil contratos do modelo comercial só para acrescentar um campo.

Medido com `node --expose-gc medir.mjs` (na raiz do servidor), balde por balde:

| | heap | residente |
|---|---|---|
| antes | 771 MB | 1.255 MB |
| depois | **537 MB** | **753 MB** |

O que mudou, em ordem de tamanho:

1. **O clone dos contratos** (−92 MB). `relatorios.js` fazia
   `facts.map((f) => ({ ...f, origem: 'voalle' }))`. O campo `origem` agora nasce no
   próprio fato, em `store.js`, e o modelo de relatórios aponta para os mesmos objetos.
2. **A linha crua guardada ao lado da derivada** (−140 MB). Cesta, pesquisa, base de
   clientes, portas de splitter e negociações passaram a ser transformadas na ENTRADA
   (`setFonte…`), não na construção. A linha do banco vive o tempo de uma passada.
   As portas ganham os campos de ocupação por enriquecimento **no lugar** — criar um
   segundo objeto ali custaria os mesmos 39 MB de volta.
3. **Uma janela própria para Relatórios** (ver abaixo), que é a alavanca do admin.

> **Por que não se limpa o bruto no fim da construção**, que seria mais simples: a
> reconstrução é disparada por fonte, e as fontes chegam em momentos diferentes — a
> ocupação leva 1 s e as portas 11 s. Limpar no fim faria a segunda reconstrução
> encontrar o bruto vazio e publicar um modelo pela metade. Transformar na entrada não
> tem esse problema.

O que **sobra** de duplicação conhecida: `raw.leads` (56 MB), porque a classificação de
cada lead depende das negociações dele e só pode ser feita com as duas fontes em mãos;
e `raw.base` (69 MB), que a carga incremental de 2 minutos precisa para fazer o merge.

### Janela de dados

O recorte histórico da carga fica em **Configurações → Janela de dados** (só admin). Ele
decide até onde o dashboard enxerga: é o que limita a comparação entre meses, as coortes e
as projeções.

São **quatro datas**, uma por modelo que tem recorte:

| Campo | `.env` | Alcança |
|---|---|---|
| Carregar contratos a partir de | `DATA_SINCE` | contratos, ativações e primeiro pagamento — Diretoria, Vendas, Ativações, 1º Pagamento, Rampagem, Premiações, Canceladas, Históricos e Preditiva |
| Ativações de telefonia a partir de | `PHONE_SINCE` | só as ativações de telefonia |
| Leads e negociações a partir de | `CRM_SINCE` | as quatro sub-páginas de Leads e Negociações |
| Relatórios Comercial a partir de | `REL_SINCE` | cesta de produtos, pesquisa de cancelamento, base de clientes e a ponte histórica |

A data de **Relatórios é a alavanca de memória do servidor**, e o efeito está medido:

| recorte | cesta de produtos | base de clientes | pesquisa |
|---|---|---|---|
| 2024-01-01 (segue a data inicial) | 219.963 | 54.672 | 5.535 |
| 2025-01-01 | 137.658 | 39.143 | 5.533 |
| 2026-01-01 | 37.843 | 18.692 | 3.182 |

Estreitar para 2026 devolve cerca de 100 MB sem tirar histórico da Diretoria — aquelas
telas respondem "onde está este contrato agora", raramente sobre 2024. Sem valor
próprio, a data de Relatórios segue a data inicial, para que ligar esta versão não mude
número nenhum sem alguém pedir.

As variáveis do `.env` continuam valendo como **semente** — enquanto ninguém definir nada
na tela, e como destino do botão "voltar ao valor do .env". O que a tela grava tem precedência
e vive em `janela.json`, no volume de dados. `config.since`, `config.phoneSince` e
`config.crmSince` são getters, e todos os pontos que montam SQL já os liam de forma preguiçosa,
então a carga seguinte usa o recorte novo sem reiniciar o processo.

Mudar o recorte dispara uma recarga completa em segundo plano: a tela responde na hora e
acompanha o progresso, e os dados anteriores continuam servindo até a nova carga terminar.

> **Consultas em voo.** Uma carga completa leva dezenas de segundos. Se o recorte mudar nesse
> meio-tempo, o resultado que chega é de outro recorte e é **descartado** — a consulta é
> refeita com o valor novo. Quem pede uma fonte que já está em execução espera a que está
> rodando em vez de receber um retorno imediato. Sem isso, trocar o recorte durante uma carga
> respondia "concluído" na hora e o cache acabava com os dados do recorte anterior.

A telefonia tem data própria porque entrou na operação depois do resto; ela não pode ser
anterior à data inicial da base. O CRM **não** tem essa amarra: leads e negociações vivem num
modelo próprio, e querer mais histórico de CRM que de contrato (ou o contrário) é legítimo —
amarrar os dois só criaria erro de validação sem motivo. A carga incremental (60 dias) também
respeita o recorte: se ele for mais estreito que a janela incremental, ela é encurtada.

**Condomínios não está na tela de propósito.** A rede de splitters é um retrato do agora, não
uma série temporal: cortar por data de criação tiraria da conta equipamento em operação desde
2019 e a ocupação passaria a mentir. O recorte por data daquela tela é o filtro *Criação do
splitter*, na barra dela, que só esconde linha — não muda a capacidade instalada. Por isso as
consultas de condomínio também ficam fora do descarte de "consulta em voo" acima: elas não
recebem data por parâmetro, e refazer 60 s de consulta porque o admin mexeu numa janela que
não as alcança seria trabalho perdido.

O seletor de período de cada tela tem `min` na janela do seu modelo, e um atalho que
começaria antes dela é **encurtado** em vez de deixar passar: "12 meses" numa tela cujo recorte
começa em janeiro vira janeiro–hoje, o atalho deixa de ficar aceso e o resumo mostra as datas
reais. Pedir 2023 numa tela carregada desde 2026 devolvia zero linhas e parecia dado faltando —
o número certo para uma pergunta que os dados em memória não podem responder.

## Relatórios Comercial: o quinto relatório, e o único de consulta

O `.pbip` **COM - Relatórios Comercial** é o maior dos cinco: 8 páginas e 189 visuais.
Ele também é o único que não responde "como estamos" — responde "onde está aquele
contrato", "o que tem naquela cesta", "quem está na fila de instalação". Por isso a
densidade aqui é de tabela, não de gráfico: nas 189 caixas da origem há 15 gráficos e
mais de 20 tabelas.

A CAPA de lá é navegação e cartão de "atualizado em", que o dashboard já tem. Sobram
**sete sub-páginas** numa entrada de menu (`?rpag=`), pelo mesmo motivo de Leads: a
navegação principal já tem 14 itens.

### O que veio de graça, e o que era novo

`general`, `payments`, `alocattion_activations` e `phone_activation` são exatamente as
consultas que `base.sql`, `pagto.sql`, `aloc.sql` e `phone.sql` já replicam. E as
tabelas ATIVOS, CADASTRO, PRIMEIRO PAGAMENTO e TECNOLOGIA são projeções DAX de
`general` — `SELECTCOLUMNS`, sem SQL próprio. Quatro consultas novas, então:

| Consulta | Grão | Linhas medidas | Recorte |
|---|---|---|---|
| `cesta.sql` | item de contrato | 219.871 | Janela de dados |
| `cancelamento.sql` | atendimento com pesquisa | 5.535 → 60.458 respostas | Janela de dados |
| `backlog.sql` | protocolo de instalação em aberto | ~170 | **nenhum**, de propósito |
| `contratos_base.sql` | contrato com ponto de autenticação | 54.642 | Janela de dados |

O `backlog` não tem recorte pela mesma razão dos condomínios: fila em aberto é retrato
do agora, e um protocolo de 2019 que nunca foi instalado é exatamente o que se quer
ver. Cortar por data o esconderia e faria a fila parecer menor do que é.

### A ponte histórica, e por que o total é MENOR que o do Power BI

O `general` deste relatório não é só Voalle: ele faz `Table.Combine` com a tabela
`General_Commercial` do MariaDB — 55.198 linhas de venda registrada fora do Voalle,
entre 2022 e 2024.

Medido no banco, no recorte de 2024: a tabela traz 26.218 linhas, e **25.805 delas
(98,4%) são o mesmo cliente na mesma data que o Voalle já tem**. Ela não é fonte
paralela de venda; é ponte de uma época, e 2024 está coberto pelos dois lados.

As três leituras possíveis, todas medidas:

| Leitura | Contratos em 2024 |
|---|---|
| A — não anexar nada | 120.822 |
| **B — anexar só o que o Voalle não tem** | **121.266** (+444) |
| C — literal da origem | 145.838 (+25.016) |

A origem faz (C): anexa e depois aplica `Table.Distinct` por cliente+contrato. Como as
linhas da ponte não têm contrato, cada cliente sobrevive como **uma linha de contrato
vazio** — 25.016 linhas que duplicam venda já contada, 21% de inflação. Aqui fazemos
(B). A consequência é direta e esperada: **esta tela mostra total menor que o Power BI,
e é o número menor que está certo.**

As linhas da ponte entram marcadas, e a tabela da aba Geral tem uma coluna ORIGEM. Sem
ela, a célula vazia de contrato e bairro pareceria defeito de carga. Elas também só
entram depois que a base do Voalle carregou — a consulta do MariaDB leva 2 s e a do
Voalle 40 s, e sem essa espera o modelo mostrava 26 mil contratos fantasmas por um
minuto e meio, porque não havia com o que comparar.

### Duas divergências internas da própria origem

**A fila de instalação não fecha com ela mesma.** A lista de equipes da consulta
agregada (`backlog`) inclui `Equipe Field Service` e a do detalhe (`Consulta1`) não. São
cerca de 100 de 170 protocolos: na mesma página, o total diz 170 e a tabela lista 70. O
SQL marca as duas bases na coluna `no_detalhe`, cada visual usa a que a origem usava, e
a tela diz o número que está fora.

**A pesquisa de cancelamento conta Sim e Não incluindo os vazios.** As três medidas de
lá (`Qtd Sim2`, `Qtd Não2`, `Qtd Vazio2`) são todas
`CALCULATE(DISTINCTCOUNT(Protocolo), ISBLANK(valor) || valor = "<X>")`. O `||` soma os
vazios nas três colunas, e como 90% das respostas são vazias, "Sim" e "Não" mostram
quase o mesmo número enorme — nenhuma das duas responde à pergunta. É erro de cópia.
Aqui cada resposta conta só na própria coluna, e a de vazios fica ao lado para conferir
que a soma fecha com o total de protocolos.

### O que substituiu a planilha do Google

O modelo de origem lia **equipes** e **feriados** de uma planilha. Equipes já vinham do
`Comercial_Teams`; os feriados agora são **calculados**, móveis inclusive — a Páscoa
sai pelo algoritmo gregoriano anônimo (Meeus/Jones/Butcher), conferida contra 2024 a
2027, e Carnaval, Sexta-feira Santa e Corpus Christi derivam dela. Nacionais e o
estadual do RS nunca precisam de manutenção.

Os **municipais não são semeados de propósito**: aniversário de cidade muda por
município, e chutar uma data seria pior que não ter, porque o número sairia errado com
cara de certo. O admin cadastra em **Configurações → Feriados**, e pode marcar um
calculado como dia normal.

Isso não é detalhe de cadastro. Feriado é dia produtivo a menos, que é meta por dia
maior, que é projeção diferente — uma data errada ali move todos os números do
Relatório Diário.

### Relatório Diário: três blocos de tecnologia, e as cores da origem

Esta é a única tela do dashboard que foge do padrão de cor da casa, e é decisão
consciente: barra de título dourada, corpo de tabela com tom próprio por bloco,
cartão de número em vinho, contador de dia em cinza. Quem usa este relatório todo dia
acha o número pela cor e pela posição — uniformizar tudo em branco fez a tela deixar
de ser reconhecível. Os tokens ficam escopados em `.tela-diario`.

**A estrutura é por TECNOLOGIA**, e isso saiu do `filterConfig` de cada visual: todos
eles têm `TECNOLOGIA` no próprio filtro.

| Bloco | O que tem |
|---|---|
| FIBRA | vendas e ativações por cidade contra meta, mais cartões de ativos, projeção e valor instalado |
| RÁDIO | o mesmo, com meta **única** — na origem a meta de rádio não é por cidade |
| TELEFONIA | só contagem e média por dia; não tem meta na origem |

Uma tabela só, somando as três, responderia uma pergunta que ninguém faz.

**A fila divide por EQUIPE, não por tecnologia.** `BKO` é a equipe *Validação de dados*
— protocolo parado na conferência de cadastro; `AGENDADOS` são as equipes de campo —
já tem agenda, espera a rua. É a divisão que responde a pergunta operacional, e o tipo
(fibra/rádio) é o segundo eixo. Eu havia dividido só por tipo, o que juntava dois
estados bem diferentes na mesma coluna.

> **Dois clientes fora da conta de ativação.** O `filterConfig` de cada visual de
> ativos exclui `Prefeitura Municipal de São Leopoldo/RS` e
> `RESIDENCIAL MORRO DO ESPELHO` — contratos institucionais que entram como uma
> ativação e valem um prédio inteiro. A exclusão vale só para ATIVAÇÃO, nunca para
> venda, e a tela diz quantas ativações ela tirou no mês. Recorte invisível gera
> chamado.

**Porto Alegre fica fora da matriz de clima**, também por filtro do visual de origem:
a cidade existe na busca porque as outras seis são a região metropolitana dela, mas a
operação não instala lá.

Conferido contra uma captura do Power BI do mesmo dia: Canoas, Esteio e Porto Alegre
saíram com os sete números idênticos, e o total de telefonia também. As diferenças nas
demais linhas eram as vendas que entraram entre o print e a medição.

### Enquadrar na tela: como o print sai inteiro

O Relatório Diário existe para virar print e ser compartilhado, e tem 2,4 telas de
altura. O botão **Enquadrar na tela** reduz o conteúdo até ele caber inteiro numa
janela. Três coisas nele foram descobertas medindo, e cada uma corrigiu um print ruim:

1. **`transform: scale`, não zoom do navegador.** O zoom mudaria o tamanho da fonte da
   barra de filtros e refluiria o layout — o print não seria o que se vê na tela.
2. **Tela virtual antes de reduzir.** Só reduzir levava a 44% com metade da tela vazia
   à direita: a escala encolhe os dois eixos junto, e o conteúdo é alto e estreito
   (1.400 × 2.216) contra uma janela larga e baixa (1.440 × 760). Desenhando numa
   largura MAIOR que a janela, o grid reflui, a altura cai e a redução necessária é
   menor. A largura certa depende de como o layout reflui, o que não se calcula: o
   código prova oito larguras e fica com a melhor.
3. **O critério é ocupação da tela, não o maior fator.** Escolhendo o maior fator, a
   tela virtual mais estreita sempre ganhava — ela cabe com menos redução — e o print
   voltava a ter 55% de largura em branco. A ocupação é a menor das duas frações
   preenchidas; maximizá-la escolhe a largura cuja proporção mais se parece com a da
   janela. Medido: **98% de largura e 98% de altura**, a 55% do tamanho.

Mais dois detalhes: a margem negativa que colapsa a sobra, porque `scale` reduz o
desenho mas não o espaço que o elemento ocupa (sem ela a tela cabia e a página
continuava rolando por mil pixels de nada); e o `resize` que espera 120 ms mais um
quadro antes de remedir, porque o navegador dispara o evento antes de terminar o
reflow — medindo no evento, o fator saía do tamanho anterior da janela.

No modo enquadrado os controles de tela somem (CSV, IA, alternadores): são coisas de
interação, e em escala pequena viram borrão ao lado do título.

**Rádio não aparece nesta tela**, a pedido. O relatório de origem tem os blocos de
rádio — meta, fila e dois cartões —, mas medido no banco eles estão todos em zero: não
há venda, ativação nem protocolo de rádio no recorte. Numa tela cujo propósito é virar
print, seis caixas de zero só disputam espaço. Os números continuam sendo calculados no
servidor, então voltar a mostrá-los é acrescentar os visuais de novo.

### Filtro em painel, não em popover (Clientes Base)

Na página CLIENTES BASE da origem, o slicer de cidade e bairro tem 311×849 e fica à
**esquerda** das três matrizes (x=12, contra x=333 delas), ocupando a altura inteira.
Ali o filtro não é acessório da barra: é o eixo pelo qual se lê a tela, e quem usa
fica trocando de bairro e olhando a matriz ao lado. Num popover isso custa dois
cliques por troca e esconde o gráfico justamente na hora de comparar.

Então cidade e bairro saíram da barra de cima e viraram um `FiltroLateral` — mas
continuam sendo contados e limpos pela barra (campo `extras` na declaração da aba),
senão o botão "limpar N filtros" mentiria sobre o que está ativo.

O slicer de lá é uma **hierarquia** cidade > bairro, e a réplica também: escolher
Canoas deixa a lista de baixo com os 40 bairros de Canoas, não com os 277 de todas as
cidades. E trocar de cidade **descarta** o bairro que não pertence a ela — sem isso a
lista deixava de mostrar o bairro mas ele continuava na URL, recortando a tela sem
aparecer em lugar nenhum.

### A régua de dias do Relatório Diário

Sábado vale **meio** dia, domingo zero, feriado zero — a régua da origem.

```
meta/dia  = meta      ÷ dias PRODUTIVOS   (o mês inteiro, porque é alvo)
média/dia = realizado ÷ dias ÚTEIS        (só o que já passou, até ontem)
projeção  = média/dia × dias produtivos
```

Os dois divisores são diferentes de propósito: é isso que faz a projeção significar
algo — ela pega o ritmo do que já aconteceu e estende pelo mês todo. Os dias úteis param
em ontem porque incluir o dia corrente, ainda em andamento, derrubaria a média toda
manhã.

### Metas editáveis, e duas séries conflitantes

As metas por cidade eram constantes dentro de medidas DAX. Agora vivem no volume de
dados com tela de administração, no mesmo padrão de `janela.json`.

O modelo de origem tem **dois conjuntos conflitantes** de meta de ativação:

| Cidade | `# ATIVOS_META` | `## ATIVOS_META_BASE` |
|---|---|---|
| Canoas | 1100 | 898 |
| São Leopoldo | 600 | 598 |
| Novo Hamburgo | 650 | 498 |
| Sapucaia do Sul | 400 | 349 |
| Esteio | 250 | 149 |
| Cachoeirinha | (não existe) | 498 |

A semente é o segundo, que é o que as tabelas da tela usam — e também o único que soma
corretamente com mais de uma cidade marcada: o primeiro usa `SELECTEDVALUE` e devolve
**zero** quando há duas cidades selecionadas. A tela de administração mostra o conjunto
alternativo no rodapé, para quem precisar comparar.

### Clima: a única fonte que não é banco nosso

A página CLIMA/TEMPO busca chuva na **Open-Meteo**: dois endpoints públicos, sem chave
e sem cadastro. Só latitude e longitude saem daqui; nenhum dado nosso viaja. São as
sete cidades do relatório de origem, com as coordenadas de lá.

Uma busca por dia, guardada em disco. Chuva de ontem não muda, e a previsão de hoje não
melhora se pedirmos de dez em dez minutos. Falha aqui **não derruba tela**: a matriz diz
que a busca falhou, o que estava em cache continua servindo, e o resto do Relatório
Diário não depende dela.

O histórico começa em 1º de janeiro do **ano corrente**. Na origem é a constante
`'2026-01-01'`, que envelhece — em 2027 aquele relatório continuaria trazendo 2026.

Os emojis da origem (☀️ ⛅ 🌧️ ⛈️) viraram classificação em texto mais ícone SVG: emoji
muda de desenho por sistema operacional e desalinha a linha da tabela.

### Limite de concorrência no ETL

Com o quarto modelo, a carga inicial passou a ter **13 consultas para um pool de 5
conexões**, e quebrou de duas maneiras ao mesmo tempo: as que ficaram na fila estouraram
o tempo de espera por conexão, e as que passaram competiram por I/O no banco e
estouraram o `statement_timeout` — a consulta de ativações, que sozinha leva 31 s, foi a
130 s. Seis fontes falhando por carga.

Aumentar os timeouts de novo só empurraria o problema; o gargalo é o banco de produção,
que é compartilhado. **Limitar a três consultas simultâneas** (`config.voalle.max - 2`)
não só zerou as falhas — deixou tudo mais rápido, porque o banco parou de competir
consigo mesmo:

| Consulta | Antes | Depois |
|---|---|---|
| `base` | 77 s | 39 s |
| `cesta` | 88 s | 34 s |
| `ponte` (MariaDB) | 53 s | 2,4 s |

O limite também protege os ciclos agendados: `full` (30 min) e `rel` (15 min) coincidem
de hora em hora.

> **Tentei e não paguei.** Internar as strings repetidas da cesta (220 mil linhas com
> vocabulário pequeno em seis colunas) para reduzir memória. O residente ficou em
> 1.178 MB contra 1.161 MB — o custo não são as strings repetidas, é o overhead de 335
> mil objetos. Revertido. Se a memória precisar cair, o caminho é não manter a cesta
> inteira em memória, não economizar string.

### Leitura por IA

Nove visuais registrados, e a aba **Geral fica de fora** — as três tabelas dela são
detalhe de cliente, com nome, endereço e contrato. Mesma regra do detalhe de condomínios
e de leads: o que sobe para a IA é agregado, nunca a linha da pessoa.

Os `oQueE` de cada visual carregam as advertências: que "não ativado" não é
cancelamento, que a base de clientes é estoque acumulado e não fluxo, e que as colunas
Sim/Não da pesquisa divergem do Power BI de propósito. Sem isso a IA leria o número e
repetiria a interpretação errada com confiança.

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
| **Leads e Negociações** · sub-páginas *Desempenho do vendedor* e *por cidade* | 6 cartões, produtividade, status, resumo financeiro, 2 funis, 2 matrizes de taxa, 8 tabelas de perda | `Leads Cadastrados`, `Leads Cadastrados e Ganhos`, `Taxa Conversao Cadastro`, `Negociacoes Conduzidas`, `Negociacoes Conduzidas Ganhas`, `Taxa Conversao Negociacao`, `Taxa Vendas sobre Cadastro`, `Backlog Leads Aberto`, `Média Duração por Vendedor`, `Média Tempo Vida Lead` |
| **Leads e Negociações** · sub-página *Negociações* | 6 cartões, negociações por lead, status × motivo, colunas por mês, detalhe de 18 colunas, 9 tabelas de dimensão | `Negociacoes`, `Negociacoes_Ganhas`, `Negociacoes_Perdas`, `Negociacoes_Andamento`, `Receita Total`, `Ticket Medio`, `Duracao Total Formatada` |
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

* **`MEDIA VENDAS` / `MEDIA ATIVOS`** — registros por dia útil (`mediaPorDiaUtil`). O
  divisor é a soma dos pesos dos dias: domingo e feriado valem 0, sábado 0,5 e os demais
  1; entram só os dias que aparecem nos dados (mesmo comportamento de `VALUES()` no DAX).
  Feriados em `src/model/holidays.js` (a tabela do Power BI parava em 2025; 2026 e 2027
  foram acrescentados). **O dividendo não é ponderado — e aqui divergimos do Power BI de
  propósito.** Ver a seção abaixo.
* **Cada projeção usa a sua data** — vendas por `DATA CRIAÇÃO CONTRATO`, ativações por
  `DATA ATIVAÇÃO`, primeiro pagamento por `PAGAMENTO CLIENTE` — exatamente como os três
  relacionamentos com a tabela `calendar`.
* **Premiações** — as faixas de TELEFONIA só valem quando uma única tecnologia está
  selecionada no filtro, replicando o `SELECTEDVALUE(tecnology[TECNOLOGIA])`.
* **`DATA ATIVAÇÃO`** — telefonia usa `MAX(reports.final_date)`; fibra/rádio usam a saída
  do equipamento, ignorando os casos em que ele retornou no mesmo dia.

### A média por dia útil, e a divergência deliberada com o Power BI

A regra que o comercial enuncia é: *domingo e feriado não contam, sábado vale meio dia*.
Ela é sobre o **divisor** — quanto expediente teve o período. Foi assim que a medida
passou a ser calculada em 02/09/2026, a pedido do comercial:

```
media = total de registros ÷ Σ(peso dos dias com movimento)
```

O peso vem de `dayWeight`: domingo e feriado 0, sábado 0,5, segunda a sexta 1.

**O que mudou.** O DAX de origem multiplicava os *dois* lados da divisão:

```
DIVIDE( SUMX(Dias, Qtd × Peso), SUMX(Dias, Peso) )   -- Power BI, e a réplica até 01/09/2026
```

Ponderar o dividendo não descontava só o expediente — descontava a **produção**. As
vendas de sábado entravam pela metade, e uma venda feita em domingo ou feriado era
multiplicada por zero: sumia da média enquanto continuava contada no total exibido no
card ao lado. Em abril/2026 foram **107 vendas** assim, 2,8% do mês.

Medido direto no Voalle, contando contratos por data de criação:

| mês | total | divisor | **agora** | antes (Power BI) | sumiam da conta |
|---|---:|---:|---:|---:|---:|
| jan | 4.027 | 23,5 | **171,36** | 163,55 | 16 |
| fev | 3.328 | 21,0 | **158,48** | 148,79 | 71 |
| mar | 4.011 | 24,0 | **167,13** | 160,85 | 0 |
| abr | 3.839 | 22,0 | **174,50** | 163,32 | **107** |
| mai | 3.568 | 22,5 | **158,58** | 149,93 | 37 |
| jun | 3.521 | 23,0 | **153,09** | 145,70 | 48 |
| jul | 3.432 | 25,0 | **137,28** | 133,14 | 0 |
| ago | 3.557 | 23,5 | **151,36** | 144,70 | 0 |

A medida sobe de 3,0% a 6,4% conforme o mês — quanto mais sábado e feriado produtivo,
maior o ajuste. Em compensação **`média × Σpeso` reproduz o total**, que é a única
leitura que fecha: antes o card e a média nunca se reconciliavam.

**Onde a conta continua igual.** O divisor não mudou. Ele segue somando só os dias que
aparecem nos dados, e o sábado segue valendo meio dia. Quando alguém compara com dias
corridos — `3.557 ÷ 31 = 114,7` — o número parece alto: o salto para 151,36 é o efeito
de dividir por 23,5 em vez de 31, que é exatamente o que a regra pede.

**Consequência:** os números desta medida **não batem mais** com o relatório Power BI de
origem, por decisão do comercial. As demais medidas seguem fiéis. Vale para vendas,
ativações e primeiro pagamento, porque as três telas chamam a mesma função. Travado em
`test/medias.test.mjs`.

**De quebra, o sistema deixou de discordar de si mesmo.** A Análise Preditiva sempre
calculou `realizado ÷ pesoDoPeriodo(...)` — a contagem cheia dividida pelos pesos, sem
ponderar o dividendo (`src/model/preditivo.js`). Eram duas réguas para a mesma ideia de
"por dia útil" na mesma aplicação, e o ritmo do preditivo saía acima da média do card
sem nada que explicasse a diferença. Agora as duas contam igual. A única distinção que
resta é de propósito: o preditivo varre o calendário e conta **todo** dia útil do
período, inclusive os sem venda, porque projetar exige saber quanto expediente ainda
falta.

### Onde o denominador muda: o recálculo por contexto

A medida é recalculada em cada célula, com **os dias daquela célula** — é o que
`VALUES()` faz no DAX, e o que o `Map` por dia faz aqui:

| Onde | Dias no denominador |
|---|---|
| card da tela | todos os dias com movimento no período |
| linha da tabela por vendedor | só os dias em que **aquele** vendedor vendeu |
| rodapé da tabela | todos de novo — **não** é a soma nem a média das linhas |

Por isso um vendedor que fechou 10 contratos num único dia aparece com média `10,0`, e
não `10 ÷ 23,5`: o denominador dele é um dia. E por isso a coluna de média nunca fecha
com o rodapé — no Power BI também não fechava.

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

### Ativações: quando o equipamento volta no mesmo dia

A data de ativação de fibra e rádio é a data de saída do equipamento. Quando o
aparelho **volta na mesma data**, a instalação não se concretizou e a data é anulada
— `src/sql/aloc.sql`. A regra é certa, mas sozinha ela é cega para um caso comum:

> O técnico leva o aparelho, ele não serve, volta no mesmo dia — e um **segundo**
> equipamento sai por outro atendimento (quase sempre `TEC - Suporte de Retorno
> Prioritário`) e fica com o cliente. Trocou-se o aparelho. O cliente **está**
> instalado.

Como esse segundo atendimento não é do tipo "instalação", ele fica fora do `WHERE`
da consulta, e o contrato sumia da tela inteiro. Por isso a anulação passou a valer
só quando **nenhum** equipamento do contrato ficou com o cliente, de qualquer tipo de
atendimento — o que decide é o aparelho na casa, não o motivo da visita.

Medido no Voalle, 2026 inteiro: a regra anula **35** contratos e em **12** deles havia
equipamento instalado. O efeito nos meses fechados:

| mês | antes | agora | recuperados |
|---|---:|---:|---:|
| jun/2026 | 2.593 | **2.593** | — |
| jul/2026 | 2.529 | **2.532** | 3 |
| ago/2026 | 2.674 | **2.677** | 3 |

Junho não muda de propósito: lá os dois contratos anulados não tinham aparelho
nenhum na casa do cliente, e a anulação estava correta.

**O Power BI de origem tem a mesma regra escrita — e ela nunca dispara.** O `CASE`
que monta a data mistura `plis.out_date` (`date`) com `a.conclusion_date`
(`timestamp`); o Postgres promove o resultado a `timestamp`, e o
`if [RETORNO] = [DATA SAÍDA] then null` do Power Query passa a comparar `date` com
`datetime` — em M isso é **sempre falso**. No relatório antigo nenhuma instalação é
descartada, nem as 23 que deveriam sair. Agosto/2026 bate em 2.677 nos dois lados
por motivos opostos: aqui porque a ressalva devolveu os 3 casos legítimos, lá porque
a regra inteira é código morto.

Travado em `test/aloc.test.mjs` — os testes seguram a estrutura da regra, já que a
consulta só roda contra o Voalle.

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
   O *cross-filter* do Power BI existe, vai além das barras e destaca em vez de
   colapsar — detalhe em *Cross-filter: onde clicar* logo abaixo.
6. **Períodos longos** na página Histórico agrupam a matriz por mês (acima de ~2 meses),
   evitando uma tabela com centenas de colunas.
7. A paleta é a do relatório (`#880F17`, `#D9B300`, `#E66C37`). O dourado tem contraste
   baixo sobre branco — por isso todas as barras trazem rótulo de valor legível, além da
   tabela equivalente ao lado.

---

### Cross-filter: onde clicar

No Power BI, clicar num visual recorta a página. Aqui também, e o mecanismo é o mesmo de
sempre: o clique escreve o valor no **filtro da URL** (`?cidade=SALVADOR`), a página refaz
a única chamada que ela tem, e o link continua compartilhável. Clicar de novo remove.

**O que responde ao clique:**

| Onde | Filtra |
|---|---|
| Barra horizontal (cidade, canal) | o valor da barra |
| Linha da tabela por vendedor (Vendas, Ativações, Rampagem, Premiações) | o vendedor |
| Nome do vendedor na matriz de Histórico | o vendedor |
| Segmento da coluna empilhada por tecnologia | a tecnologia |
| Item da legenda `FIBRA / RÁDIO / TELEFONIA` | a tecnologia |
| Cinco das seis contagens de Vendas Canceladas | vendedor, equipe, situação, cidade, tecnologia |
| Barra de `MOTIVO DO CANCELAMENTO` | o motivo (rótulo classificado) |
| `POR TIPO DE ATENDIMENTO` em Vendas Canceladas | o tipo |
| Linha de `Planos mais vendidos` (Primeiro Pagamento) | o plano |
| Coluna do gráfico de período (Vendas, Canceladas, Primeiro Pagamento, Rampagem) | o mês ou o dia da coluna |

**O que não responde, e por quê:** `POR VALOR` em Vendas Canceladas (é o preço do plano,
que já se filtra pelo plano em Primeiro Pagamento); a coluna do gráfico de Ativações e a
de `TOTAL DE VENDAS / DIA`, porque ali o clique no segmento já significa a tecnologia e o
mesmo alvo não pode querer dizer duas coisas; a área de Diretoria, que não tem coluna para
clicar; e o gráfico de Canceladas quando agrupado por **cadastro do cliente** — a coluna é
um mês de cadastro, mas o recorte de período do modelo é sobre a venda, e filtrar um mês
diferente do que a coluna mostra é o tipo de erro que ninguém confere.

#### Três dimensões que existem numa página só

`motivo`, `tipo` e `plano` **não entram no `matchDims`**: quem os aplica é o painel dono do
visual. Cada um por uma razão diferente, e as três estão em `parseFilters`:

- **`motivo`** não é campo, é o rótulo que o classificador deriva por votação sobre a lista
  inteira — não existe comparação linha a linha. O classificador é treinado na base *sem* o
  filtro de motivo, senão o rótulo clicado mudaria de nome no clique seguinte.
- **`plano`** só existe no contrato que já teve primeiro pagamento. Aplicado no modelo, ele
  viraria um filtro escondido de "quem pagou" nas telas de venda.
- **`tipo`** existe em todo fato, mas o visual dele vive numa página só — e o Power BI
  também recorta a PÁGINA no clique, não o relatório.

Cada tela declara as suas na barra (`chipsExtra`), então um motivo esquecido não aparece
como chip em Vendas, onde ele também não faria nada. O nome vai sem prefixo porque nenhuma
outra tela tem campo com esse nome; se um dia tiver, o prefixo entra aqui, como em
`rcidade`/`lcidade`.

#### O recorte de período é um campo próprio

Clicar na coluna de março escreve `?zoom=2026-03`, e o servidor cruza isso com o período do
slicer — **estreita, nunca alarga**. Campo próprio, e não `de`/`ate` reescritos: o seletor
da barra continua dizendo "Este ano" enquanto a tela mostra março, e apagar o chip devolve o
ano inteiro. Sobrescrever o período perderia o que a pessoa escolheu, sem volta.

Duas consequências boas: o gráfico que mostra o período ignora esse recorte (senão colapsa
numa coluna só, com as outras esmaecidas ao redor da clicada), e o visual
`TOTAL DE VENDAS / DIA` passa a abrir **os dias do mês clicado** — o detalhamento que a
pessoa está pedindo com aquele clique.

**Três decisões que vieram com isso:**

1. **O clique empilha no histórico** (`alternar` não usa `replace`), então o botão voltar
   desfaz. Os seletores da barra continuam com `replace`: ali o valor muda a cada caixa
   marcada e a cada tecla da busca, e empilhar isso encheria o histórico de passos que
   ninguém quer desfazer um a um.
2. **Uma faixa de chips diz o que está valendo.** Ela existe porque o cross-filter preenche
   campos que não têm botão na barra — `cidade` não está entre os seis seletores da tela de
   Vendas. O contador dizia "limpar 1 filtro" e nada na tela dizia qual: filtro que soma mas
   não se mostra é o caminho mais curto para alguém apresentar um número recortado achando
   que é o total. Cada chip remove o **seu** valor, não o campo inteiro.
3. **A faixa entra na conta da altura.** `--h-chips` (33 px) soma no `--chrome`, e por isso
   os cards encolhem quando ela aparece — medido sem rolagem em 1440×900 e 1920×1080. Em
   720p os pisos do `clamp` ganham e a tela rola ~29 px, que é o comportamento desenhado:
   abaixo do piso, rolar é melhor que comprimir.

#### Destacar, não colapsar: a auto-exclusão

O padrão do Power BI é *cross-highlight*, e o detalhe que faz diferença é este: o visual
clicado **mantém todas as categorias** e destaca a escolhida. Sem isso, clicar em SALVADOR
no gráfico de cidades deixava uma barra só na tela — some justamente a comparação que
motivou o clique.

A regra no servidor é uma linha: **o visual que mostra um campo é calculado sem o filtro
daquele campo** (`rowsExceto` em `measures.js`). O gráfico de cidades continua recortado por
vendedor, tecnologia e período; só não por cidade. Os cartões de KPI e as séries do topo
seguem com o filtro CHEIO, de propósito — eles respondem "quanto deu o que você escolheu",
que é outra pergunta.

Vale em **Vendas, Ativações e Vendas Canceladas**, as três telas de comparação. Três
consequências que precisaram de cuidado:

1. **Valor clicado nunca desaparece.** `groupCount` recebe `garantir` e fixa na lista os
   valores selecionados mesmo fora do topo N. Sem isso, clicar numa cidade de 18º lugar a
   tirava de um gráfico de 15 barras: a tela ficava filtrada por algo invisível.
2. **O rótulo da coluna empilhada acompanha a seleção.** Com FIBRA clicada as três faixas
   continuam desenhadas (as outras esmaecidas), mas o número no topo é o de fibra —
   `seriePorTecnologia` conta só as faixas destacadas. Sem isso o rótulo somava as três e
   brigava com o cartão de KPI, que é filtrado: dois números da mesma coisa discordando na
   mesma tela.
3. **O rodapé da tabela por vendedor soma o que a tabela mostra**, e o rótulo diz quantos
   estão no filtro (`Total (12 vendedores · 1 no filtro)`). A tabela lista todos e o cartão
   mostra o selecionado; os dois números são certos, e sem o aviso a diferença se lê como
   erro de conta.

**Rótulos-sentinela e caudas não clicam.** `(sem canal)`, `(sem equipe)` e `Outros (N)` não
são valor de banco — `matchDims` compara com o campo cru, então filtrar por eles devolvia
tela vazia. O servidor marca `semFiltro`/`agrupado` e a barra fica desenhada, contando, mas
com cursor de seta.

**Onde o clique ISOLA, e por quê.** Em **Histórico** o visual é a tela inteira: com
auto-exclusão o clique não faria nada além de acender a linha. Em **Premiações** a tabela é
uma lista de quem recebe — mostrar quem está fora do filtro numa lista de pagamento é
convite a erro. Em **Rampagem** a pergunta é o desempenho de um vendedor nos primeiros 90
dias, e isolar é o que se quer. Nessas três, clicar recorta.

**Custo medido** (só CPU, fatos sintéticos, `bench` fora do repositório): sem filtro, o
caminho é idêntico ao de antes — `rowsExceto` devolve a lista que o painel já calculou
quando o campo não está filtrado, então **tela sem clique não custa nada a mais**. Com 120
mil fatos (a ordem de grandeza da base real): 21 ms sem filtro contra 5–15 ms com um a
quatro cliques — a tela filtrada é mais BARATA, porque a varredura é a mesma e as
agregações recebem menos linha. Com 250 mil fatos: 47 ms sem filtro, 12–24 ms no caso
típico. A varredura extra só existe por dimensão CLICADA, não por visual da tela.

#### O cache que o cross-filter exigiu

Explorar é clicar, voltar e clicar de novo, e cada volta refazia a varredura inteira. Com o
auto-refresh por cima, vinte abas na tela de Vendas com o período padrão são vinte
varreduras idênticas por minuto. As sete rotas comerciais passam por um cache LRU de 240
entradas com validade de dois minutos — o intervalo da carga incremental, o mesmo tempo que
o dado leva para poder mudar (`model/cache.js`).

A chave tem duas coisas que a tornam segura em vez de esperta:

1. **A versão do modelo.** Uma carga nova troca todas as chaves de uma vez, então não existe
   invalidação para alguém esquecer de chamar.
2. **A query inteira, já reescrita pelo middleware de escopo.** É `aplicarEscopo` que cruza
   `equipe` com as equipes que a pessoa pode ver, e ele escreve em `req.query`. Cachear por
   rota e filtro *pedido* serviria o dado de uma equipe para quem não pode enxergá-la.

`/meta` expõe entradas, acertos, faltas e taxa: cache sem medida é fé, e é a taxa que
denuncia chave errada. O `/refresh` manual limpa tudo — o botão existe para quem quer ver
agora, e se a carga não mexeu na versão ele não pode devolver a resposta de antes dele.

No front, `apiGet` repassa o `signal` do react-query: quatro cliques em rajada abriam quatro
requisições que iam até o fim, e a penúltima resposta podia chegar depois da última.

Sete testes em `server/test/cache.test.mjs` (`npm test` no server) cobrem a chave, o teto de
entradas e a integração — um deles monta o roteador de verdade sobre fatos sintéticos e
confere o acerto pelo `/meta`, porque dá para escrever um cache perfeito e esquecer de
ligá-lo em metade das rotas.

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
Leopoldo, Sapucaia do Sul e Esteio como filtro nas tabelas de detalhe. A tela mostra todas;
quem quiser aquele recorte escolhe as cidades no seletor, que tem busca. Filtro escondido em
constante é a receita de "o dashboard está com número errado": quem abre não tem como saber
que cinco cidades foram escolhidas dentro de um arquivo `.js`.

### Condomínios: de onde vem cada número da diferença com o Power BI

Os três cartões do topo não batem com os do relatório, e a diferença é inteiramente
explicada pelas divergências acima. Medido no banco, com a mesma cadeia de joins e cada
filtro nosso ligado e desligado:

| | primários | splitters | portas |
|---|---|---|---|
| **A** — nosso, todos os filtros | **777** | **3.887** | **55.050** |
| **B** — sem `porta_sec.deleted IS FALSE` | 777 | 3.887 | 55.489 |
| **C** — sem os filtros do splitter secundário | 779 | 3.902 | 55.274 |
| **D** — sem nenhum dos dois | 779 | 3.902 | 55.729 |
| **Power BI** (`SPLITTER PRIMARIO` / `SPLITTER SECUNDARIO` / `USUARIO (s)`) | 779 | 3.902 | 55.906 |

Lendo a tabela:

* **Primários e splitters** fecham em D. Os **2 primários** e os **15 splitters** de
  diferença são os secundários inativos, apagados ou de tipo diferente de 1, que o Power
  Query não filtra e nós filtramos.
* **Portas**: 55.050 + **439** (portas marcadas como apagadas em splitters válidos) + **240**
  (portas dos 15 splitters excluídos) = 55.729 = D. Faltam **177** para o número do
  relatório, e elas não são dados — são **duplicatas**: o `Table.ExpandTableColumn` de
  `CONTRATOS_BLOQUEADOS` casa por número de contrato contra uma tabela deduplicada por
  USUÁRIO, então um contrato com duas conexões vira duas linhas. Reproduzindo a expansão em
  SQL, o total dá **55.906** — exatamente o card `USUARIO (s)` de lá.

Ou seja: as 856 portas de diferença são **679 linhas que não deveriam contar** (porta ou
equipamento fora de operação) e **177 linhas contadas duas vezes**. Nenhuma delas é porta
que exista e esteja faltando aqui.

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


### Negociações: uma linha não é uma negociação

A consulta de negociações agrupa por `sp.title` e `ccsssp.unit_amount` — o plano e o valor
dele. Uma negociação com **dois planos** vira **duas linhas**. Medido no banco: **31.108
linhas para 30.714 negociações distintas**, 394 a mais (1,3%).

É por isso que o relatório tem duas medidas que parecem redundantes:
`Medidas_old[Negociacoes]` é `DISTINCTCOUNT(negociacao_id)` e `Medidas[Total Negociacoes]` é
`COUNT(titulo_negociacao)`, ou seja, linhas. Lá os cartões usam a distinta e as nove tabelas
de dimensão usam a de linhas — então a tabela pode mostrar 31.108 dois centímetros abaixo de
um cartão que diz 30.714.

Aqui **toda contagem é a distinta**, para tabela e cartão não se contradizerem, e a tela diz
no cartão quantas linhas a consulta devolveu. As duas exceções são deliberadas:

* **Receita soma por LINHA.** Cada linha é um plano com o seu `unit_amount`; somar por
  negociação perderia o segundo plano.
* **A tabela de PLANO soma acima do total**, porque uma negociação com dois planos conta nos
  dois. Está dito no subtítulo dela — é a informação correta, não um erro de fechamento.

**A base da tela é a NEGOCIAÇÃO, não o lead.** O período filtra a data de criação da
negociação e o vendedor é o `responsavel` por ela. Medido: 6.694 negociações, de 5.660 leads,
têm o lead cadastrado antes do recorte de 01/01/2026 — 21% do total. Herdar a base da
sub-página de Leads faria os quatro cartões nascerem um quinto abaixo do relatório. Por isso
as duas sub-páginas têm barras de filtro separadas, com campos próprios na URL.

**EQUIPE é a do responsável.** No modelo de origem a relação ativa com a dimensão de
vendedores é a do dono do LEAD, e a do responsável pela negociação é inativa (as medidas a
ligam com `USERELATIONSHIP`). O efeito lá é que "EQUIPE" e "VENDEDOR", lado a lado na mesma
barra, podem se referir a duas pessoas diferentes. Aqui os dois falam da mesma pessoa.


### Desempenho: duas páginas, um componente

As páginas DESEMPENHO DO VENDEDOR e DESEMPENHO POR CIDADE do relatório têm 5.100px e 32 e 30
visuais. Comparadas visual por visual, são a **mesma página com outra dimensão de linha**:
mesmos sete slicers, mesmos seis cartões, mesma matriz de produtividade, mesmos dois funis,
mesmas oito tabelas de perda. Aqui é um componente com `por`, e uma rota com `?por=` — o que
também garante que as duas nunca divirjam por descuido de manutenção.

**O que cada lado agrupa** é a decisão central:

* **por vendedor** — leads pelo dono do lead, negociações pelo **responsável**. Uma negociação
  conta para quem a conduziu, mesmo que o lead seja de outra pessoa. É o `USERELATIONSHIP` que
  as medidas do relatório usam para trocar a relação com `dVendedores`.
* **por cidade** — leads pela cidade deles, negociações pela cidade do **lead**. Aqui
  negociação de lead fora do recorte fica de fora: cidade quem tem é o lead. Por isso a
  contagem de negociações difere entre os dois agrupamentos (30,7 mil contra 24,1 mil) — e as
  duas estão certas, para perguntas diferentes.

**Duas taxas, duas bases.** Numa linha de vendedor, a conversão de CADASTRO é sobre os leads
que ele cadastrou e a de NEGOCIAÇÃO é sobre as negociações que ele conduziu. Os conjuntos não
são o mesmo, e ler as duas como se fossem a mesma escala induz a erro — está dito no `title`
dos cartões e no `oQueE` que vai para a IA.

**Contagem distinta, aqui também.** O relatório usa `Total Negociacoes` (linhas) nos funis e
nas tabelas de perda. Na primeira versão eu segui a medida, e o funil dizia 31.150 enquanto a
matriz logo acima dizia 30.756 — a mesma incoerência que eu havia apontado no relatório,
reproduzida por mim. Uma tela precisa fechar consigo mesma antes de fechar com a origem.

**UMOV ME TECNOLOGIA aparece como vendedor**, com 40 mil leads e nenhuma negociação. Não é
uma pessoa: é a integração que cadastra lead automaticamente. Ela entra porque
`Dono do Lead Final` cai para `criado_por` quando não há proprietário — e o próprio SQL do
relatório a conhece, excluindo-a das classificações Disponível e Qualificado. Fica na tabela
porque é dado real, e está dita no `oQueE` da leitura por IA.

**Os vendedores sem equipe estão contados na tela.** `Comercial_Teams` é a fonte única de
equipe, por decisão de projeto — sem planilha do Google. Hoje 77 dos 265 vendedores do CRM
não estão lá, então aparecem agrupados sem equipe e o filtro de Equipe não os alcança. O
banner da tela diz o número: recorte invisível gera chamado.


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
| `GET /api/negociacoes/filtros` | listas dos slicers da sub-página de negociações |
| `GET /api/negociacoes` | cartões, por lead, motivo, série, dimensões, valores |
| `GET /api/desempenho/filtros` | listas dos slicers das duas sub-páginas de desempenho |
| `GET /api/desempenho?por=vendedor\|cidade` | produtividade, status, resumo, funis, taxas, perdas |
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
| `GET /api/relatorios/{geral,resumo,equipes,diario,base,pesquisa,clima}` | as sete sub-páginas de Relatórios Comercial |
| `GET/PUT /api/metas` · `POST /api/metas/restaurar` | metas por cidade (admin) |
| `GET/PUT /api/feriados` · `POST /api/feriados/restaurar` | cadastro de feriados (admin) |
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

As de negociações têm outro, e não é duplicação: `nde`/`nate` é a data de **criação da
negociação**, `nvend` é o **responsável** por ela, e `nstatus` tem três valores em vez de
sete. Mais `nequipe`, `nfase`, `ntipo`, `norigem`, `nforma`, `nregiao` e `nbusca`.

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
* **Aba `Exportações`** — doze conjuntos completos gerados pelo servidor, sem o corte que
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
| Negociações (CRM) | leads |

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
* **Todo filtro ativo aparece**, mesmo o que veio de clique em gráfico: a faixa de chips
  abaixo da barra mostra um chip por valor, e o chip remove só aquele valor.
