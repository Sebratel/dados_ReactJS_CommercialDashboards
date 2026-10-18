/**
 * Importação do RASTREAMENTO DE POSTS do Matrix para o MariaDB.
 *
 * O relatório só sai pela tela do Matrix (não há endpoint), então quem tem papel
 * de admin exporta o CSV e sobe pela tela de Campanhas. Este módulo grava em
 * `DB_Marketing.marketing_matrix_rastreamento` e recarrega o modelo.
 *
 * Quando a Matrix liberar o relatório por API, só a ORIGEM muda: a carga
 * automática grava nas mesmas tabelas, e nada da tela precisa mexer.
 */
import * as maria from './db/maria.js';
import { contagemDoUpsert, lerRastreamento } from './model/rastreamento.js';
import {
  RASTREAMENTO_DDL, RASTREAMENTO_LOTES_DDL, RASTREAMENTO_UPSERT_SQL,
} from './sql/marketing.js';

let tabelasProntas = null;

/**
 * Cria as duas tabelas se ainda não existirem. Idempotente e feito uma vez por
 * processo: a primeira carga da tela roda isto antes de ler, então uma instalação
 * nova abre a tela vazia em vez de quebrar com "tabela não existe".
 */
export function garantirTabelas() {
  if (!tabelasProntas) {
    tabelasProntas = (async () => {
      await maria.query(RASTREAMENTO_DDL);
      await maria.query(RASTREAMENTO_LOTES_DDL);
    })().catch((err) => {
      tabelasProntas = null; // tenta de novo na próxima chamada
      throw err;
    });
  }
  return tabelasProntas;
}

/** Lote de gravação: 500 linhas por INSERT mantém o pacote longe do max_allowed_packet. */
const LOTE = 500;

/**
 * Grava o arquivo.
 *
 * Tudo numa transação: se uma parte falhar, nenhuma linha fica pela metade e o
 * registro do lote não é criado. Reimportar um período é seguro: o `cod` do
 * relatório é a chave, então a linha que já existia é regravada, não duplicada
 * (ver `contagemDoUpsert` para o que dá e o que não dá para contar).
 */
export async function importarRastreamento(bytes, { arquivo = null, usuario = null } = {}) {
  const lido = lerRastreamento(bytes);
  if (!lido.linhas.length) {
    throw new Error(lido.recusadas.length
      ? `Nenhuma linha válida: ${lido.recusadas.length} recusada(s), ex.: linha ${lido.recusadas[0].linha} (${lido.recusadas[0].motivo}).`
      : 'O arquivo não tem nenhuma linha de dados.');
  }
  await garantirTabelas();

  const agora = new Date().toISOString().slice(0, 19).replace('T', ' ');
  const conn = await maria.pool.getConnection();
  try {
    await conn.beginTransaction();
    const [lote] = await conn.query(
      `INSERT INTO DB_Marketing.marketing_matrix_rastreamento_lotes
         (arquivo, linhas, novas, existentes, recusadas, periodo_de, periodo_ate, importado_por, importado_em)
       VALUES (?, ?, 0, 0, ?, ?, ?, ?, ?)`,
      [arquivo, lido.linhas.length, lido.recusadas.length, lido.de, lido.ate, usuario, agora],
    );
    const loteId = lote.insertId;

    let novas = 0;
    let existentes = 0;
    for (let i = 0; i < lido.linhas.length; i += LOTE) {
      const valores = lido.linhas.slice(i, i + LOTE).map((l) => [
        l.cod, l.titulo, l.tipo, l.conta, l.canal, l.contato, l.telefone, l.classificacao,
        l.dataAcesso, l.protocolo, l.mensagem, loteId, agora,
      ]);
      const [res] = await conn.query(RASTREAMENTO_UPSERT_SQL, [valores]);
      const r = contagemDoUpsert(res, valores.length);
      novas += r.novas;
      existentes += r.existentes;
    }

    await conn.query(
      'UPDATE DB_Marketing.marketing_matrix_rastreamento_lotes SET novas = ?, existentes = ? WHERE id = ?',
      [novas, existentes, loteId],
    );
    await conn.commit();
    return {
      lote: loteId,
      linhas: lido.linhas.length,
      novas,
      existentes,
      recusadas: lido.recusadas.length,
      exemplosRecusadas: lido.recusadas.slice(0, 5),
      de: lido.de,
      ate: lido.ate,
    };
  } catch (err) {
    await conn.rollback().catch(() => {});
    throw err;
  } finally {
    conn.release();
  }
}
