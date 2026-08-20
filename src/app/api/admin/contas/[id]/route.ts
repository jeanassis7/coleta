import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { exigirAdmin } from "@/lib/auth/exigir-admin";
const n2 = (v: number) => Math.round(v * 100) / 100;

/**
 * PATCH — três ações:
 *
 *  pagar     → marca como paga. Escolhendo cheque, o papel sai da carteira
 *              e vira 'repassado' com esta conta como destino. É o elo entre
 *              o cheque que entrou numa venda e a conta que ele quita.
 *  confirmar → previsão vira conta real (o boleto chegou e o valor é outro).
 *  cancelar  → some das contas sem apagar o histórico.
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const admin = await exigirAdmin();
  if (!admin) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const { id } = await params;
  const body = await req.json();
  const acao = String(body.acao || "");
  const client = getSupabaseAdmin(admin.id);
  const hoje = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString().slice(0, 10);

  if (acao === "cancelar") {
    const { data, error } = await client
      .from("contas_a_pagar")
      .update({ status: "cancelada" })
      .eq("id", id)
      .in("status", ["prevista", "a_pagar"])
      .select();
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    if (!data?.length) {
      return NextResponse.json(
        { error: "essa conta já mudou de situação — recarregue a tela" },
        { status: 409 }
      );
    }
    return NextResponse.json({ ok: true });
  }

  // Corrigir valor/vencimento de uma conta AINDA NÃO PAGA é seguro por
  // definição: o que gira pro DRE e pro caixa é o PAGAMENTO — enquanto a
  // conta deve, ela é só uma promessa, e promessa se corrige. O caso real
  // do Evaner: o óleo pago pela sede tem valor certo mas o vencimento é
  // combinado depois (3, 15 ou 30 dias).
  if (acao === "editar") {
    const updates: Record<string, unknown> = {};
    if (body.valor !== undefined) {
      const valor = Number(body.valor);
      if (!Number.isFinite(valor) || valor <= 0) {
        return NextResponse.json({ error: "valor inválido" }, { status: 400 });
      }
      updates.valor = n2(valor);
    }
    if (body.vencimento !== undefined) {
      const vencimento = String(body.vencimento || "").trim();
      if (!/^\d{4}-\d{2}-\d{2}$/.test(vencimento)) {
        return NextResponse.json({ error: "vencimento inválido" }, { status: 400 });
      }
      updates.vencimento = vencimento;
    }
    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ error: "nada a atualizar" }, { status: 400 });
    }
    const { data, error } = await client
      .from("contas_a_pagar")
      .update(updates)
      .eq("id", id)
      .in("status", ["prevista", "a_pagar"])
      .select();
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    if (!data?.length) {
      return NextResponse.json(
        { error: "essa conta já foi paga ou cancelada — recarregue a tela" },
        { status: 409 }
      );
    }
    return NextResponse.json({ ok: true });
  }

  if (acao === "confirmar") {
    const valor = Number(body.valor);
    const vencimento = String(body.vencimento || "").trim();
    if (!Number.isFinite(valor) || valor <= 0) {
      return NextResponse.json({ error: "valor inválido" }, { status: 400 });
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(vencimento)) {
      return NextResponse.json({ error: "vencimento inválido" }, { status: 400 });
    }
    const { data, error } = await client
      .from("contas_a_pagar")
      .update({ status: "a_pagar", valor: n2(valor), vencimento })
      .eq("id", id)
      .eq("status", "prevista")
      .select();
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    if (!data?.length) {
      return NextResponse.json({ error: "essa conta não é uma previsão" }, { status: 409 });
    }
    return NextResponse.json({ ok: true });
  }

  if (acao !== "pagar") {
    return NextResponse.json({ error: "ação inválida" }, { status: 400 });
  }

  const forma = String(body.forma_pagamento || "");
  if (!["dinheiro", "pix", "deposito", "boleto", "cheque"].includes(forma)) {
    return NextResponse.json({ error: "forma de pagamento inválida" }, { status: 400 });
  }

  // Pagar COM cheque não tira dinheiro de conta nenhuma: quitou com o papel,
  // que sai da carteira e vira 'repassado'. Nas outras formas o dinheiro saiu
  // de algum lugar agora, e sem dizer de onde o caixa não fecha.
  const contaId = body.conta_id ? String(body.conta_id) : null;
  if (forma !== "cheque" && !contaId) {
    return NextResponse.json(
      { error: "diga de qual conta saiu o dinheiro" },
      { status: 400 }
    );
  }
  const pagoEm =
    body.pago_em && /^\d{4}-\d{2}-\d{2}$/.test(body.pago_em) ? body.pago_em : hoje;

  let chequeId: string | null = null;
  if (forma === "cheque") {
    chequeId = String(body.cheque_id || "") || null;
    if (!chequeId) {
      return NextResponse.json(
        { error: "escolha qual cheque da carteira vai pagar" },
        { status: 400 }
      );
    }
    // Tira da carteira ANTES de quitar a conta: se o cheque já tiver sido
    // usado em outra aba, a conta não pode ficar marcada como paga por um
    // papel que não está mais lá.
    const { data: ch, error: eCh } = await client
      .from("cheques")
      .update({
        status: "repassado",
        repassado_em: pagoEm,
        repassado_para: String(body.repassado_para || "").trim() || null,
      })
      .eq("id", chequeId)
      .eq("status", "em_carteira")
      .select();
    if (eCh) return NextResponse.json({ error: eCh.message }, { status: 400 });
    if (!ch?.length) {
      return NextResponse.json(
        { error: "esse cheque não está mais na carteira — recarregue a tela" },
        { status: 409 }
      );
    }
  }

  const { data, error } = await client
    .from("contas_a_pagar")
    .update({
      status: "paga",
      forma_pagamento: forma,
      pago_em: pagoEm,
      cheque_id: chequeId,
      conta_id: forma === "cheque" ? null : contaId,
    })
    .eq("id", id)
    .in("status", ["prevista", "a_pagar"])
    .select();

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  if (!data?.length) {
    // Devolve o cheque pra carteira: a conta não foi paga por ele.
    if (chequeId) {
      await client
        .from("cheques")
        .update({ status: "em_carteira", repassado_em: null, repassado_para: null })
        .eq("id", chequeId);
    }
    return NextResponse.json(
      { error: "essa conta já mudou de situação — recarregue a tela" },
      { status: 409 }
    );
  }
  return NextResponse.json({ ok: true });
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const admin = await exigirAdmin();
  if (!admin) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const { id } = await params;
  const client = getSupabaseAdmin(admin.id);

  // Apagar um pagamento desfaz TUDO que ele fez — senão fica ponta solta:
  //  - o cheque que pagou a conta ficava 'repassado' pra sempre (fora da
  //    carteira, sem despesa correspondente);
  //  - o vale marcado como quitado sumia da lista de pendentes sem nunca
  //    ter sido descontado de salário nenhum (o FK só limpava o ponteiro).
  const { data: conta } = await client
    .from("contas_a_pagar")
    .select("cheque_id, status")
    .eq("id", id)
    .maybeSingle();

  const desfeito: string[] = [];

  if (conta?.cheque_id) {
    const { data: ch, error: eCh } = await client
      .from("cheques")
      .update({ status: "em_carteira", repassado_em: null, repassado_para: null })
      .eq("id", conta.cheque_id)
      .eq("status", "repassado")
      .select("banco, valor");
    if (eCh) return NextResponse.json({ error: eCh.message }, { status: 400 });
    if (ch?.length) {
      desfeito.push(
        `o cheque ${ch[0].banco} de R$ ${Number(ch[0].valor).toFixed(2).replace(".", ",")} voltou pra carteira`
      );
    }
  }

  const { data: vales, error: eVales } = await client
    .from("acertos")
    .update({ vale_quitado_em: null, vale_quitado_por: null })
    .eq("vale_quitado_por", id)
    .select("id");
  if (eVales) return NextResponse.json({ error: eVales.message }, { status: 400 });
  if (vales?.length) {
    desfeito.push(
      `${vales.length} vale(s) voltou(aram) a ficar pendente(s) — o desconto não aconteceu`
    );
  }

  const { error } = await client.from("contas_a_pagar").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ ok: true, desfeito });
}
