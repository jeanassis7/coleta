import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { exigirAdmin } from "@/lib/auth/exigir-admin";

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * DELETE — desfaz uma devolução lançada errado. O saldo da conta e o do
 * motorista recalculam sozinhos (as duas funções são derivadas). Só não
 * mexe em devolução de ciclo já FECHADO: o acerto seguinte já dividiu o
 * saldo contando com ela.
 */
export async function DELETE(_req: NextRequest, { params }: RouteParams) {
  const admin = await exigirAdmin();
  if (!admin) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const { id } = await params;
  const client = getSupabaseAdmin(admin.id);

  const { data: dev, error: eDev } = await client
    .from("devolucoes_motorista")
    .select("id, motorista_id, criado_em")
    .eq("id", id)
    .maybeSingle();
  if (eDev) return NextResponse.json({ error: eDev.message }, { status: 400 });
  if (!dev) return NextResponse.json({ error: "devolução não encontrada" }, { status: 404 });

  const { data: acertoDepois } = await client
    .from("acertos")
    .select("id")
    .eq("motorista_id", dev.motorista_id)
    .gt("corte_em", dev.criado_em)
    .limit(1);
  if ((acertoDepois ?? []).length > 0) {
    return NextResponse.json(
      { error: "essa devolução já entrou num acerto fechado — desfaça o acerto primeiro" },
      { status: 409 }
    );
  }

  const { error } = await client.from("devolucoes_motorista").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ ok: true });
}
