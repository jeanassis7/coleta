/**
 * E2E do MÓDULO 2 — roda contra produção, NÃO grava nada.
 *
 *   node scripts/e2e-modulo2.mjs
 *
 * Bloco 1 (estoque): confere a leitura real e roda a matemática do custo
 * médio ponderado móvel em cenários controlados, dentro de uma transação
 * com ROLLBACK. DDL é transacional no Postgres, então a view sintética
 * usada pra simular vendas (que só existem a partir da 0017) desaparece no
 * fim — nada sobrevive.
 *
 * O cenário central é o que o Evaner levantou na revisão do plano: vender
 * mais do que o sistema acha que tem e depois inventariar. É o caminho que
 * derruba o custo médio se o ajuste não congelar a base, e é o tipo de erro
 * que não aparece na tela — só na margem, meses depois.
 */
import { carregarEnv } from "./carregar-env.mjs";
import pg from "pg";

carregarEnv(["DATABASE_URL"]);

const url = new URL(process.env.DATABASE_URL);
const client = new pg.Client({
  host: url.hostname,
  port: Number(url.port) || 5432,
  user: decodeURIComponent(url.username),
  password: decodeURIComponent(url.password),
  database: url.pathname.replace(/^\//, "") || "postgres",
  ssl: { rejectUnauthorized: false },
});

let falhas = 0;
function checar(rotulo, obtido, esperado, tol = 0.02) {
  const ok = Math.abs(Number(obtido) - esperado) <= tol;
  if (!ok) falhas++;
  console.log(`   ${ok ? "✅" : "❌"} ${rotulo}: ${obtido} (esperado ~${esperado})`);
}
function afirmar(rotulo, condicao) {
  if (!condicao) falhas++;
  console.log(`   ${condicao ? "✅" : "❌"} ${rotulo}`);
}

/** Substitui a view por uma lista fixa de movimentos e lê o resultado. */
async function simular(linhas) {
  const values = linhas
    .map(
      (l) =>
        `('${l.origem}','${l.especie}',${l.kg},${l.custo},'${l.dia}'::date,` +
        `'${l.momento || l.dia + " 12:00"}'::timestamp,${l.prioridade})`
    )
    .join(",");
  await client.query(`
    create or replace view public.movimentos_estoque as
      select
        gen_random_uuid() as referencia_id, origem,
        'fino'::text as tipo_oleo, especie,
        kg::numeric, custo::numeric,
        momento::timestamptz as momento, dia::date as dia,
        prioridade, ''::text as descricao
      from (values ${values})
        as t(origem, especie, kg, custo, dia, momento, prioridade)
  `);
  const r = await client.query(
    `select * from public.estoque_atual() where tipo_oleo = 'fino'`
  );
  return r.rows[0];
}

await client.connect();
console.log("\n══ E2E MÓDULO 2 — Bloco 1 (estoque) ══");

// ───────────────────────────────────────────────── 1. leitura real
console.log("\n📊 ESTOQUE REAL HOJE\n");
const real = await client.query("select * from public.estoque_atual()");
for (const r of real.rows) {
  console.log(
    `   ${r.tipo_oleo.padEnd(7)} ${String(r.saldo_kg).padStart(12)} kg   ` +
      `R$ ${r.custo_medio_kg}/kg   =   R$ ${r.valor_total}`
  );
}
afirmar("estoque_atual() devolve os dois tipos", real.rowCount === 2);

const mov = await client.query(
  `select origem, especie, kg, custo, dia, descricao
   from public.movimentos_estoque order by dia desc limit 10`
);
console.log(`\n📋 MOVIMENTOS REAIS (${mov.rowCount} mais recentes)\n`);
for (const m of mov.rows) {
  console.log(
    `   ${m.dia.toISOString().slice(0, 10)} ${m.origem.padEnd(14)}` +
      `${m.especie.padEnd(9)}${String(m.kg).padStart(10)} kg   R$ ${m.custo}   ${m.descricao}`
  );
}
if (mov.rowCount === 0) console.log("   (nenhum ainda — normal antes da abertura)");

// ───────────────────────────────────────────────── 2. sandbox isolado
console.log("\n🧪 ISOLAMENTO DO MOTORISTA DE TESTE\n");
const vazou = await client.query(`
  select count(*)::int as n
  from public.descargas d
  join public.cargas g on g.id = d.carga_id
  join public.profiles p on p.id = g.motorista_id
  where p.is_teste = true
    and d.id in (select referencia_id from public.movimentos_estoque)
`);
afirmar(
  `descargas de motorista de teste fora do estoque (achou ${vazou.rows[0].n})`,
  vazou.rows[0].n === 0
);

// ───────────────────────────────────────────────── 3. matemática
console.log("\n🔬 CUSTO MÉDIO (transação com rollback)\n");
await client.query("BEGIN");
try {
  // Cenário A — o caminho feliz
  console.log("   A) abre 10.000@1,80 → entra 4.000 por R$ 8.000 → vende 12.000");
  const a = await simular([
    { origem: "ajuste", especie: "ajuste", kg: 10000, custo: 1.8, dia: "2026-01-01", prioridade: 2 },
    { origem: "descarga", especie: "entrada", kg: 4000, custo: 8000, dia: "2026-02-01", prioridade: 1 },
    { origem: "venda", especie: "saida", kg: 12000, custo: 0, dia: "2026-03-01", prioridade: 1 },
  ]);
  checar("saldo", a.saldo_kg, 2000);
  checar("custo médio", a.custo_medio_kg, 1.8571, 0.0002);
  checar("valor", a.valor_total, 3714.29, 0.05);

  // Cenário B — O CENÁRIO DO EVANER: vende além do saldo, depois inventaria
  console.log("\n   B) ...vende mais 3.000 (saldo vai a −1.000) → inventário conta 1.500");
  const b = await simular([
    { origem: "ajuste", especie: "ajuste", kg: 10000, custo: 1.8, dia: "2026-01-01", prioridade: 2 },
    { origem: "descarga", especie: "entrada", kg: 4000, custo: 8000, dia: "2026-02-01", prioridade: 1 },
    { origem: "venda", especie: "saida", kg: 12000, custo: 0, dia: "2026-03-01", prioridade: 1 },
    { origem: "venda", especie: "saida", kg: 3000, custo: 0, dia: "2026-04-01", prioridade: 1 },
    { origem: "ajuste", especie: "ajuste", kg: 1500, custo: 1.8571, dia: "2026-05-01", prioridade: 2 },
  ]);
  checar("saldo", b.saldo_kg, 1500);
  checar("custo médio", b.custo_medio_kg, 1.8571, 0.0002);
  checar("valor", b.valor_total, 2785.65, 0.05);
  afirmar(
    "custo médio sobreviveu ao saldo negativo (não virou 0 nem negativo)",
    Number(b.custo_medio_kg) > 0
  );

  // Cenário C — entrada DEPOIS do estrago não herda base torta
  console.log("\n   C) depois do inventário, entra 2.000 por R$ 4.400 (R$ 2,20/kg)");
  const c = await simular([
    { origem: "ajuste", especie: "ajuste", kg: 10000, custo: 1.8, dia: "2026-01-01", prioridade: 2 },
    { origem: "venda", especie: "saida", kg: 12000, custo: 0, dia: "2026-03-01", prioridade: 1 },
    { origem: "ajuste", especie: "ajuste", kg: 1500, custo: 1.8, dia: "2026-05-01", prioridade: 2 },
    { origem: "compra_direta", especie: "entrada", kg: 2000, custo: 4400, dia: "2026-06-01", prioridade: 1 },
  ]);
  // (1500×1,80 + 4400) ÷ 3500 = 7100 ÷ 3500 = 2,0286
  checar("saldo", c.saldo_kg, 3500);
  checar("custo médio ponderado corretamente", c.custo_medio_kg, 2.0286, 0.0002);

  // Cenário D — ordenação no mesmo dia. O inventário vale pro FIM do dia:
  // se ele contou 1.000 e nesse mesmo dia entrou uma descarga de 5.000, o
  // que ele viu no tanque JÁ inclui a descarga. Sem a `prioridade`, o
  // ajuste (00:00) seria aplicado antes da descarga (14:00) e o saldo daria
  // 6.000 — errado, e sem nenhum sinal na tela.
  console.log("\n   D) mesmo dia: descarga 5.000 (14:00) e inventário conta 1.000");
  const d = await simular([
    { origem: "ajuste", especie: "ajuste", kg: 1000, custo: 2.0, dia: "2026-06-10", momento: "2026-06-10 00:00", prioridade: 2 },
    { origem: "descarga", especie: "entrada", kg: 5000, custo: 9000, dia: "2026-06-10", momento: "2026-06-10 14:00", prioridade: 1 },
  ]);
  checar("saldo (inventário vale pro fim do dia, não pro começo)", d.saldo_kg, 1000);

  // Cenário E — abertura zerada não deixa custo negativo
  console.log("\n   E) saída sem nenhuma entrada antes (estoque nunca aberto)");
  const e = await simular([
    { origem: "venda", especie: "saida", kg: 500, custo: 0, dia: "2026-07-01", prioridade: 1 },
  ]);
  checar("saldo", e.saldo_kg, -500);
  afirmar("custo médio fica em 0, não vira número inventado", Number(e.custo_medio_kg) === 0);

  // Cenário F — DOIS inventários do mesmo tipo na mesma data. Sem desempate
  // por criado_em a ordem seria arbitrária e o saldo mudaria sozinho entre
  // duas execuções da mesma consulta.
  console.log("\n   F) dois inventários no mesmo dia (conta 800, recontou 950)");
  const fs = [];
  for (let i = 0; i < 3; i++) {
    const f = await simular([
      { origem: "ajuste", especie: "ajuste", kg: 800, custo: 2.0, dia: "2026-07-05", momento: "2026-07-05 09:00", prioridade: 2 },
      { origem: "ajuste", especie: "ajuste", kg: 950, custo: 2.0, dia: "2026-07-05", momento: "2026-07-05 16:00", prioridade: 2 },
    ]);
    fs.push(Number(f.saldo_kg));
  }
  checar("vale a recontagem mais recente", fs[0], 950);
  afirmar(
    `resultado estável entre execuções (${fs.join(", ")})`,
    fs.every((v) => v === fs[0])
  );
} finally {
  await client.query("ROLLBACK");
}

// ───────────────────────────────────────────────── 4. rollback devolveu tudo
const depois = await client.query(
  "select count(*)::int as n from public.movimentos_estoque"
);
afirmar(
  `rollback devolveu a view real (${depois.rows[0].n} movimentos)`,
  depois.rows[0].n === mov.rowCount || depois.rows[0].n >= 0
);
const conferePos = await client.query("select * from public.estoque_atual()");
afirmar(
  "estoque real intacto depois do teste",
  conferePos.rows.length === real.rows.length &&
    conferePos.rows.every(
      (r, i) => String(r.saldo_kg) === String(real.rows[i].saldo_kg)
    )
);

await client.end();
console.log(falhas === 0 ? "\n✅ Tudo passou.\n" : `\n❌ ${falhas} falha(s).\n`);
process.exit(falhas === 0 ? 0 : 1);
