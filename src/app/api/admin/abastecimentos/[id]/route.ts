import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { exigirAdmin } from "@/lib/auth/exigir-admin";

/**
 * PATCH: admin corrige um abastecimento lançado errado (mesmo com o
 * antiburro do app, erro humano acontece). Campos: posto_nome, litros,
 * valor, km_atual — e `pago_na_hora`, porque o motorista erra o botão.
 *
 * A troca de `pago_na_hora` arrasta a contrapartida:
 *   • PAGUEI AGORA → ASSINEI A NOTA: o gasto sai do saldo do motorista e a
 *     conta a pagar do posto nasce aqui (o trigger 0034 só cobre INSERT).
 *   • ASSINEI A NOTA → PAGUEI AGORA: a conta morre — se ainda não foi paga.
 *     Paga, a troca é recusada: primeiro se apaga o pagamento (que devolve
 *     o dinheiro pra conta), senão o caixa registraria um pagamento de uma
 *     dívida que deixou de existir.
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

  const { data: atual, error: eAtual } = await client
    .from("abastecimentos")
    .select("id, pago_na_hora, valor, posto_nome, tipo")
    .eq("id", id)
    .maybeSingle();
  if (eAtual) return NextResponse.json({ error: eAtual.message }, { status: 400 });
  if (!atual) return NextResponse.json({ error: "abastecimento não encontrado" }, { status: 404 });

  const updates: Record<string, unknown> = {};
  if (typeof body.posto_nome === "string" && body.posto_nome.trim()) {
    updates.posto_nome = body.posto_nome.trim();
  }
  if (body.litros !== undefined) {
    const n = Number(body.litros);
    if (!Number.isFinite(n) || n <= 0) {
      return NextResponse.json({ error: "litros inválido" }, { status: 400 });
    }
    updates.litros = Math.round(n * 100) / 100;
  }
  if (body.valor !== undefined) {
    const n = Number(body.valor);
    if (!Number.isFinite(n) || n <= 0) {
      return NextResponse.json({ error: "valor inválido" }, { status: 400 });
    }
    updates.valor = Math.round(n * 100) / 100;
  }
  if (body.km_atual !== undefined) {
    const n = Number(body.km_atual);
    if (!Number.isFinite(n) || n <= 0) {
      return NextResponse.json({ error: "km inválido" }, { status: 400 });
    }
    updates.km_atual = Math.round(n);
  }

  // ------------------------------------------------------------ o botão
  const trocaPago =
    typeof body.pago_na_hora === "boolean" &&
    body.pago_na_hora !== atual.pago_na_hora
      ? (body.pago_na_hora as boolean)
      : null;

  if (trocaPago === true) {
    // ASSINEI A NOTA → PAGUEI AGORA: a dívida com o posto deixa de existir.
    const { data: contaPaga } = await client
      .from("contas_a_pagar")
      .select("id")
      .eq("origem_tipo", "abastecimento")
      .eq("origem_id", id)
      .eq("status", "paga")
      .maybeSingle();
    if (contaPaga) {
      return NextResponse.json(
        {
          error:
            "a conta dessa nota já foi PAGA — apague o pagamento primeiro (em Lançamentos, o dinheiro volta pra conta) e aí troque pra 'paguei na hora'",
        },
        { status: 409 }
      );
    }
    const { error: eDelConta } = await client
      .from("contas_a_pagar")
      .delete()
      .eq("origem_tipo", "abastecimento")
      .eq("origem_id", id)
      .in("status", ["prevista", "a_pagar"]);
    if (eDelConta) {
      return NextResponse.json({ error: eDelConta.message }, { status: 400 });
    }
    updates.pago_na_hora = true;
  } else if (trocaPago === false) {
    updates.pago_na_hora = false;
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: "nada a atualizar" }, { status: 400 });
  }

  const { error } = await client.from("abastecimentos").update(updates).eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  const avisos: string[] = [];
  const rotuloTipo = atual.tipo === "arla" ? "ARLA" : "Diesel";
  const postoFinal = (updates.posto_nome as string) ?? atual.posto_nome;
  const valorFinal = (updates.valor as number) ?? Number(atual.valor);

  if (trocaPago === false) {
    // PAGUEI AGORA → ASSINEI A NOTA: a conta nasce aqui, espelhando o
    // trigger 0034 (que é só de INSERT). Vencimento padrão: dia 1 do mês
    // seguinte, no fuso BR — o Jean ajusta em Contas a pagar se for outro.
    const { data: jaExiste } = await client
      .from("contas_a_pagar")
      .select("id")
      .eq("origem_tipo", "abastecimento")
      .eq("origem_id", id)
      .in("status", ["prevista", "a_pagar", "paga"])
      .maybeSingle();
    if (!jaExiste) {
      const hojeBr = new Date(Date.now() - 3 * 60 * 60 * 1000);
      const venc = new Date(
        Date.UTC(hojeBr.getUTCFullYear(), hojeBr.getUTCMonth() + 1, 1)
      )
        .toISOString()
        .slice(0, 10);
      const { error: eNova } = await client.from("contas_a_pagar").insert({
        descricao: `${rotuloTipo} (nota assinada) — ${postoFinal}`,
        fornecedor: postoFinal,
        categoria: "combustivel",
        valor: valorFinal,
        vencimento: venc,
        status: "a_pagar",
        origem_tipo: "abastecimento",
        origem_id: id,
        registrado_por: admin.id,
      });
      if (eNova) {
        // O flip já aconteceu — sem a conta, o gasto sumiria dos dois lados.
        // Volta o abastecimento pro estado anterior e explica.
        await client
          .from("abastecimentos")
          .update({ pago_na_hora: true })
          .eq("id", id);
        return NextResponse.json(
          {
            error: `não consegui criar a conta a pagar do posto (${eNova.message}) — a troca foi desfeita, tenta de novo`,
          },
          { status: 500 }
        );
      }
    }
    avisos.push(
      "virou nota assinada: o gasto saiu do saldo do motorista e a dívida com o posto está em Contas a pagar (vencimento dia 1 do mês que vem)"
    );
  }
  if (trocaPago === true) {
    avisos.push(
      "virou 'paguei na hora': o gasto voltou a descontar do saldo do motorista e a dívida com o posto foi removida"
    );
  }

  // Nota assinada tem conta a pagar amarrada. Corrigir o valor ou o posto
  // do abastecimento corrige a dívida junto — senão o motorista lançou
  // R$ 800, você corrige pra 680, e a dívida com o posto continuava R$ 800.
  // Conta já PAGA fica quieta: é história.
  if (updates.valor !== undefined || updates.posto_nome !== undefined) {
    const ajusteConta: Record<string, unknown> = {};
    if (updates.valor !== undefined) ajusteConta.valor = updates.valor;
    if (updates.posto_nome !== undefined) {
      ajusteConta.fornecedor = updates.posto_nome;
      ajusteConta.descricao = `${rotuloTipo} (nota assinada) — ${updates.posto_nome}`;
    }
    const { error: eConta } = await client
      .from("contas_a_pagar")
      .update(ajusteConta)
      .eq("origem_tipo", "abastecimento")
      .eq("origem_id", id)
      .in("status", ["prevista", "a_pagar"]);
    if (eConta) {
      avisos.push(
        `a conta a pagar amarrada não acompanhou a correção: ${eConta.message}`
      );
    }
  }
  return NextResponse.json({
    ok: true,
    ...(avisos.length > 0 ? { aviso: avisos.join(". ") } : {}),
  });
}

/**
 * DELETE: apaga o abastecimento e a foto do cupom.
 * Atenção: o saldo do motorista é calculado somando os gastos, então
 * apagar um abastecimento AUMENTA o saldo dele na mesma hora. A UI avisa.
 */
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const admin = await exigirAdmin();
  if (!admin) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const { id } = await params;
  const client = getSupabaseAdmin(admin.id);

  const { data: abast } = await client
    .from("abastecimentos")
    .select("foto_path")
    .eq("id", id)
    .maybeSingle();

  // A conta a pagar da nota assinada morre junto com o fato — se ainda não
  // foi paga. Se JÁ FOI, o dinheiro saiu de verdade: a conta fica (vira
  // histórico), e quem apagou fica sabendo.
  const { data: contaPaga } = await client
    .from("contas_a_pagar")
    .select("id")
    .eq("origem_tipo", "abastecimento")
    .eq("origem_id", id)
    .eq("status", "paga")
    .maybeSingle();
  const { error: eConta } = await client
    .from("contas_a_pagar")
    .delete()
    .eq("origem_tipo", "abastecimento")
    .eq("origem_id", id)
    .in("status", ["prevista", "a_pagar"]);
  if (eConta) return NextResponse.json({ error: eConta.message }, { status: 400 });

  const { error } = await client.from("abastecimentos").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  if (abast?.foto_path) {
    await client.storage.from("fotos-coletas").remove([abast.foto_path]);
  }
  return NextResponse.json({
    ok: true,
    ...(contaPaga
      ? {
          aviso:
            "a conta dessa nota JÁ FOI PAGA — o pagamento continua no histórico e no DRE; confira se o estorno com o posto aconteceu de verdade",
        }
      : {}),
  });
}
