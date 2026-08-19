import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { exigirAdmin } from "@/lib/auth/exigir-admin";

/**
 * DELETE — desfaz uma transferência lançada errado.
 *
 * Pode apagar sem medo: transferência não tem nada pendurado nela. Os dois
 * saldos voltam sozinhos, porque o saldo é calculado, não guardado.
 */
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const admin = await exigirAdmin();
  if (!admin) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const { id } = await params;

  const client = getSupabaseAdmin(admin.id);
  const { error } = await client.from("transferencias").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ ok: true });
}
