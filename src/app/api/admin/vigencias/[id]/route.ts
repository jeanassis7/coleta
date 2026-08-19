import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { exigirAdmin } from "@/lib/auth/exigir-admin";

/**
 * DELETE — apaga uma vigência lançada errada.
 *
 * Pode apagar sem medo: nada fica pendurado nela. O que já foi PAGO é um
 * lançamento próprio e não se mexe — a vigência só serve pra calcular
 * quanto se deve daqui pra frente.
 */
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const admin = await exigirAdmin();
  if (!admin) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const { id } = await params;

  const client = getSupabaseAdmin(admin.id);
  const { error } = await client
    .from("vigencias_remuneracao")
    .delete()
    .eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ ok: true });
}
