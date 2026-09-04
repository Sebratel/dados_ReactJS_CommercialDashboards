/**
 * A ressalva da anulação por devolução no mesmo dia.
 *
 * `aloc.sql` roda no Voalle, então não há como executá-lo aqui sem o banco. O que
 * estes testes travam é a ESTRUTURA da regra: se alguém remover a CTE ou soltar a
 * condição que a liga ao CASE, os 12 falsos negativos de 2026 voltam calados.
 *
 * A verificação contra dados reais está registrada no README (seção "Ativações:
 * quando o equipamento volta no mesmo dia"): agosto/2026 sai de 2.674 para 2.677,
 * julho de 2.529 para 2.532, junho fica em 2.593 — porque lá nada ficou com o
 * cliente e a anulação estava certa.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const SQL = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'sql', 'aloc.sql'), 'utf8');

test('a CTE que procura equipamento na casa do cliente continua lá', () => {
  assert.match(SQL, /WITH\s+ficou_equipamento\s+AS/i);
  // o que a define: saiu e não voltou
  assert.match(SQL, /plis\.returned_date\s+IS\s+NULL/i);
});

test('a CTE olha QUALQUER tipo de atendimento, não só os de instalação', () => {
  // o trecho da CTE vai do WITH até o SELECT principal
  const cte = SQL.slice(SQL.search(/WITH\s+ficou_equipamento/i), SQL.search(/\)\s*SELECT\s+contrato/i));
  assert.doesNotMatch(cte, /incident_type|it\.id/i,
    'filtrar a CTE por tipo de atendimento reintroduz o falso negativo: o equipamento '
    + 'que fica costuma sair por "TEC - Suporte de Retorno Prioritário", fora da lista');
});

test('a anulação só vale quando NADA ficou com o cliente', () => {
  // dentro do CASE que anula, a condição de guarda tem de estar presente
  const caseAnula = SQL.slice(SQL.search(/WHEN\s+plis\.returned_date\s+IS\s+NOT\s+NULL/i),
                              SQL.search(/THEN\s+NULL/i));
  assert.match(caseAnula, /fe\.contrato\s+IS\s+NULL/i,
    'sem esta guarda o contrato inteiro some da tela mesmo com aparelho instalado');
});

test('a CTE está ligada à consulta por LEFT JOIN no número do contrato', () => {
  assert.match(SQL, /LEFT\s+JOIN\s+ficou_equipamento\s+fe\s+ON\s+fe\.contrato\s*=\s*c\.contract_number/i);
});

test('o recorte da janela de dados vale também para a CTE', () => {
  // as duas metades precisam enxergar o mesmo período, senão a guarda fica cega
  assert.equal((SQL.match(/plis\.out_date\s*>\s*\$1/g) || []).length, 2);
});
