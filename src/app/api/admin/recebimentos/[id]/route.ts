import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { exigirAdmin } from "@/lib/auth/exigir-admin";

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * DELETE — apagar um recebimento lançado errado.
 *
 * Tudo é derivado, então apagar desfaz sozinho: a dívida do comprador volta
 * (`saldo_compradores()`) e o dinheiro sai do saldo da conta que o recebeu
 * (`saldo_contas()`). Não existe editar recebimento de propósito — apagar e
 * relançar certo é um caminho só, sem estado pela metade.
 *
 * Cheque: o recebimento é 1:1 com o papel (FK on delete cascade). Só dá pra
 * apagar enquanto o cheque ainda é SÓ papel (em carteira ou depositado).
 * Compensado o dinheiro já entrou numa conta, e repassado ele já pagou uma
 * despesa — apagar por aqui reescreveria o caixa por baixo dos panos.
 */
export async function DELETE(_req: NextRequest, { params }: RouteParams) {
  const admin = await exigirAdmin();
  if (!admin) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const { id } = await params;

  const client = getSupabaseAdmin(admin.id);

  const { data: rec, error: eRec } = await client
    .from("recebimentos")
    .select("id, forma, valor")
    .eq("id", id)
    .maybeSingle();
  if (eRec) return NextResponse.json({ error: eRec.message }, { status: 400 });
  if (!rec) return NextResponse.json({ error: "recebimento não encontrado" }, { status: 404 });

  if (rec.forma === "cheque") {
    const { data: cheque, error: eCh } = await client
      .from("cheques")
      .select("id, status")
      .eq("recebimento_id", id)
      .maybeSingle();
    if (eCh) return NextResponse.json({ error: eCh.message }, { status: 400 });

    if (cheque && !["em_carteira", "depositado"].includes(cheque.status)) {
      const motivo =
        cheque.status === "compensado"
          ? "esse cheque já COMPENSOU — o dinheiro entrou numa conta, e apagar reescreveria o caixa"
          : cheque.status === "repassado"
            ? "esse cheque foi REPASSADO — ele pagou uma conta; apague o pagamento primeiro (o cheque volta pra carteira) e aí sim"
            : "esse cheque VOLTOU — ele já não conta no saldo, e apagar sumiria com o histórico da devolução";
      return NextResponse.json({ error: motivo }, { status: 409 });
    }
  }

  const { error: eDel } = await client.from("recebimentos").delete().eq("id", id);
  if (eDel) return NextResponse.json({ error: eDel.message }, { status: 400 });

  const avisos =
    rec.forma === "cheque"
      ? ["a dívida do comprador voltou e o cheque saiu da carteira"]
      : [
          "a dívida do comprador voltou e o valor saiu do saldo da conta que o tinha recebido",
        ];
  return NextResponse.json({ ok: true, avisos });
}
