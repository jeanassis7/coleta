import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { exigirAdmin } from "@/lib/auth/exigir-admin";

/**
 * PUT: define QUAIS caminhões o motorista pode dirigir (0046).
 *
 * Recebe a lista completa de caminhao_ids e substitui a atual (apaga e
 * regrava — é uma lista pequena e a semântica de "o que está marcado é o
 * que vale" é a mais simples de acertar).
 *
 * Lista VAZIA = pode todos os caminhões ativos (comportamento de sempre; a
 * restrição é opt-in).
 */
export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const admin = await exigirAdmin();
  if (!admin) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const { id } = await params;

  const body = await req.json();
  const caminhaoIds: string[] = Array.isArray(body.caminhao_ids)
    ? body.caminhao_ids.map(String)
    : [];

  const client = getSupabaseAdmin(admin.id);

  const { error: eDel } = await client
    .from("motorista_caminhoes")
    .delete()
    .eq("motorista_id", id);
  if (eDel) return NextResponse.json({ error: eDel.message }, { status: 400 });

  if (caminhaoIds.length > 0) {
    const { error: eIns } = await client.from("motorista_caminhoes").insert(
      caminhaoIds.map((caminhao_id) => ({ motorista_id: id, caminhao_id }))
    );
    if (eIns) return NextResponse.json({ error: eIns.message }, { status: 400 });
  }

  return NextResponse.json({ ok: true, total: caminhaoIds.length });
}
