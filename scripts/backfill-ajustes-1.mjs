// ============================================================================
// Ajustes pós-verificação do backfill 2026 (21/08/2026) — 3 correções:
//  1. lan-520: "BOLETO LAR" estava 19/05/1902 na planilha → 19/05/2026
//  2. c25-8 (agregado cheques 2025 de agosto): datado 31/08 → 19/08
//     (o dinheiro entrou no banco ATÉ o corte; 31/08 furava o caixa)
//  3. chq-256 (nº 700050, R$ 11.685): compensou de verdade em 20/08 (entrada
//     do banco), não no bom-para 17/08 → compensado_em = 20/08 (pós-corte,
//     igual ao banco real)
// ============================================================================
import { readFileSync } from "node:fs";
import pg from "pg";

const env = readFileSync(new URL("../.env.local", import.meta.url), "utf8");
const u = new URL(env.match(/DATABASE_URL="?([^"\n]+)"?/)[1]);
const db = new pg.Client({
  host: u.hostname, port: u.port,
  user: decodeURIComponent(u.username), password: decodeURIComponent(u.password),
  database: u.pathname.slice(1), ssl: { rejectUnauthorized: false },
});
await db.connect();

try {
  await db.query("begin");

  const r1 = await db.query(`
    update contas_a_pagar
       set pago_em = '2026-05-19', vencimento = '2026-05-19', criado_em = '2026-05-19T15:00:00Z',
           observacao = observacao || ' · data corrigida de 1902→2026 (typo da planilha, contexto maio/2026)'
     where observacao like '[backfill-2026 lan-520]%' and pago_em < '2025-01-01'`);

  const r2a = await db.query(`
    update recebimentos
       set data = '2026-08-19', criado_em = '2026-08-19T15:00:00Z'
     where observacao like '[backfill-2026 c25-8]%'`);
  const r2b = await db.query(`
    update cheques
       set bom_para = '2026-08-19', depositado_em = '2026-08-19', compensado_em = '2026-08-19', criado_em = '2026-08-19T15:00:00Z',
           observacao = observacao || ' · datado 19/08: dinheiro entrou no banco antes do corte'
     where observacao like '[backfill-2026 c25-8]%'`);

  const r3 = await db.query(`
    update cheques
       set depositado_em = '2026-08-20', compensado_em = '2026-08-20',
           observacao = observacao || ' · compensou em 20/08 (entrada real do banco), pós-corte'
     where observacao like '[backfill-2026 chq-256]%' and valor = 11685`);

  if (r1.rowCount !== 1 || r2a.rowCount !== 1 || r2b.rowCount !== 1 || r3.rowCount !== 1)
    throw new Error(`contagem inesperada: lan-520=${r1.rowCount}, c25-8 rec=${r2a.rowCount}, c25-8 chq=${r2b.rowCount}, chq-256=${r3.rowCount} (esperava 1 de cada)`);

  await db.query("commit");
  console.log("✅ 3 ajustes aplicados (1 conta redatada, agregado de agosto → 19/08, cheque 700050 compensado em 20/08).");
} catch (e) {
  await db.query("rollback").catch(() => {});
  console.error("❌ ERRO — nada alterado:\n", e.message);
  process.exitCode = 1;
} finally {
  await db.end();
}
