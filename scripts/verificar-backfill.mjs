// Prova real do backfill: números do sistema × resumo da planilha (só leitura)
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

async function tab(titulo, sql) {
  const r = await db.query(sql);
  console.log(`\n=== ${titulo} ===`);
  for (const row of r.rows) console.log("  " + Object.values(row).map((v) => (v == null ? "—" : String(v))).join("  |  "));
}

// RECEITA por mês, nas 3 aberturas do DRE (regime de caixa)
await tab("RECEITA por mês (à vista+pix / cheques compensados / repassados)", `
  with avista as (
    select date_trunc('month', data)::date m, sum(valor) v from recebimentos
    where forma in ('pix','dinheiro','transferencia') group by 1),
  comp as (
    select date_trunc('month', compensado_em)::date m, sum(valor) v from cheques
    where status = 'compensado' group by 1),
  rep as (
    select date_trunc('month', repassado_em)::date m, sum(valor) v from cheques
    where status = 'repassado' group by 1)
  select to_char(coalesce(a.m, c.m, r.m), 'YYYY-MM') mes,
         coalesce(a.v,0)::numeric(12,2) avista, coalesce(c.v,0)::numeric(12,2) compensados,
         coalesce(r.v,0)::numeric(12,2) repassados,
         (coalesce(a.v,0)+coalesce(c.v,0)+coalesce(r.v,0))::numeric(12,2) total
  from avista a full join comp c on c.m = a.m full join rep r on r.m = coalesce(a.m, c.m)
  order by 1`);

// DESPESA por mês (contas pagas)
await tab("CONTAS PAGAS por mês", `
  select to_char(date_trunc('month', pago_em), 'YYYY-MM') mes, count(*) n, sum(valor)::numeric(12,2) total
  from contas_a_pagar where status = 'paga' group by 1 order by 1`);

// Por grupo do DRE (ano inteiro)
await tab("CONTAS PAGAS por categoria (2026 até agosto)", `
  select categoria, count(*) n, sum(valor)::numeric(12,2) total
  from contas_a_pagar where status = 'paga' and pago_em >= '2026-01-01'
  group by 1 order by total desc`);

// A conta de 1902 — data doente vinda da planilha
await tab("CONTA COM DATA DOENTE (1902)", `
  select pago_em, valor, categoria, descricao, observacao from contas_a_pagar where pago_em < '2025-01-01'`);

// Saldo por comprador (função oficial do sistema)
await tab("saldo_compradores() — deve bater com o fim das abas das fundições", `
  select * from saldo_compradores()`);

// Caixa (função oficial)
await tab("saldo_contas() — o caixa depois do backfill", `
  select * from saldo_contas()`);

// Adiantamentos pendentes de aceite
await tab("Adiantamentos pendentes (motorista aceita no app)", `
  select p.nome, a.valor::numeric(12,2), a.data_envio::date, a.status
  from adiantamentos a join profiles p on p.id = a.motorista_id
  order by p.nome, a.data_envio`);

// Estoque: garantir que as vendas/descargas históricas não quebram a função
await tab("estoque_atual() — antes da abertura oficial do inventário", `
  select tipo_oleo, saldo_kg::numeric(12,1), custo_medio_kg::numeric(12,4) from estoque_atual()`);

await db.end();
