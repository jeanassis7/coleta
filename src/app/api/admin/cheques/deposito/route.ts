import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { exigirAdmin } from "@/lib/auth/exigir-admin";

/**
 * DEPÓSITO DE UM MAÇO DE CHEQUES.
 *
 * O maço se forma por DATA ("bom para"), não por comprador: num depósito vão
 * cheques de emitentes e de compradores diferentes, que é como o banco recebe.
 *
 * ⚠️ TUDO-OU-NADA. A conta pesada mora na RPC `depositar_cheques` (0071), e
 * não num laço aqui, porque o PostgREST não tem transação de vários comandos —
 * um laço podia parar no meio e deixar 8 depositados e 2 na carteira sem
 * ninguém saber. A RPC levanta exceção e o Postgres desfaz tudo.
 *
 * ⚠️ O DEPÓSITO NÃO É DINHEIRO. Ele grava a conta no cheque (pra compensação
 * não perguntar de novo), mas o caixa continua enxergando só `compensado` —
 * a view `movimentos_caixa` filtra por status. Ver o comentário grande da
 * 0071 antes de mexer nisto.
 *
 * IDEMPOTÊNCIA: não precisa de client_id. O UPDATE exige `status =
 * 'em_carteira'`; no reenvio nenhum está mais lá, a contagem não bate e a RPC
 * recusa o lote inteiro. Clique duplo não deposita duas vezes.
 */
export async function POST(req: NextRequest) {
  const admin = await exigirAdmin();
  if (!admin) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const client = getSupabaseAdmin(admin.id);
  const body = await req.json();

  const ids: string[] = Array.isArray(body.cheques) ? body.cheques.map(String) : [];
  if (ids.length === 0) {
    return NextResponse.json(
      { error: "escolha ao menos um cheque para depositar" },
      { status: 400 }
    );
  }

  const contaId = body.conta_id ? String(body.conta_id) : null;
  if (!contaId) {
    return NextResponse.json(
      { error: "diga em qual conta da empresa os cheques foram depositados" },
      { status: 400 }
    );
  }

  const hoje = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const data =
    body.data && /^\d{4}-\d{2}-\d{2}$/.test(String(body.data))
      ? String(body.data)
      : hoje;

  // Depósito no futuro é dedo errado no ano. Mesma regra do pagamento.
  if (data > hoje) {
    return NextResponse.json(
      { error: "a data do depósito está no futuro" },
      { status: 400 }
    );
  }

  const { data: quantos, error } = await client.rpc("depositar_cheques", {
    ids,
    conta: contaId,
    quando: data,
  });

  if (error) {
    // A mensagem do Postgres vai JUNTO: ela diz quantos estavam disponíveis,
    // e é a única pista de que alguém mexeu em outra aba. Erro sem motivo é
    // adivinhação (a lição do leitor de cheques, 14/09).
    return NextResponse.json({ error: error.message }, { status: 409 });
  }

  return NextResponse.json({ ok: true, depositados: Number(quantos ?? 0) });
}
