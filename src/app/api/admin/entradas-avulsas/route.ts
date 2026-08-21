import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { exigirAdmin } from "@/lib/auth/exigir-admin";

const TIPOS = ["aporte", "emprestimo", "reembolso", "rendimento", "venda_ativo", "outra"];

/**
 * POST — dinheiro que entra sem ser venda de óleo (0047).
 *
 * Aporte do sócio, empréstimo recebido, reembolso, rendimento, venda de um
 * ativo. Entra no CAIXA (braço próprio da saldo_contas) e fica FORA do DRE
 * — não é resultado da operação.
 */
export async function POST(req: NextRequest) {
  const admin = await exigirAdmin();
  if (!admin) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const body = await req.json();

  const tipo = String(body.tipo || "");
  const valor = Number(body.valor);
  const data = String(body.data || "").trim();
  const conta_id = body.conta_id ? String(body.conta_id) : null;
  const descricao = String(body.descricao || "").trim();

  if (!TIPOS.includes(tipo)) {
    return NextResponse.json({ error: "tipo inválido" }, { status: 400 });
  }
  if (!Number.isFinite(valor) || valor <= 0) {
    return NextResponse.json({ error: "valor inválido" }, { status: 400 });
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(data)) {
    return NextResponse.json({ error: "data inválida" }, { status: 400 });
  }
  const hojeBr = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString().slice(0, 10);
  if (data > hojeBr) {
    return NextResponse.json(
      { error: "a data está no futuro — dinheiro só entra quando entra" },
      { status: 400 }
    );
  }
  if (!conta_id) {
    return NextResponse.json({ error: "diga em qual conta o dinheiro entrou" }, { status: 400 });
  }
  if (descricao.length < 3) {
    return NextResponse.json(
      { error: "descreva de onde veio (ex.: aporte do Jean, empréstimo BB)" },
      { status: 400 }
    );
  }

  const client = getSupabaseAdmin(admin.id);
  const { error } = await client.from("entradas_avulsas").insert({
    tipo,
    valor: Math.round(valor * 100) / 100,
    data,
    conta_id,
    descricao,
    registrado_por: admin.id,
  });
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ ok: true });
}
