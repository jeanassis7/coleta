import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { exigirAcessoModulo1 } from "@/lib/auth/gate-modulo1";

// Módulo 1 — Estágio 1: dev-only. Promoção pro Jean é um flip em gate-modulo1.ts.
const exigirAdmin = exigirAcessoModulo1;

/** PATCH: corrige valor/descrição de uma despesa lançada errado. */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const admin = await exigirAdmin();
  if (!admin) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const { id } = await params;
  const body = await req.json();

  const updates: Record<string, unknown> = {};
  if (typeof body.descricao === "string" && body.descricao.trim()) {
    updates.descricao = body.descricao.trim();
  }
  if (body.valor !== undefined) {
    const n = Number(body.valor);
    if (!Number.isFinite(n) || n <= 0) {
      return NextResponse.json({ error: "valor inválido" }, { status: 400 });
    }
    updates.valor = Math.round(n * 100) / 100;
  }
  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: "nada a atualizar" }, { status: 400 });
  }

  const client = getSupabaseAdmin(admin.id);
  const { error } = await client.from("despesas").update(updates).eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ ok: true });
}

/**
 * DELETE: apaga a despesa e a foto do storage.
 * Atenção: o saldo do motorista é calculado somando os gastos, então
 * apagar uma despesa AUMENTA o saldo dele na mesma hora. A UI avisa.
 */
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const admin = await exigirAdmin();
  if (!admin) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const { id } = await params;
  const client = getSupabaseAdmin(admin.id);

  const { data: despesa } = await client
    .from("despesas")
    .select("foto_path")
    .eq("id", id)
    .maybeSingle();

  const { error } = await client.from("despesas").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  if (despesa?.foto_path) {
    await client.storage.from("fotos-coletas").remove([despesa.foto_path]);
  }
  return NextResponse.json({ ok: true });
}
