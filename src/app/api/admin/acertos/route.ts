import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { exigirAcessoModulo1 } from "@/lib/auth/gate-modulo1";

// Módulo 1 — Estágio 1: dev-only. Promoção pro Jean é um flip em gate-modulo1.ts.
const exigirAdmin = exigirAcessoModulo1;

export async function POST(req: NextRequest) {
  const admin = await exigirAdmin();
  if (!admin) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const body = await req.json();
  const motorista_id = String(body.motorista_id || "");
  // Centavos são válidos (colunas numeric) — arredonda só pra 2 casas
  const aCentavos = (x: unknown) => Math.round((Number(x) || 0) * 100) / 100;
  const valor_devolvido = aCentavos(body.valor_devolvido);
  const valor_vale = aCentavos(body.valor_vale);
  const valor_saldo = aCentavos(body.valor_saldo);
  const observacao = body.observacao ? String(body.observacao).trim() : null;

  if (!motorista_id) return NextResponse.json({ error: "motorista_id obrigatório" }, { status: 400 });
  if (valor_devolvido < 0 || valor_vale < 0 || valor_saldo < 0) {
    return NextResponse.json({ error: "valores negativos não permitidos" }, { status: 400 });
  }

  const client = getSupabaseAdmin();
  const { data, error } = await client
    .from("acertos")
    .insert({
      motorista_id,
      valor_devolvido,
      valor_vale,
      valor_saldo,
      observacao,
      registrado_por: admin.id,
    })
    .select()
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ ok: true, acerto: data });
}
