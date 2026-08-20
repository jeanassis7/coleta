import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { exigirAdmin } from "@/lib/auth/exigir-admin";

/**
 * POST: grava uma configuração avulsa do sistema (tabela `configuracoes`,
 * migration 0036). Allowlist explícita — configuração nova entra aqui de
 * propósito, não por acidente.
 *
 * `preco_referencia_litro`: R$/litro usado pra dar valor ao óleo no painel
 * do patrimônio (R87). É conta de cabeça, não custo médio — um valor só pra
 * fino e grosso, editável quando o mercado mudar.
 */
const CHAVES_VALIDAS = ["preco_referencia_litro"] as const;

export async function POST(req: NextRequest) {
  const admin = await exigirAdmin();
  if (!admin) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const body = await req.json();
  const chave = String(body.chave || "");
  if (!CHAVES_VALIDAS.includes(chave as (typeof CHAVES_VALIDAS)[number])) {
    return NextResponse.json({ error: "configuração desconhecida" }, { status: 400 });
  }

  const valor = Number(body.valor);
  if (!Number.isFinite(valor) || valor <= 0) {
    return NextResponse.json({ error: "valor inválido" }, { status: 400 });
  }

  const client = getSupabaseAdmin(admin.id);
  const { error } = await client.from("configuracoes").upsert({
    chave,
    valor: String(Math.round(valor * 100) / 100),
    atualizado_em: new Date().toISOString(),
    atualizado_por: admin.id,
  });
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ ok: true });
}
