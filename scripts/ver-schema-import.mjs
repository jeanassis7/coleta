// Colunas + CHECKs das tabelas que o backfill vai tocar (só leitura)
import { readFileSync } from "node:fs";
import pg from "pg";

const env = readFileSync(new URL("../.env.local", import.meta.url), "utf8");
const u = new URL(env.match(/DATABASE_URL="?([^"\n]+)"?/)[1]);
const client = new pg.Client({
  host: u.hostname, port: u.port,
  user: decodeURIComponent(u.username), password: decodeURIComponent(u.password),
  database: u.pathname.slice(1), ssl: { rejectUnauthorized: false },
});
await client.connect();

const TABELAS = ["contas_a_pagar", "recebimentos", "cheques", "vendas", "adiantamentos", "acertos", "cargas", "descargas", "caminhoes", "compradores"];
for (const t of TABELAS) {
  const cols = await client.query(
    `select column_name, data_type, is_nullable, column_default is not null as tem_default,
            is_generated
     from information_schema.columns where table_schema='public' and table_name=$1 order by ordinal_position`, [t]);
  console.log(`\n=== ${t} ===`);
  for (const c of cols.rows)
    console.log(`  ${c.column_name.padEnd(24)} ${c.data_type.padEnd(26)} ${c.is_nullable === "NO" ? "NOT NULL" : "null ok "} ${c.tem_default ? "default" : ""} ${c.is_generated === "ALWAYS" ? "GENERATED" : ""}`);
  const checks = await client.query(
    `select conname, pg_get_constraintdef(oid) as def from pg_constraint
     where conrelid = ('public.'||$1)::regclass and contype in ('c','u') order by conname`, [t]);
  for (const k of checks.rows) console.log(`  [${k.conname}] ${k.def}`);
}
await client.end();
