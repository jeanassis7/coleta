import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { exigirAcessoModulo1 } from "@/lib/auth/gate-modulo1";

const exigirAdmin = exigirAcessoModulo1;
const n2 = (v: number) => Math.round(v * 100) / 100;

const CATEGORIAS = [
  "combustivel",
  "manutencao",
  "oleo",
  "imposto",
  "fixa",
  "folha",
  "outra",
];

/**
 * POST: cria conta avulsa ou parcelada.
 *
 * Parcelamento (compra de óleo a prazo, revisão em 3x) gera N linhas, uma
 * por parcela, cada uma com seu vencimento. Assim cada parcela se paga
 * sozinha pelo mesmo fluxo das outras contas — não existe caso especial.
 */
export async function POST(req: NextRequest) {
  const admin = await exigirAdmin();
  if (!admin) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const body = await req.json();
  const descricao = String(body.descricao || "").trim();
  const categoria = String(body.categoria || "outra");
  const valor = Number(body.valor);
  const vencimento = String(body.vencimento || "").trim();
  const parcelas = Math.max(1, Math.min(36, Number(body.parcelas) || 1));
  const prevista = body.prevista === true;

  if (descricao.length < 2) {
    return NextResponse.json({ error: "descreva a conta" }, { status: 400 });
  }
  if (!CATEGORIAS.includes(categoria)) {
    return NextResponse.json({ error: "categoria inválida" }, { status: 400 });
  }
  if (!Number.isFinite(valor) || valor <= 0) {
    return NextResponse.json({ error: "valor inválido" }, { status: 400 });
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(vencimento)) {
    return NextResponse.json({ error: "vencimento inválido" }, { status: 400 });
  }

  // Divide sem perder centavo: a última parcela absorve a sobra do
  // arredondamento (1000 em 3x = 333,33 + 333,33 + 333,34).
  const base = Math.floor((valor * 100) / parcelas) / 100;
  const sobra = n2(valor - base * parcelas);

  const linhas = Array.from({ length: parcelas }, (_, i) => {
    const d = new Date(`${vencimento}T12:00:00`);
    d.setMonth(d.getMonth() + i);
    return {
      descricao:
        parcelas > 1 ? `${descricao} (${i + 1}/${parcelas})` : descricao,
      fornecedor: body.fornecedor ? String(body.fornecedor).trim() : null,
      categoria,
      valor: i === parcelas - 1 ? n2(base + sobra) : base,
      vencimento: d.toISOString().slice(0, 10),
      status: prevista ? "prevista" : "a_pagar",
      origem_tipo: body.origem_tipo || null,
      origem_id: body.origem_id || null,
      parcela: parcelas > 1 ? i + 1 : null,
      parcelas_total: parcelas > 1 ? parcelas : null,
      observacao: body.observacao ? String(body.observacao).trim() : null,
      registrado_por: admin.id,
    };
  });

  const client = getSupabaseAdmin(admin.id);
  const { error } = await client.from("contas_a_pagar").insert(linhas);
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ ok: true, criadas: linhas.length });
}
