import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { exigirAdmin } from "@/lib/auth/exigir-admin";

interface RouteParams {
  params: Promise<{ id: string }>;
}

/** PATCH: corrige um lançamento de manutenção. */
export async function PATCH(req: NextRequest, { params }: RouteParams) {
  const admin = await exigirAdmin();
  if (!admin) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const { id } = await params;

  const body = await req.json();
  const updates: Record<string, unknown> = {};

  if (typeof body.descricao === "string" && body.descricao.trim()) {
    updates.descricao = body.descricao.trim();
  }
  if (body.valor != null) {
    const v = Number(body.valor);
    if (!Number.isFinite(v) || v <= 0) {
      return NextResponse.json({ error: "valor inválido" }, { status: 400 });
    }
    updates.valor = Math.round(v * 100) / 100;
  }
  if (body.data != null) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(body.data))) {
      return NextResponse.json({ error: "data inválida" }, { status: 400 });
    }
    updates.data = body.data;
  }
  if (body.km !== undefined) {
    updates.km = body.km === "" || body.km == null ? null : Number(body.km);
  }
  if (body.proxima_km !== undefined) {
    updates.proxima_km =
      body.proxima_km === "" || body.proxima_km == null
        ? null
        : Number(body.proxima_km);
  }
  if (body.proxima_data !== undefined) {
    if (body.proxima_data && !/^\d{4}-\d{2}-\d{2}$/.test(String(body.proxima_data))) {
      return NextResponse.json({ error: "data da próxima troca inválida" }, { status: 400 });
    }
    updates.proxima_data = body.proxima_data || null;
  }
  if (body.fornecedor !== undefined) {
    updates.fornecedor = body.fornecedor
      ? String(body.fornecedor).trim()
      : null;
  }
  if (body.observacao !== undefined) {
    updates.observacao = body.observacao
      ? String(body.observacao).trim()
      : null;
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: "nada a atualizar" }, { status: 400 });
  }

  const client = getSupabaseAdmin(admin.id);
  const { error } = await client
    .from("manutencoes")
    .update(updates)
    .eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  // Manutenção a prazo tem conta a pagar amarrada — corrigir o valor ou a
  // descrição da manutenção corrige a dívida junto (só enquanto não paga;
  // paga é história e fica quieta).
  if (updates.valor !== undefined || updates.descricao !== undefined || updates.fornecedor !== undefined) {
    const ajuste: Record<string, unknown> = {};
    if (updates.valor !== undefined) ajuste.valor = updates.valor;
    if (updates.descricao !== undefined) ajuste.descricao = `Manutenção — ${updates.descricao}`;
    if (updates.fornecedor !== undefined) ajuste.fornecedor = updates.fornecedor;
    const { error: eConta } = await client
      .from("contas_a_pagar")
      .update(ajuste)
      .eq("origem_tipo", "manutencao")
      .eq("origem_id", id)
      .in("status", ["prevista", "a_pagar"]);
    if (eConta) {
      return NextResponse.json({
        ok: true,
        aviso: `manutenção corrigida, mas a conta amarrada não acompanhou: ${eConta.message}`,
      });
    }
  }
  return NextResponse.json({ ok: true });
}

/**
 * DELETE: apaga o lançamento.
 *
 * A conta AINDA NÃO PAGA morre junto — dívida de uma manutenção que não
 * existe mais é dívida-fantasma (mesmo comportamento do abastecimento).
 * A conta JÁ PAGA fica de pé: o dinheiro saiu de verdade, e apagar
 * reescreveria o caixa — quem apagou fica sabendo pelo aviso.
 */
export async function DELETE(_req: NextRequest, { params }: RouteParams) {
  const admin = await exigirAdmin();
  if (!admin) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const { id } = await params;

  const client = getSupabaseAdmin(admin.id);

  const { data: contaPaga } = await client
    .from("contas_a_pagar")
    .select("id")
    .eq("origem_tipo", "manutencao")
    .eq("origem_id", id)
    .eq("status", "paga")
    .maybeSingle();

  const { data: contasAbertas, error: eConta } = await client
    .from("contas_a_pagar")
    .delete()
    .eq("origem_tipo", "manutencao")
    .eq("origem_id", id)
    .in("status", ["prevista", "a_pagar"])
    .select("id");
  if (eConta) return NextResponse.json({ error: eConta.message }, { status: 400 });

  const { error } = await client.from("manutencoes").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  return NextResponse.json({
    ok: true,
    aviso: contaPaga
      ? "O pagamento dessa manutenção JÁ FOI FEITO — ele continua no histórico e no DRE; confira se o estorno com a oficina aconteceu de verdade."
      : (contasAbertas?.length ?? 0) > 0
        ? "A conta a pagar dessa manutenção foi removida junto — a dívida não existe mais."
        : null,
  });
}
