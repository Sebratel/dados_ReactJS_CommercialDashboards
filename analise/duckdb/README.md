# Consultas DuckDB — análise fora do dashboard

Duas consultas que leem **direto do Voalle e do MariaDB**, sem passar pela API nem
pelo cache em memória do servidor. Servem para conferir número, cruzar com planilha
ou alimentar uma análise própria.

| Arquivo | Grão | Responde |
|---|---|---|
| `01_vendas_e_premiacoes.sql` | um contrato vendido | quem vendeu, quando o contrato foi criado, e a premiação do vendedor no período |
| `02_ativacoes_por_vendedor.sql` | um contrato ativado | quem vendeu, quando ativou, e quanto tempo levou entre uma coisa e outra |

## Como rodar

```bash
duckdb                     # ou: python -c "import duckdb"
```

1. Abra o `.sql` e preencha o `ATTACH` com as credenciais de `dashboard/.env`.
   **Não** faça commit do arquivo preenchido — os `<PLACEHOLDERS>` existem por isso.
2. Ajuste o bloco `params` no topo: `de`, `ate` e `since`.
   * `de` / `ate` — o período que você quer analisar. O `ate` é também a **data de
     referência da premiação**, que decide se o vendedor ainda é novato.
   * `since` — o recorte de carga, equivalente à *Janela de dados* da tela de
     Configurações. Quanto mais recente, mais rápida a consulta.
3. Rode o arquivo inteiro.

Já tem os dados em Parquet ou CSV? Apague os blocos `INSTALL` / `LOAD` / `ATTACH` e
troque `voalle.erp.<tabela>` e `maria.<schema>.<tabela>` pelos seus arquivos.

## O que conferir antes de confiar no número

**O período é sobre a data certa.** A consulta 1 filtra por `data_criacao_contrato`
(quando a venda aconteceu); a 2, por `data_ativacao` (quando o cliente foi instalado).
São recortes diferentes, e o mesmo contrato costuma cair em meses diferentes nas duas.

**A premiação repete.** Na consulta 1 ela é atributo do vendedor no período, então
aparece igual em cada linha de venda da mesma pessoa. Para ler só a premiação, use o
`SELECT DISTINCT` que está comentado no cabeçalho do arquivo.

**Nem todo vendedor entra na premiação.** Só quem está em `Comercial_Teams` com
`ATIVO = 1` **e** tem admissão no RH (Senior). A coluna `via_juncao` mostra por qual
caminho o cadastro do Voalle casou com o do RH — e-mail, nome, ou nome sem acento.

> **Diferença conhecida.** O `store.js` tem um quarto passo de casamento, difuso
> (75% dos tokens do nome, tolerando uma letra de diferença), que não cabe em SQL.
> Um punhado de vendedores com grafia bem diferente entre as duas bases pode não
> casar aqui e sair sem premiação, mesmo aparecendo na tela. Se um nome esperado
> sumir, é o primeiro lugar para olhar.

**A telefonia tem regra própria.** Preencha `tecnologia_premiacao` com `'TELEFONIA'`
na CTE `params` para aplicar o pagamento por aparelho (4,5 interno / 7,5 externo, e
o primeiro não paga). Deixe `NULL` para a tabela de faixas normal. É o equivalente a
selecionar uma única tecnologia no filtro da tela.

## Média por dia útil

A consulta 2 traz `peso_dia_util` pronto — domingo e feriado 0, sábado 0,5, os demais
1 — para reproduzir a medida como o dashboard passou a calcular em 02/09/2026. Agrupe
**por dia antes de somar o peso**, senão você soma o peso uma vez por linha:

```sql
WITH por_dia AS (
    SELECT vendedor, data_ativacao,
           count(*)                 AS qtd,
           any_value(peso_dia_util) AS peso
    FROM (/* …consulta 2… */)
    GROUP BY vendedor, data_ativacao
)
SELECT vendedor,
       sum(qtd)                          AS ativacoes,
       sum(peso)                         AS dias_uteis,
       sum(qtd) / nullif(sum(peso), 0)   AS media_por_dia_util
FROM por_dia
GROUP BY vendedor
ORDER BY ativacoes DESC;
```

O README principal, em *A média por dia útil*, explica por que o de cima da divisão
não é ponderado e onde isso diverge do Power BI.

## Validação

As duas consultas foram executadas no DuckDB 1.5.5 contra schemas simulados com os
mesmos nomes de catálogo, schema, tabela e coluna do Voalle e do MariaDB — elas
compilam e devolvem resultado.

A lógica de premiação foi comparada caso a caso com a do dashboard
(`faixaPremiacao` e `bonusTempoDeCasa`, em `server/src/model/measures.js`): **344
combinações** de quantidade × Interno/Externo × tempo de casa, cobrindo todas as
bordas de faixa e os três degraus do bônus. Zero divergência.
