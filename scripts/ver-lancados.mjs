// Detalhe do que JÁ está lançado no sistema (pra evitar duplicar no backfill)
import { readFileSync } from "node:fs";
import pg from "pg";

const env = readFileSync(new URL("../.env.local", import.meta.url), "utf8");
const url = env.match(/DATABASE_URL="?([^"\n]+)"?/)[1];
const u = new URL(url);
const client = new pg.Client({
  host: u.hostname, port: u.port,
  user: decodeURIComponent(u.username), password: decodeURIComponent(u.password),
  database: u.pathname.slice(1), ssl: { rejectUnauthorized: false },
});
await client.connect();

async function q(titulo, sql) {
  const r = await client.query(sql);
  console.log(`\n--- ${titulo} (${r.rowCount}) ---`);
  for (const row of r.rows) console.log("  " + JSON.stringify(row));
}

await q("cheques já no sistema", `
  select ch.numero, ch.banco, ch.valor, ch.bom_para, ch.status, co.nome as comprador
  from cheques ch
  left join recebimentos re on re.id = ch.recebimento_id
  left join vendas ve on ve.id = re.venda_id
  left join compradores co on co.id = coalesce(ve.comprador_id, re.comprador_id)
  order by ch.bom_para`);
await q("recebimentos já no sistema", `
  select re.valor, re.forma, re.data::date as data, co.nome as comprador
  from recebimentos re
  left join compradores co on co.id = re.comprador_id
  order by re.data`);
await q("contas_a_pagar já no sistema", `
  select descricao, categoria, valor, vencimento, status, pago_em::date as pago_em
  from contas_a_pagar order by criado_em`);
await q("coletas: faixa por motorista", `
  select p.nome, count(*) as n, min(c.criado_em)::date as primeira, max(c.criado_em)::date as ultima,
         sum(c.litros) as litros, sum(c.valor_pago) as pago
  from coletas c join profiles p on p.id = c.motorista_id
  group by p.nome order by p.nome`);

await client.end();
