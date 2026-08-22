import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { exigirAdmin } from "@/lib/auth/exigir-admin";

export async function POST(req: NextRequest) {
  const admin = await exigirAdmin();
  if (!admin) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const body = await req.json();
  const motorista_id = String(body.motorista_id || "");
  const valor = Number(body.valor);
  const forma_pagamento = String(body.forma_pagamento || "");
  const observacao = body.observacao ? String(body.observacao).trim() : null;
  const conta_id = body.conta_id ? String(body.conta_id) : null;

  if (!motorista_id) return NextResponse.json({ error: "motorista_id obrigatório" }, { status: 400 });
  if (!Number.isFinite(valor) || valor <= 0) {
    return NextResponse.json({ error: "valor inválido" }, { status: 400 });
  }
  if (!["dinheiro", "pix"].includes(forma_pagamento)) {
    return NextResponse.json({ error: "forma_pagamento deve ser dinheiro ou pix" }, { status: 400 });
  }
  // Esse dinheiro saiu de algum lugar. Sem dizer de onde, o adiantamento
  // apareceria do nada e o saldo da conta não bateria com a realidade.
  if (!conta_id) {
    return NextResponse.json(
      { error: "diga de qual conta saiu o dinheiro" },
      { status: 400 }
    );
  }

  // Data retroativa OPCIONAL — o caso de uso é a REGULARIZAÇÃO da largada:
  // dinheiro que foi mandado por fora do sistema (PIX/WhatsApp) antes do
  // módulo de saldo existir. Datado ANTES do corte da conta financeira, ele
  // conserta o saldo do motorista sem descontar o caixa de novo (aquele
  // dinheiro já está embutido no saldo de partida da conta). Futuro não:
  // adiantamento que ainda não aconteceu não existe.
  let data_envio: string | null = null;
  if (body.data_envio) {
    const d = String(body.data_envio).trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) {
      return NextResponse.json({ error: "data inválida" }, { status: 400 });
    }
    const hojeBr = new Date(Date.now() - 3 * 60 * 60 * 1000)
      .toISOString()
      .slice(0, 10);
    if (d > hojeBr) {
      return NextResponse.json(
        { error: "a data do envio não pode ser no futuro" },
        { status: 400 }
      );
    }
    // Meio-dia BR pra data não escorregar de dia em nenhum fuso.
    data_envio = new Date(`${d}T12:00:00-03:00`).toISOString();
  }

  const client = getSupabaseAdmin(admin.id);

  // RÉGUA DO DINHEIRO #1 — adiantamento maior que o que a conta tem
  // (varredura 21/08). Não havia teto NENHUM: R$ 50.000 no lugar de R$ 500
  // saía calado e a conta ficava negativa — o sistema tem antiburro de
  // ±30% na descarga e de 1.500 km no abastecimento, e aqui, nada.
  //
  // Retroativo (regularização da largada) fica de fora: aquele dinheiro já
  // está embutido no saldo de partida da conta, então comparar com o saldo
  // de hoje não diz nada.
  if (!data_envio) {
    const { data: saldos } = await client.rpc("saldo_contas");
    const conta = ((saldos as { conta_id: string; nome: string; saldo: number }[]) ?? []).find(
      (s) => s.conta_id === conta_id
    );
    const tem = Math.round(Number(conta?.saldo ?? 0) * 100) / 100;
    if (valor > tem + 0.009 && !body.confirmado) {
      return NextResponse.json(
        {
          error: `"${conta?.nome ?? "A conta"}" tem ${tem.toFixed(
            2
          )} e o adiantamento é de ${valor.toFixed(2)} — ficaria ${(tem - valor).toFixed(
            2
          )} negativo. Confira se o valor está certo (é fácil sobrar um zero). Se está, confirme.`,
          precisaConfirmar: true,
        },
        { status: 409 }
      );
    }
  }

  const { data, error } = await client
    .from("adiantamentos")
    .insert({
      motorista_id,
      // Centavos são válidos (coluna numeric) — arredonda só pra 2 casas
      valor: Math.round(valor * 100) / 100,
      forma_pagamento,
      conta_id,
      observacao,
      registrado_por: admin.id,
      ...(data_envio ? { data_envio } : {}),
    })
    .select()
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ ok: true, adiantamento: data });
}
