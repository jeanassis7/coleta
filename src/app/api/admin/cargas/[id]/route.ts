import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { exigirAdmin } from "@/lib/auth/exigir-admin";

/**
 * DELETE: apaga uma carga INTEIRA — descarga, coletas, despesas,
 * abastecimentos, contas amarradas e fotos.
 *
 * Existe pro TESTE (perfil normal que se testa de verdade e se apaga
 * depois) e pra carga lançada por engano. Carga real de produção não se
 * apaga — o histórico é o lastro do estoque e do dinheiro; a tela confirma
 * digitando APAGAR antes de chegar aqui.
 *
 * Efeitos em cadeia, na ordem certa:
 *  - a descarga some → o estoque recalcula sozinho (a view soma na hora);
 *  - coletas/despesas/abastecimentos somem → o saldo do motorista sobe;
 *  - contas a pagar de origem (nota assinada, coleta da sede) somem se
 *    ainda não foram pagas — paga fica (o dinheiro saiu de verdade).
 */
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const admin = await exigirAdmin();
  if (!admin) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const { id } = await params;
  const client = getSupabaseAdmin(admin.id);

  const { data: carga } = await client
    .from("cargas")
    .select("id, foto_painel_path")
    .eq("id", id)
    .maybeSingle();
  if (!carga) {
    return NextResponse.json({ error: "carga não encontrada" }, { status: 404 });
  }

  const [{ data: coletas }, { data: despesas }, { data: abast }, { data: descargas }] =
    await Promise.all([
      client.from("coletas").select("id, foto_path").eq("carga_id", id),
      client.from("despesas").select("id, foto_path").eq("carga_id", id),
      client.from("abastecimentos").select("id, foto_path").eq("carga_id", id),
      client.from("descargas").select("id, foto_path").eq("carga_id", id),
    ]);
  const coletaIds = (coletas ?? []).map((c) => c.id);
  const abastIds = (abast ?? []).map((a) => a.id);

  // Contas de origem AINDA NÃO PAGAS morrem junto (o fato deixou de
  // existir). Paga fica de pé — apagar reescreveria o caixa.
  const { data: contasPagas } = await client
    .from("contas_a_pagar")
    .select("id")
    .eq("status", "paga")
    .or(
      [
        abastIds.length
          ? `and(origem_tipo.eq.abastecimento,origem_id.in.(${abastIds.join(",")}))`
          : "origem_id.eq.00000000-0000-0000-0000-000000000000",
        coletaIds.length
          ? `and(origem_tipo.eq.coleta,origem_id.in.(${coletaIds.join(",")}))`
          : "origem_id.eq.00000000-0000-0000-0000-000000000000",
      ].join(",")
    );
  const idsOrigem = [...abastIds, ...coletaIds];
  if (idsOrigem.length > 0) {
    const { error: eContas } = await client
      .from("contas_a_pagar")
      .delete()
      .in("origem_id", idsOrigem)
      .in("origem_tipo", ["abastecimento", "coleta"])
      .in("status", ["prevista", "a_pagar"]);
    if (eContas) return NextResponse.json({ error: eContas.message }, { status: 400 });
  }

  // Filhos primeiro, a carga por último.
  const passos: Array<() => PromiseLike<{ error: { message: string } | null }>> = [
    () => client.from("descargas").delete().eq("carga_id", id),
    () => client.from("coletas").delete().eq("carga_id", id),
    () => client.from("despesas").delete().eq("carga_id", id),
    () => client.from("abastecimentos").delete().eq("carga_id", id),
    () => client.from("cargas").delete().eq("id", id),
  ];
  for (const passo of passos) {
    const { error } = await passo();
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  }

  // Fotos por último — blob órfão é inócuo, dado órfão não.
  const paths = [
    ...(coletas ?? []).map((c) => c.foto_path),
    ...(despesas ?? []).map((d) => d.foto_path),
    ...(abast ?? []).map((a) => a.foto_path),
    ...(descargas ?? []).map((d) => d.foto_path),
    carga.foto_painel_path,
  ].filter((p): p is string => !!p);
  if (paths.length > 0) {
    await client.storage.from("fotos-coletas").remove(paths);
  }

  return NextResponse.json({
    ok: true,
    apagado: {
      coletas: coletaIds.length,
      despesas: (despesas ?? []).length,
      abastecimentos: abastIds.length,
      descargas: (descargas ?? []).length,
    },
    aviso:
      (contasPagas ?? []).length > 0
        ? "atenção: havia conta JÁ PAGA amarrada a lançamentos dessa carga — o pagamento continua no histórico e no DRE"
        : null,
  });
}
