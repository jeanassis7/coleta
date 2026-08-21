import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { exigirAdmin } from "@/lib/auth/exigir-admin";

/**
 * POST — devolução de troco do motorista no MEIO do ciclo (0047).
 *
 * "Toma R$ 500 de volta, continuo rodando." Sai do saldo na mão dele
 * (braço próprio da saldos_motoristas) e entra na conta escolhida — sem
 * fechar acerto, sem mexer no corte do ciclo.
 */
export async function POST(req: NextRequest) {
  const admin = await exigirAdmin();
  if (!admin) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const body = await req.json();

  const motorista_id = String(body.motorista_id || "");
  const valor = Number(body.valor);
  const data = String(body.data || "").trim();
  const conta_id = body.conta_id ? String(body.conta_id) : null;

  if (!motorista_id) {
    return NextResponse.json({ error: "motorista_id obrigatório" }, { status: 400 });
  }
  if (!Number.isFinite(valor) || valor <= 0) {
    return NextResponse.json({ error: "valor inválido" }, { status: 400 });
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(data)) {
    return NextResponse.json({ error: "data inválida" }, { status: 400 });
  }
  const hojeBr = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString().slice(0, 10);
  if (data > hojeBr) {
    return NextResponse.json({ error: "a data está no futuro" }, { status: 400 });
  }
  if (!conta_id) {
    return NextResponse.json(
      { error: "diga em qual conta o dinheiro entrou" },
      { status: 400 }
    );
  }

  const client = getSupabaseAdmin(admin.id);
  const { error } = await client.from("devolucoes_motorista").insert({
    motorista_id,
    valor: Math.round(valor * 100) / 100,
    data,
    conta_id,
    observacao: body.observacao ? String(body.observacao).trim() : null,
    registrado_por: admin.id,
  });
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ ok: true });
}
