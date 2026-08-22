import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { exigirAdmin } from "@/lib/auth/exigir-admin";

/**
 * POST /api/admin/dividas — cadastra o que a empresa deve.
 *
 * PARCELADA: acordo fechado (8× R$ 12.000). Pede parcelas e valor da parcela.
 * ABERTA: valor devido sem cronograma. O `observacao` guarda a situação em
 * palavras (juro combinado, estado da negociação).
 *
 * O SALDO não é gravado — sai da conta `valor_total − pagamentos`. Por isso
 * aqui não existe campo "quanto já paguei": isso é consequência dos
 * lançamentos, não um número digitado que pode desencontrar.
 */
export async function POST(req: NextRequest) {
  const admin = await exigirAdmin();
  if (!admin) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const body = await req.json();
  const credor = String(body.credor || "").trim();
  const tipo = String(body.tipo || "");
  const valor_total = Number(body.valor_total);

  if (!credor) {
    return NextResponse.json({ error: "diga a quem a empresa deve" }, { status: 400 });
  }
  if (tipo !== "parcelada" && tipo !== "aberta") {
    return NextResponse.json({ error: "tipo inválido" }, { status: 400 });
  }
  if (!Number.isFinite(valor_total) || valor_total <= 0) {
    return NextResponse.json({ error: "valor total inválido" }, { status: 400 });
  }

  let parcelas_total: number | null = null;
  let valor_parcela: number | null = null;
  if (tipo === "parcelada") {
    parcelas_total = Number(body.parcelas_total);
    valor_parcela = Number(body.valor_parcela);
    if (!Number.isInteger(parcelas_total) || parcelas_total <= 0) {
      return NextResponse.json({ error: "número de parcelas inválido" }, { status: 400 });
    }
    if (!Number.isFinite(valor_parcela) || valor_parcela <= 0) {
      return NextResponse.json({ error: "valor da parcela inválido" }, { status: 400 });
    }
    // Não travo em cima do total (acordo pode ter entrada, arredondamento,
    // juro embutido na última) — mas aviso quando a conta não fecha, porque
    // quase sempre é dedo trocado.
    const somaParcelas = Math.round(parcelas_total * valor_parcela * 100) / 100;
    const diferenca = Math.abs(somaParcelas - Math.round(valor_total * 100) / 100);
    if (diferenca > Math.max(1, valor_total * 0.02) && !body.confirmado) {
      return NextResponse.json(
        {
          error: `${parcelas_total}× ${valor_parcela.toFixed(2)} dá ${somaParcelas.toFixed(
            2
          )}, e o total informado é ${valor_total.toFixed(2)}. Confira — se estiver certo mesmo (entrada, juro na última), confirme.`,
          precisaConfirmar: true,
        },
        { status: 409 }
      );
    }
  }

  const primeira_em =
    typeof body.primeira_em === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.primeira_em)
      ? body.primeira_em
      : null;

  const client = getSupabaseAdmin(admin.id);
  const { data, error } = await client
    .from("dividas")
    .insert({
      credor,
      tipo,
      valor_total: Math.round(valor_total * 100) / 100,
      parcelas_total,
      valor_parcela: valor_parcela != null ? Math.round(valor_parcela * 100) / 100 : null,
      primeira_em,
      observacao: body.observacao ? String(body.observacao).trim() : null,
      registrado_por: admin.id,
    })
    .select("id")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ ok: true, id: data.id });
}
