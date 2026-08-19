import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { exigirAcessoModulo1 } from "@/lib/auth/gate-modulo1";

// Módulo 1 — Estágio 1: dev-only. Promoção pro Jean é um flip em gate-modulo1.ts.
const exigirAdmin = exigirAcessoModulo1;

/**
 * PATCH: admin corrige um abastecimento lançado errado (mesmo com o
 * antiburro do app, erro humano acontece). Campos: posto_nome, litros,
 * valor, km_atual.
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
  if (typeof body.posto_nome === "string" && body.posto_nome.trim()) {
    updates.posto_nome = body.posto_nome.trim();
  }
  if (body.litros !== undefined) {
    const n = Number(body.litros);
    if (!Number.isFinite(n) || n <= 0) {
      return NextResponse.json({ error: "litros inválido" }, { status: 400 });
    }
    updates.litros = Math.round(n * 100) / 100;
  }
  if (body.valor !== undefined) {
    const n = Number(body.valor);
    if (!Number.isFinite(n) || n <= 0) {
      return NextResponse.json({ error: "valor inválido" }, { status: 400 });
    }
    updates.valor = Math.round(n * 100) / 100;
  }
  if (body.km_atual !== undefined) {
    const n = Number(body.km_atual);
    if (!Number.isFinite(n) || n <= 0) {
      return NextResponse.json({ error: "km inválido" }, { status: 400 });
    }
    updates.km_atual = Math.round(n);
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: "nada a atualizar" }, { status: 400 });
  }

  const client = getSupabaseAdmin(admin.id);
  const { error } = await client.from("abastecimentos").update(updates).eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ ok: true });
}

/**
 * DELETE: apaga o abastecimento e a foto do cupom.
 * Atenção: o saldo do motorista é calculado somando os gastos, então
 * apagar um abastecimento AUMENTA o saldo dele na mesma hora. A UI avisa.
 */
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const admin = await exigirAdmin();
  if (!admin) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const { id } = await params;
  const client = getSupabaseAdmin(admin.id);

  const { data: abast } = await client
    .from("abastecimentos")
    .select("foto_path")
    .eq("id", id)
    .maybeSingle();

  const { error } = await client.from("abastecimentos").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  if (abast?.foto_path) {
    await client.storage.from("fotos-coletas").remove([abast.foto_path]);
  }
  return NextResponse.json({ ok: true });
}
