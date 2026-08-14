import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { exigirAcessoModulo1 } from "@/lib/auth/gate-modulo1";

// Módulo 1 — Estágio 1: dev-only. Promoção pro Jean é um flip em gate-modulo1.ts.
const exigirAdmin = exigirAcessoModulo1;

/** PATCH: corrige uma compra direta lançada errado. */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const admin = await exigirAdmin();
  if (!admin) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const { id } = await params;
  const body = await req.json();

  const updates: Record<string, unknown> = {};
  if (typeof body.data === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.data)) {
    updates.data = body.data;
  }
  if (typeof body.fornecedor === "string" && body.fornecedor.trim().length >= 2) {
    updates.fornecedor = body.fornecedor.trim();
  }
  if (body.valor !== undefined) {
    const n = Number(body.valor);
    if (!Number.isFinite(n) || n <= 0) {
      return NextResponse.json({ error: "valor inválido" }, { status: 400 });
    }
    updates.valor = Math.round(n * 100) / 100;
  }
  if (body.quantidade !== undefined) {
    const n = Number(body.quantidade);
    if (!Number.isFinite(n) || n <= 0) {
      return NextResponse.json({ error: "quantidade inválida" }, { status: 400 });
    }
    updates.quantidade = Math.round(n * 100) / 100;
  }
  if (body.unidade !== undefined) {
    if (!["kg", "litros"].includes(body.unidade)) {
      return NextResponse.json({ error: "unidade inválida" }, { status: 400 });
    }
    updates.unidade = body.unidade;
  }
  if (body.tipo_oleo !== undefined) {
    if (!["fino", "grosso"].includes(body.tipo_oleo)) {
      return NextResponse.json({ error: "tipo de óleo inválido" }, { status: 400 });
    }
    updates.tipo_oleo = body.tipo_oleo;
  }
  if (typeof body.entra_no_estoque === "boolean") {
    updates.entra_no_estoque = body.entra_no_estoque;
  }
  if (body.observacao !== undefined) {
    updates.observacao = body.observacao?.trim() || null;
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: "nada a atualizar" }, { status: 400 });
  }

  const client = getSupabaseAdmin();
  const { error } = await client.from("compras_diretas").update(updates).eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ ok: true });
}

/** DELETE: apaga a compra e a foto do comprovante. */
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const admin = await exigirAdmin();
  if (!admin) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const { id } = await params;
  const client = getSupabaseAdmin();

  const { data: compra } = await client
    .from("compras_diretas")
    .select("foto_path")
    .eq("id", id)
    .maybeSingle();

  const { error } = await client.from("compras_diretas").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  if (compra?.foto_path) {
    await client.storage.from("fotos-coletas").remove([compra.foto_path]);
  }
  return NextResponse.json({ ok: true });
}
