import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { exigirAdmin } from "@/lib/auth/exigir-admin";

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function PATCH(req: NextRequest, { params }: RouteParams) {
  const admin = await exigirAdmin();
  if (!admin) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const { id } = await params;
  const body = await req.json();

  const updates: Record<string, unknown> = {};
  if (typeof body.placa === "string" && body.placa.trim()) {
    const placa = body.placa.trim().toUpperCase();
    if (!/^[A-Z]{3}-?\d[A-Z0-9]\d{2}$/.test(placa)) {
      return NextResponse.json({ error: "placa em formato inválido" }, { status: 400 });
    }
    updates.placa = placa;
  }
  if (typeof body.marca === "string" && body.marca.trim()) updates.marca = body.marca.trim();
  if (body.modelo !== undefined) updates.modelo = body.modelo?.trim() || null;
  if (typeof body.cor === "string" && body.cor.trim()) updates.cor = body.cor.trim();
  if (body.capacidade_l !== undefined) {
    const n = Number(body.capacidade_l);
    if (!Number.isFinite(n) || n <= 0) {
      return NextResponse.json({ error: "capacidade inválida" }, { status: 400 });
    }
    updates.capacidade_l = Math.round(n);
  }
  if (body.tara_kg !== undefined) {
    const n = Number(body.tara_kg);
    if (!Number.isFinite(n) || n <= 0) {
      return NextResponse.json({ error: "tara inválida" }, { status: 400 });
    }
    updates.tara_kg = Math.round(n);
  }
  if (typeof body.ativo === "boolean") {
    updates.ativo = body.ativo;
    if (!body.ativo) {
      updates.motivo_inativo = body.motivo_inativo?.trim() || null;
    } else {
      updates.motivo_inativo = null;
    }
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: "nada a atualizar" }, { status: 400 });
  }

  const client = getSupabaseAdmin(admin.id);
  const { error } = await client.from("caminhoes").update(updates).eq("id", id);
  if (error) {
    if (error.code === "23505") {
      return NextResponse.json({ error: "placa já cadastrada" }, { status: 400 });
    }
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
  return NextResponse.json({ ok: true });
}

export async function DELETE(_req: NextRequest, { params }: RouteParams) {
  const admin = await exigirAdmin();
  if (!admin) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const { id } = await params;
  const client = getSupabaseAdmin(admin.id);

  // Bloqueia delete se caminhão tem cargas — precisa inativar em vez disso
  const { count } = await client
    .from("cargas")
    .select("id", { count: "exact", head: true })
    .eq("caminhao_id", id);
  if ((count ?? 0) > 0) {
    return NextResponse.json(
      { error: `esse caminhão tem ${count} carga(s). Desative em vez de deletar.` },
      { status: 409 }
    );
  }

  const { error } = await client.from("caminhoes").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ ok: true });
}
