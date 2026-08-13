import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServer } from "@/lib/supabase/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { podeAcessarAdmin } from "@/lib/auth/roles";

async function exigirAdmin() {
  const supabase = await getSupabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const { data: profile } = await supabase
    .from("profiles").select("role, ativo").eq("id", user.id).maybeSingle();
  if (!profile || !profile.ativo || !podeAcessarAdmin(profile)) return null;
  return user;
}

export async function POST(req: NextRequest) {
  const admin = await exigirAdmin();
  if (!admin) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const body = await req.json();
  const motorista_id = String(body.motorista_id || "");
  const valor = Number(body.valor);
  const forma_pagamento = String(body.forma_pagamento || "");
  const observacao = body.observacao ? String(body.observacao).trim() : null;

  if (!motorista_id) return NextResponse.json({ error: "motorista_id obrigatório" }, { status: 400 });
  if (!Number.isFinite(valor) || valor <= 0) {
    return NextResponse.json({ error: "valor inválido" }, { status: 400 });
  }
  if (!["dinheiro", "pix"].includes(forma_pagamento)) {
    return NextResponse.json({ error: "forma_pagamento deve ser dinheiro ou pix" }, { status: 400 });
  }

  const client = getSupabaseAdmin();
  const { data, error } = await client
    .from("adiantamentos")
    .insert({
      motorista_id,
      valor: Math.round(valor),
      forma_pagamento,
      observacao,
      registrado_por: admin.id,
    })
    .select()
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ ok: true, adiantamento: data });
}
