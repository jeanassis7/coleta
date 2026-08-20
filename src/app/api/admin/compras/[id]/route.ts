import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { exigirAdmin } from "@/lib/auth/exigir-admin";

/** PATCH: corrige uma compra direta lançada errado. */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const admin = await exigirAdmin();
  if (!admin) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const { id } = await params;
  const body = await req.json();

  const updates: Record<string, unknown> = {};
  if (typeof body.data === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.data)) {
    updates.data = body.data;
  }
  if (typeof body.fornecedor === "string" && body.fornecedor.trim().length >= 2) {
    updates.fornecedor = body.fornecedor.trim();
  }
  if (body.valor !== undefined) {
    const n = Number(body.valor);
    if (!Number.isFinite(n) || n <= 0) {
      return NextResponse.json({ error: "valor inválido" }, { status: 400 });
    }
    updates.valor = Math.round(n * 100) / 100;
  }
  if (body.quantidade !== undefined) {
    const n = Number(body.quantidade);
    if (!Number.isFinite(n) || n <= 0) {
      return NextResponse.json({ error: "quantidade inválida" }, { status: 400 });
    }
    updates.quantidade = Math.round(n * 100) / 100;
  }
  if (body.unidade !== undefined) {
    if (!["kg", "litros"].includes(body.unidade)) {
      return NextResponse.json({ error: "unidade inválida" }, { status: 400 });
    }
    updates.unidade = body.unidade;
  }
  if (body.tipo_oleo !== undefined) {
    if (!["fino", "grosso"].includes(body.tipo_oleo)) {
      return NextResponse.json({ error: "tipo de óleo inválido" }, { status: 400 });
    }
    updates.tipo_oleo = body.tipo_oleo;
  }
  if (typeof body.entra_no_estoque === "boolean") {
    updates.entra_no_estoque = body.entra_no_estoque;
  }
  // O certificado É editável — o caso real: acertou os litros do óleo, errou
  // o certificado, volta e corrige. O PATCH descartava esses campos em
  // silêncio (a tela dizia salvo, o banco não mudava).
  if (body.certificado_tipo !== undefined) {
    if (!["integral", "parcial", "nao"].includes(body.certificado_tipo)) {
      return NextResponse.json({ error: "certificado inválido" }, { status: 400 });
    }
    updates.certificado_tipo = body.certificado_tipo;
    if (body.certificado_tipo === "parcial") {
      const lc = Number(body.litros_certificado);
      if (!Number.isFinite(lc) || lc <= 0) {
        return NextResponse.json(
          { error: "quantos litros no certificado parcial?" },
          { status: 400 }
        );
      }
      updates.litros_certificado = Math.round(lc * 100) / 100;
    }
    if (body.certificado_tipo === "nao") updates.litros_certificado = null;
  }
  if (body.conta_id !== undefined) {
    updates.conta_id = body.conta_id ? String(body.conta_id) : null;
  }
  if (body.observacao !== undefined) {
    updates.observacao = body.observacao?.trim() || null;
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: "nada a atualizar" }, { status: 400 });
  }

  const client = getSupabaseAdmin(admin.id);
  const { data: depois, error } = await client
    .from("compras_diretas")
    .update(updates)
    .eq("id", id)
    .select("quantidade, unidade, certificado_tipo")
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  // Certificado INTEGRAL cobre a compra inteira: se quantidade, unidade ou o
  // próprio tipo mudaram, os litros do certificado se recalculam — senão
  // editar a compra deixava o certificado com os litros antigos.
  if (depois?.certificado_tipo === "integral") {
    const qtd = Number(depois.quantidade);
    const litros =
      depois.unidade === "litros"
        ? Math.round(qtd * 100) / 100
        : Math.round((qtd / 0.9) * 100) / 100;
    const { error: eCert } = await client
      .from("compras_diretas")
      .update({ litros_certificado: litros })
      .eq("id", id);
    if (eCert) return NextResponse.json({ error: eCert.message }, { status: 400 });
  }

  return NextResponse.json({ ok: true });
}

/** DELETE: apaga a compra e a foto do comprovante. */
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const admin = await exigirAdmin();
  if (!admin) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const { id } = await params;
  const client = getSupabaseAdmin(admin.id);

  const { data: compra } = await client
    .from("compras_diretas")
    .select("foto_path")
    .eq("id", id)
    .maybeSingle();

  const { error } = await client.from("compras_diretas").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  if (compra?.foto_path) {
    await client.storage.from("fotos-coletas").remove([compra.foto_path]);
  }
  return NextResponse.json({ ok: true });
}
