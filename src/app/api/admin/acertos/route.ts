import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { exigirAdmin } from "@/lib/auth/exigir-admin";

export async function POST(req: NextRequest) {
  const admin = await exigirAdmin();
  if (!admin) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const body = await req.json();
  const motorista_id = String(body.motorista_id || "");
  // Centavos são válidos (colunas numeric) — arredonda só pra 2 casas
  const aCentavos = (x: unknown) => Math.round((Number(x) || 0) * 100) / 100;
  const valor_devolvido = aCentavos(body.valor_devolvido);
  const valor_vale = aCentavos(body.valor_vale);
  const valor_saldo = aCentavos(body.valor_saldo);
  const observacao = body.observacao ? String(body.observacao).trim() : null;
  const conta_id = body.conta_id ? String(body.conta_id) : null;

  if (!motorista_id) return NextResponse.json({ error: "motorista_id obrigatório" }, { status: 400 });
  // Conta é exigida sempre que dinheiro se move, NOS DOIS SENTIDOS:
  // devolvido > 0 = entrou na conta; devolvido < 0 = a empresa pagou o
  // motorista agora e o dinheiro SAIU de uma conta. Descartar a conta no
  // negativo fazia o caixa ficar maior que a gaveta, em silêncio.
  if (valor_devolvido !== 0 && !conta_id) {
    return NextResponse.json(
      {
        error:
          valor_devolvido > 0
            ? "diga em qual conta entrou o dinheiro devolvido"
            : "diga de qual conta saiu o pagamento ao motorista",
      },
      { status: 400 }
    );
  }
  // Negativos são VÁLIDOS desde a 0011: saldo negativo = empresa devendo
  // pro motorista (pagou agora / soma no salário / leva pro próximo ciclo).

  const client = getSupabaseAdmin(admin.id);

  // A soma devolvido+vale+saldo tem que bater com o saldo REAL DE AGORA,
  // recalculado aqui — não com o que a tela carregou minutos atrás. Se um
  // lançamento do motorista sincronizou nesse meio-tempo (ou outro admin
  // acertou junto), o valor dele cairia no ciclo fechado sem entrar na
  // divisão: dinheiro que ninguém cobra. 409 manda recarregar a tela.
  const { data: saldos, error: eSaldo } = await client.rpc("saldos_motoristas");
  if (eSaldo) return NextResponse.json({ error: eSaldo.message }, { status: 400 });
  const saldoAgora = Number(
    ((saldos as { motorista_id: string; saldo: number }[]) || []).find(
      (s) => s.motorista_id === motorista_id
    )?.saldo ?? 0
  );
  const somaAcerto = Math.round((valor_devolvido + valor_vale + valor_saldo) * 100);
  if (somaAcerto !== Math.round(saldoAgora * 100)) {
    return NextResponse.json(
      {
        error: `o saldo mudou enquanto a tela estava aberta (agora é R$ ${saldoAgora.toFixed(2).replace(".", ",")}) — recarregue e refaça o acerto`,
      },
      { status: 409 }
    );
  }
  const { data, error } = await client
    .from("acertos")
    .insert({
      motorista_id,
      conta_id: valor_devolvido !== 0 ? conta_id : null,
      valor_devolvido,
      valor_vale,
      valor_saldo,
      observacao,
      registrado_por: admin.id,
    })
    .select()
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ ok: true, acerto: data });
}
