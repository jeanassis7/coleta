import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { exigirAcessoModulo1 } from "@/lib/auth/gate-modulo1";

// Módulo 1 — Estágio 1: dev-only. Promoção pro Jean é um flip em gate-modulo1.ts.
const exigirAdmin = exigirAcessoModulo1;

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const admin = await exigirAdmin();
  if (!admin) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const { id } = await params;
  const body = await req.json();
  const updates: Record<string, unknown> = {};
  if (body.umidade_pct !== undefined) {
    if (body.umidade_pct === null) {
      updates.umidade_pct = null;
    } else {
      const n = Number(body.umidade_pct);
      if (!Number.isFinite(n) || n < 0 || n > 100) {
        return NextResponse.json({ error: "umidade deve estar entre 0 e 100" }, { status: 400 });
      }
      updates.umidade_pct = n;
    }
  }
  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: "nada a atualizar" }, { status: 400 });
  }
  const client = getSupabaseAdmin(admin.id);
  const { error } = await client.from("descargas").update(updates).eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ ok: true });
}
