import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServer } from "@/lib/supabase/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

async function exigirAdmin() {
  const supabase = await getSupabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  const { data: profile } = await supabase
    .from("profiles")
    .select("role, ativo")
    .eq("id", user.id)
    .maybeSingle();
  if (!profile || profile.role !== "admin" || !profile.ativo) return null;
  return user;
}

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function PATCH(req: NextRequest, { params }: RouteParams) {
  const admin = await exigirAdmin();
  if (!admin) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const { id } = await params;

  const body = await req.json();
  const updates: Record<string, unknown> = { atualizado_em: new Date().toISOString() };

  if (typeof body.nome_canonico === "string" && body.nome_canonico.trim()) {
    updates.nome_canonico = body.nome_canonico.trim();
  }
  if (typeof body.latitude === "number") updates.latitude = body.latitude;
  if (typeof body.longitude === "number") updates.longitude = body.longitude;
  if (typeof body.raio_match_m === "number") {
    if (body.raio_match_m < 10 || body.raio_match_m > 5000) {
      return NextResponse.json({ error: "raio_match_m fora do intervalo" }, { status: 400 });
    }
    updates.raio_match_m = Math.round(body.raio_match_m);
  }
  if (typeof body.ativo === "boolean") updates.ativo = body.ativo;
  if (Array.isArray(body.apelidos)) {
    updates.apelidos = body.apelidos.map((a: unknown) => String(a).trim()).filter(Boolean);
  }
  if (body.notas_internas === null) updates.notas_internas = null;
  else if (typeof body.notas_internas === "string") {
    updates.notas_internas = body.notas_internas.trim() || null;
  }

  const adminClient = getSupabaseAdmin();
  const { error } = await adminClient.from("locais").update(updates).eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ ok: true });
}

/**
 * POST /api/admin/locais/[id]/vincular — vincula coletas existentes a esse local
 * Body: { coleta_ids: string[] }
 */
export async function POST(req: NextRequest, { params }: RouteParams) {
  const admin = await exigirAdmin();
  if (!admin) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const { id } = await params;

  const body = await req.json();
  if (!Array.isArray(body.coleta_ids) || body.coleta_ids.length === 0) {
    return NextResponse.json({ error: "coleta_ids obrigatório" }, { status: 400 });
  }

  const ids = body.coleta_ids.map((x: unknown) => String(x));
  const adminClient = getSupabaseAdmin();

  const { error } = await adminClient
    .from("coletas")
    .update({ local_id: id })
    .in("id", ids);

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ ok: true, vinculadas: ids.length });
}

export async function DELETE(_req: NextRequest, { params }: RouteParams) {
  const admin = await exigirAdmin();
  if (!admin) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const { id } = await params;

  const adminClient = getSupabaseAdmin();

  // Desvincula coletas (mantém histórico, só limpa o link)
  await adminClient.from("coletas").update({ local_id: null }).eq("local_id", id);

  // Deleta o local
  const { error } = await adminClient.from("locais").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ ok: true });
}
