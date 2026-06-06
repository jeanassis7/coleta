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

const CAMPOS_EDITAVEIS = [
  "litros",
  "local_nome",
  "valor_pago",
  "certificado_tipo",
  "litros_certificado",
  "observacao",
] as const;

type CampoEditavel = (typeof CAMPOS_EDITAVEIS)[number];

export async function PATCH(req: NextRequest, { params }: RouteParams) {
  const admin = await exigirAdmin();
  if (!admin) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const { id } = await params;

  const body = (await req.json()) as Partial<Record<CampoEditavel, unknown>>;

  // Valida e monta updates
  const updates: Record<string, unknown> = {};

  if (typeof body.litros === "number" && body.litros > 0) {
    updates.litros = body.litros;
  }
  if (typeof body.local_nome === "string" && body.local_nome.trim()) {
    updates.local_nome = body.local_nome.trim();
  }
  if (typeof body.valor_pago === "number" && body.valor_pago > 0) {
    updates.valor_pago = Math.round(body.valor_pago);
  }
  if (
    typeof body.certificado_tipo === "string" &&
    ["integral", "parcial", "nao"].includes(body.certificado_tipo)
  ) {
    updates.certificado_tipo = body.certificado_tipo;
  }
  if (body.litros_certificado === null) {
    updates.litros_certificado = null;
  } else if (
    typeof body.litros_certificado === "number" &&
    body.litros_certificado > 0
  ) {
    updates.litros_certificado = body.litros_certificado;
  }
  if (body.observacao === null) {
    updates.observacao = null;
  } else if (typeof body.observacao === "string") {
    const trimmed = body.observacao.trim();
    updates.observacao = trimmed || null;
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: "nada a atualizar" }, { status: 400 });
  }

  const adminClient = getSupabaseAdmin();
  const { error } = await adminClient
    .from("coletas")
    .update(updates)
    .eq("id", id);

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ ok: true });
}
