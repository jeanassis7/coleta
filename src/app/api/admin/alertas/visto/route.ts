import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { exigirAdmin } from "@/lib/auth/exigir-admin";

/**
 * POST { chave } — marca um alerta como visto ("OK, VI").
 * Ele some do dashboard pra sempre. Se a condição voltar em OUTRO
 * registro, a chave é diferente e o alerta aparece de novo.
 */
export async function POST(req: NextRequest) {
  const user = await exigirAdmin();
  if (!user) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const body = await req.json();
  const chave = String(body.chave || "").trim();
  if (!chave || chave.length > 200) {
    return NextResponse.json({ error: "chave inválida" }, { status: 400 });
  }

  const client = getSupabaseAdmin(user.id);
  const { error } = await client
    .from("alertas_vistos")
    .upsert({ chave, visto_por: user.id, visto_em: new Date().toISOString() });
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ ok: true });
}
