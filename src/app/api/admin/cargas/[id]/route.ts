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
      // ⚠️ A coluna da foto da descarga é foto_papel_path, não foto_path.
      // Com o nome errado a consulta errava, o `?? []` engolia, a foto do
      // papel da balança nunca era apagada e `apagado.descargas` reportava
      // sempre 0 — o endpoint mentia sobre o que tinha feito.
      client.from("descargas").select("id, foto_papel_path").eq("carga_id", id),
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
    ...(descargas ?? []).map((d) => d.foto_papel_path),
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

/**
 * PATCH — corrigir os dados da própria carga.
 *
 * km_inicial digitado errado envenena o km/L da frota inteira e, até
 * 14/09/2026, não tinha conserto: só existia o DELETE da carga toda.
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const admin = await exigirAdmin();
  if (!admin) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const { id } = await params;
  const body = await req.json();
  const confirmado = body.confirmado === true;
  const client = getSupabaseAdmin(admin.id);

  const { data: carga } = await client
    .from("cargas")
    .select("id, caminhao_id, km_inicial, km_final, iniciada_em")
    .eq("id", id)
    .maybeSingle();
  if (!carga) {
    return NextResponse.json({ error: "carga não encontrada" }, { status: 404 });
  }

  const updates: Record<string, unknown> = {};
  if (body.caminhao_id !== undefined) updates.caminhao_id = String(body.caminhao_id);
  if (body.iniciada_em !== undefined) updates.iniciada_em = String(body.iniciada_em);

  const kmInicial =
    body.km_inicial === undefined ? Number(carga.km_inicial) : Number(body.km_inicial);
  const kmFinal =
    body.km_final === undefined
      ? carga.km_final === null
        ? null
        : Number(carga.km_final)
      : body.km_final === null
        ? null
        : Number(body.km_final);

  if (body.km_inicial !== undefined) {
    if (!Number.isFinite(kmInicial) || kmInicial < 0) {
      return NextResponse.json({ error: "km inicial inválido" }, { status: 400 });
    }
    updates.km_inicial = kmInicial;
  }
  if (body.km_final !== undefined) {
    if (kmFinal !== null && (!Number.isFinite(kmFinal) || kmFinal < 0)) {
      return NextResponse.json({ error: "km final inválido" }, { status: 400 });
    }
    updates.km_final = kmFinal;
  }

  // Erro impossível: o caminhão não anda pra trás.
  if (kmFinal !== null && kmFinal <= kmInicial) {
    return NextResponse.json(
      {
        error: `o km final não fecha: saiu com ${kmInicial.toLocaleString("pt-BR")} km e voltou com ${kmFinal.toLocaleString("pt-BR")} km`,
      },
      { status: 400 }
    );
  }

  // Erro SUSPEITO (não impossível): salto grande contra o histórico do
  // caminhão. Mesmo número que o motorista já vê no celular — 1.500 km.
  if (body.km_inicial !== undefined && !confirmado) {
    const { data: vizinhas } = await client
      .from("cargas")
      .select("km_inicial, km_final")
      .eq("caminhao_id", carga.caminhao_id)
      .neq("id", id)
      .order("iniciada_em", { ascending: false })
      .limit(5);
    const kms = (vizinhas ?? [])
      .flatMap((c) => [c.km_inicial, c.km_final])
      .filter((k): k is number => typeof k === "number");
    const maisProximo = kms.length
      ? kms.reduce((a, b) => (Math.abs(b - kmInicial) < Math.abs(a - kmInicial) ? b : a))
      : null;
    if (maisProximo !== null && Math.abs(maisProximo - kmInicial) > 1500) {
      return NextResponse.json(
        {
          precisa_confirmar: true,
          error: `${kmInicial.toLocaleString("pt-BR")} km está a mais de 1.500 km do registro mais próximo desse caminhão (${maisProximo.toLocaleString("pt-BR")} km). Confira se não faltou ou sobrou um dígito.`,
        },
        { status: 409 }
      );
    }
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: "nada a atualizar" }, { status: 400 });
  }

  const { error } = await client.from("cargas").update(updates).eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ ok: true });
}
