// ============================================================================
// BACKFILL 2026 — importa o histórico das planilhas pro sistema
//
// Fonte: dados-historicos/dados-import.json (gerado da MESMA leitura da
// CONFERENCIA-BACKFILL.xlsx auditada pelo Evaner em 21/08/2026).
//
// USO:
//   node scripts/backfill-2026.mjs              → ENSAIO: roda tudo e ROLLBACK
//   node scripts/backfill-2026.mjs --valendo    → COMMIT + grava o manifesto
//
// Desfazer: node scripts/backfill-desfazer.mjs --sim-eu-confirmo
//
// Segurança:
//  - transação única (ou entra tudo, ou nada)
//  - recusa rodar se o manifesto de um import anterior existir
//  - client_id determinístico em recebimentos/descargas (re-run acusa conflito)
//  - linhas de transição (21/08) só entram se o fato NÃO existir no app
//  - toda observacao carrega a marca [backfill-2026 <ref>]
// ============================================================================
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import pg from "pg";

const VALENDO = process.argv.includes("--valendo");
const RAIZ = new URL("..", import.meta.url);
const DADOS = JSON.parse(readFileSync(new URL("dados-historicos/dados-import.json", RAIZ), "utf8"));
const MANIFESTO_PATH = new URL("dados-historicos/backfill-manifesto.json", RAIZ);

if (existsSync(MANIFESTO_PATH)) {
  console.error("❌ Já existe dados-historicos/backfill-manifesto.json — o import já rodou.");
  console.error("   Pra rodar de novo, desfaça antes: node scripts/backfill-desfazer.mjs --sim-eu-confirmo");
  process.exit(1);
}

const env = readFileSync(new URL(".env.local", RAIZ), "utf8");
const u = new URL(env.match(/DATABASE_URL="?([^"\n]+)"?/)[1]);
const db = new pg.Client({
  host: u.hostname, port: u.port,
  user: decodeURIComponent(u.username), password: decodeURIComponent(u.password),
  database: u.pathname.slice(1), ssl: { rejectUnauthorized: false },
});
await db.connect();

// uuid determinístico a partir da ref (md5 → formato uuid)
const uuidDet = (ref) => {
  const h = createHash("md5").update("backfill-2026|" + ref).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;
};
const ts = (iso) => `${iso}T15:00:00Z`; // 12:00 no Brasil — longe das viradas de dia
const marca = (ref, extra) => `[backfill-2026 ${ref}]${extra ? " " + extra : ""}`;

const manifesto = { rodadoEm: null, tabelas: {} };
const anota = (tabela, id) => (manifesto.tabelas[tabela] ??= []).push(id);
const pulados = [];

try {
  await db.query("begin");

  // ---------------------------------------------------------- 0. cadastros
  await db.query(`update compradores set nome = 'PR ALUMÍNIO / LAZZARIN' where nome = 'PARANA ALUMÍNIO'`);

  const compradorVirada = await db.query(
    `insert into compradores (nome, observacao)
     select 'CHEQUES 2025 — VIRADA', 'Comprador técnico do backfill: cheques recebidos em 2025 (antes do controle) que compensaram no banco em 2026. Regime de caixa: a receita conta no mês da compensação.'
     where not exists (select 1 from compradores where nome = 'CHEQUES 2025 — VIRADA')
     returning id`);
  if (compradorVirada.rowCount) anota("compradores", compradorVirada.rows[0].id);

  for (const [placa, tara, cap, quem] of [["ANTIGO-NEI", 7520, 11000, "Lucinei"], ["ANTIGO-FUMACA", 8750, 13000, "Luiz"]]) {
    const r = await db.query(
      `insert into caminhoes (placa, marca, cor, tara_kg, capacidade_l, tipo, ativo, motivo_inativo, de_quem)
       select $1, 'Regime antigo', '—', $2, $3, 'caminhao', false, 'Caminhão do regime antigo (backfill 2026) — não será mais utilizado', $4
       where not exists (select 1 from caminhoes where placa = $1)
       returning id`, [placa, tara, cap, quem]);
    if (r.rowCount) anota("caminhoes", r.rows[0].id);
  }

  // ---------------------------------------------------------- lookups
  const mapa = async (sql) => new Map((await db.query(sql)).rows.map((r) => [r.nome, r.id]));
  const compradores = await mapa("select nome, id from compradores");
  const contas = await mapa("select nome, id from contas_financeiras");
  const pessoas = await mapa("select nome, id from profiles");
  const caminhoes = new Map((await db.query("select placa, id from caminhoes")).rows.map((r) => [r.placa, r.id]));
  const EVANER = pessoas.get("Evaner");
  const contaDe = (nome) => (nome ? contas.get(nome) ?? null : null);
  for (const n of ["Banco do Brasil PF", "Dinheiro em mãos"]) if (!contas.get(n)) throw new Error(`conta "${n}" não existe`);
  for (const n of ["PERFILAZ", "VISSOTO", "PR ALUMÍNIO / LAZZARIN", "PROLUMINAS", "FILTROVILLE", "CHEQUES 2025 — VIRADA"]) if (!compradores.get(n)) throw new Error(`comprador "${n}" não existe`);

  // ---------------------------------------------------------- 1. contas pagas
  for (const c of DADOS.contasPagas) {
    const r = await db.query(
      `insert into contas_a_pagar (descricao, categoria, valor, vencimento, status, pago_em, conta_id, pessoa_id, observacao, registrado_por, criado_em)
       values ($1, $2, $3, $4, 'paga', $4, $5, $6, $7, $8, $9) returning id`,
      [c.descricao || c.categoria, c.categoria, c.valor, c.pagoEm, contaDe(c.conta), c.pessoa ? pessoas.get(c.pessoa) : null,
       marca(c.ref, c.nota), EVANER, ts(c.pagoEm)]);
    anota("contas_a_pagar", r.rows[0].id);
  }

  // ---------------------------------------------------------- 2. vendas
  for (const v of DADOS.vendas) {
    const r = await db.query(
      `insert into vendas (comprador_id, data, peso_total_kg, kg_fino, kg_grosso, preco_kg, valor_total, observacao, registrado_por, criado_em, client_id)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) returning id`,
      [compradores.get(v.comprador), v.data, v.kg, v.kgFino, v.kgGrosso, v.precoKg, v.valor,
       marca(v.ref, "mistura 85/15 por decisão do Evaner (21/08)"), EVANER, ts(v.data), "backfill-2026-" + v.ref]);
    anota("vendas", r.rows[0].id);
  }

  // ---------------------------------------------------------- 3. recebimentos avulsos
  for (const rc of DADOS.recebimentos) {
    const r = await db.query(
      `insert into recebimentos (comprador_id, forma, valor, data, conta_id, observacao, registrado_por, criado_em, client_id)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9) returning id`,
      [compradores.get(rc.comprador), rc.forma, rc.valor, rc.data,
       rc.forma === "abatimento" ? null : contas.get("Banco do Brasil PF"),
       marca(rc.ref, rc.obs), EVANER, ts(rc.data), uuidDet(rc.ref)]);
    anota("recebimentos", r.rows[0].id);
  }

  // ---------------------------------------------------------- 4. cheques (um a um)
  const BB = contas.get("Banco do Brasil PF");
  for (const ch of DADOS.cheques) {
    const rec = await db.query(
      `insert into recebimentos (comprador_id, forma, valor, data, conta_id, observacao, registrado_por, criado_em, client_id)
       values ($1, 'cheque', $2, $3, null, $4, $5, $6, $7) returning id`,
      [compradores.get(ch.comprador), ch.valor, ch.recebidoEm, marca(ch.ref), EVANER, ts(ch.recebidoEm), uuidDet(ch.ref + "-rec")]);
    anota("recebimentos", rec.rows[0].id);
    const ehRepasse = !!ch.repasse;
    const cq = await db.query(
      `insert into cheques (recebimento_id, comprador_id, banco, emitente, numero, valor, bom_para, status,
                            repassado_para, repassado_em, depositado_em, compensado_em, conta_id, observacao, criado_em)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15) returning id`,
      [rec.rows[0].id, compradores.get(ch.comprador), ch.banco || "—", ch.comprador, ch.numero || null, ch.valor, ch.bomPara,
       ehRepasse ? "repassado" : "compensado",
       ehRepasse ? ch.destino : null, ehRepasse ? ch.bomPara : null,
       ehRepasse ? null : ch.bomPara, ehRepasse ? null : ch.bomPara,
       ehRepasse ? null : BB, marca(ch.ref), ts(ch.recebidoEm)]);
    anota("cheques", cq.rows[0].id);
    if (ehRepasse) {
      const conta = await db.query(
        `insert into contas_a_pagar (descricao, fornecedor, categoria, valor, vencimento, status, forma_pagamento, pago_em, cheque_id, pessoa_id, observacao, registrado_por, criado_em)
         values ($1, $2, $3, $4, $5, 'paga', 'cheque', $5, $6, $7, $8, $9, $10) returning id`,
        [`Repasse de cheque — ${ch.destino}`, ch.destino, ch.repasse.categoria, ch.valor, ch.bomPara,
         cq.rows[0].id, ch.repasse.pessoa ? pessoas.get(ch.repasse.pessoa) : null,
         marca(ch.ref, "conta paga com o próprio cheque (repasse)"), EVANER, ts(ch.bomPara)]);
      anota("contas_a_pagar", conta.rows[0].id);
    }
  }

  // ---------------------------------------------------------- 5. cheques 2025 (agregado mensal)
  const VIRADA = compradores.get("CHEQUES 2025 — VIRADA");
  for (const c25 of DADOS.cheques2025) {
    const rec = await db.query(
      `insert into recebimentos (comprador_id, forma, valor, data, conta_id, observacao, registrado_por, criado_em, client_id)
       values ($1, 'cheque', $2, $3, null, $4, $5, $6, $7) returning id`,
      [VIRADA, c25.valor, c25.ultimoDia, marca(c25.ref, "agregado do mês — cheques de 2025 compensados no banco"), EVANER, ts(c25.ultimoDia), uuidDet(c25.ref)]);
    anota("recebimentos", rec.rows[0].id);
    const cq = await db.query(
      `insert into cheques (recebimento_id, comprador_id, banco, emitente, valor, bom_para, status, depositado_em, compensado_em, conta_id, observacao, criado_em)
       values ($1, $2, '—', 'DIVERSOS (cheques de 2025)', $3, $4, 'compensado', $4, $4, $5, $6, $7) returning id`,
      [rec.rows[0].id, VIRADA, c25.valor, c25.ultimoDia, BB, marca(c25.ref, "AGREGADO: diferença banco × controle de cheques do mês (decisão do Evaner 21/08)"), ts(c25.ultimoDia)]);
    anota("cheques", cq.rows[0].id);
  }

  // ---------------------------------------------------------- 6. cargas + descargas
  for (const cg of DADOS.cargas) {
    if (!(cg.pesoBruto > 0) || !(cg.tara > 0)) {
      pulados.push(`${cg.ref}: descarga sem peso na planilha (dia de zero tambores) — não importada`);
      continue;
    }
    const placa = cg.caminhao.startsWith("ANTIGO-NEI") ? "ANTIGO-NEI" : cg.caminhao.startsWith("ANTIGO-FUMAÇA") || cg.caminhao.startsWith("ANTIGO-FUMACA") ? "ANTIGO-FUMACA" : cg.caminhao;
    const camId = caminhoes.get(placa);
    if (!camId) throw new Error(`caminhão "${placa}" não achado (carga ${cg.ref})`);
    const carga = await db.query(
      `insert into cargas (motorista_id, caminhao_id, km_inicial, status, iniciada_em, encerrada_em, criado_em)
       values ($1, $2, 0, 'encerrada', $3, $4, $3) returning id`,
      [pessoas.get(cg.motorista), camId, ts(cg.inicio), ts(cg.descarga)]);
    anota("cargas", carga.rows[0].id);
    const desc = await db.query(
      `insert into descargas (carga_id, peso_bruto_kg, peso_tara_kg, litros_estimados, criado_em, client_id)
       values ($1, $2, $3, $4, $5, $6) returning id`,
      [carga.rows[0].id, Math.round(cg.pesoBruto), Math.round(cg.tara), cg.litros, ts(cg.descarga), uuidDet(cg.ref)]);
    anota("descargas", desc.rows[0].id);
  }

  // ---------------------------------------------------------- 7. adiantamentos da virada
  for (const ad of DADOS.adiantamentos) {
    if (ad.transicao) {
      // 21/08 = dia da transição física: só entra se o fato ainda não existe no app
      const ja = await db.query(
        `select 1 from adiantamentos where motorista_id = $1 and valor = $2 and data_envio >= '2026-08-20'
         union all
         select 1 from acertos where motorista_id = $1 and criado_em >= '2026-08-20'`,
        [pessoas.get(ad.motorista), ad.valor]);
      if (ja.rowCount) { pulados.push(`${ad.ref}: ${ad.motorista} R$ ${ad.valor} (${ad.obs}) — já existe no app, pulado`); continue; }
    }
    const r = await db.query(
      `insert into adiantamentos (motorista_id, valor, data_envio, forma_pagamento, status, conta_id, observacao, registrado_por, criado_em)
       values ($1, $2, $3, 'dinheiro', 'pendente', $4, $5, $6, $3) returning id`,
      [pessoas.get(ad.motorista), ad.valor, ts(ad.dataEnvio), contaDe(ad.conta),
       marca(ad.ref, `regularização da virada — ${ad.obs || "dinheiro entregue em mãos"}`), EVANER]);
    anota("adiantamentos", r.rows[0].id);
  }

  // ---------------------------------------------------------- fecha
  const resumo = Object.entries(manifesto.tabelas).map(([t, ids]) => `${t}: ${ids.length}`).join(" | ");
  if (VALENDO) {
    await db.query("commit");
    manifesto.rodadoEm = new Date().toISOString();
    writeFileSync(MANIFESTO_PATH, JSON.stringify(manifesto, null, 1), "utf8");
    console.log("✅ IMPORT CONCLUÍDO E GRAVADO.");
  } else {
    await db.query("rollback");
    console.log("🧪 ENSAIO OK — tudo inseriu sem erro e foi DESFEITO (rollback). Nada gravado.");
  }
  console.log("   " + resumo);
  for (const p of pulados) console.log("   ⏭️  " + p);
  if (!VALENDO) console.log("\nPra valer: node scripts/backfill-2026.mjs --valendo");
} catch (e) {
  await db.query("rollback").catch(() => {});
  console.error("❌ ERRO — transação desfeita, nada gravado:\n", e.message);
  process.exitCode = 1;
} finally {
  await db.end();
}
