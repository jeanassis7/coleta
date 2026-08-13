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
  const valor_devolvido = Math.round(Number(body.valor_devolvido) || 0);
  const valor_vale = Math.round(Number(body.valor_vale) || 0);
  const valor_saldo = Math.round(Number(body.valor_saldo) || 0);
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
