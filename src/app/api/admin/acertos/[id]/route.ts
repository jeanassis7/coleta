import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { exigirAdmin } from "@/lib/auth/exigir-admin";

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * DELETE — desfazer o ÚLTIMO acerto de um motorista.
 *
 * O acerto é um corte: tudo antes dele sai da conta do saldo. Desfazer o
 * último devolve o ciclo pro estado anterior — as coletas/despesas que ele
 * fechou voltam a contar, o devolvido sai do caixa (a `saldo_contas()` é
 * derivada, recalcula sozinha) e o carry volta a ser o do acerto anterior.
 *
 * Só o ÚLTIMO: desfazer um acerto do meio deixaria os posteriores contando
 * um período que eles não dividiram — número sem dono. Errou dois acertos
 * atrás? Desfaz um por um, do mais novo pro mais velho.
 */
export async function DELETE(_req: NextRequest, { params }: RouteParams) {
  const admin = await exigirAdmin();
  if (!admin) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const { id } = await params;

  const client = getSupabaseAdmin(admin.id);

  const { data: acerto, error: eBusca } = await client
    .from("acertos")
    .select("id, motorista_id, corte_em, valor_devolvido, valor_vale, valor_saldo, vale_quitado_em")
    .eq("id", id)
    .maybeSingle();
  if (eBusca) return NextResponse.json({ error: eBusca.message }, { status: 400 });
  if (!acerto) return NextResponse.json({ error: "acerto não encontrado" }, { status: 404 });

  // Só o mais recente do motorista.
  const { data: maisNovo, error: eNovo } = await client
    .from("acertos")
    .select("id")
    .eq("motorista_id", acerto.motorista_id)
    .gt("corte_em", acerto.corte_em)
    .limit(1);
  if (eNovo) return NextResponse.json({ error: eNovo.message }, { status: 400 });
  if ((maisNovo ?? []).length > 0) {
    return NextResponse.json(
      {
        error:
          "esse não é o último acerto do motorista — só o mais recente pode ser desfeito (desfazendo um do meio, os acertos seguintes ficariam contando um período que não dividiram)",
      },
      { status: 409 }
    );
  }

  // Vale já descontado num pagamento de salário: desfazer o acerto deixaria
  // o pagamento apontando pra um vale que não existe. Primeiro se apaga o
  // pagamento (em Lançamentos) — que devolve o vale pra pendente — e aí sim.
  if (acerto.vale_quitado_em) {
    return NextResponse.json(
      {
        error:
          "o vale desse acerto já foi descontado num pagamento de salário — apague o pagamento primeiro (em Lançamentos) e tente de novo",
      },
      { status: 409 }
    );
  }

  const { error: eDel } = await client.from("acertos").delete().eq("id", id);
  if (eDel) return NextResponse.json({ error: eDel.message }, { status: 400 });

  const devolvido = Number(acerto.valor_devolvido) || 0;
  const avisos: string[] = [];
  if (devolvido > 0) {
    avisos.push(
      `os R$ ${devolvido.toFixed(2).replace(".", ",")} devolvidos saíram do saldo da conta que os recebeu`
    );
  } else if (devolvido < 0) {
    avisos.push(
      `os R$ ${Math.abs(devolvido).toFixed(2).replace(".", ",")} pagos ao motorista voltaram pro saldo da conta`
    );
  }
  avisos.push(
    "o ciclo reabriu: os lançamentos que esse acerto fechou voltaram a contar no saldo do motorista"
  );

  return NextResponse.json({ ok: true, avisos });
}
