// ============================================================================
// Fechamento do regime antigo (decisão do Evaner, 21/08/2026 à noite):
// um ACERTO administrativo por motorista zera o saldo do app AGORA.
// O resíduo de cada um fica documentado na observação — zerado, não escondido.
// A partir daqui: adiantamento manual + aceite real = ledger verdadeiro.
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
  const evaner = (await db.query(`select id from profiles where nome = 'Evaner'`)).rows[0].id;
  const saldos = await db.query(`
    select s.motorista_id, s.saldo, p.nome
    from saldos_motoristas() s join profiles p on p.id = s.motorista_id
    where p.nome in ('Lucimar', 'Lucinei', 'Luiz')`);

  for (const m of saldos.rows) {
    const r = await db.query(`
      insert into acertos (motorista_id, corte_em, valor_devolvido, valor_vale, valor_saldo, observacao, registrado_por)
      values ($1, now(), 0, 0, 0, $2, $3) returning id`,
      [m.motorista_id,
       `[backfill-2026] Fechamento do regime antigo (planilhas). Saldo do app no fechamento: R$ ${Number(m.saldo).toFixed(2)} — resíduo conhecido da virada, zerado por decisão do Evaner (21/08). O ledger real começa no próximo adiantamento manual + aceite do motorista.`,
       evaner]);
    (manifesto.tabelas.acertos ??= []).push(r.rows[0].id);
    console.log(`acerto ${m.nome}: saldo era R$ ${Number(m.saldo).toFixed(2)} → 0,00`);
  }

  const conf = await db.query(`
    select p.nome, s.saldo from saldos_motoristas() s join profiles p on p.id = s.motorista_id
    where p.nome in ('Lucimar', 'Lucinei', 'Luiz')`);
  for (const m of conf.rows) if (Number(m.saldo) !== 0) throw new Error(`${m.nome} não zerou: ${m.saldo}`);

  await db.query("commit");
  writeFileSync(MANIFESTO_PATH, JSON.stringify(manifesto, null, 1), "utf8");
  console.log("✅ 3 acertos de fechamento gravados — saldos 0,00 conferidos. Manifesto atualizado.");
} catch (e) {
  await db.query("rollback").catch(() => {});
  console.error("❌ ERRO — nada alterado:\n", e.message);
  process.exitCode = 1;
} finally {
  await db.end();
}
