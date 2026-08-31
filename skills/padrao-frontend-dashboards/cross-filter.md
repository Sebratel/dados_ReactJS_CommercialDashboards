# Filtro por clique (cross-filter)

Seção para o padrão de front-end de dashboards. Vem de replicar o comportamento do
Power BI no dashboard COM · Gestão Comercial: clicar num visual recorta a tela.

---

## A regra

**Clicar num visual filtra a tela, e o clique escreve na URL — não em estado local.**

Três consequências que vêm de graça: o link continua compartilhável, o botão voltar
desfaz, e a tela não precisa de nenhum estado novo para lembrar o que está filtrando.

```jsx
// no provider de filtros: alterna um valor de lista
const alternar = (campo, valor) => setParams((prev) => { /* liga/desliga na URL */ });
// para campo de valor único (o recorte de período)
const alternarUnico = (campo, valor) => setParams((prev) => { /* troca ou limpa */ });
```

## Onde o clique entra

| Visual | O que o clique filtra |
|---|---|
| Barra horizontal | o valor da barra |
| Linha de tabela | o campo daquela linha (quem chama decide qual) |
| Segmento de coluna empilhada | a categoria do segmento |
| Item de legenda | a mesma categoria do segmento |
| Coluna de gráfico de período | o mês ou o dia da coluna |

O componente de tabela recebe a **linha inteira** em `onSelect`, não um valor: quem
chama sabe qual campo dela vira filtro, a tabela não. E recebe `selecionada(linha)`
porque o nome do campo no filtro nem sempre é o nome da coluna.

## Quatro mecanismos que sustentam isso

**1. Um endpoint por tela.** Cada página faz UMA chamada que devolve o painel inteiro,
então um clique custa **uma requisição**, não uma por visual. É o que torna o
cross-filter viável sem virar tempestade de rede.

**2. O clique empilha no histórico; o seletor não.** `alternar` sai sem `replace`, então
voltar desfaz — cross-filter é exploração, a pessoa clica em cinco categorias seguidas e
espera voltar. Os seletores da barra ficam com `replace`: ali o valor muda a cada caixa
marcada e a cada tecla da busca, e empilhar isso enche o histórico de passos que ninguém
quer desfazer um a um.

**3. Uma faixa de chips diz o que está valendo, um chip por VALOR.** Não é enfeite: o
clique preenche campos que **não têm botão na barra**. No caso de referência, `cidade`
não estava entre os seis seletores da tela de vendas — o contador dizia "limpar 1 filtro"
e nada na tela dizia qual. Filtro que soma mas não se mostra é o caminho mais curto para
alguém apresentar um número recortado achando que é o total. Cada chip remove o seu
valor, não o campo inteiro: clicar em três cidades e ter que desmarcar as três de uma vez
é o mesmo problema com outro nome.

**4. Auto-exclusão: o visual clicado destaca, não colapsa.** É o detalhe que separa
"parece o Power BI" de "é o Power BI". **O visual que MOSTRA um campo é calculado sem o
filtro daquele campo.** Sem isso, clicar em SALVADOR no gráfico de cidades deixa uma
barra só — e some justamente a comparação que motivou o clique.

```js
// no servidor: a lista de um visual, ignorando o campo que ele mostra
const paraCidade = rowsExceto('vendas', flt, 'cidade', listaJaFiltrada);
// devolve `listaJaFiltrada` quando o campo não está filtrado: tela sem clique
// não paga varredura extra. O custo é por dimensão CLICADA, não por visual.
```

Os KPIs e as séries do topo continuam com o filtro **cheio**: eles respondem "quanto deu
o que você escolheu", que é outra pergunta.

## As armadilhas (todas custaram retrabalho)

**Valor clicado que desaparece.** Todo agrupamento com teto (`top N`) precisa fixar os
valores selecionados, mesmo fora do topo. Clicar numa categoria de 18º lugar a tirava de
um gráfico de 15 barras: a tela ficava filtrada por algo que não aparecia em lugar
nenhum, e a única pista era o chip.

**Rótulo-sentinela e cauda dobrada não clicam.** `(sem canal)`, `(sem equipe)` e
`Outros (N)` não são valor de banco — filtrar por eles devolve tela vazia. O servidor
marca a linha (`semFiltro` / `agrupado`), a barra continua desenhada e contando, e o
cursor volta a ser seta. Cursor de mão que não filtra nada é promessa falsa.

**Dois números da mesma coisa discordando na mesma tela.** Com auto-exclusão, a tabela
mostra todos os itens e o cartão de KPI mostra o selecionado. Se o rodapé da tabela
somar o KPI, ele não fecha com as linhas visíveis. Duas providências: o rodapé soma o
que a tabela MOSTRA, e o rótulo diz o recorte — `Total (12 vendedores · 1 no filtro)`.
Mesma regra para o rótulo de total no topo de coluna empilhada: ele conta só as faixas
destacadas.

**Um alvo, um significado.** Se o segmento da coluna já significa a categoria, a mesma
coluna não pode também significar o período. Escolha um por visual e diga qual.

**Clique que filtra por um campo diferente do que a coluna mostra.** Se o gráfico está
agrupado por uma data e o filtro do modelo é sobre outra, o clique fica **desligado**
naquele modo. Filtrar mês diferente do que a coluna mostra é o tipo de erro que ninguém
confere.

**Recorte de período é campo próprio, não `de`/`ate` reescritos.** Assim o seletor
continua dizendo "Este ano" enquanto a tela mostra março, e apagar o chip devolve o ano
inteiro. Os dois se cruzam: o clique estreita, nunca alarga. Sobrescrever o período
perde a escolha da pessoa, sem volta.

**Dimensão de PÁGINA ≠ dimensão do modelo.** Campo que só existe num visual (motivo
classificado, plano, tipo) não entra no filtro global do modelo: é aplicado pelo painel
dono do visual, e cada tela declara os seus na barra de chips. Um campo derivado
(rótulo classificado) não tem comparação linha a linha; um campo que só existe em parte
dos fatos (plano, que exige pagamento) viraria filtro escondido nas outras telas.

## A faixa de chips entra na conta da altura

A altura útil é derivada do cromo, então uma faixa que aparece e desaparece precisa
entrar na conta — senão a tela volta a rolar exatamente quando alguém está explorando.

```css
:root { --h-chips: 0px; }
:root:has(.chips) { --h-chips: 33px; }   /* variável PRÓPRIA: --h-filtros tem media queries */
--chrome: calc(var(--h-topbar) + var(--h-nav) + var(--h-filtros) + var(--h-chips) + 34px);
```

A faixa é de **uma linha só** (`flex: 0 0 100%`, `overflow-x: auto`, borda direita
esmaecida como dica de rolagem) e tem teto de chips com `+N` no `title`. Se ela pudesse
quebrar em duas ou três linhas, a altura da tela passaria a depender do texto das
categorias.

## Custo, medido

- **Sem clique, custo zero a mais**: a lista de auto-exclusão só é recalculada quando
  aquele campo está filtrado.
- **A tela filtrada é mais barata que a tela cheia**: a varredura é a mesma e as
  agregações recebem menos linha. Com 120 mil fatos em memória: ~21 ms sem filtro contra
  5–15 ms com um a quatro cliques.
- **Cache de resposta por `(versão do modelo, rota, query)`**, LRU curto, com validade
  igual ao intervalo da carga. Duas exigências: a versão na chave (carga nova invalida
  sozinha, sem ninguém lembrar) e a query **já reescrita pelo middleware de escopo** —
  cachear pelo filtro *pedido* serve dado de uma equipe para quem não pode ver.
- **Repasse o `signal` do react-query** ao `fetch`. Sem isso, quatro cliques em rajada
  abrem quatro requisições que vão até o fim, e a penúltima resposta pode chegar depois
  da última: a tela mostra o recorte anterior com o chip do novo.

## Onde o clique deve ISOLAR em vez de destacar

Auto-exclusão é para tela de **comparação**. Em três casos o certo é recortar:

- **o visual é a tela inteira** — destacar não faria nada além de acender uma linha;
- **a lista é uma lista de pagamento** (premiação, comissão) — mostrar quem está fora do
  filtro numa lista de dinheiro é convite a erro;
- **a tela é de acompanhamento individual** — a pergunta é sobre uma pessoa, e isolar é
  o que se quer.

## Antes de dizer que está pronto

1. Clique numa barra: as outras categorias continuam desenhadas e esmaecidas?
2. O chip apareceu, com o nome do campo igual ao do seletor da barra?
3. O botão voltar desfez o clique?
4. Clicar de novo na mesma categoria limpou?
5. O contador de "limpar N filtros" conta o que os chips mostram?
6. Clique numa categoria de cauda longa: ela continua visível no gráfico?
7. `(sem X)` e `Outros (N)` estão com cursor de seta e sem efeito?
8. Algum total dentro de um visual discorda de um KPI ao lado sem explicar por quê?
9. Com chip aceso, a tela ainda cabe em 1440×900 e 1920×1080 sem rolar?
