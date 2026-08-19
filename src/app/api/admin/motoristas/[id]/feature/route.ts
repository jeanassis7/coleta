import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { exigirAdmin } from "@/lib/auth/exigir-admin";

/**
 * PATCH /api/admin/motoristas/:id/feature
 * Body: { feature: string, valor: boolean }
 *
 * Liga/desliga uma feature dentro de profiles.features (jsonb).
 *
 * Era dev-only enquanto o papel `dev` existia. Agora é do admin: o ciclo
 * de uma feature é ligar num motorista, acompanhar alguns dias e estender
 * pros outros — isso é trabalho de gestão, não de desenvolvimento.
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await exigirAdmin();
  if (!user) return NextResponse.json({ error: "forbidden" }, { status: 403 });

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

  const adminClient = getSupabaseAdmin(user.id);

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
