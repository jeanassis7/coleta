import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { exigirAdmin } from "@/lib/auth/exigir-admin";

/**
 * POST: coleta lançada pelo gestor numa carga (o motorista coletou e
 * esqueceu de registrar no app; avisou depois).
 *
 * Funciona com a carga ATIVA ou já ENCERRADA — o óleo entrou naquela
 * carga de qualquer jeito, e a descarga dela já contabilizou o peso.
 *
 * Regras herdadas da coleta normal:
 *   • pertence ao motorista da carga
 *   • por padrão o valor DESCONTA do saldo dele (o dinheiro saiu da mão dele)
 *   • sem GPS e sem foto (não foi capturada em campo)
 *   • lancado_por_admin guarda quem digitou, pra auditoria
 *
 * `pagamento` diz de quem o dinheiro saiu (antes era um passo em dois —
 * criar debitando o motorista e marcar a sede no drawer depois; esquecer o
 * segundo passo cobrava do motorista um óleo que a empresa pagou):
 *   • "motorista" (padrão) — desconta do saldo dele;
 *   • "sede"              — vira conta a pagar (vencimento opcional);
 *   • "sede_ja_pagou"     — a conta nasce PAGA (forma + conta + data).
 */
export async function POST(req: NextRequest) {
  const admin = await exigirAdmin();
  if (!admin) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const body = await req.json();
  const carga_id = String(body.carga_id || "");
  const litros = Number(body.litros);
  const valor_pago = Number(body.valor_pago);
  const local_nome = String(body.local_nome || "").trim();
  const observacao = body.observacao ? String(body.observacao).trim() : null;
  const criado_em = String(body.criado_em || "");
  const certificado_tipo = ["integral", "parcial", "nao"].includes(
    body.certificado_tipo
  )
    ? body.certificado_tipo
    : "nao";

  if (!carga_id) {
    return NextResponse.json({ error: "carga não informada" }, { status: 400 });
  }
  if (!Number.isFinite(litros) || litros <= 0) {
    return NextResponse.json({ error: "litros inválido" }, { status: 400 });
  }
  // Zero é válido: óleo doado se lança com R$ 0 (R2, migration 0031) — a
  // retroativa não pode ser mais restritiva que o app do motorista.
  if (!Number.isInteger(valor_pago) || valor_pago < 0) {
    return NextResponse.json(
      { error: "valor da coleta é inteiro, sem centavos" },
      { status: 400 }
    );
  }
  if (local_nome.length < 2) {
    return NextResponse.json({ error: "diga o nome do local" }, { status: 400 });
  }

  let litros_certificado: number | null = null;
  if (certificado_tipo === "integral") {
    litros_certificado = Math.round(litros * 100) / 100;
  } else if (certificado_tipo === "parcial") {
    const n = Number(body.litros_certificado);
    if (!Number.isFinite(n) || n <= 0) {
      return NextResponse.json(
        { error: "certificado parcial precisa dos litros" },
        { status: 400 }
      );
    }
    litros_certificado = Math.round(n * 100) / 100;
  }

  // Quem pagou esse óleo
  const pagamento = ["motorista", "sede", "sede_ja_pagou"].includes(
    String(body.pagamento)
  )
    ? String(body.pagamento)
    : "motorista";
  const pagoPelaSede = pagamento !== "motorista";
  if (pagamento === "sede_ja_pagou") {
    if (
      !body.conta_id ||
      !["pix", "dinheiro", "deposito"].includes(String(body.forma_pagamento))
    ) {
      return NextResponse.json(
        { error: "\"sede já pagou\" precisa da forma (pix/dinheiro/depósito) e de qual conta o dinheiro saiu" },
        { status: 400 }
      );
    }
  }

  const client = getSupabaseAdmin(admin.id);
  const { data: carga } = await client
    .from("cargas")
    .select("id, motorista_id, iniciada_em")
    .eq("id", carga_id)
    .maybeSingle();
  if (!carga) {
    return NextResponse.json({ error: "carga não encontrada" }, { status: 404 });
  }

  const { data: criada, error } = await client
    .from("coletas")
    .insert({
      motorista_id: carga.motorista_id,
      carga_id: carga.id,
      litros: Math.round(litros * 100) / 100,
      local_nome,
      valor_pago,
      certificado_tipo,
      litros_certificado,
      observacao,
      gps_capturado: false,
      criado_em: criado_em || carga.iniciada_em,
      client_id: randomUUID(),
      lancado_por_admin: admin.id,
      pago_pela_sede: pagoPelaSede,
    })
    .select("id")
    .maybeSingle();
  if (error || !criada) {
    return NextResponse.json({ error: error?.message || "erro" }, { status: 400 });
  }

  // A dívida com o fornecedor nasce junto (mesma regra do drawer). Valor 0
  // é doação: sede marcada, dívida nenhuma.
  if (pagoPelaSede && valor_pago > 0) {
    const hojeBr = new Date(Date.now() - 3 * 60 * 60 * 1000);
    const vencDefault = new Date(
      Date.UTC(hojeBr.getUTCFullYear(), hojeBr.getUTCMonth() + 1, 1)
    )
      .toISOString()
      .slice(0, 10);
    const vencimento = /^\d{4}-\d{2}-\d{2}$/.test(String(body.vencimento || ""))
      ? String(body.vencimento)
      : vencDefault;
    const jaPagou = pagamento === "sede_ja_pagou";
    // "Já pagou" sem data = pagou HOJE (não no vencimento do mês que vem).
    const hojeIso = hojeBr.toISOString().slice(0, 10);
    const pagoEm =
      jaPagou && /^\d{4}-\d{2}-\d{2}$/.test(String(body.pago_em || ""))
        ? String(body.pago_em)
        : hojeIso;

    const { error: eConta } = await client.from("contas_a_pagar").insert({
      descricao: `Óleo — ${local_nome}`,
      fornecedor: local_nome,
      categoria: "oleo_sede",
      valor: valor_pago,
      vencimento: jaPagou ? pagoEm : vencimento,
      status: jaPagou ? "paga" : "a_pagar",
      ...(jaPagou
        ? {
            pago_em: pagoEm,
            forma_pagamento: String(body.forma_pagamento),
            conta_id: String(body.conta_id),
          }
        : {}),
      origem_tipo: "coleta",
      origem_id: criada.id,
      registrado_por: admin.id,
    });
    if (eConta) {
      return NextResponse.json({
        ok: true,
        aviso: `coleta salva, mas a conta do fornecedor não nasceu: ${eConta.message} — marque de novo pelo detalhe da coleta`,
      });
    }
  }
  return NextResponse.json({ ok: true });
}
