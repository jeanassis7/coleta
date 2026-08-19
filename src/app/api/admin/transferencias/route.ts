import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { exigirAdmin } from "@/lib/auth/exigir-admin";

/**
 * POST — saque, depósito, ou qualquer dinheiro trocando de conta.
 *
 * NÃO é receita nem despesa: é o mesmo dinheiro mudando de lugar. Por isso
 * mora em tabela própria — é o que faz o caixa fechar e o DRE ignorar
 * corretamente, em vez de virar uma despesa fantasma.
 */
export async function POST(req: NextRequest) {
  const admin = await exigirAdmin();
  if (!admin) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const body = await req.json();
  const conta_origem_id = String(body.conta_origem_id || "");
  const conta_destino_id = String(body.conta_destino_id || "");
  const valor = Number(body.valor);
  const data = String(body.data || "").trim();

  if (!conta_origem_id || !conta_destino_id) {
    return NextResponse.json(
      { error: "diga de qual conta saiu e pra qual foi" },
      { status: 400 }
    );
  }
  if (conta_origem_id === conta_destino_id) {
    return NextResponse.json(
      { error: "a conta de origem e a de destino são a mesma" },
      { status: 400 }
    );
  }
  if (!Number.isFinite(valor) || valor <= 0) {
    return NextResponse.json({ error: "valor inválido" }, { status: 400 });
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(data)) {
    return NextResponse.json({ error: "data inválida" }, { status: 400 });
  }

  const client = getSupabaseAdmin(admin.id);
  const { error } = await client.from("transferencias").insert({
    conta_origem_id,
    conta_destino_id,
    valor: Math.round(valor * 100) / 100,
    data,
    descricao: body.descricao ? String(body.descricao).trim() : null,
    registrado_por: admin.id,
  });

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ ok: true });
}
