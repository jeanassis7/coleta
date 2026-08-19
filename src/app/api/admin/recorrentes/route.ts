import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { exigirAdmin } from "@/lib/auth/exigir-admin";
const n2 = (v: number) => Math.round(v * 100) / 100;

/** POST: cadastra uma despesa recorrente (aluguel, energia, contador, IPVA). */
export async function POST(req: NextRequest) {
  const admin = await exigirAdmin();
  if (!admin) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const body = await req.json();
  const descricao = String(body.descricao || "").trim();
  const valor = Number(body.valor);
  const dia = Number(body.dia_vencimento);
  const periodicidade = body.periodicidade === "anual" ? "anual" : "mensal";
  const mes = Number(body.mes_vencimento);

  if (descricao.length < 2) {
    return NextResponse.json({ error: "descreva a despesa" }, { status: 400 });
  }
  if (!Number.isFinite(valor) || valor <= 0) {
    return NextResponse.json({ error: "valor inválido" }, { status: 400 });
  }
  if (!Number.isInteger(dia) || dia < 1 || dia > 31) {
    return NextResponse.json({ error: "dia do vencimento inválido" }, { status: 400 });
  }
  if (periodicidade === "anual" && (!Number.isInteger(mes) || mes < 1 || mes > 12)) {
    return NextResponse.json(
      { error: "despesa anual precisa do mês de vencimento" },
      { status: 400 }
    );
  }

  const client = getSupabaseAdmin(admin.id);
  const { error } = await client.from("despesas_recorrentes").insert({
    descricao,
    categoria: String(body.categoria || "fixa"),
    fornecedor: body.fornecedor ? String(body.fornecedor).trim() : null,
    valor: n2(valor),
    dia_vencimento: dia,
    periodicidade,
    mes_vencimento: periodicidade === "anual" ? mes : null,
    aproximada: body.aproximada === true,
    observacao: body.observacao ? String(body.observacao).trim() : null,
  });
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ ok: true });
}
