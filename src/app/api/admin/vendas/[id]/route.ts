import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { exigirAdmin } from "@/lib/auth/exigir-admin";
const n2 = (v: number) => Math.round(v * 100) / 100;

/**
 * PATCH: corrige os campos SIMPLES de uma venda — data, comprador, preço,
 * número da nota, observação.
 *
 * Peso e mistura ficam DE FORA de propósito: mexem no estoque
 * retroativamente (a saída muda de tamanho no meio do custo médio móvel).
 * Errou o peso, o caminho honesto é apagar e relançar.
 *
 * Preço pode: o estoque sai por custo médio, não pelo preço de venda — o
 * preço só muda o valor_total, e a conta corrente do comprador recalcula
 * sozinha.
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

  const { data: venda, error: eVenda } = await client
    .from("vendas")
    .select(
      "id, comprador_id, peso_total_kg, preco_kg, valor_total, valor_combinado, desconto_umidade"
    )
    .eq("id", id)
    .maybeSingle();
  if (eVenda) return NextResponse.json({ error: eVenda.message }, { status: 400 });
  if (!venda) return NextResponse.json({ error: "venda não encontrada" }, { status: 404 });

  const updates: Record<string, unknown> = {};

  // ------------------------------------------------------------------
  // DESCONTO DE UMIDADE (0067) — lançado DEPOIS, quando a análise do
  // comprador chega. Ação própria, não campo solto: ela guarda o valor
  // combinado antes de mexer, e é isso que deixa o "por quê" visível
  // daqui a seis meses.
  // ------------------------------------------------------------------
  if (body.acao === "desconto_umidade") {
    const desconto = Number(body.desconto);
    if (!Number.isFinite(desconto) || desconto < 0) {
      return NextResponse.json({ error: "desconto inválido" }, { status: 400 });
    }
    const quando = String(body.quando || "");
    if (!/^d{4}-d{2}-d{2}$/.test(quando)) {
      return NextResponse.json(
        { error: "diga a data em que a análise chegou" },
        { status: 400 }
      );
    }
    // A base é SEMPRE o combinado: lançar o desconto duas vezes (análise
    // corrigida) recalcula em cima do valor original, não em cascata.
    const combinado = n2(
      Number(venda.valor_combinado ?? venda.valor_total)
    );
    if (desconto >= combinado) {
      return NextResponse.json(
        {
          error: `o desconto (R$ ${desconto.toFixed(2)}) não pode ser maior que a venda (R$ ${combinado.toFixed(2)}). Se eles devolveram a carga, apague a venda em vez de zerar o valor.`,
        },
        { status: 400 }
      );
    }
    const final = n2(combinado - desconto);
    const peso = Number(venda.peso_total_kg);
    const { error } = await client
      .from("vendas")
      .update({
        valor_combinado: combinado,
        desconto_umidade: n2(desconto),
        desconto_umidade_em: quando,
        desconto_umidade_obs: body.observacao
          ? String(body.observacao).trim()
          : null,
        // valor_total continua sendo o VALOR FINAL: saldo do comprador e
        // receita do DRE seguem lendo só ele e continuam certos.
        valor_total: final,
        ...(peso > 0
          ? { preco_kg: Math.round((final / peso) * 10000) / 10000 }
          : {}),
      })
      .eq("id", id);
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    return NextResponse.json({ ok: true, valor_final: final });
  }

  if (body.data !== undefined) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(body.data))) {
      return NextResponse.json({ error: "data inválida" }, { status: 400 });
    }
    updates.data = body.data;
  }

  // ---------------------------------------------------------------------
  // RÉGUA DO DINHEIRO #6 — o total NÃO é sempre peso × preço
  // ---------------------------------------------------------------------
  // A tela convida a arredondar o total ("pode arredondar aqui — o R$/kg
  // se ajusta sozinho"), então uma venda legítima tem total 20.320 com
  // preço 1,69 num peso de 12.000 (que daria 20.280). Recalcular o total
  // em TODA edição — e a tela manda `preco_kg` mesmo quando o usuário só
  // mexeu no nº da nota — comia R$ 40 da dívida do comprador sem ninguém
  // tocar em valor. Agora: só recalcula quando o preço MUDOU de verdade.
  if (body.preco_kg !== undefined) {
    const preco = Number(body.preco_kg);
    if (!Number.isFinite(preco) || preco <= 0) {
      return NextResponse.json({ error: "preço inválido" }, { status: 400 });
    }
    const precoNovo = Math.round(preco * 10000) / 10000;
    const precoAtual = Math.round(Number(venda.preco_kg) * 10000) / 10000;
    if (precoNovo !== precoAtual) {
      updates.preco_kg = precoNovo;
      updates.valor_total = n2(Number(venda.peso_total_kg) * precoNovo);
    }
  }
  // Total informado explicitamente manda: é ele que vira a dívida do
  // comprador, e o preço/kg é que se ajusta (mesma regra da tela de venda).
  if (body.valor_total !== undefined) {
    const total = Number(body.valor_total);
    if (!Number.isFinite(total) || total <= 0) {
      return NextResponse.json({ error: "valor total inválido" }, { status: 400 });
    }
    updates.valor_total = n2(total);
    const peso = Number(venda.peso_total_kg);
    if (peso > 0) updates.preco_kg = Math.round((total / peso) * 10000) / 10000;
  }

  if (body.comprador_id !== undefined) {
    const novo = String(body.comprador_id || "");
    if (!novo) {
      return NextResponse.json({ error: "comprador não informado" }, { status: 400 });
    }
    if (novo !== venda.comprador_id) {
      // Recebimento vinculado é do comprador ANTIGO — mudar a venda de dono
      // deixaria o pagamento de um apontando pra venda de outro, e os dois
      // saldos errados. Sem vínculo, a troca é limpa: o saldo dos dois
      // compradores recalcula sozinho.
      const { count } = await client
        .from("recebimentos")
        .select("id", { count: "exact", head: true })
        .eq("venda_id", id);
      if ((count ?? 0) > 0) {
        return NextResponse.json(
          {
            error:
              "essa venda tem pagamento vinculado a ela — apague o pagamento primeiro (na ficha do comprador) pra poder trocar o comprador",
          },
          { status: 409 }
        );
      }
      updates.comprador_id = novo;
    }
  }

  if (body.nota_numero !== undefined) {
    updates.nota_numero = body.nota_numero ? String(body.nota_numero).trim() : null;
  }
  if (body.observacao !== undefined) {
    updates.observacao = body.observacao ? String(body.observacao).trim() : null;
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: "nada a atualizar" }, { status: 400 });
  }

  const { error } = await client.from("vendas").update(updates).eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ ok: true });
}

/**
 * DELETE: apaga a venda lançada errado.
 *
 * Os recebimentos ficam (o `venda_id` vira null pela FK on delete set null):
 * o dinheiro entrou de verdade e continua valendo na conta do comprador.
 * Apagar o pagamento junto faria o cliente "voltar a dever" algo que já
 * pagou. Os cheques também ficam — o papel existe.
 */
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const admin = await exigirAdmin();
  if (!admin) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const { id } = await params;
  const client = getSupabaseAdmin(admin.id);

  const { data: venda } = await client
    .from("vendas")
    .select("foto_ticket_path")
    .eq("id", id)
    .maybeSingle();

  // Se já tem pagamento vinculado, o comprador vai ficar com CRÉDITO no
  // saldo (pagou por uma venda que deixou de existir). Não é bloqueio — é
  // aviso: o crédito precisa virar alguma coisa (outra venda, devolução).
  const { count: nRec } = await client
    .from("recebimentos")
    .select("id", { count: "exact", head: true })
    .eq("venda_id", id);

  const { error } = await client.from("vendas").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  if (venda?.foto_ticket_path) {
    await client.storage.from("fotos-coletas").remove([venda.foto_ticket_path]);
  }
  return NextResponse.json({
    ok: true,
    ...((nRec ?? 0) > 0
      ? {
          aviso:
            "essa venda já tinha pagamento: o dinheiro continua valendo e o comprador fica com CRÉDITO no saldo — abata numa próxima venda ou apague o pagamento na ficha dele",
        }
      : {}),
  });
}
