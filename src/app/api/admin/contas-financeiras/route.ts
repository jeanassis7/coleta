import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { exigirAdmin } from "@/lib/auth/exigir-admin";

/**
 * POST — cadastra uma conta financeira (caixa em espécie ou conta de banco).
 *
 * `saldo_inicial` + `saldo_inicial_em` não são opcionais por acaso: sem o
 * ponto de partida o caixa nasce errado e nunca mais bate. A data é o corte —
 * movimento anterior a ela já está embutido no saldo informado.
 */
export async function POST(req: NextRequest) {
  const admin = await exigirAdmin();
  if (!admin) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const body = await req.json();
  const nome = String(body.nome || "").trim();
  const tipo = body.tipo === "banco" ? "banco" : "especie";
  const saldo_inicial = Number(body.saldo_inicial ?? 0);
  const saldo_inicial_em = String(body.saldo_inicial_em || "").trim();

  if (nome.length < 2) {
    return NextResponse.json({ error: "dê um nome à conta" }, { status: 400 });
  }
  if (!Number.isFinite(saldo_inicial)) {
    return NextResponse.json({ error: "saldo inicial inválido" }, { status: 400 });
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(saldo_inicial_em)) {
    return NextResponse.json(
      { error: "diga a partir de que data esse saldo vale" },
      { status: 400 }
    );
  }

  const client = getSupabaseAdmin(admin.id);
  const { data, error } = await client
    .from("contas_financeiras")
    .insert({
      nome,
      tipo,
      banco: tipo === "banco" && body.banco ? String(body.banco).trim() : null,
      agencia: tipo === "banco" && body.agencia ? String(body.agencia).trim() : null,
      numero: tipo === "banco" && body.numero ? String(body.numero).trim() : null,
      saldo_inicial: Math.round(saldo_inicial * 100) / 100,
      saldo_inicial_em,
      ordem: Number(body.ordem) || 0,
      observacao: body.observacao ? String(body.observacao).trim() : null,
    })
    .select("id")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ ok: true, id: data.id });
}
