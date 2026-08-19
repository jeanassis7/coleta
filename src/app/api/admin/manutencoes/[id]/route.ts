import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { exigirAdmin } from "@/lib/auth/exigir-admin";

interface RouteParams {
  params: Promise<{ id: string }>;
}

/** PATCH: corrige um lançamento de manutenção. */
export async function PATCH(req: NextRequest, { params }: RouteParams) {
  const admin = await exigirAdmin();
  if (!admin) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const { id } = await params;

  const body = await req.json();
  const updates: Record<string, unknown> = {};

  if (typeof body.descricao === "string" && body.descricao.trim()) {
    updates.descricao = body.descricao.trim();
  }
  if (body.valor != null) {
    const v = Number(body.valor);
    if (!Number.isFinite(v) || v <= 0) {
      return NextResponse.json({ error: "valor inválido" }, { status: 400 });
    }
    updates.valor = Math.round(v * 100) / 100;
  }
  if (body.data != null) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(body.data))) {
      return NextResponse.json({ error: "data inválida" }, { status: 400 });
    }
    updates.data = body.data;
  }
  if (body.km !== undefined) {
    updates.km = body.km === "" || body.km == null ? null : Number(body.km);
  }
  if (body.proxima_km !== undefined) {
    updates.proxima_km =
      body.proxima_km === "" || body.proxima_km == null
        ? null
        : Number(body.proxima_km);
  }
  if (body.fornecedor !== undefined) {
    updates.fornecedor = body.fornecedor
      ? String(body.fornecedor).trim()
      : null;
  }
  if (body.observacao !== undefined) {
    updates.observacao = body.observacao
      ? String(body.observacao).trim()
      : null;
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: "nada a atualizar" }, { status: 400 });
  }

  const client = getSupabaseAdmin(admin.id);
  const { error } = await client
    .from("manutencoes")
    .update(updates)
    .eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ ok: true });
}

/**
 * DELETE: apaga o lançamento.
 *
 * A conta a pagar gerada por ele NÃO é apagada junto de propósito: se já foi
 * paga, apagar reescreveria o caixa. Quem quiser desfazer as duas coisas
 * apaga a conta na tela dela, onde vê o status antes.
 */
export async function DELETE(_req: NextRequest, { params }: RouteParams) {
  const admin = await exigirAdmin();
  if (!admin) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const { id } = await params;

  const client = getSupabaseAdmin(admin.id);
  const { count } = await client
    .from("contas_a_pagar")
    .select("id", { count: "exact", head: true })
    .eq("origem_tipo", "manutencao")
    .eq("origem_id", id);

  const { error } = await client.from("manutencoes").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  return NextResponse.json({
    ok: true,
    aviso:
      (count ?? 0) > 0
        ? "A conta a pagar dessa manutenção continua lá — apague por Contas a pagar se for o caso."
        : null,
  });
}
