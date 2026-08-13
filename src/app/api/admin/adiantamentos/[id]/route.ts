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

/**
 * DELETE cancela adiantamento pendente. Atômico: só cancela se ainda pendente.
 * Se motorista aceitou entre load e clique, retorna 409.
 */
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const admin = await exigirAdmin();
  if (!admin) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const { id } = await params;
  const client = getSupabaseAdmin();
  const { data, error } = await client
    .from("adiantamentos")
    .update({ status: "cancelado" })
    .eq("id", id)
    .eq("status", "pendente")
    .select()
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  if (!data) {
    return NextResponse.json(
      { error: "Motorista já aceitou esse adiantamento. Se quer reverter, faz ajuste manual no próximo acerto." },
      { status: 409 }
    );
  }
  return NextResponse.json({ ok: true });
}
