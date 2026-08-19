import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { exigirAdmin } from "@/lib/auth/exigir-admin";

/** POST: cadastra um comprador (as fundições). */
export async function POST(req: NextRequest) {
  const admin = await exigirAdmin();
  if (!admin) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const body = await req.json();
  const nome = String(body.nome || "").trim();
  if (nome.length < 2) {
    return NextResponse.json({ error: "diga o nome do comprador" }, { status: 400 });
  }

  const client = getSupabaseAdmin(admin.id);
  const { data, error } = await client
    .from("compradores")
    .insert({
      nome,
      cidade: body.cidade ? String(body.cidade).trim() : null,
      contato: body.contato ? String(body.contato).trim() : null,
      observacao: body.observacao ? String(body.observacao).trim() : null,
    })
    .select()
    .maybeSingle();

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ ok: true, comprador: data });
}
