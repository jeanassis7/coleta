import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { exigirAdmin } from "@/lib/auth/exigir-admin";

export async function POST(req: NextRequest) {
  const admin = await exigirAdmin();
  if (!admin) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const body = await req.json();
  const motorista_id = String(body.motorista_id || "");
  const valor = Number(body.valor);
  const forma_pagamento = String(body.forma_pagamento || "");
  const observacao = body.observacao ? String(body.observacao).trim() : null;
  const conta_id = body.conta_id ? String(body.conta_id) : null;

  if (!motorista_id) return NextResponse.json({ error: "motorista_id obrigatório" }, { status: 400 });
  if (!Number.isFinite(valor) || valor <= 0) {
    return NextResponse.json({ error: "valor inválido" }, { status: 400 });
  }
  if (!["dinheiro", "pix"].includes(forma_pagamento)) {
    return NextResponse.json({ error: "forma_pagamento deve ser dinheiro ou pix" }, { status: 400 });
  }
  // Esse dinheiro saiu de algum lugar. Sem dizer de onde, o adiantamento
  // apareceria do nada e o saldo da conta não bateria com a realidade.
  if (!conta_id) {
    return NextResponse.json(
      { error: "diga de qual conta saiu o dinheiro" },
      { status: 400 }
    );
  }

  const client = getSupabaseAdmin(admin.id);
  const { data, error } = await client
    .from("adiantamentos")
    .insert({
      motorista_id,
      // Centavos são válidos (coluna numeric) — arredonda só pra 2 casas
      valor: Math.round(valor * 100) / 100,
      forma_pagamento,
      conta_id,
      observacao,
      registrado_por: admin.id,
    })
    .select()
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ ok: true, adiantamento: data });
}
