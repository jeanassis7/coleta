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
  };

  // Valida e monta updates
  const updates: Record<string, unknown> = {};

  if (typeof body.litros === "number" && body.litros > 0) {
    updates.litros = body.litros;
  }
  if (typeof body.local_nome === "string" && body.local_nome.trim()) {
    updates.local_nome = body.local_nome.trim();
  }
  if (typeof body.valor_pago === "number" && body.valor_pago > 0) {
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

  if (typeof body.pago_pela_sede === "boolean") {
    updates.pago_pela_sede = body.pago_pela_sede;
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: "nada a atualizar" }, { status: 400 });
  }

  const adminClient = getSupabaseAdmin(admin.id);

  // Estado ANTES, pra saber se está marcando agora ou se já estava marcada
  // (evita criar a mesma dívida duas vezes ao salvar de novo).
  const { data: antes } = await adminClient
    .from("coletas")
    .select("pago_pela_sede, valor_pago, local_nome, criado_em")
    .eq("id", id)
    .maybeSingle();

  const { error } = await adminClient
    .from("coletas")
    .update(updates)
    .eq("id", id);

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  const marcandoAgora =
    updates.pago_pela_sede === true && antes?.pago_pela_sede !== true;

  if (marcandoAgora) {
    const valor = Number(updates.valor_pago ?? antes?.valor_pago ?? 0);
    const fornecedor = String(updates.local_nome ?? antes?.local_nome ?? "").trim();
    // Sem vencimento informado, cai no dia 1 do mês que vem — que é como
    // o combinado costuma ser ("pago início mês que vem").
    let vencimento = String(body.vencimento || "");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(vencimento)) {
      const hoje = new Date(Date.now() - 3 * 60 * 60 * 1000);
      const prox = new Date(Date.UTC(hoje.getUTCFullYear(), hoje.getUTCMonth() + 1, 1));
      vencimento = prox.toISOString().slice(0, 10);
    }

    if (valor > 0) {
      const { error: eConta } = await adminClient.from("contas_a_pagar").insert({
        descricao: `Óleo — ${fornecedor || "fornecedor"}`,
        fornecedor: fornecedor || null,
        // "oleo_sede": a linha do DRE que já promete "compra direta e
        // coletas pagas pela sede". Categoria fora do plano fazia a conta
        // paga cair no "Não classificado".
        categoria: "oleo_sede",
        valor,
        vencimento,
        status: "a_pagar",
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

  // Corrigir o VALOR de uma coleta já marcada como paga pela sede corrige a
  // dívida com o fornecedor junto (só enquanto não foi paga).
  if (
    updates.valor_pago !== undefined &&
    antes?.pago_pela_sede === true &&
    updates.pago_pela_sede !== false
  ) {
    const { error: eAjuste } = await adminClient
      .from("contas_a_pagar")
      .update({ valor: Number(updates.valor_pago) })
      .eq("origem_tipo", "coleta")
      .eq("origem_id", id)
      .in("status", ["prevista", "a_pagar"]);
    if (eAjuste) {
      return NextResponse.json({
        ok: true,
        aviso: `coleta salva, mas a conta do fornecedor não acompanhou o valor: ${eAjuste.message}`,
      });
    }
  }

  return NextResponse.json({ ok: true });
}
