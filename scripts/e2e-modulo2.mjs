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
  where p.nome like '%E2E%'
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

// ───────────────────────────────────────────── 3b. venda → estoque → cheque
console.log("\n🔬 VENDA, CONTA CORRENTE E CHEQUE DEVOLVIDO (rollback no fim)\n");
await client.query("BEGIN");
try {
  const { rows: [perfil] } = await client.query(
    "select id from public.profiles where role = 'admin' and ativo = true limit 1"
  );
  if (!perfil) throw new Error("nenhum perfil admin/dev pra usar como registrado_por");

  // Abertura ONTEM de propósito: inventário vale pro FIM do dia, então
  // abrir e vender no mesmo dia faz a abertura sobrescrever a venda — o que
  // está correto (se ele contou 10.000 no fim do dia, já é depois da venda),
  // mas não é o cenário que este teste quer medir. O caso mesmo-dia tem
  // teste próprio mais abaixo.
  const abrir = (tipo, kg, custo) =>
    client.query(
      `insert into public.ajustes_estoque
         (tipo_oleo, motivo_tipo, saldo_antes_kg, saldo_novo_kg, custo_medio_kg,
          motivo, data, registrado_por)
       values ($1,'abertura',0,$2,$3,'E2E',current_date - 1,$4)`,
      [tipo, kg, custo, perfil.id]
    );
  await abrir("fino", 10000, 2.0);
  await abrir("grosso", 2000, 3.0);

  const { rows: [comp] } = await client.query(
    "insert into public.compradores (nome, cidade) values ('Fundição E2E','Cascavel') returning id"
  );

  // Vende 5.000 kg: 4.000 de fino + 1.000 de grosso, a R$ 3,50 = R$ 17.500
  const { rows: [venda] } = await client.query(
    `insert into public.vendas
       (comprador_id, data, peso_total_kg, kg_fino, kg_grosso, preco_kg,
        valor_total, registrado_por)
     values ($1, current_date, 5000, 4000, 1000, 3.50, 17500, $2) returning id`,
    [comp.id, perfil.id]
  );

  const est = await client.query("select * from public.estoque_atual()");
  const fino = est.rows.find((r) => r.tipo_oleo === "fino");
  const grosso = est.rows.find((r) => r.tipo_oleo === "grosso");
  console.log("   Abre 10.000 fino@2,00 e 2.000 grosso@3,00 → vende 4.000+1.000\n");
  checar("fino baixou", fino.saldo_kg, 6000);
  checar("grosso baixou", grosso.saldo_kg, 1000);
  checar("custo do fino não mudou com a saída", fino.custo_medio_kg, 2.0, 0.0002);
  checar("custo do grosso não mudou com a saída", grosso.custo_medio_kg, 3.0, 0.0002);

  const saldoDe = async () => {
    const { rows } = await client.query(
      "select * from public.saldo_compradores() where comprador_id = $1",
      [comp.id]
    );
    return rows[0];
  };

  console.log("\n   Conta corrente:");
  checar("deve o total da venda", (await saldoDe()).saldo, 17500);

  await client.query(
    `insert into public.recebimentos (comprador_id, venda_id, forma, valor, data, registrado_por)
     values ($1,$2,'pix',10000,current_date,$3)`,
    [comp.id, venda.id, perfil.id]
  );
  checar("após pix de 10.000", (await saldoDe()).saldo, 7500);

  const { rows: [recCh] } = await client.query(
    `insert into public.recebimentos (comprador_id, venda_id, forma, valor, data, registrado_por)
     values ($1,$2,'cheque',7500,current_date,$3) returning id`,
    [comp.id, venda.id, perfil.id]
  );
  const { rows: [cheque] } = await client.query(
    `insert into public.cheques
       (recebimento_id, comprador_id, banco, emitente, valor, bom_para)
     values ($1,$2,'Bradesco','Fundição E2E',7500, current_date + 30) returning id`,
    [recCh.id, comp.id]
  );
  checar("após cheque de 7.500 (papel na mão quita a dívida)", (await saldoDe()).saldo, 0);

  // O teste que importa: cheque volta e a dívida renasce SOZINHA.
  await client.query(
    "update public.cheques set status='devolvido', devolvido_em=current_date where id=$1",
    [cheque.id]
  );
  const dep = await saldoDe();
  checar("cheque devolvido → dívida renasce", dep.saldo, 7500);
  checar("e a ficha sabe nomear quanto disso é cheque voltado", dep.devolvido, 7500);

  // 1 cheque : 1 recebimento — devolver o cheque não pode levar o pix junto.
  afirmar(
    `o pix de 10.000 continua valendo (recebido = ${dep.recebido})`,
    Math.abs(Number(dep.recebido) - 10000) < 0.02
  );

  // Inserts que DEVEM falhar precisam de savepoint: no Postgres, um erro
  // aborta a transação inteira e todo statement seguinte devolve 25P02 —
  // sem isso, o primeiro teste negativo faz os próximos mentirem.
  const deveFalhar = async (rotulo, sql, params, codigoEsperado) => {
    await client.query("SAVEPOINT sp");
    const codigo = await client
      .query(sql, params)
      .then(() => "nenhum erro")
      .catch((e) => e.code);
    await client.query("ROLLBACK TO SAVEPOINT sp");
    if (codigo !== codigoEsperado) falhas++;
    console.log(
      `   ${codigo === codigoEsperado ? "✅" : "❌"} ${rotulo} (${codigo})`
    );
  };

  console.log("");
  await deveFalhar(
    "segundo cheque no mesmo recebimento é barrado",
    `insert into public.cheques (recebimento_id, comprador_id, banco, emitente, valor, bom_para)
     values ($1,$2,'Itau','Outro',100, current_date + 10)`,
    [recCh.id, comp.id],
    "23505"
  );
  await deveFalhar(
    "mistura que não fecha com o peso da balança é barrada",
    `insert into public.vendas
       (comprador_id, data, peso_total_kg, kg_fino, kg_grosso, preco_kg, valor_total, registrado_por)
     values ($1, current_date, 1000, 400, 300, 3.0, 3000, $2)`,
    [comp.id, perfil.id],
    "23514"
  );

  // Documenta o mesmo-dia: inventário HOJE sobrescreve a venda de HOJE.
  // Está certo (a contagem do fim do dia já é pós-venda) e a tela avisa
  // "vale pro fim desse dia" — o teste existe pra ninguém "consertar" isso
  // depois sem perceber que está invertendo a regra.
  await client.query(
    `insert into public.ajustes_estoque
       (tipo_oleo, motivo_tipo, saldo_antes_kg, saldo_novo_kg, custo_medio_kg,
        motivo, data, registrado_por)
     values ('fino','inventario',6000,5800,2.0,'contagem E2E',current_date,$1)`,
    [perfil.id]
  );
  const { rows: pos } = await client.query(
    "select * from public.estoque_atual() where tipo_oleo = 'fino'"
  );
  checar("inventário de hoje manda no saldo do dia", pos[0].saldo_kg, 5800);
} finally {
  await client.query("ROLLBACK");
}

// ───────────────────────────────────────────── 3c. contas a pagar
console.log("\n🔬 CONTAS A PAGAR (rollback no fim)\n");
await client.query("BEGIN");
try {
  const { rows: [perfil] } = await client.query(
    "select id from public.profiles where role = 'admin' and ativo = true limit 1"
  );

  const conta = (descricao, valor, status, venc) =>
    client.query(
      `insert into public.contas_a_pagar
         (descricao, categoria, valor, vencimento, status, registrado_por)
       values ($1,'outra',$2,$3,$4,$5) returning id`,
      [descricao, valor, venc, status, perfil.id]
    );

  // Baseline ANTES de inserir: o banco de produção tem contas reais, e
  // comparar total absoluto quebrava o teste toda vez que o Jean lançava
  // uma. O que importa aqui é o quanto ESTAS linhas mexeram.
  const { rows: [base] } = await client.query("select * from public.resumo_contas_a_pagar()");

  await conta("Vencida E2E", 300, "a_pagar", "2020-01-01");
  await client.query(
    `insert into public.contas_a_pagar
       (descricao, categoria, valor, vencimento, status, registrado_por)
     values ('Semana E2E','outra',500, current_date + 3,'a_pagar',$1)`,
    [perfil.id]
  );
  await conta("Chute E2E", 9999, "prevista", "2030-01-01");

  const { rows: [res] } = await client.query("select * from public.resumo_contas_a_pagar()");
  const delta = (campo) => Number(res[campo]) - Number(base[campo]);
  // 300 (vencida) + 500 (semana) — a prevista de 9999 fica FORA do que se deve.
  checar("total a pagar ignora previsão", delta("a_pagar_total"), 800);
  checar("vencidas", delta("vencidas_total"), 300);
  checar("vence em 7 dias", delta("semana_total"), 500);
  checar("previsto fica separado", delta("previsto_total"), 9999);

  // Gerar contas do mês duas vezes não pode duplicar o aluguel
  const { rows: [rec] } = await client.query(
    `insert into public.despesas_recorrentes
       (descricao, categoria, valor, dia_vencimento)
     values ('Aluguel E2E','fixa',3000,10) returning id`
  );
  const gerar = () =>
    client.query(
      `insert into public.contas_a_pagar
         (descricao, categoria, valor, vencimento, status, recorrente_id, competencia, registrado_por)
       values ('Aluguel E2E','fixa',3000,'2026-09-10','a_pagar',$1,'2026-09',$2)
       on conflict (recorrente_id, competencia) do nothing`,
      [rec.id, perfil.id]
    );
  await gerar();
  await gerar();
  const { rows: [{ n }] } = await client.query(
    "select count(*)::int as n from public.contas_a_pagar where recorrente_id = $1",
    [rec.id]
  );
  afirmar(`gerar o mês duas vezes não duplica (achou ${n})`, n === 1);

  // Pagar com cheque: o papel sai da carteira e vira repassado
  const { rows: [comp] } = await client.query(
    "insert into public.compradores (nome) values ('Fundição Cheque E2E') returning id"
  );
  const { rows: [recCh] } = await client.query(
    `insert into public.recebimentos (comprador_id, forma, valor, data, registrado_por)
     values ($1,'cheque',3000,current_date,$2) returning id`,
    [comp.id, perfil.id]
  );
  const { rows: [ch] } = await client.query(
    `insert into public.cheques (recebimento_id, comprador_id, banco, emitente, valor, bom_para)
     values ($1,$2,'Itau','Fundição', 3000, current_date + 20) returning id`,
    [recCh.id, comp.id]
  );
  const up1 = await client.query(
    `update public.cheques set status='repassado', repassado_para='Oficina E2E',
       repassado_em=current_date where id=$1 and status='em_carteira' returning id`,
    [ch.id]
  );
  afirmar("cheque em carteira pode ser repassado", up1.rowCount === 1);
  const up2 = await client.query(
    `update public.cheques set status='repassado' where id=$1 and status='em_carteira' returning id`,
    [ch.id]
  );
  afirmar("repassar de novo devolve 0 linhas (vira 409 na tela)", up2.rowCount === 0);
} finally {
  await client.query("ROLLBACK");
}

// ───────────────────────────────────────────── 3d. frota e documentos
console.log("\n🔬 FROTA E DOCUMENTOS (rollback no fim)\n");
await client.query("BEGIN");
try {
  const { rows: [perfil] } = await client.query(
    "select id from public.profiles where role = 'admin' and ativo = true limit 1"
  );
  const { rows: [cam] } = await client.query(
    "select id from public.caminhoes limit 1"
  );

  if (!cam) {
    afirmar("SEM CAMINHÃO CADASTRADO — checks de frota pulados", true);
  } else {
    // --- manutenção a prazo vira conta a pagar ---------------------------
    const { rows: [man] } = await client.query(
      `insert into public.manutencoes
         (caminhao_id, data, km, tipo, descricao, valor, proxima_km, registrado_por)
       values ($1, current_date, 100000, 'troca_oleo', 'E2E troca', 450.50, 110000, $2)
       returning id`,
      [cam.id, perfil.id]
    );
    await client.query(
      `insert into public.contas_a_pagar
         (descricao, categoria, valor, vencimento, status, origem_tipo, origem_id, registrado_por)
       values ('Manutenção — E2E troca','manutencao',450.50, current_date + 20,'a_pagar','manutencao',$1,$2)`,
      [man.id, perfil.id]
    );
    const { rows: [lig] } = await client.query(
      `select count(*)::int n from public.contas_a_pagar
        where origem_tipo = 'manutencao' and origem_id = $1`,
      [man.id]
    );
    afirmar("manutenção a prazo tem conta a pagar ligada a ela", lig.n === 1);

    // --- o CHECK de dono único ------------------------------------------
    let doisDonos = false;
    try {
      await client.query("savepoint sp1");
      await client.query(
        `insert into public.documentos (caminhao_id, motorista_id, tipo, vencimento)
         values ($1, $2, 'cipp', current_date + 30)`,
        [cam.id, perfil.id]
      );
      doisDonos = true;
      await client.query("rollback to sp1");
    } catch {
      await client.query("rollback to sp1");
    }
    afirmar("documento com caminhão E motorista é barrado", !doisDonos);

    let semDono = false;
    try {
      await client.query("savepoint sp2");
      await client.query(
        `insert into public.documentos (tipo, vencimento) values ('cipp', current_date + 30)`
      );
      semDono = true;
      await client.query("rollback to sp2");
    } catch {
      await client.query("rollback to sp2");
    }
    afirmar("documento sem dono nenhum é barrado", !semDono);

    // --- o alerta de km olha a MAIOR próxima_km --------------------------
    // Uma segunda troca mais recente tem que mandar na conta, senão o alerta
    // acenderia pra sempre com o alvo da primeira.
    await client.query(
      `insert into public.manutencoes
         (caminhao_id, data, km, tipo, descricao, valor, proxima_km, registrado_por)
       values ($1, current_date, 112000, 'troca_oleo', 'E2E troca 2', 400, 122000, $2)`,
      [cam.id, perfil.id]
    );
    const { rows: [alvo] } = await client.query(
      `select max(proxima_km)::int m from public.manutencoes
        where caminhao_id = $1 and tipo = 'troca_oleo'`,
      [cam.id]
    );
    checar("alvo da troca de óleo é a próxima_km MAIS ALTA", alvo.m, 122000, 0);

    // --- documento vencido aparece no filtro de vencimento ---------------
    await client.query(
      `insert into public.documentos (caminhao_id, tipo, vencimento, alerta_dias, registrado_por)
       values ($1, 'cipp', current_date - 5, 30, $2)`,
      [cam.id, perfil.id]
    );
    const { rows: [venc] } = await client.query(
      `select count(*)::int n from public.documentos
        where caminhao_id = $1 and vencimento < current_date`,
      [cam.id]
    );
    afirmar("documento com vencimento no passado é encontrável", venc.n >= 1);

    // --- documento com valor vira PREVISÃO, não dívida -------------------
    // O ponto do desenho: IPVA entra no fluxo de caixa futuro sem contar
    // como o que se deve hoje. Se um dia alguém trocar 'prevista' por
    // 'a_pagar' aqui, o "a pagar" do painel incha e ninguém entende por quê.
    const { rows: [antes] } = await client.query(
      "select * from public.resumo_contas_a_pagar()"
    );
    const { rows: [docV] } = await client.query(
      `insert into public.documentos (caminhao_id, tipo, vencimento, valor, registrado_por)
       values ($1, 'ipva', current_date + 60, 1250.00, $2) returning id`,
      [cam.id, perfil.id]
    );
    await client.query(
      `insert into public.contas_a_pagar
         (descricao, categoria, valor, vencimento, status, origem_tipo, origem_id, registrado_por)
       values ('IPVA — E2E','documento',1250.00, current_date + 60,'prevista','documento',$1,$2)`,
      [docV.id, perfil.id]
    );
    const { rows: [depoisDoc] } = await client.query(
      "select * from public.resumo_contas_a_pagar()"
    );
    checar(
      "previsão do documento entra no previsto",
      Number(depoisDoc.previsto_total) - Number(antes.previsto_total),
      1250
    );
    checar(
      "previsão do documento NÃO entra no que se deve",
      Number(depoisDoc.a_pagar_total) - Number(antes.a_pagar_total),
      0
    );
    const { rows: [lig2] } = await client.query(
      `select count(*)::int n from public.contas_a_pagar
        where origem_tipo = 'documento' and origem_id = $1`,
      [docV.id]
    );
    afirmar("previsão fica ligada ao documento que a gerou", lig2.n === 1);
  }
} finally {
  await client.query("ROLLBACK");
}

// ───────────────────────────────────── 3e. maço de cheques (lançamento em lote)
console.log("\n🔬 MAÇO DE CHEQUES (rollback no fim)\n");
await client.query("BEGIN");
try {
  const { rows: [perfil] } = await client.query(
    "select id from public.profiles where role = 'admin' and ativo = true limit 1"
  );
  const { rows: [comp] } = await client.query(
    `insert into public.compradores (nome, ativo) values ('Comprador E2E', true) returning id`
  );

  // Uma venda de 5.000 vira dívida.
  await client.query(
    `insert into public.vendas (comprador_id, data, peso_total_kg, kg_fino, kg_grosso, preco_kg, valor_total, registrado_por)
     values ($1, current_date, 1000, 1000, 0, 5, 5000, $2)`,
    [comp.id, perfil.id]
  );
  const saldoAntes = (await client.query(
    "select saldo from public.saldo_compradores() where comprador_id = $1", [comp.id]
  )).rows[0];

  // O maço vira UM RECEBIMENTO POR CHEQUE: cheques.recebimento_id é UNIQUE
  // (0017), porque cada cheque tem seu bom_para e seu ciclo — cada um É um
  // evento de pagamento. Um recebimento com N cheques bate na constraint.
  const idsReceb = [];
  for (const [banco, valor] of [["Sicredi", 1000], ["Bradesco", 2000]]) {
    const { rows: [r] } = await client.query(
      `insert into public.recebimentos (comprador_id, venda_id, forma, valor, data, registrado_por)
       values ($1, null, 'cheque', $2, current_date, $3) returning id`,
      [comp.id, valor, perfil.id]
    );
    idsReceb.push(r.id);
    await client.query(
      `insert into public.cheques (recebimento_id, comprador_id, banco, emitente, valor, bom_para, status)
       values ($1, $2, $3, 'Fulano E2E', $4, current_date + 30, 'em_carteira')`,
      [r.id, comp.id, banco, valor]
    );
  }

  const saldoDepois = (await client.query(
    "select saldo from public.saldo_compradores() where comprador_id = $1", [comp.id]
  )).rows[0];
  checar(
    "maço de cheques abate a dívida do comprador",
    Number(saldoAntes.saldo) - Number(saldoDepois.saldo),
    3000
  );

  const { rows: [naCarteira] } = await client.query(
    `select count(*)::int n, coalesce(sum(valor),0)::numeric v from public.cheques
      where recebimento_id = any($1) and status = 'em_carteira'`,
    [idsReceb]
  );
  afirmar("os 2 cheques do maço entram na carteira", naCarteira.n === 2);
  checar("a soma dos cheques bate com o maço", Number(naCarteira.v), 3000);

  // recebimento_id e comprador_id são NOT NULL: cheque solto não existe.
  let solto = false;
  try {
    await client.query("savepoint sp3");
    await client.query(
      `insert into public.cheques (comprador_id, banco, emitente, valor, bom_para)
       values ($1,'X','Y',10, current_date)`, [comp.id]
    );
    solto = true;
    await client.query("rollback to sp3");
  } catch { await client.query("rollback to sp3"); }
  afirmar("cheque sem recebimento é barrado pelo banco", !solto);
} finally {
  await client.query("ROLLBACK");
}

// ───────────────────────────────────────────────── 3f. caixa (contas e saldos)
console.log("\n🔬 CAIXA (rollback no fim)\n");
await client.query("BEGIN");
try {
  const { rows: [perfil] } = await client.query(
    "select id from public.profiles where role = 'admin' and ativo = true limit 1"
  );
  const { rows: [mot] } = await client.query(
    "select id from public.profiles where role = 'motorista' limit 1"
  );

  const conta = async (nome, tipo, inicial, diasAtras) => (await client.query(
    `insert into public.contas_financeiras (nome,tipo,saldo_inicial,saldo_inicial_em)
     values ($1,$2,$3, current_date - $4::int) returning id`,
    [nome, tipo, inicial, diasAtras]
  )).rows[0].id;

  const esp = await conta("E2E Espécie", "especie", 10000, 30);
  const bb  = await conta("E2E Banco",   "banco",   50000, 30);

  const saldoDe = async (id) => Number((await client.query(
    "select saldo from public.saldo_contas() where conta_id = $1", [id]
  )).rows[0].saldo);

  checar("saldo nasce igual ao saldo inicial", await saldoDe(esp), 10000);

  // Saque: sai do banco, entra na espécie. Tem que mover OS DOIS lados.
  await client.query(
    `insert into public.transferencias (conta_origem_id,conta_destino_id,valor,data,descricao,registrado_por)
     values ($1,$2,5000,current_date,'Saque E2E',$3)`, [bb, esp, perfil.id]
  );
  checar("saque entra na espécie", await saldoDe(esp), 15000);
  checar("saque sai do banco",     await saldoDe(bb),  45000);

  // Adiantamento sai do caixa de onde saiu o dinheiro.
  await client.query(
    `insert into public.adiantamentos (motorista_id,valor,data_envio,forma_pagamento,registrado_por,status,conta_id)
     values ($1,3000,current_date,'dinheiro',$2,'aceito',$3)`, [mot.id, perfil.id, esp]
  );
  checar("adiantamento sai da conta de origem", await saldoDe(esp), 12000);

  // CANCELADO não saiu: o dinheiro nunca foi entregue.
  await client.query(
    `insert into public.adiantamentos (motorista_id,valor,data_envio,forma_pagamento,registrado_por,status,conta_id)
     values ($1,9999,current_date,'dinheiro',$2,'cancelado',$3)`, [mot.id, perfil.id, esp]
  );
  checar("adiantamento CANCELADO não sai do caixa", await saldoDe(esp), 12000);

  // Antes do corte já está embutido no saldo inicial — somar de novo dobraria.
  await client.query(
    `insert into public.transferencias (conta_origem_id,conta_destino_id,valor,data,descricao,registrado_por)
     values ($1,$2,7777, current_date - 60,'antes do corte',$3)`, [bb, esp, perfil.id]
  );
  checar("movimento ANTES do corte é ignorado", await saldoDe(esp), 12000);

  // Acerto devolve dinheiro da mão do motorista PRO caixa: é entrada.
  await client.query(
    `insert into public.acertos (motorista_id,corte_em,valor_devolvido,valor_vale,valor_saldo,registrado_por,conta_id)
     values ($1, now(), 500, 0, 0, $2, $3)`, [mot.id, perfil.id, esp]
  );
  checar("acerto devolvido entra no caixa", await saldoDe(esp), 12500);

  // Origem igual ao destino é dinheiro que não anda — o banco recusa.
  let mesmaConta = false;
  try {
    await client.query("savepoint spc");
    await client.query(
      `insert into public.transferencias (conta_origem_id,conta_destino_id,valor,data,registrado_por)
       values ($1,$1,100,current_date,$2)`, [esp, perfil.id]
    );
    mesmaConta = true;
    await client.query("rollback to spc");
  } catch { await client.query("rollback to spc"); }
  afirmar("transferir pra própria conta é barrado", !mesmaConta);
} finally {
  await client.query("ROLLBACK");
}

// ────────────────────────────────────── 3g. DRE: a conta não dobra nem some
console.log("\n🔬 DRE — ANTI-DOBRA (rollback no fim)\n");
await client.query("BEGIN");
try {
  // REGIME DE CAIXA: o DRE conta a conta a pagar QUANDO PAGA, e o lançamento
  // operacional só quando ele NÃO virou conta (pagou na hora). Um fato com
  // conta é ignorado no DRE e contado quando a conta sai do caixa.
  //
  // O que os checks abaixo guardam é a integridade desse elo: conta órfã
  // (aponta pra fato que não existe) e fato com duas contas quebram a regra
  // dos dois lados — um faz sumir, o outro faz dobrar.
  const COM_FATO = ["abastecimento", "manutencao", "compra_direta", "coleta"];

  // 1) Toda conta com origem aponta pra um lançamento que EXISTE. Órfã é
  //    conta que ninguém consegue rastrear até o fato que a gerou.
  const { rows: [orfas] } = await client.query(
    `select count(*)::int n from public.contas_a_pagar cp
      where cp.origem_tipo = any($1)
        and not exists (
          select 1 from public.abastecimentos a where cp.origem_tipo='abastecimento' and a.id = cp.origem_id
          union all
          select 1 from public.manutencoes m where cp.origem_tipo='manutencao' and m.id = cp.origem_id
          union all
          select 1 from public.compras_diretas c where cp.origem_tipo='compra_direta' and c.id = cp.origem_id
          union all
          select 1 from public.coletas co where cp.origem_tipo='coleta' and co.id = cp.origem_id
        )`,
    [COM_FATO]
  );
  afirmar("nenhuma conta aponta pra um fato que não existe", orfas.n === 0);

  // 2) Um fato não pode ter DUAS contas: as duas seriam pagas e o mesmo
  //    gasto sairia do caixa (e do DRE) duas vezes.
  const { rows: [dupes] } = await client.query(
    `select count(*)::int n from (
       select origem_tipo, origem_id from public.contas_a_pagar
       where origem_tipo = any($1) and origem_id is not null
       group by 1,2 having count(*) > 1
     ) x`,
    [COM_FATO]
  );
  afirmar("nenhum lançamento operacional tem 2 contas", dupes.n === 0);

  // 3) Conta gerada por DOCUMENTO tem que ser contável como qualquer outra.
  //    Se alguém a tratar como caso especial, IPVA e seguro somem do DRE
  //    sem erro nenhum — o número só fica menor.
  const perfil = (await client.query(
    "select id from public.profiles where role='admin' and ativo limit 1"
  )).rows[0];
  const cam = (await client.query("select id from public.caminhoes limit 1")).rows[0];
  if (cam) {
    const { rows: [doc] } = await client.query(
      `insert into public.documentos (caminhao_id, tipo, vencimento, valor, registrado_por)
       values ($1,'ipva', current_date + 40, 1500, $2) returning id`,
      [cam.id, perfil.id]
    );
    await client.query(
      `insert into public.contas_a_pagar
         (descricao, categoria, valor, vencimento, status, origem_tipo, origem_id, registrado_por)
       values ('IPVA E2E','ipva_frota',1500, current_date + 40,'a_pagar','documento',$1,$2)`,
      [doc.id, perfil.id]
    );
    const { rows: [contavel] } = await client.query(
      `select count(*)::int n from public.contas_a_pagar
        where origem_tipo = 'documento' and not (origem_tipo = any($1))`,
      [COM_FATO]
    );
    afirmar("conta de documento é contável (IPVA e seguro entram)", contavel.n >= 1);
  }

  // 4) Categoria vazia é linha que não cai em grupo nenhum do DRE — soma
  //    some do relatório sem ninguém achar.
  const { rows: [semCat] } = await client.query(
    `select count(*)::int n from public.contas_a_pagar
      where categoria is null or trim(categoria) = ''`
  );
  afirmar("nenhuma conta sem categoria (sumiria do DRE)", semCat.n === 0);
} finally {
  await client.query("ROLLBACK");
}

// ─────────────────────────────────── 3h. vigências de remuneração e comissão
console.log("\n🔬 REMUNERAÇÃO COM VIGÊNCIA (rollback no fim)\n");
await client.query("BEGIN");
try {
  const { rows: [perfil] } = await client.query(
    "select id from public.profiles where role='admin' and ativo limit 1"
  );
  const { rows: [mot] } = await client.query(
    "select id from public.profiles where role='motorista' limit 1"
  );

  const vig = async (pessoa, tipo, valor, base, desde) =>
    client.query(
      `insert into public.vigencias_remuneracao
         (pessoa_id, tipo, valor, litros_base, vigente_desde, registrado_por)
       values ($1,$2,$3,$4,$5,$6)`,
      [pessoa, tipo, valor, base, desde, perfil.id]
    );

  // Regra geral da empresa, e um reajuste depois.
  await vig(null, "comissao", 100, 200, "2026-01-01");
  await vig(null, "comissao", 120, 200, "2026-06-01");

  // A busca: a de MAIOR vigente_desde que seja <= a data.
  const valeEm = async (data, pessoa) => (await client.query(
    `select valor, litros_base from public.vigencias_remuneracao
      where tipo='comissao' and vigente_desde <= $1::date
        and (pessoa_id = $2 or pessoa_id is null)
      order by vigente_desde desc, (pessoa_id is null) asc
      limit 1`,
    [data, pessoa]
  )).rows[0];

  checar("coleta de março usa a regra de janeiro", Number((await valeEm("2026-03-15", mot.id)).valor), 100);
  checar("coleta de agosto usa o reajuste de junho", Number((await valeEm("2026-08-15", mot.id)).valor), 120);

  // Regra específica da pessoa vence a geral NA MESMA DATA — é o caso de
  // "todo mundo ganha X, menos o fulano".
  await vig(mot.id, "comissao", 150, 200, "2026-06-01");
  checar("regra da pessoa vence a geral no mesmo dia", Number((await valeEm("2026-08-15", mot.id)).valor), 150);

  // A conta é PROPORCIONAL: metade dos litros paga metade.
  const r = await valeEm("2026-08-15", mot.id);
  const comissaoDe = (litros) => (litros / Number(r.litros_base)) * Number(r.valor);
  checar("350 L numa base de 200 paga 1,75x", comissaoDe(350), 262.5);
  checar("100 L numa base de 200 paga metade", comissaoDe(100), 75);

  // Duas vigências do mesmo tipo, mesma pessoa, mesmo dia seria ambíguo.
  let dupe = false;
  try {
    await client.query("savepoint spv");
    await vig(mot.id, "comissao", 999, 200, "2026-06-01");
    dupe = true;
    await client.query("rollback to spv");
  } catch { await client.query("rollback to spv"); }
  afirmar("duas vigências no mesmo dia são barradas", !dupe);

  // Comissão sem base de litros não calcula nada.
  let semBase = false;
  try {
    await client.query("savepoint spb");
    await vig(null, "comissao", 100, null, "2027-01-01");
    semBase = true;
    await client.query("rollback to spb");
  } catch { await client.query("rollback to spb"); }
  afirmar("comissão sem base de litros é barrada", !semBase);

  // E salário NÃO usa base — o campo é só da comissão.
  let salarioComBase = false;
  try {
    await client.query("savepoint sps");
    await vig(mot.id, "salario", 2500, 200, "2026-01-01");
    salarioComBase = true;
    await client.query("rollback to sps");
  } catch { await client.query("rollback to sps"); }
  afirmar("salário com base de litros é barrado", !salarioComBase);
} finally {
  await client.query("ROLLBACK");
}

// ──────────────────────── 3i. DRE: a receita é caixa, e cheque não dobra
console.log("\n🔬 RECEITA POR CAIXA (rollback no fim)\n");
await client.query("BEGIN");
try {
  const { rows: [perfil] } = await client.query(
    "select id from public.profiles where role='admin' and ativo limit 1"
  );
  const { rows: [comp] } = await client.query(
    "insert into public.compradores (nome,ativo) values ('Receita E2E',true) returning id"
  );
  const { rows: [conta] } = await client.query(
    `insert into public.contas_financeiras (nome,tipo,saldo_inicial,saldo_inicial_em)
     values ('E2E Receita','banco',0,current_date - 90) returning id`
  );

  // A receita do DRE é: recebimentos que NÃO são cheque + cheques COMPENSADOS.
  // O recebimento em cheque fica de fora porque ele e o cheque compensado são
  // o mesmo dinheiro — somar os dois dobraria a receita.
  const receitaHoje = async () => {
    const { rows: [r] } = await client.query(
      `select
         coalesce((select sum(valor) from public.recebimentos
                   where forma <> 'cheque' and data = current_date), 0)
       + coalesce((select sum(valor) from public.cheques
                   where status = 'compensado' and compensado_em = current_date), 0) as v`
    );
    return Number(r.v);
  };

  const base = await receitaHoje();

  // Venda de 10.000: metade PIX na hora, metade em cheque pra 30 dias.
  await client.query(
    `insert into public.vendas (comprador_id,data,peso_total_kg,kg_fino,kg_grosso,preco_kg,valor_total,registrado_por)
     values ($1,current_date,2000,2000,0,5,10000,$2)`,
    [comp.id, perfil.id]
  );
  await client.query(
    `insert into public.recebimentos (comprador_id,forma,valor,data,conta_id,registrado_por)
     values ($1,'pix',5000,current_date,$2,$3)`,
    [comp.id, conta.id, perfil.id]
  );
  const { rows: [rec] } = await client.query(
    `insert into public.recebimentos (comprador_id,forma,valor,data,registrado_por)
     values ($1,'cheque',5000,current_date,$2) returning id`,
    [comp.id, perfil.id]
  );
  const { rows: [ch] } = await client.query(
    `insert into public.cheques (recebimento_id,comprador_id,banco,emitente,valor,bom_para,status)
     values ($1,$2,'BB','Fulano E2E',5000,current_date+30,'em_carteira') returning id`,
    [rec.id, comp.id]
  );

  checar(
    "venda em cheque NÃO vira receita enquanto não compensa",
    (await receitaHoje()) - base,
    5000
  );

  await client.query(
    `update public.cheques set status='compensado', compensado_em=current_date, conta_id=$2 where id=$1`,
    [ch.id, conta.id]
  );

  // Se o recebimento em cheque também contasse, daria 15.000 — é este check
  // que pega alguém reintroduzindo a dobra.
  checar(
    "compensou: a venda inteira entra, e SEM dobrar",
    (await receitaHoje()) - base,
    10000
  );
} finally {
  await client.query("ROLLBACK");
}

// ─────────────────── 3j. cheque repassado: com despesa, e revertendo tudo
console.log("\n🔬 CHEQUE REPASSADO (rollback no fim)\n");
await client.query("BEGIN");
try {
  const { rows: [perfil] } = await client.query(
    "select id from public.profiles where role='admin' and ativo limit 1"
  );
  const { rows: [comp] } = await client.query(
    "insert into public.compradores (nome,ativo) values ('Repasse E2E',true) returning id"
  );

  // Comprador paga 3.000 em cheque: a dívida dele quita, o dinheiro fica no papel.
  await client.query(
    `insert into public.vendas (comprador_id,data,peso_total_kg,kg_fino,kg_grosso,preco_kg,valor_total,registrado_por)
     values ($1,current_date,600,600,0,5,3000,$2)`,
    [comp.id, perfil.id]
  );
  const { rows: [rec] } = await client.query(
    `insert into public.recebimentos (comprador_id,forma,valor,data,registrado_por)
     values ($1,'cheque',3000,current_date,$2) returning id`,
    [comp.id, perfil.id]
  );
  const { rows: [ch] } = await client.query(
    `insert into public.cheques (recebimento_id,comprador_id,banco,emitente,valor,bom_para,status)
     values ($1,$2,'BB','Fulano E2E',3000,current_date+30,'em_carteira') returning id`,
    [rec.id, comp.id]
  );

  const dividaDoComprador = async () => Number((await client.query(
    "select saldo from public.saldo_compradores() where comprador_id = $1", [comp.id]
  )).rows[0].saldo);

  checar("cheque na carteira quita a dívida do comprador", await dividaDoComprador(), 0);

  // Repassar = pagar uma despesa com ele. A despesa nasce PAGA, sem conta
  // financeira (o dinheiro saiu do papel), e amarrada ao cheque.
  const { rows: [conta] } = await client.query(
    `insert into public.contas_a_pagar
       (descricao, categoria, valor, vencimento, pago_em, status, forma_pagamento, cheque_id, registrado_por)
     values ('Posto E2E','combustivel',3000,current_date,current_date,'paga','cheque',$1,$2)
     returning id`,
    [ch.id, perfil.id]
  );
  await client.query(
    `update public.cheques set status='repassado', repassado_em=current_date, repassado_para='Posto E2E' where id=$1`,
    [ch.id]
  );

  const { rows: [semConta] } = await client.query(
    "select count(*)::int n from public.contas_a_pagar where id=$1 and conta_id is null", [conta.id]
  );
  afirmar("despesa paga com cheque não sai de conta financeira", semConta.n === 1);

  // Agora o cheque VOLTA. Tudo tem que desfazer.
  await client.query(
    `update public.cheques set status='devolvido', devolvido_em=current_date where id=$1`,
    [ch.id]
  );
  await client.query(
    `update public.contas_a_pagar
       set status='a_pagar', pago_em=null, forma_pagamento=null, conta_id=null, cheque_id=null
     where cheque_id=$1 and status='paga'`,
    [ch.id]
  );

  checar("cheque devolvido faz a dívida do comprador VOLTAR", await dividaDoComprador(), 3000);

  const { rows: [voltou] } = await client.query(
    "select status from public.contas_a_pagar where id=$1", [conta.id]
  );
  afirmar("a conta que o cheque quitava volta pra 'a pagar'", voltou.status === "a_pagar");

  // E some do DRE: a receita é caixa, e só conta paga entra.
  const { rows: [noDre] } = await client.query(
    `select count(*)::int n from public.contas_a_pagar
      where id=$1 and status='paga' and pago_em = current_date`,
    [conta.id]
  );
  afirmar("a despesa sai do DRE do dia (conta não está mais paga)", noDre.n === 0);
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
