import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { exigirAdmin } from "@/lib/auth/exigir-admin";
const n2 = (v: number) => Math.round(v * 100) / 100;

/**
 * PATCH: corrige os campos SIMPLES de uma venda — data, comprador, preço,
 * número da nota, observação.
 *
 * Peso e mistura ficam DE FORA de propósito: mexem no estoque
 * retroativamente (a saída muda de tamanho no meio do custo médio móvel).
 * Errou o peso, o caminho honesto é apagar e relançar.
 *
 * Preço pode: o estoque sai por custo médio, não pelo preço de venda — o
 * preço só muda o valor_total, e a conta corrente do comprador recalcula
 * sozinha.
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const admin = await exigirAdmin();
  if (!admin) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const { id } = await params;
  const body = await req.json();
  const client = getSupabaseAdmin(admin.id);

  const { data: venda, error: eVenda } = await client
    .from("vendas")
    .select("id, comprador_id, peso_total_kg")
    .eq("id", id)
    .maybeSingle();
  if (eVenda) return NextResponse.json({ error: eVenda.message }, { status: 400 });
  if (!venda) return NextResponse.json({ error: "venda não encontrada" }, { status: 404 });

  const updates: Record<string, unknown> = {};

  if (body.data !== undefined) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(body.data))) {
      return NextResponse.json({ error: "data inválida" }, { status: 400 });
    }
    updates.data = body.data;
  }

  if (body.preco_kg !== undefined) {
    const preco = Number(body.preco_kg);
    if (!Number.isFinite(preco) || preco <= 0) {
      return NextResponse.json({ error: "preço inválido" }, { status: 400 });
    }
    updates.preco_kg = Math.round(preco * 10000) / 10000;
    updates.valor_total = n2(Number(venda.peso_total_kg) * preco);
  }

  if (body.comprador_id !== undefined) {
    const novo = String(body.comprador_id || "");
    if (!novo) {
      return NextResponse.json({ error: "comprador não informado" }, { status: 400 });
    }
    if (novo !== venda.comprador_id) {
      // Recebimento vinculado é do comprador ANTIGO — mudar a venda de dono
      // deixaria o pagamento de um apontando pra venda de outro, e os dois
      // saldos errados. Sem vínculo, a troca é limpa: o saldo dos dois
      // compradores recalcula sozinho.
      const { count } = await client
        .from("recebimentos")
        .select("id", { count: "exact", head: true })
        .eq("venda_id", id);
      if ((count ?? 0) > 0) {
        return NextResponse.json(
          {
            error:
              "essa venda tem pagamento vinculado a ela — apague o pagamento primeiro (na ficha do comprador) pra poder trocar o comprador",
          },
          { status: 409 }
        );
      }
      updates.comprador_id = novo;
    }
  }

  if (body.nota_numero !== undefined) {
    updates.nota_numero = body.nota_numero ? String(body.nota_numero).trim() : null;
  }
  if (body.observacao !== undefined) {
    updates.observacao = body.observacao ? String(body.observacao).trim() : null;
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: "nada a atualizar" }, { status: 400 });
  }

  const { error } = await client.from("vendas").update(updates).eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ ok: true });
}

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

  // Se já tem pagamento vinculado, o comprador vai ficar com CRÉDITO no
  // saldo (pagou por uma venda que deixou de existir). Não é bloqueio — é
  // aviso: o crédito precisa virar alguma coisa (outra venda, devolução).
  const { count: nRec } = await client
    .from("recebimentos")
    .select("id", { count: "exact", head: true })
    .eq("venda_id", id);

  const { error } = await client.from("vendas").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  if (venda?.foto_ticket_path) {
    await client.storage.from("fotos-coletas").remove([venda.foto_ticket_path]);
  }
  return NextResponse.json({
    ok: true,
    ...((nRec ?? 0) > 0
      ? {
          aviso:
            "essa venda já tinha pagamento: o dinheiro continua valendo e o comprador fica com CRÉDITO no saldo — abata numa próxima venda ou apague o pagamento na ficha dele",
        }
      : {}),
  });
}
