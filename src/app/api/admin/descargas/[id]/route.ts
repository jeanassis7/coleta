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

/**
 * DELETE — apaga a descarga e REABRE a carga.
 *
 * Decisão do Evaner (14/09/2026): "um dedo errado do motorista pra bugar
 * tudo e sem poder voltar atrás é ruim."
 *
 * As sete nuances, varridas no código antes de escrever:
 *  N1 — o app do motorista precisa voltar a enxergar a carga (consertado em
 *       src/lib/motorista/carga.ts, commit anterior);
 *  N2 — reabrir zera status, encerrada_em E km_final (o posInsert do
 *       queue.ts grava os três ao encerrar; desfazer dois deixaria a carga
 *       rodando com km rodado já calculado);
 *  N3 — a comissão nasce da descarga: avisa se o período já foi pago;
 *  N5 — compra direta amarrada à carga perde o custo: BLOQUEIA;
 *  N6 — mostra o estoque resultante, inclusive negativo;
 *  N7 — a foto é foto_papel_path, não foto_path.
 */
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const admin = await exigirAdmin();
  if (!admin) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const { id } = await params;
  const confirmado = new URL(req.url).searchParams.get("confirmado") === "1";
  const client = getSupabaseAdmin(admin.id);

  const { data: descarga } = await client
    .from("descargas")
    .select("id, carga_id, peso_liquido_kg, foto_papel_path, criado_em")
    .eq("id", id)
    .maybeSingle();
  if (!descarga) {
    return NextResponse.json({ error: "descarga não encontrada" }, { status: 404 });
  }

  const { data: carga } = await client
    .from("cargas")
    .select("id, motorista_id, status")
    .eq("id", descarga.carga_id)
    .maybeSingle();
  if (!carga) {
    return NextResponse.json({ error: "carga não encontrada" }, { status: 404 });
  }

  // O motorista já tem outra carga aberta? O índice único
  // idx_cargas_uma_ativa_por_motorista proibiria o update e o erro sairia em
  // linguagem de banco. Explicar antes é melhor.
  const { data: outraAtiva } = await client
    .from("cargas")
    .select("id, iniciada_em")
    .eq("motorista_id", carga.motorista_id)
    .eq("status", "ativa")
    .neq("id", carga.id)
    .maybeSingle();
  if (outraAtiva) {
    return NextResponse.json(
      {
        error:
          "esse motorista já tem outra carga ATIVA. Reabrir esta deixaria duas abertas ao mesmo tempo, o que o sistema não permite. Encerre ou cancele a outra primeiro.",
      },
      { status: 409 }
    );
  }

  // N5 — a view movimentos_estoque (0050) soma no custo DESTA descarga as
  // compras diretas da carga com entra_no_estoque = false. Apagando a
  // descarga, esse dinheiro some do estoque inteiro: a compra não entra pela
  // própria linha (é excluída de propósito, senão o óleo contaria duas vezes)
  // e deixa de entrar por aqui. Bloqueia — buraco silencioso é pior que
  // trabalho extra.
  const { data: comprasAmarradas } = await client
    .from("compras_diretas")
    .select("id, valor, fornecedor")
    .eq("carga_id", carga.id)
    .eq("entra_no_estoque", false);
  if ((comprasAmarradas ?? []).length > 0) {
    return NextResponse.json(
      {
        error: `essa carga tem ${comprasAmarradas!.length} compra(s) direta(s) amarrada(s) cujo custo entra por esta descarga. Apagar faria esse dinheiro sumir do estoque. Desamarre ou apague a(s) compra(s) primeiro.`,
      },
      { status: 409 }
    );
  }

  // N6 — qual estoque sobra? Negativo pede segundo clique.
  const { data: estoque } = await client.rpc("estoque_atual");
  const fino = (estoque ?? []).find(
    (e: { tipo_oleo: string }) => e.tipo_oleo === "fino"
  );
  const saldoDepois =
    Number(fino?.saldo_kg ?? 0) - Number(descarga.peso_liquido_kg);
  if (saldoDepois < 0 && !confirmado) {
    return NextResponse.json(
      {
        precisa_confirmar: true,
        saldo_depois: saldoDepois,
        error: `apagar essa descarga deixa o estoque de óleo fino em ${saldoDepois.toLocaleString("pt-BR")} kg — NEGATIVO. Isso quer dizer que o óleo dela já foi vendido. Confirme se é isso mesmo.`,
      },
      { status: 409 }
    );
  }

  // N3 — a comissão daquele período muda. Avisa, não bloqueia: o fato mudou
  // de verdade. A comissão nasce da descarga (remuneracao.ts).
  const { data: comissaoPaga } = await client
    .from("contas_a_pagar")
    .select("id, pago_em")
    .eq("categoria", "comissao")
    .eq("pessoa_id", carga.motorista_id)
    .eq("status", "paga")
    .gte("pago_em", descarga.criado_em)
    .limit(1);
  const avisoComissao =
    (comissaoPaga ?? []).length > 0
      ? "atenção: já existe comissão PAGA a esse motorista depois da data desta descarga. O cálculo da comissão vai mudar e deixar de bater com o que foi pago."
      : null;

  const { error: errDel } = await client.from("descargas").delete().eq("id", id);
  if (errDel) return NextResponse.json({ error: errDel.message }, { status: 400 });

  // N2 — os TRÊS campos que o posInsert grava ao encerrar (queue.ts).
  const { error: errCarga } = await client
    .from("cargas")
    .update({ status: "ativa", encerrada_em: null, km_final: null })
    .eq("id", carga.id);
  if (errCarga) {
    return NextResponse.json(
      {
        error: `a descarga foi apagada mas a carga não reabriu: ${errCarga.message}. Avise o Evaner — a carga ficou encerrada sem descarga.`,
      },
      { status: 500 }
    );
  }

  // N7 — foto por último: blob órfão é inócuo, dado órfão não.
  if (descarga.foto_papel_path) {
    await client.storage.from("fotos-coletas").remove([descarga.foto_papel_path]);
  }

  return NextResponse.json({
    ok: true,
    carga_reaberta: carga.id,
    saldo_estoque_depois: saldoDepois,
    aviso: avisoComissao,
  });
}
