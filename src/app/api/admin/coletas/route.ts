import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { exigirAcessoModulo1 } from "@/lib/auth/gate-modulo1";

// Módulo 1 — Estágio 1: dev-only. Promoção pro Jean é um flip em gate-modulo1.ts.
const exigirAdmin = exigirAcessoModulo1;

/**
 * POST: coleta lançada pelo gestor numa carga (o motorista coletou e
 * esqueceu de registrar no app; avisou depois).
 *
 * Funciona com a carga ATIVA ou já ENCERRADA — o óleo entrou naquela
 * carga de qualquer jeito, e a descarga dela já contabilizou o peso.
 *
 * Regras herdadas da coleta normal:
 *   • pertence ao motorista da carga
 *   • o valor DESCONTA do saldo dele (o dinheiro saiu da mão dele)
 *   • sem GPS e sem foto (não foi capturada em campo)
 *   • lancado_por_admin guarda quem digitou, pra auditoria
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
  if (!Number.isInteger(valor_pago) || valor_pago <= 0) {
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

  const client = getSupabaseAdmin();
  const { data: carga } = await client
    .from("cargas")
    .select("id, motorista_id, iniciada_em")
    .eq("id", carga_id)
    .maybeSingle();
  if (!carga) {
    return NextResponse.json({ error: "carga não encontrada" }, { status: 404 });
  }

  const { error } = await client.from("coletas").insert({
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
  });
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ ok: true });
}
