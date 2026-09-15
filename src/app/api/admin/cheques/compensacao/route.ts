import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { exigirAdmin } from "@/lib/auth/exigir-admin";

/**
 * COMPENSAÇÃO DE UM MAÇO DE CHEQUES.
 *
 * ⚠️ AQUI O DINHEIRO ENTRA NO CAIXA (R70). É a única porta — depositar não
 * move nada. Por isso este endpoint é o que mais merece desconfiança dos dois.
 *
 * O maço é o mesmo do depósito (mesma conta + mesma data), porque é assim que
 * o extrato do banco mostra: o gestor abre o extrato, vê o que caiu naquele
 * dia naquele banco, e tica.
 *
 * A CONTA NÃO SE DIGITA DE NOVO: vem gravada no cheque desde o depósito
 * (0071). `conta_id` no corpo só é necessário pra cheque depositado ANTES da
 * 0071 (conta nula) ou pra corrigir — e nesse caso ele vence, porque quem
 * está olhando o extrato agora sabe mais do que quem digitou no depósito.
 *
 * TUDO-OU-NADA na RPC `compensar_cheques`: ou o maço inteiro vira dinheiro, ou
 * nada vira. Um lote meio-aplicado deixaria o saldo do app diferente do saldo
 * do banco sem nenhum sinal — exatamente o erro que só se descobre meses
 * depois.
 *
 * IDEMPOTÊNCIA: o UPDATE exige `status = 'depositado'`. Reenvio não casa,
 * a contagem não bate, o lote é recusado inteiro.
 */
export async function POST(req: NextRequest) {
  const admin = await exigirAdmin();
  if (!admin) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const client = getSupabaseAdmin(admin.id);
  const body = await req.json();

  const ids: string[] = Array.isArray(body.cheques) ? body.cheques.map(String) : [];
  if (ids.length === 0) {
    return NextResponse.json({ error: "escolha ao menos um cheque" }, { status: 400 });
  }

  const hoje = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const data =
    body.data && /^\d{4}-\d{2}-\d{2}$/.test(String(body.data))
      ? String(body.data)
      : hoje;

  // Dinheiro entrando com data no futuro inflaria o saldo de hoje por algo
  // que ainda não aconteceu.
  if (data > hoje) {
    return NextResponse.json(
      { error: "a data da compensação está no futuro" },
      { status: 400 }
    );
  }

  const contaId = body.conta_id ? String(body.conta_id) : null;

  const { data: quantos, error } = await client.rpc("compensar_cheques", {
    ids,
    quando: data,
    conta: contaId,
  });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 409 });
  }

  return NextResponse.json({ ok: true, compensados: Number(quantos ?? 0) });
}
