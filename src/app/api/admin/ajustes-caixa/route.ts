import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { exigirAdmin } from "@/lib/auth/exigir-admin";

/**
 * POST — o inventário do dinheiro (0047).
 *
 * "Contei a gaveta e a conta não bate." O valor é a DIFERENÇA: positivo =
 * sobra, negativo = falta. Motivo obrigatório, igual ao ajuste de estoque.
 * Mexe no caixa e fica fora do DRE — é conferência, não gasto.
 */
export async function POST(req: NextRequest) {
  const admin = await exigirAdmin();
  if (!admin) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const body = await req.json();

  const valor = Number(body.valor);
  const data = String(body.data || "").trim();
  const conta_id = body.conta_id ? String(body.conta_id) : null;
  const motivo = String(body.motivo || "").trim();

  if (!Number.isFinite(valor) || valor === 0) {
    return NextResponse.json(
      { error: "valor inválido — é a diferença encontrada (positivo sobra, negativo falta)" },
      { status: 400 }
    );
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(data)) {
    return NextResponse.json({ error: "data inválida" }, { status: 400 });
  }
  const hojeBr = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString().slice(0, 10);
  if (data > hojeBr) {
    return NextResponse.json({ error: "a data está no futuro" }, { status: 400 });
  }
  if (!conta_id) {
    return NextResponse.json({ error: "diga qual conta foi conferida" }, { status: 400 });
  }
  if (motivo.length < 3) {
    return NextResponse.json(
      { error: "o motivo é obrigatório — ajuste sem motivo esconde problema" },
      { status: 400 }
    );
  }

  const client = getSupabaseAdmin(admin.id);
  const { error } = await client.from("ajustes_caixa").insert({
    valor: Math.round(valor * 100) / 100,
    data,
    conta_id,
    motivo,
    registrado_por: admin.id,
  });
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ ok: true });
}
