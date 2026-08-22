import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { exigirAdmin } from "@/lib/auth/exigir-admin";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const admin = await exigirAdmin();
  if (!admin) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const { id } = await params;
  const body = await req.json();

  const updates: Record<string, unknown> = {};
  if (typeof body.nome === "string" && body.nome.trim().length >= 2) {
    updates.nome = body.nome.trim();
  }
  for (const campo of ["cidade", "contato", "observacao"] as const) {
    if (body[campo] !== undefined) {
      updates[campo] = String(body[campo] ?? "").trim() || null;
    }
  }
  if (typeof body.ativo === "boolean") updates.ativo = body.ativo;

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: "nada a atualizar" }, { status: 400 });
  }

  const client = getSupabaseAdmin(admin.id);
  const { error } = await client.from("compradores").update(updates).eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ ok: true });
}

/**
 * DELETE: só apaga comprador sem histórico. Com venda lançada, o certo é
 * desativar (PATCH ativo=false) — apagar levaria a venda junto e sumiria
 * com o histórico do estoque.
 */
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const admin = await exigirAdmin();
  if (!admin) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const { id } = await params;
  const client = getSupabaseAdmin(admin.id);

  // Checar SÓ vendas deixava passar o comprador que só tem maço de cheques
  // lançado (recebimento avulso, sem venda) — e aí estourava na FK crua do
  // Postgres, com mensagem técnica na cara do gestor (varredura 21/08).
  const [{ count: nVendas }, { count: nReceb }, { count: nCheques }] =
    await Promise.all([
      client.from("vendas").select("id", { count: "exact", head: true }).eq("comprador_id", id),
      client.from("recebimentos").select("id", { count: "exact", head: true }).eq("comprador_id", id),
      client.from("cheques").select("id", { count: "exact", head: true }).eq("comprador_id", id),
    ]);

  const total = (nVendas ?? 0) + (nReceb ?? 0) + (nCheques ?? 0);
  if (total > 0) {
    const partes = [
      nVendas ? `${nVendas} venda(s)` : null,
      nReceb ? `${nReceb} recebimento(s)` : null,
      nCheques ? `${nCheques} cheque(s)` : null,
    ].filter(Boolean);
    return NextResponse.json(
      {
        error: `esse comprador tem ${partes.join(" e ")} no sistema. Desative em vez de apagar, senão o histórico some junto.`,
      },
      { status: 409 }
    );
  }

  const { error } = await client.from("compradores").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ ok: true });
}
