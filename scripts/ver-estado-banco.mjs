// Leitura rápida do estado do banco pro mapeamento do backfill (só SELECT)
import { readFileSync } from "node:fs";
import pg from "pg";

const env = readFileSync(new URL("../.env.local", import.meta.url), "utf8");
const url = env.match(/DATABASE_URL="?([^"\n]+)"?/)[1];
const u = new URL(url);
const client = new pg.Client({
  host: u.hostname,
  port: u.port,
  user: decodeURIComponent(u.username),
  password: decodeURIComponent(u.password),
  database: u.pathname.slice(1),
  ssl: { rejectUnauthorized: false },
});
await client.connect();

async function q(titulo, sql) {
  const r = await client.query(sql);
  console.log(`\n--- ${titulo} (${r.rowCount}) ---`);
  for (const row of r.rows) console.log("  " + JSON.stringify(row));
}

await q("colunas contas_financeiras", "select column_name, data_type from information_schema.columns where table_name='contas_financeiras' order by ordinal_position");
await q("contas_financeiras", "select * from contas_financeiras order by nome");
await q("compradores", "select id, nome, ativo from compradores order by nome");
await q("profiles", "select id, nome, role, ativo from profiles order by nome");
await q("caminhoes", "select id, placa, tipo, tara_kg, ativo from caminhoes order by placa");
await q("contagens", `select
  (select count(*) from coletas) as coletas,
  (select count(*) from cargas) as cargas,
  (select count(*) from descargas) as descargas,
  (select count(*) from vendas) as vendas,
  (select count(*) from recebimentos) as recebimentos,
  (select count(*) from cheques) as cheques,
  (select count(*) from contas_a_pagar) as contas_a_pagar,
  (select count(*) from adiantamentos) as adiantamentos,
  (select count(*) from acertos) as acertos,
  (select count(*) from compras_diretas) as compras_diretas,
  (select count(*) from transferencias) as transferencias,
  (select count(*) from ajustes_estoque) as ajustes_estoque,
  (select count(*) from vigencias_remuneracao) as vigencias`);
await q("adiantamentos (todos)", "select motorista_id, valor, status, data_envio::date, criado_em::date from adiantamentos order by criado_em");
await q("ajustes_estoque", "select tipo_oleo, motivo_tipo, saldo_novo_kg, custo_medio_kg, data from ajustes_estoque order by data");
await q("colunas vigencias", "select column_name from information_schema.columns where table_name='vigencias_remuneracao' order by ordinal_position");
await q("vigencias", "select * from vigencias_remuneracao order by criado_em");

await client.end();
