import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { exigirAdmin } from "@/lib/auth/exigir-admin";


interface RouteParams {
  params: Promise<{ id: string }>;
}

const CAMPOS_EDITAVEIS = [
  "litros",
  "local_nome",
  "valor_pago",
  "certificado_tipo",
  "litros_certificado",
  "observacao",
  "pago_pela_sede",
  "valor_sede",
] as const;

type CampoEditavel = (typeof CAMPOS_EDITAVEIS)[number];

export async function PATCH(req: NextRequest, { params }: RouteParams) {
  const admin = await exigirAdmin();
  if (!admin) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const { id } = await params;

  // `vencimento` não é campo da coleta — só acompanha a marcação de
  // "pagamento pela sede" pra datar a conta a pagar que nasce dela.
  const body = (await req.json()) as Partial<Record<CampoEditavel, unknown>> & {
    vencimento?: string;
    /** "a sede já pagou à vista": a conta nasce PAGA com forma+conta+data. */
    pagamento_sede?: { forma?: string; conta_id?: string; pago_em?: string };
  };

  // Valida e monta updates
  const updates: Record<string, unknown> = {};

  if (typeof body.litros === "number" && body.litros > 0) {
    updates.litros = body.litros;
  }
  if (typeof body.local_nome === "string" && body.local_nome.trim()) {
    updates.local_nome = body.local_nome.trim();
  }
  // Zero é válido: doação (R2, 0031). O PATCH ignorava o zero EM SILÊNCIO —
  // a tela dizia salvo e o valor antigo ficava.
  if (typeof body.valor_pago === "number" && body.valor_pago >= 0) {
    updates.valor_pago = Math.round(body.valor_pago);
  }
  if (
    typeof body.certificado_tipo === "string" &&
    ["integral", "parcial", "nao"].includes(body.certificado_tipo)
  ) {
    updates.certificado_tipo = body.certificado_tipo;
  }
  if (body.litros_certificado === null) {
    updates.litros_certificado = null;
  } else if (
    typeof body.litros_certificado === "number" &&
    body.litros_certificado > 0
  ) {
    updates.litros_certificado = body.litros_certificado;
  }
  if (body.observacao === null) {
    updates.observacao = null;
  } else if (typeof body.observacao === "string") {
    const trimmed = body.observacao.trim();
    updates.observacao = trimmed || null;
  }

  const adminClient = getSupabaseAdmin(admin.id);

  // Estado ANTES: diz se está marcando agora ou se já estava marcada (evita
  // criar a mesma dívida duas vezes ao salvar de novo) e, desde a 0058,
  // serve pra validar a parte da sede contra o valor total.
  const { data: antes } = await adminClient
    .from("coletas")
    .select("pago_pela_sede, valor_pago, valor_sede, local_nome, criado_em")
    .eq("id", id)
    .maybeSingle();

  // -------------------------------------------------------------------
  // Quanto a SEDE bancou (0058) — são três números, não dois
  // -------------------------------------------------------------------
  //   valor_pago  = quanto o óleo custou (vai pro estoque)
  //   valor_sede  = quanto disso a empresa pagou direto ao fornecedor
  //   a diferença = quanto saiu do bolso do motorista
  //
  // O banco tem CHECK amarrando `pago_pela_sede = (valor_sede > 0)`, então o
  // par é gravado JUNTO aqui. Deixar a tela mandar os dois separados criaria
  // dois donos da mesma verdade — e o save morreria num erro de constraint
  // que pro gestor não quer dizer nada.
  const valorAntes = Number(antes?.valor_pago ?? 0);
  const sedeAntes = Number(antes?.valor_sede ?? 0);
  const valorFinal =
    updates.valor_pago !== undefined ? Number(updates.valor_pago) : valorAntes;

  let sedeFinal: number | null = null;
  if (typeof body.valor_sede === "number" && Number.isFinite(body.valor_sede)) {
    sedeFinal = Math.max(0, Math.round(body.valor_sede));
  } else if (body.pago_pela_sede === true) {
    // Compat com quem manda só o sim/não: a sede bancou o óleo inteiro.
    sedeFinal = valorFinal;
  } else if (body.pago_pela_sede === false) {
    sedeFinal = 0;
  } else if (updates.valor_pago !== undefined && sedeAntes > 0) {
    // Corrigiu só o total de uma coleta que já tinha parte da sede: a parte
    // dela não muda sozinha — mas não pode passar do total novo.
    sedeFinal = sedeAntes;
  }

  if (sedeFinal !== null && sedeFinal > valorFinal) {
    return NextResponse.json(
      {
        error:
          `a sede não pode ter pago R$ ${sedeFinal.toLocaleString("pt-BR")} de um óleo que custou ` +
          `R$ ${valorFinal.toLocaleString("pt-BR")}. Corrija o valor total da coleta primeiro, ou baixe a parte da sede.`,
      },
      { status: 400 }
    );
  }

  if (sedeFinal !== null) {
    updates.valor_sede = sedeFinal;
    updates.pago_pela_sede = sedeFinal > 0;
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: "nada a atualizar" }, { status: 400 });
  }

  const { error } = await adminClient
    .from("coletas")
    .update(updates)
    .eq("id", id);

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  const marcandoAgora =
    updates.pago_pela_sede === true && antes?.pago_pela_sede !== true;

  if (marcandoAgora) {
    // A dívida é da PARTE DA SEDE (0058), não do valor cheio da coleta: o
    // que o motorista tirou do bolso já saiu do caixa dele, não do da empresa.
    const valor = Number(updates.valor_sede ?? antes?.valor_sede ?? 0);
    const fornecedor = String(updates.local_nome ?? antes?.local_nome ?? "").trim();
    // Sem vencimento informado, cai no dia 1 do mês que vem — que é como
    // o combinado costuma ser ("pago início mês que vem").
    let vencimento = String(body.vencimento || "");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(vencimento)) {
      const hoje = new Date(Date.now() - 3 * 60 * 60 * 1000);
      const prox = new Date(Date.UTC(hoje.getUTCFullYear(), hoje.getUTCMonth() + 1, 1));
      vencimento = prox.toISOString().slice(0, 10);
    }

    // A sede pode JÁ TER PAGO na hora (PIX no ato): a conta nasce PAGA, com
    // forma + conta + data — desconta o caixa e entra no DRE no dia do
    // pagamento. Senão, nasce a pagar com o vencimento.
    const ps = body.pagamento_sede as
      | { forma?: string; conta_id?: string; pago_em?: string }
      | undefined;
    const jaPagou =
      !!ps &&
      !!ps.conta_id &&
      ["pix", "dinheiro", "deposito"].includes(String(ps.forma));
    // "Já pagou" sem data = pagou HOJE (cair no vencimento default jogaria
    // o pagamento pro mês que vem — um pagamento feito no futuro).
    const pagoEmSede =
      ps?.pago_em && /^\d{4}-\d{2}-\d{2}$/.test(String(ps.pago_em))
        ? String(ps.pago_em)
        : new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString().slice(0, 10);

    if (valor > 0) {
      const { error: eConta } = await adminClient.from("contas_a_pagar").insert({
        descricao: `Óleo — ${fornecedor || "fornecedor"}`,
        fornecedor: fornecedor || null,
        // "oleo_sede": a linha do DRE que já promete "compra direta e
        // coletas pagas pela sede". Categoria fora do plano fazia a conta
        // paga cair no "Não classificado".
        categoria: "oleo_sede",
        valor,
        vencimento: jaPagou ? pagoEmSede : vencimento,
        status: jaPagou ? "paga" : "a_pagar",
        ...(jaPagou
          ? {
              pago_em: pagoEmSede,
              forma_pagamento: String(ps!.forma),
              conta_id: String(ps!.conta_id),
            }
          : {}),
        origem_tipo: "coleta",
        origem_id: id,
        registrado_por: admin.id,
      });
      if (eConta) {
        return NextResponse.json({
          ok: true,
          aviso: `coleta salva, mas a conta a pagar não nasceu: ${eConta.message}`,
        });
      }
    }
  }

  // DESMARCAR "paga pela sede": a coleta volta a descontar do motorista, e a
  // dívida com o fornecedor tem que morrer junto — senão o mesmo óleo sai
  // duas vezes (do saldo do motorista E da conta que continuava de pé).
  // Se a conta JÁ FOI PAGA, o dinheiro da empresa saiu de verdade: aí
  // desmarcar é que seria o erro, e o pedido é recusado com explicação.
  const desmarcandoAgora =
    updates.pago_pela_sede === false && antes?.pago_pela_sede === true;
  if (desmarcandoAgora) {
    const { data: contaPagaSede } = await adminClient
      .from("contas_a_pagar")
      .select("id")
      .eq("origem_tipo", "coleta")
      .eq("origem_id", id)
      .eq("status", "paga")
      .maybeSingle();
    if (contaPagaSede) {
      // Reverte o flag: a coleta continua marcada como paga pela sede.
      await adminClient
        .from("coletas")
        .update({ pago_pela_sede: true })
        .eq("id", id);
      return NextResponse.json(
        {
          error:
            "a conta dessa coleta JÁ FOI PAGA pela empresa — desmarcar agora descontaria do motorista um óleo que a sede pagou. Se o pagamento foi lançado errado, apague o pagamento primeiro (em Lançamentos).",
        },
        { status: 409 }
      );
    }
    const { error: eCancela } = await adminClient
      .from("contas_a_pagar")
      .delete()
      .eq("origem_tipo", "coleta")
      .eq("origem_id", id)
      .in("status", ["prevista", "a_pagar"]);
    if (eCancela) {
      return NextResponse.json({
        ok: true,
        aviso: `coleta salva, mas a conta do fornecedor não foi desfeita: ${eCancela.message}`,
      });
    }
  }

  // Corrigir VALOR ou NOME de uma coleta já marcada como paga pela sede
  // corrige a dívida com o fornecedor junto — cobrindo os três estados:
  //   • conta ABERTA: acompanha valor e fornecedor;
  //   • conta que NUNCA NASCEU (coleta marcada com R$ 0 — doação — e
  //     corrigida depois): nasce agora, senão o dinheiro evapora — não
  //     desconta do motorista, não vira dívida e não entra no DRE;
  //   • conta JÁ PAGA: fica quieta (é história), mas a divergência deixa
  //     de ser silenciosa — a tela avisa.
  const avisos: string[] = [];
  if (
    antes?.pago_pela_sede === true &&
    updates.pago_pela_sede !== false &&
    !marcandoAgora &&
    (updates.valor_pago !== undefined ||
      updates.valor_sede !== undefined ||
      updates.local_nome !== undefined)
  ) {
    // De novo: a conta segue a PARTE DA SEDE, não o valor cheio.
    const valorNovo =
      updates.valor_sede !== undefined
        ? Number(updates.valor_sede)
        : Number(antes?.valor_sede ?? 0);
    const nomeNovo = String(updates.local_nome ?? antes?.local_nome ?? "").trim();

    const { data: contasDaColeta } = await adminClient
      .from("contas_a_pagar")
      .select("id, status, valor")
      .eq("origem_tipo", "coleta")
      .eq("origem_id", id)
      .in("status", ["prevista", "a_pagar", "paga"]);
    const contaPaga = (contasDaColeta ?? []).find((c) => c.status === "paga");
    const contaAberta = (contasDaColeta ?? []).find((c) => c.status !== "paga");

    if (contaPaga) {
      if (
        (updates.valor_pago !== undefined || updates.valor_sede !== undefined) &&
        Math.round(Number(contaPaga.valor) * 100) !== Math.round(valorNovo * 100)
      ) {
        avisos.push(
          `a conta dessa coleta já foi PAGA com R$ ${Number(contaPaga.valor).toFixed(2).replace(".", ",")} — o valor novo NÃO altera o pagamento; se pagou errado, apague o pagamento em Lançamentos e refaça`
        );
      }
    } else if (contaAberta) {
      if (valorNovo > 0) {
        const ajuste: Record<string, unknown> = { valor: valorNovo };
        if (updates.local_nome !== undefined) {
          ajuste.fornecedor = nomeNovo || null;
          ajuste.descricao = `Óleo — ${nomeNovo || "fornecedor"}`;
        }
        const { error: eAjuste } = await adminClient
          .from("contas_a_pagar")
          .update(ajuste)
          .eq("id", contaAberta.id);
        if (eAjuste) {
          avisos.push(
            `a conta do fornecedor não acompanhou a correção: ${eAjuste.message}`
          );
        }
      } else {
        // Virou doação (R$ 0): a dívida deixa de existir.
        await adminClient.from("contas_a_pagar").delete().eq("id", contaAberta.id);
        avisos.push("valor zerado (doação): a dívida com o fornecedor foi removida");
      }
    } else if (
      valorNovo > 0 &&
      (updates.valor_pago !== undefined || updates.valor_sede !== undefined)
    ) {
      // A coleta era da sede com R$ 0 e ganhou valor: a dívida nasce AGORA.
      const hojeBr = new Date(Date.now() - 3 * 60 * 60 * 1000);
      const venc = new Date(
        Date.UTC(hojeBr.getUTCFullYear(), hojeBr.getUTCMonth() + 1, 1)
      )
        .toISOString()
        .slice(0, 10);
      const { error: eNova } = await adminClient.from("contas_a_pagar").insert({
        descricao: `Óleo — ${nomeNovo || "fornecedor"}`,
        fornecedor: nomeNovo || null,
        categoria: "oleo_sede",
        valor: valorNovo,
        vencimento: venc,
        status: "a_pagar",
        origem_tipo: "coleta",
        origem_id: id,
        registrado_por: admin.id,
      });
      if (eNova) {
        avisos.push(`a dívida com o fornecedor não nasceu: ${eNova.message}`);
      } else {
        avisos.push(
          `a dívida com o fornecedor nasceu agora (R$ ${valorNovo.toFixed(2).replace(".", ",")}, vence dia 1 do mês que vem — ajuste em Contas a pagar se for outro combinado)`
        );
      }
    }
  }

  return NextResponse.json({
    ok: true,
    ...(avisos.length > 0 ? { aviso: avisos.join(". ") } : {}),
  });
}

/**
 * DELETE — apaga a coleta E desfaz a conta amarrada (paga pela sede).
 *
 * Antes o drawer deletava direto do navegador: a conta a pagar ficava órfã
 * (a empresa "devendo" por um óleo que não existe mais) e o delete nem
 * entrava no /admin/log (o trigger só registra com service key). Agora todo
 * caminho passa por aqui.
 */
export async function DELETE(_req: NextRequest, { params }: RouteParams) {
  const admin = await exigirAdmin();
  if (!admin) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const { id } = await params;
  const adminClient = getSupabaseAdmin(admin.id);

  const { data: coleta } = await adminClient
    .from("coletas")
    .select("foto_path")
    .eq("id", id)
    .maybeSingle();

  // Conta ABERTA morre junto; conta PAGA fica (o dinheiro saiu de verdade)
  // e quem apagou fica sabendo — mesmo padrão do abastecimento.
  const { data: contaPaga } = await adminClient
    .from("contas_a_pagar")
    .select("id")
    .eq("origem_tipo", "coleta")
    .eq("origem_id", id)
    .eq("status", "paga")
    .maybeSingle();
  const { error: eConta } = await adminClient
    .from("contas_a_pagar")
    .delete()
    .eq("origem_tipo", "coleta")
    .eq("origem_id", id)
    .in("status", ["prevista", "a_pagar"]);
  if (eConta) return NextResponse.json({ error: eConta.message }, { status: 400 });

  const { error } = await adminClient.from("coletas").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  if (coleta?.foto_path) {
    await adminClient.storage.from("fotos-coletas").remove([coleta.foto_path]);
  }
  return NextResponse.json({
    ok: true,
    ...(contaPaga
      ? {
          aviso:
            "a conta dessa coleta JÁ FOI PAGA — o pagamento continua no histórico e no DRE; confira se o acerto com o fornecedor aconteceu de verdade",
        }
      : {}),
  });
}
