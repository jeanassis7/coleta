import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { exigirAdmin } from "@/lib/auth/exigir-admin";


/**
 * POST /api/admin/coletas/bulk-delete
 * Body: { ids: string[] }
 * Apaga coletas em lote + remove fotos do Storage.
 */
export async function POST(req: NextRequest) {
  const admin = await exigirAdmin();
  if (!admin) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const body = await req.json();
  const ids = Array.isArray(body.ids) ? body.ids.map(String) : [];
  if (ids.length === 0) {
    return NextResponse.json({ error: "ids vazio" }, { status: 400 });
  }
  if (ids.length > 200) {
    return NextResponse.json(
      { error: "máximo 200 por vez" },
      { status: 400 }
    );
  }

  const adminClient = getSupabaseAdmin(admin.id);

  // 1. Busca fotos pra apagar do Storage
  const { data: coletasComFoto } = await adminClient
    .from("coletas")
    .select("foto_path")
    .in("id", ids)
    .not("foto_path", "is", null);

  const paths = (coletasComFoto || [])
    .map((c) => c.foto_path)
    .filter((p): p is string => !!p);

  if (paths.length > 0) {
    await adminClient.storage.from("fotos-coletas").remove(paths);
  }

  // 2. Contas amarradas (coleta paga pela sede): as ABERTAS morrem junto —
  // dívida de óleo que deixou de existir é dívida-fantasma. As PAGAS ficam
  // (o dinheiro da empresa saiu de verdade) e o aviso conta quantas.
  const { data: contasPagas } = await adminClient
    .from("contas_a_pagar")
    .select("id")
    .eq("origem_tipo", "coleta")
    .in("origem_id", ids)
    .eq("status", "paga");
  const { error: eContas } = await adminClient
    .from("contas_a_pagar")
    .delete()
    .eq("origem_tipo", "coleta")
    .in("origem_id", ids)
    .in("status", ["prevista", "a_pagar"]);
  if (eContas) {
    return NextResponse.json({ error: eContas.message }, { status: 400 });
  }

  // 3. Apaga as coletas
  const { error } = await adminClient.from("coletas").delete().in("id", ids);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  return NextResponse.json({
    ok: true,
    apagadas: ids.length,
    fotos_apagadas: paths.length,
    ...((contasPagas?.length ?? 0) > 0
      ? {
          aviso: `${contasPagas!.length} coleta(s) paga(s) pela sede tinham conta JÁ PAGA — os pagamentos continuam no histórico e no DRE`,
        }
      : {}),
  });
}
