// ============================================================================
// DESFAZ o backfill 2026 inteiro, pelo manifesto gravado no import.
// USO: node scripts/backfill-desfazer.mjs --sim-eu-confirmo
// Apaga em ordem reversa de dependência, numa transação única.
// ============================================================================
import { readFileSync, existsSync, renameSync } from "node:fs";
import pg from "pg";

if (!process.argv.includes("--sim-eu-confirmo")) {
  console.error("Isto APAGA todos os registros do backfill 2026 em produção.");
  console.error("Pra confirmar: node scripts/backfill-desfazer.mjs --sim-eu-confirmo");
  process.exit(1);
}

const RAIZ = new URL("..", import.meta.url);
const MANIFESTO_PATH = new URL("dados-historicos/backfill-manifesto.json", RAIZ);
if (!existsSync(MANIFESTO_PATH)) {
  console.error("Não existe dados-historicos/backfill-manifesto.json — nada a desfazer.");
  process.exit(1);
}
const manifesto = JSON.parse(readFileSync(MANIFESTO_PATH, "utf8"));

const env = readFileSync(new URL(".env.local", RAIZ), "utf8");
const u = new URL(env.match(/DATABASE_URL="?([^"\n]+)"?/)[1]);
const db = new pg.Client({
  host: u.hostname, port: u.port,
  user: decodeURIComponent(u.username), password: decodeURIComponent(u.password),
  database: u.pathname.slice(1), ssl: { rejectUnauthorized: false },
});
await db.connect();

// ordem reversa de dependência (conta paga com cheque → cheque → recebimento...)
const ORDEM = ["ajustes_estoque", "contas_a_pagar", "adiantamentos", "cheques", "recebimentos", "descargas", "cargas", "vendas", "caminhoes", "compradores"];

try {
  await db.query("begin");
  for (const tabela of ORDEM) {
    const ids = manifesto.tabelas[tabela] ?? [];
    if (!ids.length) continue;
    const r = await db.query(`delete from ${tabela} where id = any($1::uuid[])`, [ids]);
    console.log(`${tabela}: apagados ${r.rowCount} de ${ids.length}`);
    if (r.rowCount !== ids.length) console.log(`   ⚠️ ${ids.length - r.rowCount} já não existiam (ok se apagados na mão)`);
  }
  await db.query(`update compradores set nome = 'PARANA ALUMÍNIO' where nome = 'PR ALUMÍNIO / LAZZARIN'`);
  await db.query("commit");
  renameSync(MANIFESTO_PATH, new URL("dados-historicos/backfill-manifesto.desfeito.json", RAIZ));
  console.log("✅ Backfill desfeito por completo. Manifesto arquivado como backfill-manifesto.desfeito.json");
} catch (e) {
  await db.query("rollback").catch(() => {});
  console.error("❌ ERRO — nada foi apagado:\n", e.message);
  process.exitCode = 1;
} finally {
  await db.end();
}
