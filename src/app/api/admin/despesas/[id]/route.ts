import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { exigirAdmin } from "@/lib/auth/exigir-admin";

/**
 * PATCH: corrige valor/descrição de uma despesa — e o botão "paguei agora ↔
 * assinei a nota", arrastando a conta a pagar amarrada (mesmas regras do
 * abastecimento, que é o fluxo irmão):
 *   • virou nota assinada: sai do saldo do motorista, a conta nasce aqui
 *     (o trigger da 0047 só cobre INSERT);
 *   • virou "paguei agora": a conta morre — se ainda não foi paga; paga,
 *     a troca é recusada (apague o pagamento primeiro).
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

  const { data: atual, error: eAtual } = await client
    .from("despesas")
    .select("id, pago_na_hora, valor, descricao, motorista_id, lancado_por")
    .eq("id", id)
    .maybeSingle();
  if (eAtual) return NextResponse.json({ error: eAtual.message }, { status: 400 });
  if (!atual) return NextResponse.json({ error: "despesa não encontrada" }, { status: 404 });

  const updates: Record<string, unknown> = {};
  if (typeof body.descricao === "string" && body.descricao.trim()) {
    updates.descricao = body.descricao.trim();
  }
  if (body.valor !== undefined) {
    const n = Number(body.valor);
    if (!Number.isFinite(n) || n <= 0) {
      return NextResponse.json({ error: "valor inválido" }, { status: 400 });
    }
    updates.valor = Math.round(n * 100) / 100;
  }

  const trocaPago =
    typeof body.pago_na_hora === "boolean" &&
    body.pago_na_hora !== atual.pago_na_hora
      ? (body.pago_na_hora as boolean)
      : null;

  if (trocaPago === true) {
    const { data: contaPaga } = await client
      .from("contas_a_pagar")
      .select("id")
      .eq("origem_tipo", "despesa")
      .eq("origem_id", id)
      .eq("status", "paga")
      .maybeSingle();
    if (contaPaga) {
      return NextResponse.json(
        {
          error:
            "a conta dessa nota já foi PAGA — apague o pagamento primeiro (em Lançamentos) e aí troque pra 'pagou na hora'",
        },
        { status: 409 }
      );
    }
    const { error: eDelConta } = await client
      .from("contas_a_pagar")
      .delete()
      .eq("origem_tipo", "despesa")
      .eq("origem_id", id)
      .in("status", ["prevista", "a_pagar"]);
    if (eDelConta) {
      return NextResponse.json({ error: eDelConta.message }, { status: 400 });
    }
    updates.pago_na_hora = true;
  } else if (trocaPago === false) {
    updates.pago_na_hora = false;
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: "nada a atualizar" }, { status: 400 });
  }

  const { error } = await client.from("despesas").update(updates).eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  const avisos: string[] = [];
  const descFinal = (updates.descricao as string) ?? atual.descricao;
  const valorFinal = (updates.valor as number) ?? Number(atual.valor);

  if (trocaPago === false) {
    const { data: jaExiste } = await client
      .from("contas_a_pagar")
      .select("id")
      .eq("origem_tipo", "despesa")
      .eq("origem_id", id)
      .in("status", ["prevista", "a_pagar", "paga"])
      .maybeSingle();
    if (!jaExiste) {
      const hojeBr = new Date(Date.now() - 3 * 60 * 60 * 1000);
      const venc = new Date(
        Date.UTC(hojeBr.getUTCFullYear(), hojeBr.getUTCMonth() + 1, 1)
      )
        .toISOString()
        .slice(0, 10);
      const { error: eNova } = await client.from("contas_a_pagar").insert({
        descricao: `Despesa (nota assinada) — ${descFinal.slice(0, 80)}`,
        fornecedor: null,
        categoria: "custos_viagem",
        valor: valorFinal,
        vencimento: venc,
        status: "a_pagar",
        origem_tipo: "despesa",
        origem_id: id,
        registrado_por: admin.id,
      });
      if (eNova) {
        await client.from("despesas").update({ pago_na_hora: true }).eq("id", id);
        return NextResponse.json(
          {
            error: `não consegui criar a conta a pagar (${eNova.message}) — a troca foi desfeita, tenta de novo`,
          },
          { status: 500 }
        );
      }
    }
    avisos.push(
      "virou nota assinada: não sai mais do saldo do motorista e a dívida está em Contas a pagar"
    );
  }
  if (trocaPago === true) {
    avisos.push(
      "virou 'pagou na hora': voltou a descontar do saldo do motorista e a dívida foi removida"
    );
  }

  // Conta amarrada acompanha valor/descrição — enquanto não paga.
  if (updates.valor !== undefined || updates.descricao !== undefined) {
    const ajuste: Record<string, unknown> = {};
    if (updates.valor !== undefined) ajuste.valor = updates.valor;
    if (updates.descricao !== undefined) {
      ajuste.descricao = `Despesa (nota assinada) — ${String(updates.descricao).slice(0, 80)}`;
    }
    const { error: eConta } = await client
      .from("contas_a_pagar")
      .update(ajuste)
      .eq("origem_tipo", "despesa")
      .eq("origem_id", id)
      .in("status", ["prevista", "a_pagar"]);
    if (eConta) {
      avisos.push(`a conta amarrada não acompanhou a correção: ${eConta.message}`);
    }
  }

  return NextResponse.json({
    ok: true,
    ...(avisos.length > 0 ? { aviso: avisos.join(". ") } : {}),
  });
}

/**
 * DELETE: apaga a despesa, a foto — e a conta a pagar EM ABERTO amarrada
 * (nota assinada). Conta paga fica: o dinheiro saiu de verdade, e quem
 * apagou fica sabendo. Mesmo padrão do abastecimento.
 */
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const admin = await exigirAdmin();
  if (!admin) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const { id } = await params;
  const client = getSupabaseAdmin(admin.id);

  const { data: despesa } = await client
    .from("despesas")
    .select("foto_path")
    .eq("id", id)
    .maybeSingle();

  const { data: contaPaga } = await client
    .from("contas_a_pagar")
    .select("id")
    .eq("origem_tipo", "despesa")
    .eq("origem_id", id)
    .eq("status", "paga")
    .maybeSingle();
  const { error: eConta } = await client
    .from("contas_a_pagar")
    .delete()
    .eq("origem_tipo", "despesa")
    .eq("origem_id", id)
    .in("status", ["prevista", "a_pagar"]);
  if (eConta) return NextResponse.json({ error: eConta.message }, { status: 400 });

  const { error } = await client.from("despesas").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  if (despesa?.foto_path) {
    await client.storage.from("fotos-coletas").remove([despesa.foto_path]);
  }
  return NextResponse.json({
    ok: true,
    ...(contaPaga
      ? {
          aviso:
            "a conta dessa nota JÁ FOI PAGA — o pagamento continua no histórico e no DRE; confira se o estorno aconteceu de verdade",
        }
      : {}),
  });
}
