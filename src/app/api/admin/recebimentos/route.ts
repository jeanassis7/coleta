import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { exigirAcessoModulo1 } from "@/lib/auth/gate-modulo1";

const exigirAdmin = exigirAcessoModulo1;
const n2 = (v: number) => Math.round(v * 100) / 100;

/**
 * POST: registra um pagamento na conta corrente do comprador.
 *
 * Sem vínculo obrigatório com venda: o Evaner descreveu o fluxo real —
 * a venda fica em aberto e o dinheiro pinga depois, às vezes em pix, às
 * vezes em cheque novo. Forçar o casamento com uma venda específica seria
 * burocracia que trava o lançamento.
 *
 * Cheque vira SEU PRÓPRIO recebimento (1:1), pelo mesmo motivo da venda:
 * se um voltar, some só o valor dele.
 */
export async function POST(req: NextRequest) {
  const admin = await exigirAdmin();
  if (!admin) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const body = await req.json();
  const comprador_id = String(body.comprador_id || "");
  const forma = String(body.forma || "");
  const valor = Number(body.valor);
  const data = String(body.data || "").trim();

  if (!comprador_id) {
    return NextResponse.json({ error: "comprador não informado" }, { status: 400 });
  }
  if (!["pix", "dinheiro", "transferencia", "cheque"].includes(forma)) {
    return NextResponse.json({ error: "forma de pagamento inválida" }, { status: 400 });
  }
  if (!Number.isFinite(valor) || valor <= 0) {
    return NextResponse.json({ error: "valor inválido" }, { status: 400 });
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(data)) {
    return NextResponse.json({ error: "data inválida" }, { status: 400 });
  }

  const client = getSupabaseAdmin();

  if (forma === "cheque") {
    const banco = String(body.banco || "").trim();
    const emitente = String(body.emitente || "").trim();
    const bomPara = String(body.bom_para || "").trim();
    if (!banco || !emitente || !/^\d{4}-\d{2}-\d{2}$/.test(bomPara)) {
      return NextResponse.json(
        { error: "cheque precisa de banco, emitente e a data do 'bom para'" },
        { status: 400 }
      );
    }

    const { data: rec, error: eRec } = await client
      .from("recebimentos")
      .insert({
        comprador_id,
        venda_id: body.venda_id || null,
        forma,
        valor: n2(valor),
        data,
        observacao: body.observacao ? String(body.observacao).trim() : null,
        registrado_por: admin.id,
      })
      .select("id")
      .maybeSingle();
    if (eRec || !rec) {
      return NextResponse.json({ error: eRec?.message || "erro" }, { status: 400 });
    }

    const { error: eCh } = await client.from("cheques").insert({
      recebimento_id: rec.id,
      comprador_id,
      banco,
      emitente,
      numero: body.numero ? String(body.numero).trim() : null,
      valor: n2(valor),
      bom_para: bomPara,
    });
    if (eCh) {
      // Recebimento sem cheque seria crédito que nenhum papel sustenta.
      await client.from("recebimentos").delete().eq("id", rec.id);
      return NextResponse.json({ error: eCh.message }, { status: 400 });
    }
    return NextResponse.json({ ok: true });
  }

  const { error } = await client.from("recebimentos").insert({
    comprador_id,
    venda_id: body.venda_id || null,
    forma,
    valor: n2(valor),
    data,
    observacao: body.observacao ? String(body.observacao).trim() : null,
    registrado_por: admin.id,
  });
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ ok: true });
}
