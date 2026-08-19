---
name: padrao-frontend-dashboards
description: Padrão de cores, layout, componentes e interação para dashboards analíticos em React (Vite + Recharts) da Sebratel, extraído do dashboard COM · Gestão Comercial que replica um relatório Power BI. Use sempre que for criar, revisar ou estender uma tela de dashboard, painel de indicadores, relatório visual, gráfico, tabela de KPIs, barra de filtros ou tela de configurações administrativas — inclusive quando o pedido for genérico como "cria uma tela de vendas", "monta um painel com esses números", "adiciona um gráfico aqui" ou "replica esse relatório do Power BI em React", sem menção explícita a padrão, paleta ou layout. Use também ao decidir altura de card, distribuição de colunas, cor de série, quando usar diálogo em vez de popover, e ao portar visuais de Power BI para web.
---

# Padrão de front-end para dashboards

Este padrão vem de um dashboard em produção que replica o relatório Power BI **COM ·
Gestão Comercial**: ~120 mil contratos em memória, 11 telas, atualização a cada 2
minutos. Cada regra aqui existe porque a alternativa foi tentada e falhou — o
"porquê" está junto, para você julgar quando a regra não se aplica.

**Stack de referência:** React 18 + Vite + Recharts + TanStack Query +
react-router-dom. CSS puro com variáveis, sem framework de utilitários.

---

## 1. A paleta

A paleta é **herdada da marca**, não escolhida. Ao replicar um relatório existente,
extraia as cores do arquivo de origem (no `.pbip`, procure `ThemeDataColor` no JSON
do relatório) em vez de recriar de memória — o time que usa o relatório reconhece as
cores, e divergir gera desconfiança no número.

Defina tudo como variáveis em `:root` e **nunca escreva hexadecimal solto num
componente**. Quando a marca mudar, você troca em um lugar.

```css
:root {
  --pbi-primary: #880F17;      /* barra de título dos visuais, navegação ativa */
  --pbi-primary-dark: #6b2328; /* bordas de tabela, hover do primário */
  --pbi-gold: #D9B300;         /* série principal (colunas), topo do gradiente */
  --pbi-gold-light: #f0e199;   /* base do gradiente das colunas */
  --pbi-gold-200: #EED790;     /* fundo de aviso */
  --pbi-gold-600: #D49F00;     /* borda de aviso, texto sobre fundo claro */
  --pbi-gold-soft: #E0C233;    /* série secundária */
  --pbi-orange: #E66C37;       /* linha sobreposta às colunas */
  --pbi-orange-soft: #EB895F;  /* terceira série */
  --pbi-green: #0E9224;        /* barras de dados positivas */
  --pbi-ink: #252423;          /* texto principal */
  --pbi-muted: #605E5C;        /* texto secundário, rótulos de eixo */
  --pbi-grid: #E1DFDD;         /* linhas de grade, bordas de controle */
  --pbi-borda: #E3E0DC;        /* bordas de card */
  --pbi-superficie: #FFFFFF;
}
```

Exponha as mesmas cores em JS para os gráficos (`export const CORES = {...}`), porque
Recharts precisa do valor, não da variável. Manter os dois lados sincronizados é o
preço de usar biblioteca de gráfico em canvas/SVG.

### Cada cor tem um trabalho

Não escolha cor por gosto; escolha pelo papel que ela cumpre.

| Papel | O que usar |
|---|---|
| **Identidade** (séries distintas) | gold → orange → ink, nessa ordem fixa |
| **Magnitude** (barra de dados, heatmap) | um só tom, claro → escuro (`goldLight` → `gold`) |
| **Polaridade** (acima/abaixo da meta) | dois tons com neutro no meio, nunca arco-íris |
| **Estado** (crítico/atenção/positivo) | vermelho `#b3261e` / `gold600` / `green` — reservados, nunca como "série 4" |

Atribua as cores categóricas **em ordem fixa**, nunca por posição no ranking. Se um
filtro muda o número de séries, as sobreviventes não podem trocar de cor — o usuário
memoriza "amarelo é venda", e repintar destrói isso.

### Limite honesto desta paleta

Medi a separação dos pares em OKLab (×100). Os extremos:

| Par | Separação |
|---|---|
| FIBRA vs RÁDIO | 58 |
| RÁDIO vs TELEFONIA | 48 |
| primário vs gold | 41 |
| verde vs gold | 25 |
| **gold vs orange** | **18** |
| **FIBRA vs TELEFONIA** | **16** |

Os dois últimos passam raspando do piso de 15 para visão normal. Isso é consequência
de a paleta ser da marca, não escolha livre — e obriga uma contrapartida: sempre que
gold e orange (ou FIBRA e TELEFONIA) aparecerem no mesmo visual, a identidade **não
pode depender só da cor**. Use legenda presente e rótulo direto. O dashboard de
referência faz isso em todo combo coluna+linha.

Nunca use texto na cor da série: valores e rótulos ficam em `--pbi-ink` ou
`--pbi-muted`, e um marcador colorido ao lado carrega a identidade.

---

## 2. Layout: a conta que faz a tela caber

Esta é a parte mais valiosa do padrão, e a que mais dá errado quando ignorada.

O problema real: **cada gráfico maior que a tela é um gráfico que o usuário nunca
vai ver inteiro**. Reclamação literal recebida: *"há gráficos maiores que a
resolução das telas"*. A solução não é chutar altura em pixel — é derivar a altura
da área que sobra.

```css
:root {
  --h-topbar: 52px;   /* topo com logo e status */
  --h-nav: 36px;      /* navegação entre telas */
  --h-filtros: 50px;  /* barra de filtros */
  --gap: 10px;
  /* o "cromo" é tudo que não é conteúdo; 34px cobre paddings e bordas */
  --chrome: calc(var(--h-topbar) + var(--h-nav) + var(--h-filtros) + 34px);
  --util: calc(100vh - var(--chrome));
}
```

Com `--util` no lugar, as alturas dos cards saem de `clamp()` sobre a fração da
área útil que aquela faixa deve ocupar:

```css
.visual.v-grafico { height: clamp(258px, calc((var(--util) - var(--gap)) * 0.455), 430px); }
.visual.v-tabela  { height: clamp(280px, calc((var(--util) - var(--gap)) * 0.545), 500px); }
.visual.v-meia    { height: clamp(255px, calc((var(--util) - var(--gap)) * 0.5),   440px); }
.visual.v-matriz  { height: clamp(360px, var(--util), 900px); }
.visual.v-auto    { height: auto; }  /* telas de configuração, que rolam mesmo */
```

Os três valores do `clamp` não são decorativos:

- **piso** — abaixo disso o visual fica ilegível, então prefira rolar a comprimir;
- **ideal** — a fração da tela; `0.455 + 0.545 = 1`, ou seja, **duas faixas ocupam
  exatamente uma tela**;
- **teto** — em monitor muito alto, card gigante desperdiça densidade.

Verifique em **1366×768, 1440×900 e 1920×1080**. Se `document.body.scrollHeight`
passar de `window.innerHeight` numa tela de duas faixas, a conta está errada.

### Distribuição horizontal

Proporções do relatório de origem, com mínimos que permitem refluxo:

```css
.grid { display: grid; gap: var(--gap); }
.linha-principal { grid-template-columns: minmax(360px, 64fr) minmax(148px, 13fr) minmax(230px, 23fr); }
.linha-33-67     { grid-template-columns: minmax(250px, 33fr) minmax(400px, 67fr); }
.linha-dupla     { grid-template-columns: minmax(340px, 52fr) minmax(320px, 48fr); }
```

O `minmax` é o que evita a coluna de KPI virar um filete em tela estreita. Calcule
os mínimos para o conjunto caber a partir de ~1100px.

### Respeite a ordem de leitura da origem

Ao replicar um relatório, a **ordem dos visuais não é detalhe de estética** — quem
usa aquele relatório há meses procura a informação pela posição. Inverter a ordem faz
a pessoa concluir que falta conteúdo, mesmo com todos os números certos.

A ordem verdadeira não está no nome dos arquivos: está nas coordenadas. No `.pbip`,
cada `visuals/<id>/visual.json` tem `position: { x, y, z, width, height }`. Ordene por
`y` e depois por `x` para obter a sequência de leitura, e use as larguras relativas
para dimensionar as colunas — se lá uma coluna é o dobro da vizinha, é porque o rótulo
dela é mais longo.

Isso pode contrariar a sua intuição de layout: no caso de referência, o relatório
começa com a tabela de detalhe de largura inteira e termina com o gráfico de evolução,
o oposto de "gráfico em cima, detalhe embaixo". Siga a origem e diga no subtítulo o que
mudou; convenção interna vem depois de fidelidade quando existe um relatório em uso.

### Quantos visuais cabem

Duas faixas de conteúdo por tela, no máximo. Uma terceira faixa **não cabe** — a
soma dos pisos passa da área útil. Se o conteúdo exigir mais, a última faixa é
deliberadamente uma amostra rolável (tabela de detalhe curta) com exportação
completa ao lado, e você diz isso no subtítulo.

---

## 3. Componentes

Monte estes primeiro; as telas viram composição.

| Componente | Função |
|---|---|
| `Visual` | card com cabeçalho colorido, subtítulo, slot de ações |
| `Kpi` / `KpiStack` | número grande com rótulo, empilhados numa coluna estreita |
| `Segmentado` | alternador no cabeçalho (mês/dia, escala) |
| `Legenda` | marcadores de série — presente sempre que houver 2+ séries |
| `Loading` / `Vazio` / `Erro` | os três estados, sem exceção |
| `Tabela` / `Matriz` | tabela com barra de dados e sparkline; matriz vendedor × dia |
| `BotaoExportar` | CSV do que está na tela, ou arquivo completo do servidor |

O `Visual` concentra a moldura, então o cabeçalho é o lugar natural para tudo que é
"desta visão": granularidade, exportação, leitura por IA. Passe como props em vez de
repetir markup em cada tela.

**Os três estados não são opcionais.** Tela de dashboard passa a vida carregando,
filtrando para vazio e tomando erro de rede. Sem os três, o usuário vê card branco e
conclui que o número é zero.

---

## 4. Gráficos

### Não confie no `ResponsiveContainer`

O `ResponsiveContainer` do Recharts depende de `ResizeObserver`. No dashboard de
referência ele simplesmente **não disparou** e os gráficos ficaram invisíveis —
sem erro no console, o que custou tempo. Troque por um medidor próprio:

```jsx
function AutoSizer({ children, minHeight = 180 }) {
  const ref = useRef(null);
  const [caixa, setCaixa] = useState({ w: 0, h: 0 });
  useLayoutEffect(() => {
    const medir = () => {
      const r = ref.current?.getBoundingClientRect();
      if (r) setCaixa({ w: Math.floor(r.width), h: Math.max(Math.floor(r.height), minHeight) });
    };
    medir();
    window.addEventListener('resize', medir);
    return () => window.removeEventListener('resize', medir);
  }, [minHeight]);
  return (
    <div ref={ref} style={{ width: '100%', height: '100%', minHeight }}>
      {caixa.w > 0 ? children(caixa) : null}
    </div>
  );
}
```

`useLayoutEffect` (não `useEffect`) porque a medição precisa acontecer antes da
pintura, senão o primeiro quadro sai com largura zero.

### Regras de marca

- **Um eixo.** Nunca dois eixos Y. Duas medidas de escala diferente viram dois
  gráficos, múltiplos pequenos, ou índice sobre base comum. É o erro nº 1 em
  dashboard e o mais difícil de desfazer depois que a diretoria se acostuma.
- Colunas finas com topo arredondado (4px) ancorado na base.
- Linha sobreposta com 2px e marcador ≥ 8px.
- 2px de folga entre segmentos empilhados e entre barras adjacentes.
- Grade recessiva: horizontal apenas, `--pbi-grid`, tracejado 4/4.
- **Rótulo seletivo.** Número em cima de cada ponto vira ruído. Acima de ~24 pontos,
  esconda os rótulos e deixe a leitura para o tooltip; acima de ~70, esconda também
  os rótulos alternados do eixo.

### Séries longas e caudas

Série diária de anos inteiros produz 100+ barras quase todas iguais a 1. Antes de
desenhar, pergunte se o agrupamento **responde a alguma pergunta**. Se não, ofereça
o agrupamento coerente com o filtro por padrão e deixe o original a um clique.

Distribuição concentrada (4 categorias = 95%) pede **dobra da cauda**: mantenha o
topo N e some o resto numa barra `Outros (N itens)`, pintada em cinza neutro
(`#C8C6C4`) para não ser lida como categoria de verdade. E diga a concentração no
subtítulo — é a leitura que o gráfico sozinho não entrega.

### Rótulo que não cabe

Categoria vinda de banco pode ter 200 caracteres. Duas providências:

1. **Normalize no servidor**, não no CSS: extraia a parte que distingue. Prefixo fixo
   e justificativa longa não só estouram o eixo — eles **fragmentam a contagem**,
   porque o mesmo motivo aparece várias vezes com redações diferentes.
2. Corte no eixo o que não couber (`tickFormatter` com orçamento ≈
   `(largura - 8) / 5.6` caracteres) e mantenha o texto inteiro no tooltip.

---

## 5. Interação

### Barra de filtros

Seis cartões de slicer ocupavam 125px de altura; a mesma coisa em uma linha de
botões que abrem popover ocupa ~50px. Numa tela em que a altura é o recurso escasso,
isso é uma faixa inteira de gráfico.

Deixe a barra `position: sticky` abaixo da navegação, e o filtro de período com
presets (este mês, mês passado, últimos 30 dias) — o usuário quase nunca quer digitar
data.

### Popover ou diálogo?

**Popover ancorado dentro de contêiner com rolagem não funciona.** `position:
absolute` é cortado pela borda do contêiner; se a lista interna também rolar, você
empilha três recortes para escolher um item. Sintoma: o painel abre "para baixo" e
o usuário não alcança o conteúdo.

Regra: se o gatilho vive dentro de tabela/área com `overflow`, ou se a lista passa de
~10 itens, use **diálogo centralizado com portal no `body`**. Nada recorta, cabe
grade de 2–3 colunas, e você ganha busca e rodapé de confirmação.

### Gravação: rascunho com Salvar

Em tela de administração usada com frequência, gravar a cada clique significa
dezenas de requisições, nenhuma confirmação visível e nenhum jeito de desistir no
meio de uma reorganização.

Acumule as alterações em rascunho local, destaque a célula pendente, e ofereça uma
barra com contagem + **Descartar** + **Salvar**. Se a gravação tiver dependência de
ordem (um recurso que ignora escrita quando outro está em certo estado), respeite a
ordem no `salvar()` e **comente por quê** — é o tipo de coisa que quebra em silêncio.

### Sem emojis

Nenhum emoji, em nenhum lugar — nem herdado do relatório de origem. Use SVG inline
num componente `Icone` com nomes em português (`alerta`, `relogio`, `cadeado`, `ok`).
Emoji renderiza diferente por sistema operacional e destrói o alinhamento vertical.

---

## 6. Tabelas

- Cabeçalho na cor primária, texto branco, maiúsculas, ~11px.
- Numérico à direita com `font-variant-numeric: tabular-nums`; texto à esquerda.
- **Barra de dados** dentro da célula em vez de gráfico separado — o Power BI faz e
  economiza um visual inteiro.
- **Fundo de célula condicional** para estado (status, faixa) e escala contínua para
  valor. Ao replicar, essas cores estão em `objects.values` do `visual.json`, com
  `Conditional.Cases` para estado e `FillRule.linearGradient2` para escala — leia de lá
  em vez de escolher, e resolva o contraste do texto a partir do fundo em vez de fixar
  branco ou preto.
- Linha de total fixa no rodapé, sempre visível.
- Ordenação clicável no cabeçalho, com indicador de direção.

### Matriz e colunas fixas

Para tabela larga (pessoas × telas, vendedor × dia):

```css
table.matriz { table-layout: fixed; }         /* previsível, e o resto divide igual */
th.col-nome, td.col-nome {
  position: sticky; left: 0; z-index: 2; background: #fff; width: 296px;
}
thead th.col-nome { z-index: 3; }             /* cabeçalho por cima do corpo fixo */
```

`table-layout: fixed` porque a distribuição automática deu 478px de 1400 para a
coluna de e-mail — 34% da tabela para um texto de 260px — e comprimiu as onze
colunas de dado em 74px. Com largura fixa nas primeiras, as demais dividem o resto
em partes iguais. O preço é cortar texto longo com reticências e manter o valor no
`title`.

---

## 7. Regras que custaram caro

Estas vieram de erros reais. Cada uma tem um sintoma que você reconhece na hora.

**Card branco quando a sessão morre.** Se a autenticação expira e você só devolve
401 para as telas, elas ficam montadas com o usuário antigo e todos os números em
branco — sem caminho de volta. Encerrar a sessão precisa ser um **evento** que limpa
o usuário do contexto e o cache de dados, e a tela de login precisa dizer o motivo.

**Não derrube sessão por otimização que falhou.** Renovação antecipada de token roda
antes do vencimento: se ela falhar, o token atual ainda serve. Quem decide que a
sessão acabou é o 401 de verdade.

**Toda chamada pelo mesmo cliente.** Um `fetch` cru esquecido em um botão manda
requisição sem cabeçalho de autorização e toma 401 em silêncio — a ação nunca
acontece e parece funcionar, porque o cache do front recarrega de todo jeito.

**Uma resposta, um formato.** Se `GET` e `PUT` do mesmo recurso devolvem campos
diferentes, o front que troca o estado pela resposta perde dados no primeiro clique.
Sintoma clássico: seletor que abre cheio e, depois de uma ação, abre vazio.

**Recorte invisível gera chamado.** Se o usuário vê uma fatia dos dados por
permissão, diga isso na tela. Sem aviso, ele conclui que o dashboard está com número
errado.

**Não finja controle que não existe.** Caixa de marcação que não muda nada (porque
aquele acesso já é implícito) engana quem clica. Mostre estado preenchido e
desabilitado, com explicação no `title`.

---

## 8. Antes de dizer que está pronto

1. Abra a tela no navegador. Build que passa não garante tela que renderiza —
   identificador não importado só estoura em tempo de execução.
2. Meça `document.body.scrollHeight` contra `window.innerHeight` em 1440×900.
3. Confirme que não há rolagem horizontal (`scrollWidth > clientWidth`).
4. Provoque os três estados: carregando, vazio, erro.
5. Confira o console limpo, sem aviso de `key` nem de prop inválida.
6. Clique **dentro** de cada aba e cada diálogo, não só na navegação — o erro se
   esconde no controle, não na rota.
7. Verifique se alguma cor foi escrita em hexadecimal fora do `:root`.

---

## Referência de origem

O dashboard que originou este padrão está em
`Sebratel/dados_ReactJS_CommercialDashboards`. Vale consultar quando precisar de
implementação concreta: `web/src/theme.css` (tokens e layout),
`web/src/components/charts.jsx` (AutoSizer, combo, barras, gradientes),
`web/src/components/ui.jsx` (Visual, KPI, estados) e o `README.md`, que registra as
divergências propositais em relação ao Power BI e o motivo de cada uma.
