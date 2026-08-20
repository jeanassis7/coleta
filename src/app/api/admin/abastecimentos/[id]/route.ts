import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { exigirAdmin } from "@/lib/auth/exigir-admin";

/**
 * PATCH: admin corrige um abastecimento lançado errado (mesmo com o
 * antiburro do app, erro humano acontece). Campos: posto_nome, litros,
 * valor, km_atual.
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const admin = await exigirAdmin();
  if (!admin) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const { id } = await params;
  const body = await req.json();

  const updates: Record<string, unknown> = {};
  if (typeof body.posto_nome === "string" && body.posto_nome.trim()) {
    updates.posto_nome = body.posto_nome.trim();
  }
  if (body.litros !== undefined) {
    const n = Number(body.litros);
    if (!Number.isFinite(n) || n <= 0) {
      return NextResponse.json({ error: "litros inválido" }, { status: 400 });
    }
    updates.litros = Math.round(n * 100) / 100;
  }
  if (body.valor !== undefined) {
    const n = Number(body.valor);
    if (!Number.isFinite(n) || n <= 0) {
      return NextResponse.json({ error: "valor inválido" }, { status: 400 });
    }
    updates.valor = Math.round(n * 100) / 100;
  }
  if (body.km_atual !== undefined) {
    const n = Number(body.km_atual);
    if (!Number.isFinite(n) || n <= 0) {
      return NextResponse.json({ error: "km inválido" }, { status: 400 });
    }
    updates.km_atual = Math.round(n);
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: "nada a atualizar" }, { status: 400 });
  }

  const client = getSupabaseAdmin(admin.id);
  const { error } = await client.from("abastecimentos").update(updates).eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  // Nota assinada tem conta a pagar amarrada (trigger 0034). Corrigir o
  // valor ou o posto do abastecimento corrige a dívida junto — senão o
  // motorista lançou R$ 800, você corrige pra 680, e a dívida com o posto
  // continuava R$ 800. Conta já PAGA fica quieta: é história.
  if (updates.valor !== undefined || updates.posto_nome !== undefined) {
    const ajusteConta: Record<string, unknown> = {};
    if (updates.valor !== undefined) ajusteConta.valor = updates.valor;
    if (updates.posto_nome !== undefined) {
      ajusteConta.fornecedor = updates.posto_nome;
      ajusteConta.descricao = `Diesel (nota assinada) — ${updates.posto_nome}`;
    }
    const { error: eConta } = await client
      .from("contas_a_pagar")
      .update(ajusteConta)
      .eq("origem_tipo", "abastecimento")
      .eq("origem_id", id)
      .in("status", ["prevista", "a_pagar"]);
    if (eConta) {
      return NextResponse.json({
        ok: true,
        aviso: `abastecimento corrigido, mas a conta a pagar amarrada não acompanhou: ${eConta.message}`,
      });
    }
  }
  return NextResponse.json({ ok: true });
}

/**
 * DELETE: apaga o abastecimento e a foto do cupom.
 * Atenção: o saldo do motorista é calculado somando os gastos, então
 * apagar um abastecimento AUMENTA o saldo dele na mesma hora. A UI avisa.
 */
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const admin = await exigirAdmin();
  if (!admin) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const { id } = await params;
  const client = getSupabaseAdmin(admin.id);

  const { data: abast } = await client
    .from("abastecimentos")
    .select("foto_path")
    .eq("id", id)
    .maybeSingle();

  // A conta a pagar da nota assinada morre junto com o fato — se ainda não
  // foi paga. Se JÁ FOI, o dinheiro saiu de verdade: a conta fica (vira
  // histórico), e quem apagou fica sabendo.
  const { data: contaPaga } = await client
    .from("contas_a_pagar")
    .select("id")
    .eq("origem_tipo", "abastecimento")
    .eq("origem_id", id)
    .eq("status", "paga")
    .maybeSingle();
  const { error: eConta } = await client
    .from("contas_a_pagar")
    .delete()
    .eq("origem_tipo", "abastecimento")
    .eq("origem_id", id)
    .in("status", ["prevista", "a_pagar"]);
  if (eConta) return NextResponse.json({ error: eConta.message }, { status: 400 });

  const { error } = await client.from("abastecimentos").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  if (abast?.foto_path) {
    await client.storage.from("fotos-coletas").remove([abast.foto_path]);
  }
  return NextResponse.json({
    ok: true,
    ...(contaPaga
      ? {
          aviso:
            "a conta dessa nota JÁ FOI PAGA — o pagamento continua no histórico e no DRE; confira se o estorno com o posto aconteceu de verdade",
        }
      : {}),
  });
}
