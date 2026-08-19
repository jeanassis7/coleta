import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { exigirAdmin } from "@/lib/auth/exigir-admin";

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
  const client = getSupabaseAdmin(admin.id);
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
