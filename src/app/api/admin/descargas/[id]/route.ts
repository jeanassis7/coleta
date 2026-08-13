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

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const admin = await exigirAdmin();
  if (!admin) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const { id } = await params;
  const body = await req.json();
  const updates: Record<string, unknown> = {};
  if (body.umidade_pct !== undefined) {
    if (body.umidade_pct === null) {
      updates.umidade_pct = null;
    } else {
      const n = Number(body.umidade_pct);
      if (!Number.isFinite(n) || n < 0 || n > 100) {
        return NextResponse.json({ error: "umidade deve estar entre 0 e 100" }, { status: 400 });
      }
      updates.umidade_pct = n;
    }
  }
  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: "nada a atualizar" }, { status: 400 });
  }
  const client = getSupabaseAdmin();
  const { error } = await client.from("descargas").update(updates).eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ ok: true });
}
