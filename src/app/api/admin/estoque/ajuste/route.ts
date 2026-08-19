import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { exigirAdmin } from "@/lib/auth/exigir-admin";

// Módulo 2 herda o gate do Módulo 1 (dev-only até o Evaner liberar).
/**
 * POST: registra um inventário (ou a abertura) do estoque.
 *
 * O saldo anterior e o custo médio NÃO vêm do cliente — são recalculados
 * aqui na hora do insert. A tela mostra uma prévia, mas se ela estivesse
 * velha (outra aba, outra descarga chegando no meio), a linha gravada
 * ficaria mentindo pra sempre: `saldo_antes_kg` e `custo_medio_kg` são
 * congelados e nunca mais recalculados.
 */
export async function POST(req: NextRequest) {
  const admin = await exigirAdmin();
  if (!admin) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const body = await req.json();
  const tipo_oleo = String(body.tipo_oleo || "");
  const saldo_novo_kg = Number(body.saldo_novo_kg);
  const motivo = String(body.motivo || "").trim();
  const data = String(body.data || "").trim();

  if (!["fino", "grosso"].includes(tipo_oleo)) {
    return NextResponse.json({ error: "tipo de óleo inválido" }, { status: 400 });
  }
  if (!Number.isFinite(saldo_novo_kg) || saldo_novo_kg < 0) {
    return NextResponse.json({ error: "quantidade inválida" }, { status: 400 });
  }
  if (motivo.length < 3) {
    return NextResponse.json(
      { error: "escreva o motivo do ajuste" },
      { status: 400 }
    );
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(data)) {
    return NextResponse.json({ error: "data inválida" }, { status: 400 });
  }

  const client = getSupabaseAdmin(admin.id);

  const { data: estoque, error: erroEstoque } = await client.rpc("estoque_atual");
  if (erroEstoque) {
    return NextResponse.json({ error: erroEstoque.message }, { status: 500 });
  }

  const atual = ((estoque as Array<{
    tipo_oleo: string;
    saldo_kg: number;
    custo_medio_kg: number;
  }>) || []).find((l) => l.tipo_oleo === tipo_oleo);

  const saldo_antes_kg = Number(atual?.saldo_kg ?? 0);
  const cmVigente = Number(atual?.custo_medio_kg ?? 0);

  // Sem custo médio vigente não há o que preservar: é a ABERTURA, e o
  // custo por kg tem que vir do gestor. Se nascesse zero, toda margem
  // calculada daqui pra frente ficaria otimista sem nenhum sinal na tela.
  const ehAbertura = cmVigente <= 0;
  let custo_medio_kg = cmVigente;

  if (ehAbertura) {
    const informado = Number(body.custo_medio_kg);
    if (!Number.isFinite(informado) || informado <= 0) {
      return NextResponse.json(
        { error: "na abertura é preciso informar quanto custa o kg" },
        { status: 400 }
      );
    }
    custo_medio_kg = Math.round(informado * 10000) / 10000;
  }

  const { data: criado, error } = await client
    .from("ajustes_estoque")
    .insert({
      tipo_oleo,
      motivo_tipo: ehAbertura ? "abertura" : "inventario",
      saldo_antes_kg: Math.round(saldo_antes_kg * 100) / 100,
      saldo_novo_kg: Math.round(saldo_novo_kg * 100) / 100,
      custo_medio_kg,
      motivo,
      data,
      registrado_por: admin.id,
    })
    .select()
    .maybeSingle();

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ ok: true, ajuste: criado });
}
