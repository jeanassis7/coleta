import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServer } from "@/lib/supabase/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { isDev } from "@/lib/auth/roles";

/**
 * PATCH /api/admin/motoristas/:id/feature
 * Body: { feature: string, valor: boolean }
 *
 * Liga/desliga uma feature dentro de profiles.features (jsonb).
 * SÓ dev pode chamar (features em teste ficam invisíveis pro admin
 * até serem "promovidas" — se admin quiser ligar, será via toggle
 * dedicado na tela de motoristas, não aqui).
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const supabase = await getSupabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "não autenticado" }, { status: 401 });

  const { data: profile } = await supabase
    .from("profiles")
    .select("role, ativo")
    .eq("id", user.id)
    .maybeSingle();

  if (!isDev(profile) || !profile?.ativo) {
    return NextResponse.json(
      { error: "apenas dev pode alterar features" },
      { status: 403 }
    );
  }

  const { id } = await params;
  const body = await req.json();
  const feature = String(body.feature || "");
  const valor = !!body.valor;

  if (!feature || !/^[a-z_]+$/.test(feature)) {
    return NextResponse.json(
      { error: "feature inválida (só a-z e _)" },
      { status: 400 }
    );
  }

  const adminClient = getSupabaseAdmin();

  // Lê features atuais, merge, salva
  const { data: atual, error: errRead } = await adminClient
    .from("profiles")
    .select("features")
    .eq("id", id)
    .maybeSingle();
  if (errRead) return NextResponse.json({ error: errRead.message }, { status: 400 });
  if (!atual) return NextResponse.json({ error: "motorista não encontrado" }, { status: 404 });

  const features = { ...(atual.features || {}), [feature]: valor };

  const updates: Record<string, unknown> = { features };
  // A feature "saldo" controla a experiência de adiantamento inteira do
  // motorista: a tela de aceite (gated por features.saldo) E o card
  // "Seu dinheiro" (gated por mostra_saldo_app). O toggle do painel dev
  // liga/desliga os dois juntos pra não ter estado pela metade.
  if (feature === "saldo") {
    updates.mostra_saldo_app = valor;
  }

  const { error: errWrite } = await adminClient
    .from("profiles")
    .update(updates)
    .eq("id", id);
  if (errWrite) return NextResponse.json({ error: errWrite.message }, { status: 400 });

  return NextResponse.json({ ok: true, features });
}
