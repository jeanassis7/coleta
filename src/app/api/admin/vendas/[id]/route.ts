import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { exigirAcessoModulo1 } from "@/lib/auth/gate-modulo1";

const exigirAdmin = exigirAcessoModulo1;

/**
 * DELETE: apaga a venda lançada errado.
 *
 * Os recebimentos ficam (o `venda_id` vira null pela FK on delete set null):
 * o dinheiro entrou de verdade e continua valendo na conta do comprador.
 * Apagar o pagamento junto faria o cliente "voltar a dever" algo que já
 * pagou. Os cheques também ficam — o papel existe.
 */
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const admin = await exigirAdmin();
  if (!admin) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const { id } = await params;
  const client = getSupabaseAdmin(admin.id);

  const { data: venda } = await client
    .from("vendas")
    .select("foto_ticket_path")
    .eq("id", id)
    .maybeSingle();

  const { error } = await client.from("vendas").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  if (venda?.foto_ticket_path) {
    await client.storage.from("fotos-coletas").remove([venda.foto_ticket_path]);
  }
  return NextResponse.json({ ok: true });
}
