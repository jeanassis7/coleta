import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { exigirAdmin } from "@/lib/auth/exigir-admin";

/**
 * Umidade da descarga — TRÊS estados, não dois (ver migration 0057):
 *
 *   umidade_pct = 7.5            → analisada, com número
 *   umidade_nao_analisada = true → a análise não foi feita (decisão registrada)
 *   os dois vazios               → ainda não se sabe (o alerta cobra)
 *
 * Os dois campos são mutuamente exclusivos e o banco tem CHECK pra isso.
 * Por isso cada caminho aqui grava OS DOIS: mandar só um deixaria a linha
 * batendo no constraint e o gestor levaria um erro sem entender por quê.
 */
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
      // "Apagar umidade" volta pra pendente — some o número E a marca.
      updates.umidade_pct = null;
      updates.umidade_nao_analisada = false;
    } else {
      const n = Number(body.umidade_pct);
      if (!Number.isFinite(n) || n < 0 || n > 100) {
        return NextResponse.json({ error: "umidade deve estar entre 0 e 100" }, { status: 400 });
      }
      updates.umidade_pct = n;
      // Lançou número: a análise foi feita, então a marca cai sozinha.
      updates.umidade_nao_analisada = false;
    }
  }

  if (body.umidade_nao_analisada !== undefined) {
    const marcar = body.umidade_nao_analisada === true;
    if (marcar && updates.umidade_pct != null) {
      return NextResponse.json(
        { error: "não dá pra marcar como não analisada e mandar um número junto" },
        { status: 400 }
      );
    }
    updates.umidade_nao_analisada = marcar;
    if (marcar) updates.umidade_pct = null;
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: "nada a atualizar" }, { status: 400 });
  }
  const client = getSupabaseAdmin(admin.id);
  const { error } = await client.from("descargas").update(updates).eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ ok: true });
}
