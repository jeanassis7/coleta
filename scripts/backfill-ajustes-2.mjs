// ============================================================================
// Ajustes finais do backfill (decisões do Evaner, 21/08/2026 à noite):
//  1. Os 15 adiantamentos do backfill viram ACEITOS (aceito_em = data de
//     envio). É regularização: a prova real é a devolução física no acerto
//     da transição. Adiantamento lançado daqui pra frente = aceite normal.
//  2. Estoque zerado (fino 0, grosso 0) via ajuste de ABERTURA datado hoje.
//     Mata o número sem sentido do histórico; a contagem real entra depois
//     pelo inventário na tela de estoque.
// ============================================================================
import { readFileSync, writeFileSync } from "node:fs";
import pg from "pg";

const RAIZ = new URL("..", import.meta.url);
const MANIFESTO_PATH = new URL("dados-historicos/backfill-manifesto.json", RAIZ);
const manifesto = JSON.parse(readFileSync(MANIFESTO_PATH, "utf8"));

const env = readFileSync(new URL(".env.local", RAIZ), "utf8");
const u = new URL(env.match(/DATABASE_URL="?([^"\n]+)"?/)[1]);
const db = new pg.Client({
  host: u.hostname, port: u.port,
  user: decodeURIComponent(u.username), password: decodeURIComponent(u.password),
  database: u.pathname.slice(1), ssl: { rejectUnauthorized: false },
});
await db.connect();

try {
  await db.query("begin");

  // 1. aceite em lote dos adiantamentos do backfill
  const ac = await db.query(`
    update adiantamentos
       set status = 'aceito', aceito_em = data_envio,
           observacao = observacao || ' · aceito em lote (regularização do backfill — decisão do Evaner 21/08; a prova é a devolução física no acerto da transição)'
     where observacao like '[backfill-2026%' and status = 'pendente'
     returning id`);
  if (ac.rowCount !== 15) throw new Error(`esperava aceitar 15 adiantamentos, achei ${ac.rowCount}`);

  // 2. zeragem do estoque (abertura 0/0)
  const atual = await db.query("select tipo_oleo, saldo_kg from estoque_atual()");
  const saldos = Object.fromEntries(atual.rows.map((r) => [r.tipo_oleo, Number(r.saldo_kg)]));
  const evaner = (await db.query(`select id from profiles where nome = 'Evaner'`)).rows[0].id;
  for (const tipo of ["fino", "grosso"]) {
    const r = await db.query(`
      insert into ajustes_estoque (tipo_oleo, motivo_tipo, saldo_antes_kg, saldo_novo_kg, custo_medio_kg, motivo, data, registrado_por)
      values ($1, 'abertura', $2, 0, 0, '[backfill-2026] Zeragem pós-backfill (decisão do Evaner 21/08). O histórico de descargas/vendas fica só como história; a contagem real entra depois pelo inventário.', '2026-08-21', $3)
      returning id`, [tipo, saldos[tipo] ?? 0, evaner]);
    (manifesto.tabelas.ajustes_estoque ??= []).push(r.rows[0].id);
  }

  const conf = await db.query("select tipo_oleo, saldo_kg::numeric(12,1) s, custo_medio_kg::numeric(12,4) c from estoque_atual()");
  for (const r of conf.rows) if (Number(r.s) !== 0) throw new Error(`estoque ${r.tipo_oleo} não zerou: ${r.s}`);

  await db.query("commit");
  writeFileSync(MANIFESTO_PATH, JSON.stringify(manifesto, null, 1), "utf8");
  console.log(`✅ ${ac.rowCount} adiantamentos aceitos em lote · estoque zerado (fino 0 / grosso 0) · manifesto atualizado.`);
} catch (e) {
  await db.query("rollback").catch(() => {});
  console.error("❌ ERRO — nada alterado:\n", e.message);
  process.exitCode = 1;
} finally {
  await db.end();
}
