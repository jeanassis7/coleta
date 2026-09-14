import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { exigirAdmin } from "@/lib/auth/exigir-admin";

/**
 * Umidade da descarga — TRÊS estados, não dois (ver migration 0057):
 *
 *   umidade_pct = 7.5            → analisada, com número
 *   umidade_nao_analisada = true → a análise não foi feita (decisão registrada)
 *   os dois vazios               → ainda não se sabe (o alerta cobra)
 *
 * Os dois campos são mutuamente exclusivos e o banco tem CHECK pra isso.
 * Por isso cada caminho aqui grava OS DOIS: mandar só um deixaria a linha
 * batendo no constraint e o gestor levaria um erro sem entender por quê.
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const admin = await exigirAdmin();
  if (!admin) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const { id } = await params;
  const body = await req.json();
  const client = getSupabaseAdmin(admin.id);
  const updates: Record<string, unknown> = {};

  if (body.umidade_pct !== undefined) {
    if (body.umidade_pct === null) {
      // "Apagar umidade" volta pra pendente — some o número E a marca.
      updates.umidade_pct = null;
      updates.umidade_nao_analisada = false;
    } else {
      const n = Number(body.umidade_pct);
      if (!Number.isFinite(n) || n < 0 || n > 100) {
        return NextResponse.json({ error: "umidade deve estar entre 0 e 100" }, { status: 400 });
      }
      updates.umidade_pct = n;
      // Lançou número: a análise foi feita, então a marca cai sozinha.
      updates.umidade_nao_analisada = false;
    }
  }

  if (body.umidade_nao_analisada !== undefined) {
    const marcar = body.umidade_nao_analisada === true;
    if (marcar && updates.umidade_pct != null) {
      return NextResponse.json(
        { error: "não dá pra marcar como não analisada e mandar um número junto" },
        { status: 400 }
      );
    }
    updates.umidade_nao_analisada = marcar;
    if (marcar) updates.umidade_pct = null;
  }

  // ── Peso (14/09/2026) ───────────────────────────────────────────────────
  // Até aqui o PATCH só aceitava umidade: peso errado da balança não tinha
  // conserto a não ser apagar a carga inteira — e é o número que define o
  // estoque todo.
  //
  // peso_liquido_kg é GENERATED ALWAYS: recalcula sozinho, não se escreve.
  const querMexerNoPeso =
    body.peso_bruto_kg !== undefined || body.peso_tara_kg !== undefined;

  if (querMexerNoPeso) {
    const { data: atual } = await client
      .from("descargas")
      .select("peso_bruto_kg, peso_tara_kg")
      .eq("id", id)
      .maybeSingle();
    if (!atual) {
      return NextResponse.json({ error: "descarga não encontrada" }, { status: 404 });
    }
    const bruto =
      body.peso_bruto_kg === undefined
        ? Number(atual.peso_bruto_kg)
        : Number(body.peso_bruto_kg);
    const tara =
      body.peso_tara_kg === undefined
        ? Number(atual.peso_tara_kg)
        : Number(body.peso_tara_kg);

    if (!Number.isFinite(bruto) || bruto <= 0) {
      return NextResponse.json({ error: "peso bruto inválido" }, { status: 400 });
    }
    if (!Number.isFinite(tara) || tara <= 0) {
      return NextResponse.json({ error: "tara inválida" }, { status: 400 });
    }
    // Erro impossível: bloqueia. O caminhão não pesa menos que ele mesmo.
    if (bruto <= tara) {
      return NextResponse.json(
        {
          error: `o peso bruto (${bruto} kg) precisa ser MAIOR que a tara (${tara} kg) — senão a carga teria peso líquido zero ou negativo`,
        },
        { status: 400 }
      );
    }
    if (body.peso_bruto_kg !== undefined) updates.peso_bruto_kg = bruto;
    if (body.peso_tara_kg !== undefined) updates.peso_tara_kg = tara;
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: "nada a atualizar" }, { status: 400 });
  }
  const { error } = await client.from("descargas").update(updates).eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ ok: true });
}
