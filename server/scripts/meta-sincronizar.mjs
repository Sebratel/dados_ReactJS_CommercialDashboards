/**
 * Sincroniza o Meta Ads de um período pela linha de comando — para trazer
 * histórico ou reprocessar dias, sem precisar do login de admin na tela.
 *
 *   npm run meta:sincronizar -- --de=2026-01-01 --ate=2026-10-18
 *   npm run meta:sincronizar                     # últimos META_DIAS dias, sem hoje
 *
 * Usa o mesmo `.env` do dashboard (META_ACCESS_TOKEN, META_AD_ACCOUNT_ID e
 * DB_MARIA_*), e grava na MESMA tabela que a carga automática:
 * DB_Marketing.marketing_meta_ads. Reenviar um período regrava, não duplica.
 */
import { sincronizarMeta, metaConfigurado } from '../src/metaAds.js';
import * as maria from '../src/db/maria.js';

const arg = (nome) => process.argv.find((a) => a.startsWith(`--${nome}=`))?.split('=')[1] || null;
const de = arg('de');
const ate = arg('ate');
const data = /^\d{4}-\d{2}-\d{2}$/;

if ((de && !data.test(de)) || (ate && !data.test(ate))) {
  console.error('Use --de=AAAA-MM-DD e --ate=AAAA-MM-DD.');
  process.exit(1);
}
if (!metaConfigurado()) {
  console.error('META_ACCESS_TOKEN e META_AD_ACCOUNT_ID precisam estar no .env do dashboard.');
  process.exit(1);
}

try {
  const r = await sincronizarMeta({ de, ate });
  console.log(`Meta Ads ${r.de} a ${r.ate}: ${r.linhas} linhas (${r.novas} novas, ${r.existentes} regravadas) em ${r.ms} ms`);
  for (const [conta, c] of Object.entries(r.porConta)) console.log(`  ${conta}: ${c.linhas} linhas, R$ ${c.gasto}`);
} catch (err) {
  console.error(`Falhou: ${err.message}`);
  process.exitCode = 1;
} finally {
  await maria.pool.end();
}
