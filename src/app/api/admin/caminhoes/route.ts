import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { exigirAcessoModulo1 } from "@/lib/auth/gate-modulo1";

// Módulo 1 — Estágio 1: dev-only. Promoção pro Jean é um flip em gate-modulo1.ts.
const exigirAdmin = exigirAcessoModulo1;

export async function POST(req: NextRequest) {
  const admin = await exigirAdmin();
  if (!admin) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const body = await req.json();
  const placa = String(body.placa || "").trim().toUpperCase();
  const marca = String(body.marca || "").trim();
  const modelo = body.modelo ? String(body.modelo).trim() : null;
  const cor = String(body.cor || "").trim();
  const capacidade_l = Number(body.capacidade_l);
  const tara_kg = Number(body.tara_kg);

  if (!placa || !marca || !cor) {
    return NextResponse.json({ error: "placa, marca e cor são obrigatórios" }, { status: 400 });
  }
  // Aceita antigo (AAA-0000) e Mercosul (AAA1B23)
  if (!/^[A-Z]{3}-?\d[A-Z0-9]\d{2}$/.test(placa)) {
    return NextResponse.json({ error: "placa em formato inválido" }, { status: 400 });
  }
  if (!Number.isFinite(capacidade_l) || capacidade_l <= 0) {
    return NextResponse.json({ error: "capacidade inválida" }, { status: 400 });
  }
  if (!Number.isFinite(tara_kg) || tara_kg <= 0) {
    return NextResponse.json({ error: "tara inválida" }, { status: 400 });
  }

  const client = getSupabaseAdmin(admin.id);
  const { data, error } = await client
    .from("caminhoes")
    .insert({
      placa, marca, modelo, cor,
      capacidade_l: Math.round(capacidade_l),
      tara_kg: Math.round(tara_kg),
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
