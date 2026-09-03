import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { exigirAdmin } from "@/lib/auth/exigir-admin";

export async function POST(req: NextRequest) {
  const admin = await exigirAdmin();
  if (!admin) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const body = await req.json();
  const placa = String(body.placa || "").trim().toUpperCase();
  const marca = String(body.marca || "").trim();
  const modelo = body.modelo ? String(body.modelo).trim() : null;
  const cor = String(body.cor || "").trim();
  // CARRO não tem tanque de óleo nem tara — a 0018 já deixou as duas
  // colunas nulas pra ele (CHECK caminhao_precisa_tara_e_capacidade), mas
  // esta rota nunca mandou o `tipo` e exigia os dois de todo mundo: na
  // prática não existia como cadastrar um carro pelo painel. Apareceu na
  // hora de lançar a nota do posto no carro do sócio (03/09/2026).
  const tipo = body.tipo === "carro" ? "carro" : "caminhao";
  const de_quem = body.de_quem ? String(body.de_quem).trim() : null;
  const ehCaminhao = tipo === "caminhao";
  const capacidade_l = Number(body.capacidade_l);
  const tara_kg = Number(body.tara_kg);

  if (!placa || !marca || !cor) {
    return NextResponse.json({ error: "placa, marca e cor são obrigatórios" }, { status: 400 });
  }
  // Aceita antigo (AAA-0000) e Mercosul (AAA1B23)
  if (!/^[A-Z]{3}-?\d[A-Z0-9]\d{2}$/.test(placa)) {
    return NextResponse.json({ error: "placa em formato inválido" }, { status: 400 });
  }
  if (ehCaminhao && (!Number.isFinite(capacidade_l) || capacidade_l <= 0)) {
    return NextResponse.json({ error: "capacidade inválida" }, { status: 400 });
  }
  if (ehCaminhao && (!Number.isFinite(tara_kg) || tara_kg <= 0)) {
    return NextResponse.json({ error: "tara inválida" }, { status: 400 });
  }

  const client = getSupabaseAdmin(admin.id);
  const { data, error } = await client
    .from("caminhoes")
    .insert({
      placa, marca, modelo, cor, tipo, de_quem,
      capacidade_l: ehCaminhao ? Math.round(capacidade_l) : null,
      tara_kg: ehCaminhao ? Math.round(tara_kg) : null,
    })
    .select()
    .maybeSingle();
  if (error) {
    if (error.code === "23505") {
      return NextResponse.json({ error: "placa já cadastrada" }, { status: 400 });
    }
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
  return NextResponse.json({ ok: true, caminhao: data });
}
